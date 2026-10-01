// Orquestador del dashboard: estado de filtros, carga de datos y render reactivo.
import { CONFIG } from './config.js';
import { loadData, loadWeekIndex, loadWeeks, sourceMode } from './js/connector.js';
import { normalizeTable } from './js/normalize.js';
import { applyFilters, computeKPIs, crossTab, periodRange, uniqueSorted, yearsIn, MONTH_NAMES } from './js/filters.js';
import { renderCharts } from './js/charts.js';
import { renderTable } from './js/table.js';
import { renderWeekly } from './js/weekly.js';
import { STATUS, CATEGORY, $, esc, fillSelect, fmtInt, fmtTime } from './js/ui.js';

const FILTERS_KEY = 'bios-trafico:filters:v3';
// Solo el periodo se recuerda entre visitas; los filtros de detalle se descartan al recargar.
const PERSISTED = ['dateField', 'period', 'year', 'month', 'quarter', 'half'];
const now = new Date();
const DEFAULTS = {
  dateField: 'ingreso', period: 'year', year: now.getFullYear(), month: now.getMonth() + 1,
  quarter: Math.floor(now.getMonth() / 3) + 1, half: now.getMonth() < 6 ? 1 : 2,
  gerente: '', responsable: '', estado: '', categoria: '', q: '',
};

const state = { ...DEFAULTS, ...readSaved() };
const view = { page: 1, sortKey: 'ingreso', sortDir: -1 };
let records = [], issues = [], lastLoad = null;
const weeks = { index: null, loaded: [], loading: null, error: null };

function readSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(FILTERS_KEY));
    return s && typeof s === 'object' ? Object.fromEntries(PERSISTED.filter((k) => k in s).map((k) => [k, s[k]])) : {};
  } catch { return {}; }
}
function saveFilters() {
  try { localStorage.setItem(FILTERS_KEY, JSON.stringify(Object.fromEntries(PERSISTED.map((k) => [k, state[k]])))); } catch { /* sin almacenamiento */ }
}

/* ---------- Carga ---------- */

async function load(force = false) {
  const btn = $('#btnRefresh');
  btn.disabled = true;
  if (!lastLoad) setBanner('info', 'Conectando con Google Sheets…');
  try {
    const res = await loadData({ force });
    const opts = { dateOrder: CONFIG.DATE_ORDER, statuses: CONFIG.STATUSES, categories: CONFIG.CATEGORIES, clientFilter: CONFIG.CLIENT_FILTER };
    records = []; issues = [];
    for (const t of res.tabs) {
      const out = normalizeTable(t.rows, t.name, opts);
      records.push(...out.records);
      issues.push(...out.issues);
    }
    lastLoad = res;
    updateBanner();
    render();
  } catch (e) {
    if (lastLoad) { lastLoad = { ...lastLoad, origin: 'stale', error: e.message }; updateBanner(); }
    else setBanner('error', `No fue posible cargar los datos: ${e.message}`, true);
  } finally {
    btn.disabled = false;
  }
}

function setBanner(kind, html, retry = false) {
  const styles = {
    ok: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    info: 'bg-slate-50 text-slate-700 border-slate-200',
    warn: 'bg-amber-50 text-amber-900 border-amber-200',
    error: 'bg-red-50 text-red-800 border-red-200',
  };
  const el = $('#banner');
  el.className = `rounded-lg border px-3 py-2 text-sm flex flex-wrap items-center gap-2 ${styles[kind]}`;
  el.innerHTML = `<span>${html}</span>` +
    (retry ? '<button data-retry class="ml-auto rounded-md bg-white/70 border border-current px-2 py-0.5 text-xs font-medium hover:bg-white">Reintentar</button>' : '');
  el.querySelector('[data-retry]')?.addEventListener('click', () => load(true));
}

function updateBanner() {
  const { origin, ts, error } = lastLoad;
  const demo = sourceMode() === 'demo'
    ? '<b>MODO DEMO</b> (data/sample.csv) — configure <code>SHEET_ID</code> en config.js · ' : '';
  const n = `${fmtInt(records.length)} OTs${CONFIG.CLIENT_FILTER.length ? ` de ${esc(CONFIG.CLIENT_FILTER.join(', '))}` : ''}`;
  if (origin === 'stale') {
    setBanner('warn', `${demo}Sin conexión con la hoja — mostrando caché del ${fmtTime(ts)} (${n}). ${esc(error)}`, true);
  } else if (origin === 'cache') {
    setBanner(demo ? 'warn' : 'info', `${demo}Caché local del ${fmtTime(ts)} · ${n} · se consultará la hoja cada ${CONFIG.CACHE_TTL_MIN} min`);
  } else {
    setBanner(demo ? 'warn' : 'ok', `${demo}<span class="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span> Actualizado ${fmtTime(ts)} · ${n}`);
  }
}

/* ---------- Render ---------- */

function render() {
  saveFilters();
  syncControls();
  const list = applyFilters(records, state);
  const k = computeKPIs(list);

  renderActiveFilters();
  renderKPIs(k);

  const range = periodRange(state);
  const fieldLabel = state.dateField === 'ingreso' ? 'INGRESO' : 'ENTREGA';
  $('#periodLabel').textContent = range ? `${range.label} · por fecha de ${fieldLabel}` : `Todo el histórico · por fecha de ${fieldLabel}`;

  renderCharts(k, crossTab(list), pick);
  renderTable(list, view, CONFIG.PAGE_SIZE, render);
  renderIssues(range);
  syncWeekly();
}

// Chips de filtros de detalle activos (los que reducen el total), con ✕ para quitar cada uno.
const DETAIL = {
  categoria: (v) => `Tipo: ${CATEGORY[v]?.label ?? v}`,
  estado: (v) => `Estado: ${STATUS[v]?.label ?? v}`,
  gerente: (v) => `Gerente: ${v}`,
  responsable: (v) => `Responsable: ${v}`,
  q: (v) => `Búsqueda: "${v}"`,
};
function renderActiveFilters() {
  const active = Object.keys(DETAIL).filter((k) => state[k]);
  const box = $('#activeFilters');
  box.hidden = !active.length;
  box.innerHTML = '<span class="text-sm font-medium text-amber-900">Filtros activos:</span>' +
    active.map((k) => `<button data-clear="${k}" class="chip">${esc(DETAIL[k](state[k]))} ✕</button>`).join('') +
    '<button data-clear="*" class="chip chip-strong ml-auto">Quitar filtros</button>';
  box.onclick = (e) => {
    const k = e.target.closest('[data-clear]')?.dataset.clear;
    if (!k) return;
    for (const f of k === '*' ? active : [k]) state[f] = '';
    view.page = 1;
    render();
  };
}

// Tarjetas: total + una por estado configurado ("Sin estado" solo si hay filas sin estado).
function renderKPIs(k) {
  const pct = (n) => (k.total ? `${((n / k.total) * 100).toFixed(1)}%` : '—');
  const card = (label, value, color, sub) => `<div class="card"${color ? ` style="border-left:4px solid ${color}"` : ''}>
      <p class="kpi-label">${esc(label)}</p>
      <p class="kpi-value"${color ? ` style="color:${color}"` : ''}>${fmtInt(value)}</p>
      <p class="text-xs text-slate-500">${sub}</p></div>`;
  $('#kpis').innerHTML = card('Total OTs', k.total, '', CONFIG.CLIENT_FILTER.map(esc).join(', ')) +
    Object.values(STATUS).filter((s) => s.key !== 'otro' || k.otro)
      .map((s) => card(s.label, k[s.key] ?? 0, s.color, pct(k[s.key] ?? 0))).join('');
}

// Clic en un gráfico: aplica el filtro y lleva a la tabla.
function pick(sel) {
  Object.assign(state, sel);
  view.page = 1;
  render();
  $('#tableBody').closest('section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function syncControls() {
  fillSelect($('#year'), yearsIn(records, state.dateField, CONFIG.YEARS), state.year);
  state.year = +$('#year').value || DEFAULTS.year;
  fillSelect($('#fGerente'), uniqueSorted(records, 'gerente'), state.gerente, 'Todos los gerentes');
  fillSelect($('#fResponsable'), uniqueSorted(records, 'responsable', 'responsable2'), state.responsable, 'Todos los responsables');
  fillSelect($('#fCategoria'), Object.values(CATEGORY).map((c) => [c.key, c.label]), state.categoria, 'Todos los tipos');
  fillSelect($('#fEstado'), Object.entries(STATUS).map(([k, s]) => [k, s.label]), state.estado, 'Todos los estados');
  for (const id of ['dateField', 'period', 'month', 'quarter', 'half']) $(`#${id}`).value = state[id];
  $('#search').value = state.q;
  for (const p of ['month', 'quarter', 'half']) $(`#${p}`).hidden = state.period !== p;
  $('#year').hidden = state.period === 'all';
}

function renderIssues(range) {
  const noDate = range ? records.filter((r) => !r[state.dateField]).length : 0;
  const errors = issues.filter((i) => i.kind !== 'dateFix');
  const warns = issues.filter((i) => i.kind === 'dateFix');
  const box = $('#issues');
  box.hidden = !issues.length && !noDate;
  if (box.hidden) return;
  const parts = [];
  if (errors.length) parts.push(`${fmtInt(errors.length)} celdas con fecha/encabezado no válido`);
  if (warns.length) parts.push(`${fmtInt(warns.length)} fechas corregidas automáticamente`);
  if (noDate) parts.push(`${fmtInt(noDate)} OTs sin fecha de ${state.dateField.toUpperCase()} (excluidas del periodo)`);
  $('#issuesSummary').textContent = `⚠ Calidad de datos: ${parts.join(' · ')}`;
  $('#issuesList').innerHTML = issues.slice(0, 200).map((i) =>
    `<li><span class="font-mono text-xs text-slate-500">${esc(i.tab)} fila ${i.row}</span> · OT ${esc(i.ot || '—')} · ${esc(i.field)}: ${esc(i.msg)}</li>`
  ).join('') + (issues.length > 200 ? `<li>… y ${fmtInt(issues.length - 200)} más</li>` : '');
}

/* ---------- Flujo semanal (Cuadro Tango) ---------- */

const periodLabelText = () => periodRange(state)?.label ?? 'Todo el histórico';

// Semanas del índice que caen en el periodo global, más la anterior (para comparar la primera).
function weeksForPeriod() {
  const range = periodRange(state);
  if (!range) return weeks.index;
  const idx = weeks.index.map((t, i) => [t, i]).filter(([t]) => {
    const d = new Date(`${t.fecha}T00:00`);
    return d >= range.from && d < range.to;
  }).map(([, i]) => i);
  if (!idx.length) return [];
  return weeks.index.slice(Math.max(0, idx[0] - 1), idx.at(-1) + 1);
}

function drawWeekly() {
  if (sourceMode() !== 'apps_script') return renderWeekly(null);
  renderWeekly({
    semanas: weeks.loaded, total: weeks.index?.length ?? 0, loading: weeks.loading, error: weeks.error,
    range: periodRange(state), periodLabel: periodLabelText(),
    cross: new Map(records.map((r) => [r.codigo, r])),
    onLoadAll: () => refreshWeekly({ all: true }),
  });
}

// Carga las semanas del periodo (o todas) que falten; las ocultas quedan en caché local permanente.
async function refreshWeekly({ all = false, force = false } = {}) {
  if (sourceMode() !== 'apps_script' || weeks.loading) return;
  try {
    weeks.loading = 'Cargando semanas…';
    drawWeekly();
    weeks.index = await loadWeekIndex({ force });
    const loaded = new Map(weeks.loaded.map((w) => [w.gid, w]));
    const want = all ? weeks.index : weeksForPeriod();
    const missing = want.filter((t) => force || !loaded.has(t.gid));
    const got = await loadWeeks(missing, {
      force,
      onProgress: (done, total) => { weeks.loading = `Cargando semanas… ${done}/${total}`; drawWeekly(); },
    });
    for (const w of got) loaded.set(w.gid, w);
    const order = new Map(weeks.index.map((t, i) => [t.gid, i]));
    weeks.loaded = [...loaded.values()].filter((w) => order.has(w.gid)).sort((x, y) => order.get(x.gid) - order.get(y.gid));
    weeks.error = null;
  } catch (e) {
    weeks.error = `Flujo semanal: ${e.message}`;
  } finally {
    weeks.loading = null;
    drawWeekly();
  }
}

// Al cambiar el periodo global: dibuja con lo cargado y trae lo que falte de ese periodo.
function syncWeekly() {
  drawWeekly();
  if (weeks.index && weeksForPeriod().some((t) => !weeks.loaded.some((w) => w.gid === t.gid))) refreshWeekly();
}

/* ---------- Eventos ---------- */

function bind() {
  fillSelect($('#month'), MONTH_NAMES.map((m, i) => [i + 1, m]), state.month);
  const set = (key, cast = (v) => v) => (e) => { state[key] = cast(e.target.value); view.page = 1; render(); };
  $('#dateField').onchange = set('dateField');
  $('#period').onchange = set('period');
  $('#year').onchange = set('year', Number);
  $('#month').onchange = set('month', Number);
  $('#quarter').onchange = set('quarter', Number);
  $('#half').onchange = set('half', Number);
  $('#fGerente').onchange = set('gerente');
  $('#fResponsable').onchange = set('responsable');
  $('#fEstado').onchange = set('estado');
  $('#fCategoria').onchange = set('categoria');

  let t;
  $('#search').oninput = (e) => { clearTimeout(t); t = setTimeout(() => set('q')(e), 200); };

  $('#btnCurrentMonth').onclick = () => {
    const d = new Date();
    Object.assign(state, { period: 'month', year: d.getFullYear(), month: d.getMonth() + 1 });
    view.page = 1; render();
  };
  $('#btnReset').onclick = () => { Object.assign(state, DEFAULTS); view.page = 1; render(); };
  $('#btnRefresh').onclick = () => { load(true); refreshWeekly({ force: true }); };
  $('#prevPage').onclick = () => { view.page--; render(); };
  $('#nextPage').onclick = () => { view.page++; render(); };

  // "Tiempo real": refresco periódico solo con la pestaña visible; al volver o recuperar red se re-evalúa.
  setInterval(() => { if (!document.hidden) load(); }, CONFIG.AUTO_REFRESH_MIN * 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  window.addEventListener('online', () => load(true));
}

bind();
load();
refreshWeekly();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* PWA opcional */ });
}
