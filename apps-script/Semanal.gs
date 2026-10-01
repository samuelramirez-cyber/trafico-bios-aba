/**
 * Seguimiento semanal del libro "CUADRO TANGO - GRUPO BIOS".
 * El libro tiene una pestaña por semana ("1 SEPT", "6 OCTUBRE"...), la mayoría ocultas (histórico):
 * cada una es la foto de esa semana, con el estado de cada OT marcado por el COLOR de la celda "No".
 * Las pestañas cuyo nombre es una fecha se detectan solas (incluidas las ocultas); las demás se ignoran.
 *   ?view=pestanas         → índice de semanas (fecha inferida, gid, oculta)
 *   ?view=semana&gid=NNN   → OTs y estados de una semana
 *   ?view=semanas&gids=a,b → varias semanas en una llamada (máx. 40)
 * No escribe nada en el libro.
 */
const CUADRO_ID = 'PEGAR_AQUI_EL_ID_DEL_CUADRO';
const TOLERANCIA_COLOR = 40;          // distancia RGB para asociar un color a la leyenda
const PALABRAS_ESTADO = ['PENDIENTE', 'PROCESO', 'CORRECC', 'APROB'];
const MESES = { ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, SEP: 9, SET: 9, SPE: 9, OCT: 10, NOV: 11, DIC: 12 };
const CACHE_INDICE_SEG = 600;
const CACHE_VISIBLE_SEG = 300;        // semanas visibles (se siguen editando)
const CACHE_OCULTA_SEG = 21600;       // semanas ocultas (histórico): máximo de CacheService, 6 h

/** Índice de semanas, ordenado por fecha. El año se infiere por el orden de las pestañas. */
function pestanas_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('indice');
  if (hit) return hit;

  const sheets = SpreadsheetApp.openById(CUADRO_ID).getSheets();
  const semanas = [], otras = [];
  sheets.forEach((sh, i) => {
    const p = parsePestana_(sh.getName());
    if (p) semanas.push({ i, gid: sh.getSheetId(), nombre: sh.getName(), oculta: sh.isSheetHidden(), p });
    else otras.push(sh.getName());
  });

  // De la más reciente hacia atrás: si la fecha "salta" hacia adelante, se cambió de año.
  const hoy = new Date();
  let year = null, next = null;
  for (let k = semanas.length - 1; k >= 0; k--) {
    const p = semanas[k].p;
    if (p.y) year = p.y;
    else if (year === null) {
      year = hoy.getFullYear();
      if (new Date(year, p.m - 1, p.d) - hoy > 62 * 86400000) year--;
    } else if (new Date(year, p.m - 1, p.d) > next) year--;
    next = new Date(year, p.m - 1, p.d);
    semanas[k].fecha = Utilities.formatDate(next, 'America/Bogota', 'yyyy-MM-dd');
    delete semanas[k].p;
  }
  semanas.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.i - b.i));

  const payload = JSON.stringify({ ok: true, ts: new Date().toISOString(), semanas, otras });
  cache.put('indice', payload, CACHE_INDICE_SEG);
  return payload;
}

// "1 SEPT" / "6 OCTUBRE" / "2 SPETIEMBRE" / "10 JUNIO 26" / "15 de septiembre de 2025" → {d, m, y|null}
function parsePestana_(nombre) {
  const m = norm_(nombre).match(/^(\d{1,2}) (?:DE )?([A-Z]{3,})(?: (?:DE )?(\d{2}|\d{4}))?$/);
  const mes = m && MESES[m[2].slice(0, 3)];
  if (!mes || Number(m[1]) < 1 || Number(m[1]) > 31) return null;
  const y = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : null;
  return { d: Number(m[1]), m: mes, y };
}

/** Una semana: leyenda + [llave, texto OT, analista, tango, estado, ingreso, entrega, piezas] por OT. */
function semana_(gid) {
  return JSON.stringify(semanasObj_([gid])[0] || { ok: false, error: 'Semana no encontrada (gid ' + gid + ')' });
}

/** Varias semanas en una sola llamada (?view=semanas&gids=1,2,3): abre el libro una vez y usa la caché. */
function semanas_(gidsCsv) {
  const gids = String(gidsCsv || '').split(',').map(Number).filter((g) => !isNaN(g)).slice(0, 40);
  return JSON.stringify({ ok: true, semanas: semanasObj_(gids) });
}

function semanasObj_(gids) {
  const cache = CacheService.getScriptCache();
  const hits = cache.getAll(gids.map((g) => 'sem2_' + g));
  const faltan = gids.filter((g) => !hits['sem2_' + g]);
  const nuevas = {};
  if (faltan.length) {
    const sheets = SpreadsheetApp.openById(CUADRO_ID).getSheets();
    faltan.forEach((gid) => {
      const sh = sheets.find((s) => s.getSheetId() === gid);
      if (!sh) return;
      const json = JSON.stringify(leerSemana_(sh));
      nuevas[gid] = json;
      if (json.length < 95000) cache.put('sem2_' + gid, json, sh.isSheetHidden() ? CACHE_OCULTA_SEG : CACHE_VISIBLE_SEG);
    });
  }
  return gids.map((g) => hits['sem2_' + g] || nuevas[g]).filter(Boolean).map((j) => JSON.parse(j));
}

function leerSemana_(sh) {
  const gid = sh.getSheetId();
  const range = sh.getDataRange();
  const vals = range.getDisplayValues();
  const bgs = range.getBackgrounds();
  const head = vals.findIndex((r) => r.some((c) => norm_(c) === 'OT') && r.some((c) => norm_(c) === 'ANALISTA'));
  if (head < 0) return { ok: true, gid, nombre: sh.getName(), leyenda: [], items: [], error: 'Encabezado (OT, ANALISTA) no encontrado' };

  const H = vals[head].map(norm_);
  const c = { no: H.indexOf('NO'), ot: H.indexOf('OT'), an: H.indexOf('ANALISTA'), tg: H.indexOf('TANGO'),
    ing: H.indexOf('INGRESO'), ent: H.indexOf('ENTREGA'), pz: H.indexOf('PIEZAS') };
  const leyenda = leyenda_(vals, bgs, head);
  const vistos = {};
  const items = [];
  for (let i = head + 1; i < vals.length; i++) {
    const r = vals[i];
    const otTxt = String(r[c.ot]).trim();
    if (!otTxt || (c.no >= 0 && !/^\d+$/.test(String(r[c.no]).trim()))) continue;   // notas sueltas
    let key = llave_(otTxt);
    vistos[key] = (vistos[key] || 0) + 1;
    if (vistos[key] > 1) key += '#' + vistos[key];                                   // misma OT en varias filas
    const color = limpiaColor_(bgs[i][c.no >= 0 ? c.no : c.ot]);
    items.push([key, otTxt, val_(r, c.an), val_(r, c.tg), estadoPorColor_(color, leyenda), val_(r, c.ing), val_(r, c.ent), val_(r, c.pz)]);
  }
  return { ok: true, gid, nombre: sh.getName(), leyenda, items };
}

// Código nuevo "ot_001354_aba_..." (igual a DESCRIPCIÓN en OT's TANGO 2026) o el texto normalizado.
function llave_(otTxt) {
  const t = otTxt.trim().toLowerCase();
  return /^ot_\d+_/.test(t) ? t.split(/\s+/)[0] : norm_(otTxt);
}

// Leyenda sobre el encabezado: texto de estado + color en la misma celda o a su izquierda.
function leyenda_(vals, bgs, head) {
  const ley = [];
  for (let i = 0; i < head; i++) {
    vals[i].forEach((cell, j) => {
      const label = String(cell).trim();
      if (!label || !PALABRAS_ESTADO.some((p) => norm_(label).indexOf(p) >= 0)) return;
      const color = limpiaColor_(bgs[i][j]) || (j > 0 ? limpiaColor_(bgs[i][j - 1]) : '');
      if (color) ley.push({ label, color });
    });
  }
  return ley;
}

function estadoPorColor_(color, leyenda) {
  if (!color) return 'SIN ESTADO';
  let best = null, bestD = Infinity;
  leyenda.forEach((l) => { const d = distancia_(color, l.color); if (d < bestD) { best = l; bestD = d; } });
  return best && bestD <= TOLERANCIA_COLOR ? best.label : 'COLOR ' + color;
}

function val_(r, i) { return i >= 0 ? String(r[i]).trim() : ''; }

function limpiaColor_(h) {
  const s = String(h || '').toLowerCase();
  return /^#[0-9a-f]{6}$/.test(s) && s !== '#ffffff' ? s : '';
}

function distancia_(a, b) {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  return Math.hypot((x >> 16) - (y >> 16), ((x >> 8) & 255) - ((y >> 8) & 255), (x & 255) - (y & 255));
}
