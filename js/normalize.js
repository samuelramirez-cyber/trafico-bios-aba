// Normalización: CSV → filas, detección de encabezados, fechas, OT y estado (texto o color de celda).

const stripAccents = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '');

export const normKey = (s) => stripAccents(s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

// RFC 4180: comillas, comillas escapadas, saltos de línea dentro de celdas, CRLF y BOM.
export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  text = String(text);
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* ---------- Fechas ---------- */

const MONTHS = { ENE: 1, JAN: 1, FEB: 2, MAR: 3, ABR: 4, APR: 4, MAY: 5, JUN: 6, JUL: 7,
  AGO: 8, AUG: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DIC: 12, DEC: 12 };
const EMPTY_DATE = /^(|-+|N ?A|S ?F|SIN FECHA|PENDIENTE|POR DEFINIR|POR CONFIRMAR|TBD|NO APLICA)$/;

// Construye una fecha local validando que exista (rechaza 31/02, 00/13, etc.).
function mk(y, m, d) {
  if (y < 100) y += 2000;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  return dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
}

/**
 * Acepta: DD/MM/YYYY, D-M-YY, DD.MM.YYYY, YYYY-MM-DD (con o sin hora), "15-mar-2026",
 * "15 de marzo de 2026", serial de Excel (46096) y Date(2026,2,15) de gviz.
 * Devuelve { date } | { date: null } (vacío/placeholder) | { date: null, error } | { date, note }.
 */
export function parseDate(raw, order = 'DMY') {
  const s = String(raw ?? '').trim().replace(/\s*([-/.])\s*/g, '$1');   // "04/05 /2026" → "04/05/2026"
  const up = stripAccents(s).toUpperCase();
  if (EMPTY_DATE.test(normKey(s))) return { date: null };

  let m, date = null, note;
  if ((m = s.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})/))) {
    date = mk(+m[1], +m[2] + 1, +m[3]);
  } else if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[\sT])/))) {
    date = mk(+m[1], +m[2], +m[3]);
  } else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:$|\s)/))) {
    let [d, mo] = order === 'MDY' ? [+m[2], +m[1]] : [+m[1], +m[2]];
    if (mo > 12 && d <= 12) { [d, mo] = [mo, d]; note = 'día y mes invertidos'; }
    date = mk(+m[3], mo, d);
  } else if ((m = up.match(/^(\d{1,2})[\s\-/.]+(?:DE\s+)?([A-Z]{3,})\.?[\s\-/.]+(?:DEL?\s+)?(\d{2}|\d{4})$/))) {
    const mo = MONTHS[m[2].slice(0, 3)];
    date = mo ? mk(+m[3], mo, +m[1]) : null;
  } else if (/^\d{5}(\.\d+)?$/.test(s)) {
    const base = new Date(1899, 11, 30);
    base.setDate(base.getDate() + Math.floor(+s));
    date = mk(base.getFullYear(), base.getMonth() + 1, base.getDate());
  }
  if (!date) return { date: null, error: `Fecha no válida: "${s}"` };
  return note ? { date, note } : { date };
}

export const formatDate = (d) => d
  ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
  : '';

/* ---------- Encabezados ---------- */

export const FIELDS = {
  ot:          ['OT', 'N OT', 'NO OT', 'NRO OT', 'NUM OT', 'NUMERO OT', 'OT NO', 'ORDEN', 'ORDEN DE TRABAJO'],
  cliente:     ['CLIENTE', 'MARCA CLIENTE'],
  gerente:     ['GERENTE DIRECTOR', 'GERENTE', 'DIRECTOR', 'TANGO', 'EJECUTIVO'],
  responsable: ['RESPONSABLE 1', 'RESPONSABLE', 'ANALISTA'],
  responsable2: ['RESPONSABLE 2'],
  ingreso:     ['FECHA INGRESO', 'FECHA DE INGRESO', 'INGRESO', 'F INGRESO'],
  entrega:     ['FECHA ENTREGA', 'FECHA DE ENTREGA', 'ENTREGA', 'F ENTREGA'],
  estado:      ['ESTADO', 'STATUS', 'ESTATUS', 'ESTADO OT'],
  desc:        ['DESCRIPCION', 'PROYECTO', 'TRABAJO', 'NOMBRE'],
  pieza:       ['PIEZA', 'TIPO DE PIEZA', 'TIPO PIEZA'],
};
const DATE_FIELDS = new Set(['ingreso', 'entrega']);
const ID_RE = /^(OT[\s_-]*)?\d{3,}$/i;

// Primero coincidencia exacta en todos los campos; luego por palabra contenida
// (sin permitir que "FECHA ..." se tome como un campo que no es fecha).
export function mapColumns(header) {
  const keys = header.map(normKey);
  const map = {}, used = new Set();
  for (const [f, aliases] of Object.entries(FIELDS)) {
    const i = keys.findIndex((k, j) => !used.has(j) && aliases.includes(k));
    map[f] = i; if (i >= 0) used.add(i);
  }
  for (const [f, aliases] of Object.entries(FIELDS)) {
    if (map[f] >= 0) continue;
    const i = keys.findIndex((k, j) => !used.has(j) && k &&
      (DATE_FIELDS.has(f) || !k.includes('FECHA')) &&
      aliases.some((a) => ` ${k} `.includes(` ${a} `)));
    map[f] = i; if (i >= 0) used.add(i);
  }
  return map;
}

// Columna de OT sin encabezado: la primera vacía cuyas celdas siguientes parecen consecutivos (000123 / OT 000123).
function guessIdColumn(rows, headerIndex, map) {
  const used = new Set(Object.values(map));
  const sample = rows.slice(headerIndex + 1, headerIndex + 31);
  return rows[headerIndex].findIndex((h, j) => {
    if (used.has(j) || normKey(h)) return false;
    const vals = sample.map((r) => String(r[j] ?? '').trim()).filter(Boolean);
    return vals.length >= 3 && vals.filter((v) => ID_RE.test(v)).length / vals.length >= 0.8;
  });
}

// La hoja puede tener título encima del encabezado: se busca en las primeras 30 filas.
export function detectHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const map = mapColumns(rows[i]);
    const score = Object.values(map).filter((v) => v >= 0).length;
    if (score < 3) continue;
    if (map.ot < 0) map.ot = guessIdColumn(rows, i, map);
    if (map.ot >= 0) return { index: i, map };
  }
  return null;
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// "000010" → "OT 000010"; "ot_000010_aba_ajuste_empaque" → { ot: 'OT 000010', titulo: 'Ajuste empaque' }
export function splitOT(raw) {
  const s = String(raw ?? '').trim();
  const m = s.match(/^(\d{3,})$|\bOT[\s_.\-#]*(\d{3,})/i);
  if (!m) return { ot: s, titulo: '' };
  const titulo = `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}`
    .replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^((GRUPO BIOS|GRUPOBIOS|ABA)\b[\s:-]*)+/i, '').trim();
  return { ot: `OT ${m[1] ?? m[2]}`, titulo: capitalize(titulo) };
}

// Primera entrada de `list` ({ key, match[] }) cuyo término aparece como prefijo de palabra
// ('FACH' → fachada, fach); con '$' final exige la palabra completa ('INV$' → inv, no investigacion).
export function classify(text, list) {
  const k = ` ${normKey(text)} `;
  if (!k.trim()) return 'otro';
  const hit = (t) => (t.endsWith('$') ? k.includes(` ${t.slice(0, -1)} `) : k.includes(` ${t}`));
  return list.find((it) => it.match.some(hit))?.key ?? 'otro';
}

/* ---------- Tabla completa ---------- */

export function normalizeTable(rows, tab, { dateOrder = 'DMY', statuses = [], categories = [], clientFilter = [] } = {}) {
  const h = detectHeader(rows);
  if (!h) {
    return { records: [], skipped: 0, map: null,
      issues: [{ tab, row: 0, ot: '', kind: 'header', field: 'ENCABEZADO', msg: 'No se encontró la fila de encabezados (OT, CLIENTE, FECHA INGRESO…)' }] };
  }
  const { index, map } = h;
  const records = [], issues = [];
  const get = (r, f) => (map[f] >= 0 ? String(r[map[f]] ?? '').trim() : '');
  const clients = new Set(clientFilter.map(normKey));
  if (clients.size && map.cliente < 0) {
    issues.push({ tab, row: index + 1, ot: '', kind: 'header', field: 'ENCABEZADO', msg: 'No existe la columna CLIENTE para aplicar el filtro fijo' });
  }
  if (map.ingreso < 0 && map.entrega < 0) {
    issues.push({ tab, row: index + 1, ot: '', kind: 'header', field: 'ENCABEZADO', msg: 'Faltan columnas de fecha de ingreso y entrega' });
  }
  let skipped = 0;

  for (let i = index + 1; i < rows.length; i++) {
    const r = rows[i];
    const rawOT = get(r, 'ot');
    const otKey = normKey(rawOT);
    // filas vacías, encabezados repetidos y totales
    if (!otKey || otKey === 'OT' || /^(SUB)?TOTAL/.test(otKey)) continue;
    if (clients.size && !clients.has(normKey(get(r, 'cliente')))) { skipped++; continue; }

    const { ot } = splitOT(rawOT);
    const rawDesc = get(r, 'desc');
    const rec = { id: `${tab}:${i + 1}`, tab, row: i + 1, ot,
      cliente: get(r, 'cliente'), gerente: get(r, 'gerente'),
      responsable: get(r, 'responsable'), responsable2: get(r, 'responsable2'),
      desc: splitOT(rawDesc).titulo || rawDesc, pieza: get(r, 'pieza'),
      estadoRaw: get(r, 'estado'), issues: [] };

    for (const f of ['ingreso', 'entrega']) {
      const raw = get(r, f);
      const p = parseDate(raw, dateOrder);
      rec[f] = p.date;
      rec[`${f}Txt`] = formatDate(p.date);
      const msg = p.error || (p.note && `${raw} → ${rec[`${f}Txt`]} (${p.note})`);
      if (msg) {
        rec.issues.push(`${f.toUpperCase()}: ${msg}`);
        issues.push({ tab, row: i + 1, ot, kind: p.error ? 'date' : 'dateFix', field: f.toUpperCase(), msg });
      }
    }
    rec.estado = classify(rec.estadoRaw, statuses);
    rec.categoria = classify(`${rawDesc} ${rec.pieza}`, categories);
    rec._search = normKey([ot, rawDesc, rec.desc, rec.pieza, rec.gerente, rec.responsable, rec.responsable2, rec.estadoRaw].join(' '));
    records.push(rec);
  }
  return { records, issues, skipped, map };
}

