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
    ['fachadas', 'fachadas', 'invitaciones', 'eventos', 'empaques', 'otro', 'invitaciones', 'invitaciones', 'invitaciones', 'otro']);
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
  assert.equal(Object.entries(k).filter(([key]) => key !== 'total').reduce((a, [, v]) => a + v, 0), k.total);
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
