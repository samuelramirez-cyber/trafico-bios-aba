// Ejecutar: node --test tests/core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCSV, parseDate, formatDate, mapColumns, detectHeader, splitOT, classify, normalizeTable } from '../js/normalize.js';
import { periodRange, applyFilters, computeKPIs } from '../js/filters.js';
import { CONFIG } from '../config.js';
import { weeklyFlow, flowTotals } from '../js/weekly.js';

const fd = (s) => formatDate(parseDate(s).date);
const opts = { statuses: CONFIG.STATUSES, clientFilter: ['GRUPO BIOS ABA'] };

test('parseCSV: comillas, saltos de línea y BOM', () => {
  assert.deepEqual(parseCSV('﻿a,"b,1","c ""x"""\r\n1,"2\n3",\n'), [['a', 'b,1', 'c "x"'], ['1', '2\n3', '']]);
});

test('parseDate: formatos aceptados → DD/MM/YYYY', () => {
  assert.equal(fd('05/03/2026'), '05/03/2026');
  assert.equal(fd('5-3-26'), '05/03/2026');
  assert.equal(fd('3/01/2026'), '03/01/2026');
  assert.equal(fd('04/05 /2026'), '04/05/2026');
  assert.equal(fd('05.03.2026 14:30'), '05/03/2026');
  assert.equal(fd('2026-03-05T10:00:00'), '05/03/2026');
  assert.equal(fd('5 de Marzo de 2026'), '05/03/2026');
  assert.equal(fd('46086'), '05/03/2026');
});

test('parseDate: inválidas, vacías e invertidas', () => {
  for (const v of ['31/02/2025', '13/25/2025', '24/04', 'mañana', '01/01/1990']) assert.ok(parseDate(v).error, v);
  for (const v of ['', '-', 'N/A', 'Pendiente']) assert.deepEqual(parseDate(v), { date: null });
  const inv = parseDate('04/23/2025');
  assert.equal(formatDate(inv.date), '23/04/2025');
  assert.ok(inv.note);
});

test('encabezados: OT sin título se detecta por formato', () => {
  const rows = [
    ['  ', 'MES', 'GERENTE / DIRECTOR', 'CLIENTE', 'FECHA INGRESO', 'FECHA ENTREGA', 'DESCRIPCIÓN', 'PIEZA', 'CANTIDAD', 'RESPONSABLE 1', 'RESPONSABLE 2', 'ESTADO'],
    ...['000001', '000002', '000003'].map((n) => [n, 'Enero', 'G', 'X', '05/01/2026', '', '', '', '', '', '', '']),
  ];
  const { map } = detectHeader(rows);
  assert.deepEqual([map.ot, map.gerente, map.cliente, map.ingreso, map.entrega, map.desc, map.pieza, map.responsable, map.responsable2, map.estado],
    [0, 2, 3, 4, 5, 6, 7, 9, 10, 11]);
  assert.equal(mapColumns(['No. OT', 'Cliente', 'Fecha Ingreso']).ot, 0);
});

test('splitOT y estados', () => {
  assert.deepEqual(splitOT('000010'), { ot: 'OT 000010', titulo: '' });
  assert.deepEqual(splitOT('ot_000010_aba_ajuste_empaque_alfalfa'), { ot: 'OT 000010', titulo: 'Ajuste empaque alfalfa' });
  assert.equal(splitOT('Campaña 2026 de verano').ot, 'Campaña 2026 de verano');
  const c = (t) => classify(t, CONFIG.STATUSES);
  assert.deepEqual(['Entregado', 'En proceso', 'En revisión', 'En reproceso', 'No realizado', '', 'Otro raro'].map(c),
    ['entregado', 'proceso', 'revision', 'reproceso', 'norealizado', 'otro', 'otro']);
  const t = (s) => classify(s, CONFIG.CATEGORIES);
  assert.deepEqual(['ot_001169_aba_fachada_agro_holstein', 'ot_1_aba_fach_la18', 'ot_2_aba_invitacion_charla_leche',
    'ot_3_aba_charla_rodeo', 'ot_4_aba_ajuste_empaque', 'ot_5_aba_logo_lactia Diseño Grafico',
    'ot_6_aba_inv_charla_porci', 'ot_7_aba_invi_jornada_pdv', 'ot_8_aba_jornada_pdv_inv', 'ot_9_aba_investigacion_instagram'].map(t),
    ['fachadas', 'fachadas', 'invitaciones', 'eventos', 'empaques', 'marca', 'invitaciones', 'invitaciones', 'invitaciones', 'contenido']);
});

test('filtro fijo de cliente + filtros temporales sobre data/sample.csv', () => {
  const rows = parseCSV(readFileSync(new URL('../data/sample.csv', import.meta.url), 'utf8'));
  const { records, issues, skipped } = normalizeTable(rows, 'DEMO', opts);
  assert.ok(records.length > 150 && skipped > 50);
  assert.ok(records.every((r) => r.cliente === 'GRUPO BIOS ABA'));
  assert.ok(records.every((r) => /^OT \d{6}$/.test(r.ot)));

  const base = { dateField: 'ingreso', q: '', gerente: '', responsable: '', estado: '' };
  const y = applyFilters(records, { ...base, period: 'year', year: 2025 });
  const sum = (period, n, key) => Array.from({ length: n }, (_, i) =>
    applyFilters(records, { ...base, period, year: 2025, [key]: i + 1 }).length).reduce((a, b) => a + b);
  assert.equal(sum('half', 2, 'half'), y.length);
  assert.equal(sum('quarter', 4, 'quarter'), y.length);
  assert.equal(sum('month', 12, 'month'), y.length);
  assert.ok(y.every((r) => r.ingreso.getFullYear() === 2025));

  const k = computeKPIs(y);
  const states = Object.entries(k).filter(([key]) => !['total', 'pz'].includes(key));
  assert.equal(states.reduce((a, [, v]) => a + v, 0), k.total);
  assert.equal(k.pz.total, y.reduce((a, r) => a + (r.cantidad ?? 0), 0));
  assert.ok(k.pz.total > 0);
  assert.equal(states.reduce((a, [key]) => a + (k.pz[key] ?? 0), 0), k.pz.total);
  assert.ok(issues.some((i) => i.kind === 'date'));
});

test('periodRange: límites semiabiertos', () => {
  const r = periodRange({ period: 'quarter', year: 2026, quarter: 4 });
  assert.equal(+r.from, +new Date(2026, 9, 1));
  assert.equal(+r.to, +new Date(2027, 0, 1));
  assert.equal(periodRange({ period: 'all' }), null);
});

test('weeklyFlow: entradas, salidas (aprobadas/retiradas), activas y piezas', () => {
  const it = (key, estado, pz = '') => [key, key, 'ELI', 'ALEJO', estado, '', '', pz];
  const semanas = [
    { gid: 1, nombre: '15 SEPT', fecha: '2026-09-15', items: [it('ot_000001_aba_a', 'EN PROCESO', '2'), it('ot_000002_aba_b', 'EN PROCESO', '3'), it('ot_000003_aba_c', 'PENDIENTE INSUMO', '1')] },
    { gid: 2, nombre: '22 SEPT', fecha: '2026-09-22', items: [it('ot_000001_aba_a', 'EN PROCESO', '2'), it('ot_000002_aba_b', 'APROBADO', '3'), it('ot_000004_aba_d', 'EN PROCESO', 'AF')] },
    { gid: 3, nombre: '29 SEPT', fecha: '2026-09-29', items: [it('ot_000001_aba_a', 'APROBADO', '2'), it('ot_000004_aba_d', 'EN PROCESO', 'AF'), it('ot_000005_aba_e', 'EN PROCESO', '4')] },
  ];
  const cross = new Map([['ot_000004_aba_d', { cantidad: 6, estado: 'proceso' }]]);   // pieza "AF" → CANTIDAD de OT 2026
  const [w1, w2, w3] = weeklyFlow(semanas, cross);
  assert.ok(w1.base);
  assert.deepEqual([w1.entraron.length, w1.salieron.length, w1.activas.length], [0, 0, 3]);
  assert.deepEqual(w2.entraron.map((x) => x.key), ['ot_000004_aba_d']);
  assert.deepEqual(w2.salieron.map((x) => [x.key, x.salida]), [['ot_000002_aba_b', 'Aprobada'], ['ot_000003_aba_c', 'Retirada del cuadro']]);
  assert.deepEqual([w2.pzEntraron, w2.pzSalieron, w2.entraron[0].piezasFuente], [6, 4, 'OT 2026']);
  assert.deepEqual([w3.entraron.length, w3.salieron.length, w3.activas.length, w3.pzActivas], [1, 1, 2, 10]);   // la aprobada b se retira: no cuenta de nuevo
  const t = flowTotals([w1, w2, w3]);
  assert.deepEqual([t.semanas, t.entraron, t.salieron, t.pzEntraron, t.pzSalieron, t.activas], [2, 2, 3, 10, 6, 2]);
});

test('parrillas: cuentan como OT pero sus piezas no suman', () => {
  const rows = [
    ['  ', 'CLIENTE', 'FECHA INGRESO', 'DESCRIPCIÓN', 'CANTIDAD', 'ESTADO'],
    ['000001', 'GRUPO BIOS ABA', '10/09/2026', 'ot_000001_aba_parrilla', '640', 'En proceso'],
    ['000002', 'GRUPO BIOS ABA', '11/09/2026', 'ot_000002_aba_fachada_x', '3', 'En proceso'],
    ['000003', 'GRUPO BIOS ABA', '12/09/2026', 'ot_000003_aba_parrilla_redes_oct', '20', 'Entregado'],
  ];
  const { records } = normalizeTable(rows, 'T', { ...opts, piecesExclude: ['PARRILLA'] });
  const k = computeKPIs(records);
  assert.deepEqual([k.total, k.pz.total, k.pz.proceso, k.pzExcluidas], [3, 3, 3, 660]);
  assert.deepEqual(records.map((r) => [r.pzExcluida, r.cantidadTotal]), [[true, 640], [false, 3], [true, 20]]);
});

test('digital: meses del periodo, rango a pedir, agregados mensuales y métricas web', async () => {
  const { monthsInRange, fetchSpan, monthlyFromDaily, webMonth, socialSummary, deltaPct } = await import('../js/digital.js');
  const today = new Date(2026, 9, 2);
  assert.deepEqual(monthsInRange(periodRange({ period: 'month', year: 2026, month: 9 }), today), ['2026-09']);
  assert.deepEqual(monthsInRange(periodRange({ period: 'quarter', year: 2026, quarter: 4 }), today), ['2026-10']);
  assert.deepEqual(fetchSpan(['2026-07', '2026-08', '2026-09'], today), { from: '2026-06-01', to: '2026-09-30' });
  assert.deepEqual(fetchSpan(['2026-10'], today), { from: '2026-09-01', to: '2026-10-02' });
  const seg = [['2026-06-30', 19939], ['2026-07-01', 19942], ['2026-07-31', 20018]];
  assert.deepEqual(monthlyFromDaily(seg, 'last'), { '2026-06': 19939, '2026-07': 20018 });
  assert.deepEqual(monthlyFromDaily([['2026-07-01', 10], ['2026-07-02', 5]], 'sum'), { '2026-07': 15 });
  const s = socialSummary({ instagram: { seguidores: seg, impresiones: [['2026-06-15', 100], ['2026-07-15', 150]] } }, '2026-07');
  assert.deepEqual(s.instagram, { seg: 20018, segPrev: 19939, imp: 150, impPrev: 100 });
  assert.equal(deltaPct(150, 100), 50);
  const w = webMonth({ screenPageViews: 39065, newUsers: 7428, activeUsers: 100, userEngagementDuration: 6300,
    dispositivos: { mobile: 39, desktop: 61 }, tipoUsuario: { new: 66, returning: 34 } });
  assert.deepEqual([w.visitas, w.nuevos, w.permanencia, Math.round(w.pctCelular), w.pctNuevos, w.pctRecurrentes], [39065, 7428, 63, 39, 66, 34]);
  const adj = webMonth({ screenPageViews: 1, dispositivos: { mobile: 39, desktop: 61 }, tipoUsuario: { new: 66, returning: 34 },
    ajuste: { pctCelular: 1, pctComputador: 99, pctNuevos: 74.7, nota: 'Dato del informe' } });
  assert.deepEqual([adj.pctCelular, adj.pctComputador, adj.pctNuevos, Math.round(adj.pctRecurrentes * 10) / 10, adj.nota], [1, 99, 74.7, 25.3, 'Dato del informe']);
});

test('yearEvolution: nuevas, acumulado, entregadas y en curso por mes', async () => {
  const { yearEvolution } = await import('../js/filters.js');
  const d = (m, day) => new Date(2026, m - 1, day);
  const recs = [
    { ingreso: d(1, 5), entrega: d(1, 20), estado: 'entregado', cantidad: 2 },
    { ingreso: d(1, 10), entrega: d(2, 3), estado: 'entregado', cantidad: 3 },
    { ingreso: d(2, 1), entrega: null, estado: 'proceso', cantidad: 5 },
    { ingreso: d(2, 9), entrega: d(3, 1), estado: 'revision', cantidad: null },
  ];
  const rows = yearEvolution(recs, 2026, d(3, 15));
  assert.deepEqual(rows.map((r) => [r.mes, r.nuevas, r.acumulado, r.piezas, r.entregadas, r.enCurso]),
    [[1, 2, 2, 5, 1, 1], [2, 2, 4, 5, 1, 2], [3, 0, 4, 0, 0, 2]]);
  assert.equal(rows[1].deltaNuevas, 0);
  assert.equal(rows[2].deltaNuevas, -100);
  assert.equal(yearEvolution(recs, 2027, d(3, 15)).length, 0);
});

test('weeklyFlow: color sin leyenda mapeado a Cancelado cuenta como salida', async () => {
  const { weeklyFlow } = await import('../js/weekly.js');
  const it = (key, estado) => [key, key, 'ELI', '', estado, '', '', '1'];
  const [, w2] = weeklyFlow([
    { gid: 1, nombre: 'a', fecha: '2026-09-22', items: [it('ot_000001_aba_a', 'EN PROCESO'), it('ot_000002_aba_b', 'EN PROCESO')] },
    { gid: 2, nombre: 'b', fecha: '2026-09-29', items: [it('ot_000001_aba_a', 'COLOR #ff0000'), it('ot_000002_aba_b', 'COLOR #34a853')] },
  ]);
  assert.deepEqual(w2.salieron.map((x) => x.salida).sort(), ['Aprobada', 'Cancelada']);
  assert.equal(w2.activas.length, 0);
});

test('weeklyFlow: OTs con color excluido (gris) no cuentan', async () => {
  const { weeklyFlow } = await import('../js/weekly.js');
  const it = (key, estado) => [key, key, 'ELI', '', estado, '', '', '1'];
  const [w1, w2] = weeklyFlow([
    { gid: 1, nombre: 'a', fecha: '2026-09-22', items: [it('ot_000001_aba_a', 'EN PROCESO')] },
    { gid: 2, nombre: 'b', fecha: '2026-09-29', items: [it('ot_000001_aba_a', 'EN PROCESO'), it('ot_000009_aba_g', 'COLOR #b7b7b7'), it('ot_000010_aba_r', 'COLOR #ea4335')] },
  ]);
  assert.equal(w1.total, 1);
  assert.deepEqual([w2.total, w2.entraron.map((x) => x.key)], [2, ['ot_000010_aba_r']]);
  assert.equal(w2.activas.length, 1);   // la #ea4335 (cancelada) no es activa
});

test('tipo de trabajo: la PIEZA Campaña tiene prioridad y lanzamiento es campaña', () => {
  const rows = [
    ['  ', 'CLIENTE', 'FECHA INGRESO', 'DESCRIPCIÓN', 'PIEZA', 'ESTADO'],
    ['000001', 'GRUPO BIOS ABA', '10/09/2026', 'ot_000001_aba_jornada_porcicola', 'Campaña Táctica', 'Entregado'],
    ['000002', 'GRUPO BIOS ABA', '10/09/2026', 'ot_000002_aba_lanzamiento_semilla_soya', 'Diseño Grafico', 'Entregado'],
    ['000003', 'GRUPO BIOS ABA', '10/09/2026', 'ot_000003_aba_jornada_pdv', 'Diseño Digital', 'Entregado'],
    ['000004', 'GRUPO BIOS ABA', '10/09/2026', 'ot_000004_aba_valla_tulua', 'Diseño Grafico', 'Entregado'],
  ];
  const { records } = normalizeTable(rows, 'T', { ...opts, categories: CONFIG.CATEGORIES });
  assert.deepEqual(records.map((r) => r.categoria), ['campanas', 'campanas', 'eventos', 'pdv']);
});

test('evolutionMonths: de enero al mes elegido', async () => {
  const { evolutionMonths } = await import('../js/digital.js');
  assert.deepEqual(evolutionMonths(['2026-09']), ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
  assert.deepEqual(evolutionMonths(['2025-11', '2025-12', '2026-01']), ['2025-11', '2025-12', '2026-01']);
  assert.deepEqual(evolutionMonths([]), []);
});

test('parseTareas: encabezado, separadores de mes y año mal digitado', async () => {
  const { parseTareas } = await import('../js/tasks.js');
  const rows = [
    ['FINCA', '', '', '', '', '', ''],
    ['Tarea', 'Fecha Solicitud', 'Fecha Resolución', 'Responsable', 'Estado', 'Entregable', 'Notas'],
    ['Julio', '', '', '', '', '', ''],
    ['Ajuste de correo', '24/07/26', '24/07/26', 'David Uribe', 'Completa', '', ''],
    ['', '', '', '', '', '', ''],
    ['Agosto', '', '', '', '', '', ''],
    ['Publicación de producto rodeo', '04/08/06', '04/08/26', 'David Uribe', 'Completa', 'https://www.finca.co/rodeo', 'ok'],
    ['Organizar Excel', '29/09/26', '', 'David Uribe', '', '', ''],
  ];
  const t = parseTareas(rows);
  assert.equal(t.length, 3);
  assert.deepEqual(t.map((x) => x.mes), ['Julio', 'Agosto', 'Agosto']);
  assert.equal(t[1].solicitud.getFullYear(), 2026);           // 04/08/06 corregido con el año de la resolución
  assert.equal(formatDate(t[2].fecha), '29/09/2026');          // sin resolución → fecha de solicitud
});

test('interactionSummary: total, variación y engagement por red', async () => {
  const { interactionSummary } = await import('../js/interactions.js');
  const inter = { instagram: { '2026-08': { likes: 100, comentarios: 10 }, '2026-09': { likes: 150, comentarios: 20, guardados: 5 } } };
  const redes = { instagram: { impresiones: [['2026-08-10', 5000], ['2026-09-10', 10000]] } };
  const s = interactionSummary(inter, redes, '2026-09').instagram;
  assert.deepEqual([s.total, s.prevTotal, s.imp, s.eng, s.engPrev], [175, 110, 10000, 1.75, 2.2]);
});
