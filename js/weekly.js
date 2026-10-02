// Flujo semanal del Cuadro Tango: cuántas OTs (y piezas) entran y salen cada semana.
// Cada pestaña semanal es una foto; se compara con la anterior. Estado = color de la celda "No".
//   Entraron: aparecen por primera vez en la pestaña.
//   Salieron: pasaron a Aprobado o Cancelado esa semana, o se retiraron del cuadro sin cerrarse.
//   Activas:  ni aprobadas ni canceladas al cierre de la semana.
// Piezas: columna PIEZAS del cuadro; si no es un número, CANTIDAD de OT's TANGO 2026 (cruce por código ot_XXXXXX_).
import { CONFIG } from '../config.js';
import { normKey, splitOT, parseCount } from './normalize.js';
import { upsert } from './charts.js';
import { STATUS, CATEGORY, badge, $, esc, fmtInt } from './ui.js';

const isApproved = (estado) => normKey(estado).startsWith('APROB');
const isCancelled = (estado) => normKey(estado).startsWith('CANCEL');
const isClosed = (estado) => isApproved(estado) || isCancelled(estado);   // fuera del flujo activo
const fixColor = (estado) => CONFIG.CUADRO_COLORES[String(estado).replace(/^COLOR /i, '').toLowerCase()] ?? estado;

export const prettyStatus = (s) => {
  const t = String(s || '').toLowerCase();
  return t.startsWith('color #') ? `Color sin leyenda (${t.slice(6)})` : t.charAt(0).toUpperCase() + t.slice(1);
};

// [llave, texto OT, analista, tango, estado, ingreso, entrega, piezas] → objeto (con cruce a OT 2026)
export function toItem([key, otTxt, analista, tango, estado, ingreso, entrega, piezasTxt], cross = new Map()) {
  const { ot, titulo } = splitOT(otTxt);
  const codigo = key.split('#')[0];
  const ot26 = cross.get(codigo) ?? null;
  const excluida = CONFIG.PIECES_EXCLUDE.length > 0 && normKey(`${otTxt} ${key}`).split(' ').some((w) => CONFIG.PIECES_EXCLUDE.some((t) => w.startsWith(t)));
  const pzCuadro = excluida ? null : parseCount(piezasTxt);
  const piezas = excluida ? null : pzCuadro ?? ot26?.cantidad ?? null;
  return {
    key, codigo, ot: titulo ? ot : '', titulo: titulo || otTxt, analista, tango, estado: fixColor(estado),
    ingreso, entrega, ot26, piezas, excluida, piezasFuente: pzCuadro != null ? 'cuadro' : piezas != null ? 'OT 2026' : null,
  };
}

const sumPz = (list) => list.reduce((a, it) => a + (it.piezas ?? 0), 0);

/** Flujo de cada semana contra la anterior. La primera semana es la línea base (sin entradas/salidas). */
export function weeklyFlow(semanas, cross = new Map()) {
  let prev = null;
  return semanas.map((w) => {
    const cur = new Map(w.items.map((r) => { const it = toItem(r, cross); return [it.key, it]; }));
    const entraron = prev ? [...cur.values()].filter((it) => !prev.has(it.key)) : [];
    // Salida = pasó a Aprobado o Cancelado esa semana, o se retiró del cuadro sin cerrarse.
    const cerradas = prev ? [...cur.values()].filter((it) => isClosed(it.estado) && prev.has(it.key) && !isClosed(prev.get(it.key).estado)) : [];
    const retiradas = prev ? [...prev.values()].filter((it) => !cur.has(it.key) && !isClosed(it.estado)) : [];
    const activas = [...cur.values()].filter((it) => !isClosed(it.estado));
    const base = prev === null;
    prev = cur;
    const salieron = [...cerradas.map((it) => ({ ...it, salida: isCancelled(it.estado) ? 'Cancelada' : 'Aprobada' })),
      ...retiradas.map((it) => ({ ...it, salida: 'Retirada del cuadro' }))];
    return {
      gid: w.gid, nombre: w.nombre, fecha: w.fecha, base,
      total: cur.size, entraron, salieron, activas, todas: [...cur.values()],
      pzEntraron: sumPz(entraron), pzSalieron: sumPz(salieron), pzActivas: sumPz(activas),
      sinPiezas: entraron.filter((it) => it.piezas == null && !it.excluida).length + salieron.filter((it) => it.piezas == null && !it.excluida).length,
    };
  });
}

/** Totales de un rango de semanas del flujo (excluye la línea base). */
export function flowTotals(flow) {
  const f = flow.filter((x) => !x.base);
  const s = (k) => f.reduce((a, x) => a + (typeof x[k] === 'number' ? x[k] : x[k].length), 0);
  return {
    semanas: f.length, entraron: s('entraron'), salieron: s('salieron'), pzEntraron: s('pzEntraron'), pzSalieron: s('pzSalieron'),
    activas: flow.at(-1)?.activas.length ?? 0, pzActivas: flow.at(-1)?.pzActivas ?? 0,
  };
}

/* ---------- Render ---------- */

const view = { gid: null, tab: 'entraron', q: '' };
const COLORS = { entraron: '#2563eb', salieron: '#16a34a', activas: '#94a3b8' };

const kpi = (label, value, sub = '', color = '') => `<div class="card"${color ? ` style="border-left:4px solid ${color}"` : ''}>
  <p class="kpi-label">${label}</p><p class="kpi-value"${color ? ` style="color:${color}"` : ''}>${value}</p>
  <p class="text-xs text-slate-500">${sub}</p></div>`;
const fmtPz = (n) => fmtInt(Math.round(n * 10) / 10);

const TABS = {
  entraron: { label: 'Entraron', rows: (w) => w.entraron },
  salieron: { label: 'Salieron', rows: (w) => w.salieron },
  activas:  { label: 'Activas al cierre', rows: (w) => w.activas },
  todas:    { label: 'Todas', rows: (w) => w.todas },
};

function statusChip(estado, leyenda) {
  const hit = leyenda.find((l) => normKey(l.label) === normKey(estado));
  const mapped = Object.keys(CONFIG.CUADRO_COLORES).find((hex) => normKey(CONFIG.CUADRO_COLORES[hex]) === normKey(estado));
  const color = hit ? hit.color : mapped || (normKey(estado).startsWith('COLOR') ? `#${String(estado).split('#')[1]}` : '#cbd5e1');
  return `<span class="inline-flex items-center gap-1.5 whitespace-nowrap"><span class="h-2.5 w-2.5 rounded-full border border-black/10" style="background:${color}"></span>${esc(prettyStatus(estado))}</span>`;
}

function renderTable(w, leyenda) {
  $('#wkTabs').innerHTML = Object.entries(TABS).map(([k, t]) => {
    const rows = t.rows(w);
    return `<button data-tab="${k}" class="chip ${view.tab === k ? 'chip-strong' : ''}">${t.label} (${fmtInt(rows.length)} OTs · ${fmtPz(sumPz(rows))} pzs)</button>`;
  }).join('');
  const q = normKey(view.q);
  const rows = TABS[view.tab].rows(w).filter((it) => !q || normKey(`${it.ot} ${it.titulo} ${it.codigo} ${it.analista} ${it.tango}`).includes(q));
  const head = ['OT', 'Título', 'Analista', 'Tango', 'Piezas', view.tab === 'salieron' ? 'Salida' : 'Estado (cuadro)', 'En OT 2026'];
  $('#wkHead').innerHTML = `<tr>${head.map((h) => `<th class="px-3 py-2 text-left font-semibold whitespace-nowrap">${h}</th>`).join('')}</tr>`;
  $('#wkBody').innerHTML = rows.length ? rows.map((it) => {
    const x = it.ot26;
    return `<tr class="border-t border-slate-100">
      <td class="px-3 py-2 font-medium whitespace-nowrap">${esc(it.ot) || '<span class="text-slate-400">—</span>'}</td>
      <td class="px-3 py-2 max-w-xs truncate" title="${esc(it.titulo)}">${esc(it.titulo)}</td>
      <td class="px-3 py-2 whitespace-nowrap">${esc(it.analista)}</td>
      <td class="px-3 py-2 whitespace-nowrap">${esc(it.tango)}</td>
      <td class="px-3 py-2 tabular-nums whitespace-nowrap">${it.piezas != null ? `${fmtPz(it.piezas)}${it.piezasFuente === 'OT 2026' ? ' <span class="text-xs text-slate-400" title="Tomado de CANTIDAD en OT 2026">(OT 2026)</span>' : ''}` : it.excluida ? '<span class="text-slate-400" title="Parrilla: sus piezas no suman">excluida</span>' : '<span class="text-slate-400" title="Sin dato de piezas">—</span>'}</td>
      <td class="px-3 py-2">${view.tab === 'salieron' ? esc(it.salida) : statusChip(it.estado, leyenda)}</td>
      <td class="px-3 py-2 whitespace-nowrap">${x ? `${badge(x.estado, x.estadoRaw || STATUS[x.estado].label)} <span class="text-xs text-slate-500">${esc(CATEGORY[x.categoria].label)}</span>` : '<span class="text-slate-400">—</span>'}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="7" class="px-3 py-8 text-center text-slate-500">${w.base ? 'Primera semana del histórico: línea base, sin semana anterior para comparar' : 'Sin OTs en esta lista'}</td></tr>`;
  $('#wkTabs').onclick = (e) => {
    const k = e.target.closest('[data-tab]')?.dataset.tab;
    if (k) { view.tab = k; renderTable(w, leyenda); }
  };
  $('#wkSearch').oninput = (e) => { view.q = e.target.value; renderTable(w, leyenda); };
}

/**
 * s: { semanas: [{gid, nombre, fecha, oculta, leyenda, items}] (cargadas, por fecha), total (en el libro),
 *      range: periodRange del filtro global | null, periodLabel, cross: Map(codigo → registro OT 2026),
 *      loading, error, onLoadAll() }
 */
export function renderWeekly(s) {
  const box = $('#weekly');
  if (!s) { box.hidden = true; return; }
  box.hidden = false;

  const btn = $('#wkLoadAll');
  btn.hidden = s.semanas.length >= s.total;
  btn.disabled = Boolean(s.loading);
  btn.textContent = s.loading || `Cargar histórico completo (${fmtInt(s.total)} semanas)`;
  btn.onclick = s.onLoadAll;
  if (!s.semanas.length) {
    $('#wkInfo').textContent = s.loading || s.error || 'Sin semanas detectadas en el Cuadro Tango.';
    return;
  }

  // El flujo se calcula sobre todas las semanas cargadas (cada una vs su anterior real)
  // y se muestra solo el periodo del filtro global del dashboard.
  const flow = weeklyFlow(s.semanas, s.cross);
  const leyenda = s.semanas.at(-1).leyenda ?? [];
  const inRange = (x) => !s.range || (new Date(`${x.fecha}T00:00`) >= s.range.from && new Date(`${x.fecha}T00:00`) < s.range.to);
  const shown = flow.filter(inRange);
  const t = flowTotals(shown);
  const label = (x, i) => `Semana ${i + 1} · ${x.nombre}`;

  if (!shown.length) {
    $('#wkInfo').textContent = s.loading || `Sin semanas del Cuadro Tango en ${s.periodLabel}.`;
    $('#wkKpis').innerHTML = '';
    $('#wkSemana').innerHTML = '';
    $('#wkTabs').innerHTML = '';
    $('#wkHead').innerHTML = '';
    $('#wkBody').innerHTML = '';
    if (typeof window.Chart === 'function') for (const id of ['wkFlow', 'wkPiezas']) upsert(id, 'bar', { labels: [], datasets: [] }, {});
    return;
  }

  // Semana para la tabla de detalle (por defecto la última del periodo).
  if (!shown.some((x) => x.gid === view.gid)) view.gid = shown.at(-1).gid;
  const w = shown.find((x) => x.gid === view.gid);
  const sel = $('#wkSemana');
  sel.innerHTML = shown.map((x, i) => `<option value="${x.gid}">${esc(label(x, i))}</option>`).reverse().join('');
  sel.value = String(view.gid);
  sel.onchange = () => { view.gid = Number(sel.value); renderWeekly(s); };

  $('#wkInfo').textContent = `${s.periodLabel} · ${fmtInt(shown.length)} semanas del Cuadro Tango`
    + (s.loading ? ` · ${s.loading}` : '')
    + (w.sinPiezas ? ` · ${fmtInt(w.sinPiezas)} OTs de la semana elegida sin dato de piezas` : '') + (s.error ? ` ⚠ ${s.error}` : '');

  const avg = (n) => (t.semanas ? (n / t.semanas).toFixed(1) : '0');
  $('#wkKpis').innerHTML =
    kpi('OTs que entraron', fmtInt(t.entraron), `${avg(t.entraron)} por semana`, COLORS.entraron)
    + kpi('Piezas que entraron', fmtPz(t.pzEntraron), `${avg(t.pzEntraron)} por semana`, COLORS.entraron)
    + kpi('OTs que salieron', fmtInt(t.salieron), `${avg(t.salieron)} por semana`, COLORS.salieron)
    + kpi('Piezas que salieron', fmtPz(t.pzSalieron), `${avg(t.pzSalieron)} por semana`, COLORS.salieron)
    + kpi('Activas al cierre', fmtInt(t.activas), `${fmtPz(t.pzActivas)} piezas · ${esc(shown.at(-1).nombre)}`, COLORS.activas)
    + kpi('Balance del periodo', `${t.entraron - t.salieron >= 0 ? '+' : ''}${fmtInt(t.entraron - t.salieron)} OTs`, `${fmtPz(t.pzEntraron - t.pzSalieron)} piezas netas`);

  if (typeof window.Chart === 'function') {
    const pick = (_, els) => { if (els.length) { view.gid = shown[els[0].index].gid; renderWeekly(s); } };
    const common = {
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } },
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } }, valueLabels: { mode: 'value' } },
      onClick: pick,
    };
    upsert('wkFlow', 'bar', {
      labels: shown.map(label),
      datasets: [
        { label: 'Entraron', data: shown.map((x) => x.entraron.length), backgroundColor: COLORS.entraron },
        { label: 'Salieron', data: shown.map((x) => x.salieron.length), backgroundColor: COLORS.salieron },
      ],
    }, common);
    upsert('wkPiezas', 'bar', {
      labels: shown.map(label),
      datasets: [
        { label: 'Piezas que entraron', data: shown.map((x) => x.pzEntraron), backgroundColor: COLORS.entraron },
        { label: 'Piezas que salieron', data: shown.map((x) => x.pzSalieron), backgroundColor: COLORS.salieron },
      ],
    }, common);
  }
  renderTable(w, leyenda);
}
