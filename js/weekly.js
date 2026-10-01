// Seguimiento semanal del Cuadro Tango: cada pestaña semanal es una foto del estado (color) de cada OT.
// Compara semana contra semana y cruza con OT's TANGO 2026 por el código ot_XXXXXX_... (los filtros
// globales del dashboard no aplican aquí: es otra fuente).
import { CONFIG } from '../config.js';
import { normKey, splitOT } from './normalize.js';
import { upsert, doughnut } from './charts.js';
import { STATUS, CATEGORY, badge, $, esc, fmtInt } from './ui.js';

const isApproved = (estado) => normKey(estado).startsWith('APROB');
const fixColor = (estado) => CONFIG.CUADRO_COLORES[String(estado).replace(/^COLOR /i, '').toLowerCase()] ?? estado;

export const prettyStatus = (s) => {
  const t = String(s || '').toLowerCase();
  return t.startsWith('color #') ? `Color sin leyenda (${t.slice(6)})` : t.charAt(0).toUpperCase() + t.slice(1);
};

// [llave, texto OT, analista, tango, estado, ingreso, entrega] → objeto
export function toItem([key, otTxt, analista, tango, estado, ingreso, entrega]) {
  const { ot, titulo } = splitOT(otTxt);
  return { key, codigo: key.split('#')[0], ot: titulo ? ot : '', titulo: titulo || otTxt, analista, tango, estado: fixColor(estado), ingreso, entrega };
}

/** Balance de la semana idx contra la anterior. semanas: [{ fecha, items }] ordenadas por fecha. */
export function weeklyBalance(semanas, idx = semanas.length - 1, cross = new Map()) {
  const maps = semanas.map((s) => new Map(s.items.map((r) => { const it = toItem(r); return [it.key, it]; })));
  const cur = maps[idx], prev = idx > 0 ? maps[idx - 1] : null;
  const streak = (key, estado) => {
    let n = 0;
    for (let i = idx; i >= 0 && maps[i].get(key)?.estado === estado; i--) n++;
    return n;
  };
  const all = [...cur.values()].map((it) => ({
    ...it, semanasIgual: streak(it.key, it.estado), antes: prev?.get(it.key)?.estado ?? null, ot26: cross.get(it.codigo) ?? null,
  }));
  const porEstado = {};
  for (const it of all) porEstado[it.estado] = (porEstado[it.estado] ?? 0) + 1;
  const cambios = prev ? all.filter((it) => it.antes && it.antes !== it.estado) : [];
  return {
    total: cur.size, prevTotal: prev?.size ?? null, porEstado, all, cambios,
    nuevas: prev ? all.filter((it) => !prev.has(it.key)) : [],
    salieron: prev ? [...prev.values()].filter((it) => !cur.has(it.key)).map((it) => ({ ...it, ot26: cross.get(it.codigo) ?? null })) : [],
    aprobadas: cambios.filter((it) => isApproved(it.estado)),
    estancadas: all.filter((it) => !isApproved(it.estado) && it.semanasIgual >= CONFIG.STALE_WEEKS),
    cruzan: all.filter((it) => it.ot26),
    discrepancias: all.filter((it) => it.ot26 && isApproved(it.estado) !== (it.ot26.estado === 'entregado')),
  };
}

/* ---------- Render ---------- */

const view = { idx: null, tab: 'cambios', q: '' };
let state = null;   // { semanas, total, leyenda, cross, loading, onLoadAll }

function colorFor(estado) {
  const hit = state.leyenda.find((l) => normKey(l.label) === normKey(estado));
  return hit ? hit.color : normKey(estado).startsWith('COLOR') ? `#${String(estado).split('#')[1] || '475569'}` : '#cbd5e1';
}

const statusChip = (estado) => `<span class="inline-flex items-center gap-1.5 whitespace-nowrap">
  <span class="h-2.5 w-2.5 rounded-full border border-black/10" style="background:${colorFor(estado)}"></span>${esc(prettyStatus(estado))}</span>`;

const kpi = (label, value, sub = '', color = '') => `<div class="card"${color ? ` style="border-left:4px solid ${color}"` : ''}>
  <p class="kpi-label">${label}</p><p class="kpi-value"${color ? ` style="color:${color}"` : ''}>${value}</p>
  <p class="text-xs text-slate-500">${sub}</p></div>`;

const TABS = {
  cambios:       { label: 'Cambiaron de estado', rows: (b) => b.cambios },
  nuevas:        { label: 'Nuevas', rows: (b) => b.nuevas },
  estancadas:    { label: `Estancadas (≥${CONFIG.STALE_WEEKS} sem.)`, rows: (b) => b.estancadas },
  discrepancias: { label: 'Discrepancias con OT 2026', rows: (b) => b.discrepancias },
  salieron:      { label: 'Salieron del cuadro', rows: (b) => b.salieron },
  todas:         { label: 'Todas', rows: (b) => b.all },
};

function renderTable(b, hasPrev) {
  $('#wkTabs').innerHTML = Object.entries(TABS).map(([k, t]) =>
    `<button data-tab="${k}" class="chip ${view.tab === k ? 'chip-strong' : ''}">${t.label} (${fmtInt(t.rows(b).length)})</button>`).join('');
  const q = normKey(view.q);
  const rows = TABS[view.tab].rows(b).filter((it) => !q || normKey(`${it.ot} ${it.titulo} ${it.codigo} ${it.analista} ${it.tango}`).includes(q));
  const salieron = view.tab === 'salieron';
  $('#wkHead').innerHTML = `<tr>${['OT', 'Título', 'Analista', 'Tango', 'Antes', 'Ahora (cuadro)', 'Sem. igual', 'En OT 2026']
    .map((h) => `<th class="px-3 py-2 text-left font-semibold whitespace-nowrap">${h}</th>`).join('')}</tr>`;
  $('#wkBody').innerHTML = rows.length ? rows.map((it) => {
    const x = it.ot26;
    return `<tr class="border-t border-slate-100">
      <td class="px-3 py-2 font-medium whitespace-nowrap">${esc(it.ot) || '<span class="text-slate-400">—</span>'}</td>
      <td class="px-3 py-2 max-w-xs truncate" title="${esc(it.titulo)}">${esc(it.titulo)}</td>
      <td class="px-3 py-2 whitespace-nowrap">${esc(it.analista)}</td>
      <td class="px-3 py-2 whitespace-nowrap">${esc(it.tango)}</td>
      <td class="px-3 py-2">${salieron ? statusChip(it.estado) : it.antes ? statusChip(it.antes) : '<span class="text-slate-400">—</span>'}</td>
      <td class="px-3 py-2">${salieron ? '<span class="text-slate-500">Ya no está</span>' : statusChip(it.estado)}</td>
      <td class="px-3 py-2 tabular-nums">${it.semanasIgual ?? '—'}</td>
      <td class="px-3 py-2 whitespace-nowrap">${x ? `${badge(x.estado, x.estadoRaw || STATUS[x.estado].label)} <span class="text-xs text-slate-500">${esc(CATEGORY[x.categoria].label)} · ${esc(x.responsable)}</span>` : '<span class="text-slate-400">—</span>'}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="8" class="px-3 py-8 text-center text-slate-500">${hasPrev || ['todas', 'estancadas', 'discrepancias'].includes(view.tab) ? 'Sin OTs en esta lista' : 'No hay semana anterior cargada para comparar'}</td></tr>`;
  $('#wkTabs').onclick = (e) => {
    const k = e.target.closest('[data-tab]')?.dataset.tab;
    if (k) { view.tab = k; renderTable(b, hasPrev); }
  };
  $('#wkSearch').oninput = (e) => { view.q = e.target.value; renderTable(b, hasPrev); };
}

/**
 * s: { semanas: [{gid, nombre, fecha, oculta, leyenda, items}] (cargadas, por fecha), total (en el libro),
 *      cross: Map(codigo → registro de OT 2026), loading: texto | null, error, onLoadAll() }
 */
export function renderWeekly(s) {
  const box = $('#weekly');
  if (!s) { box.hidden = true; return; }
  box.hidden = false;
  state = { ...s, leyenda: s.semanas.at(-1)?.leyenda ?? [] };

  const btn = $('#wkLoadAll');
  btn.hidden = s.semanas.length >= s.total;
  btn.disabled = Boolean(s.loading);
  btn.textContent = s.loading || `Cargar histórico completo (${fmtInt(s.total)} semanas)`;
  btn.onclick = s.onLoadAll;

  if (!s.semanas.length) {
    $('#wkInfo').textContent = s.loading || s.error || 'Sin semanas detectadas en el Cuadro Tango.';
    return;
  }
  const last = s.semanas.length - 1;
  if (view.idx == null || view.idx > last || view.gid !== s.semanas[view.idx]?.gid) {
    const keep = s.semanas.findIndex((w) => w.gid === view.gid);
    view.idx = keep >= 0 ? keep : last;
  }
  view.gid = s.semanas[view.idx].gid;
  const sel = $('#wkSemana');
  sel.innerHTML = s.semanas.map((w, i) => `<option value="${i}">${esc(w.nombre)} · ${esc(w.fecha)}${w.oculta ? '' : ' (visible)'}</option>`).reverse().join('');
  sel.value = String(view.idx);
  sel.onchange = () => { view.idx = +sel.value; view.gid = s.semanas[view.idx].gid; renderWeekly(s); };

  const b = weeklyBalance(s.semanas, view.idx, s.cross);
  const cur = s.semanas[view.idx], prev = s.semanas[view.idx - 1];
  $('#wkInfo').textContent = `Pestaña "${cur.nombre}" (${cur.fecha})${prev ? ` vs "${prev.nombre}" (${prev.fecha})` : ''} · `
    + `${fmtInt(s.semanas.length)} de ${fmtInt(s.total)} semanas cargadas · ${fmtInt(b.cruzan.length)} de ${fmtInt(b.total)} OTs cruzan con OT's TANGO 2026.`
    + (s.error ? ` ⚠ ${s.error}` : '');

  const delta = b.prevTotal == null ? '' : `${b.total - b.prevTotal >= 0 ? '+' : ''}${fmtInt(b.total - b.prevTotal)} vs semana anterior`;
  const dash = (n) => (prev ? fmtInt(n) : '—');
  $('#wkKpis').innerHTML = kpi('OTs en el cuadro', fmtInt(b.total), delta)
    + kpi('Nuevas', dash(b.nuevas.length))
    + kpi('Cambiaron de estado', dash(b.cambios.length))
    + kpi('Pasaron a aprobado', dash(b.aprobadas.length), '', colorFor('APROBADO'))
    + kpi('Estancadas', fmtInt(b.estancadas.length), `mismo estado ≥ ${CONFIG.STALE_WEEKS} semanas`, '#dc2626')
    + kpi('Discrepancias', fmtInt(b.discrepancias.length), 'cuadro vs OT 2026', '#d97706');

  if (typeof window.Chart === 'function') {
    const estados = [...new Set([...state.leyenda.map((l) => l.label), ...s.semanas.flatMap((w) => w.items.map((r) => fixColor(r[4])))])];
    doughnut('wkDonut', estados.filter((e) => b.porEstado[e]).map((e) => ({ label: prettyStatus(e), color: colorFor(e), n: b.porEstado[e] })));
    upsert('wkEvol', 'bar', {
      labels: s.semanas.map((w) => w.nombre),
      datasets: estados.map((e) => ({
        label: prettyStatus(e), backgroundColor: colorFor(e),
        data: s.semanas.map((w) => w.items.filter((r) => fixColor(r[4]) === e).length),
      })).filter((ds) => ds.data.some(Boolean)),
    }, {
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { precision: 0 } } },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } } },
      onClick: (_, els) => { if (els.length) { view.idx = els[0].index; view.gid = s.semanas[view.idx].gid; renderWeekly(s); } },
    });
  }
  renderTable(b, Boolean(prev));
}
