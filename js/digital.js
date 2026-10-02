// Secciones Web (GA4) y Redes (Metricool). Fuente: "Dashboard Digital API" (Apps Script, cuenta tango.red).
// Siguen el periodo global: tarjetas = último mes del periodo vs el mes anterior; gráficos y tabla = evolución.
import { CONFIG } from '../config.js';
import { MONTH_NAMES } from './filters.js';
import { upsert } from './charts.js';
import { $, esc, fmtInt } from './ui.js';

export const NETS = {
  instagram: { label: 'Instagram', color: '#ec4899' },
  facebook: { label: 'Facebook', color: '#6366f1' },
  linkedin: { label: 'LinkedIn', color: '#22c55e' },
};
const WEB_COLOR = '#0f766e';
const pad = (n) => String(n).padStart(2, '0');
const ymOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const monthLabel = (ym) => `${MONTH_NAMES[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;
const shortMonth = (ym) => `${MONTH_NAMES[Number(ym.slice(5)) - 1].slice(0, 3)} ${ym.slice(2, 4)}`;
export const prevYm = (ym) => { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 2, 1); return ymOf(d); };

/** Meses 'YYYY-MM' del periodo (sin pasar del mes actual). range = periodRange(state) | null. */
export function monthsInRange(range, today = new Date()) {
  const from = range ? range.from : new Date(`${CONFIG.DIGITAL_FROM}T00:00`);
  const end = range ? new Date(Math.min(range.to - 1, today)) : today;
  const out = [];
  for (let d = new Date(from.getFullYear(), from.getMonth(), 1); d <= end; d.setMonth(d.getMonth() + 1)) out.push(ymOf(d));
  return out;
}

/** Fechas a pedir a la API: desde el mes anterior al primero (para comparar) hasta el último día del periodo. */
export function fetchSpan(months, today = new Date()) {
  if (!months.length) return null;
  const first = prevYm(months[0]);
  const [y, m] = months.at(-1).split('-').map(Number);
  const last = new Date(Math.min(new Date(y, m, 0), today));
  return { from: `${first}-01`, to: `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}` };
}

// Serie diaria [[YYYY-MM-DD, v]] → por mes: seguidores = último valor; impresiones = suma.
export function monthlyFromDaily(points, mode) {
  const out = {};
  for (const [d, v] of points || []) {
    const ym = d.slice(0, 7);
    out[ym] = mode === 'sum' ? (out[ym] ?? 0) + v : v;
  }
  return out;
}

// Mes de GA4 → métricas en los términos del informe (visitas = páginas vistas; permanencia = interacción/usuario).
export function webMonth(m) {
  if (!m) return null;
  const disp = m.dispositivos || {}, tipo = m.tipoUsuario || {};
  const ses = Object.values(disp).reduce((a, b) => a + b, 0);
  const usu = (tipo.new ?? 0) + (tipo.returning ?? 0);
  const out = {
    visitas: m.screenPageViews ?? 0, sesiones: m.sessions ?? 0, nuevos: m.newUsers ?? 0, usuarios: m.totalUsers ?? 0,
    permanencia: m.activeUsers ? (m.userEngagementDuration ?? 0) / m.activeUsers : 0,
    pctNuevos: usu ? (100 * (tipo.new ?? 0)) / usu : null,
    pctCelular: ses ? (100 * (disp.mobile ?? 0)) / ses : null,
    pctComputador: ses ? (100 * (disp.desktop ?? 0)) / ses : null,
    nota: null,
  };
  if (m.ajuste) Object.assign(out, m.ajuste);
  if (out.pctNuevos != null && m.ajuste?.pctRecurrentes == null) out.pctRecurrentes = 100 - out.pctNuevos;
  return out;
}

export const deltaPct = (cur, prev) => (prev ? ((cur - prev) / prev) * 100 : null);
const fmtPct = (n, d = 1) => (n == null ? '—' : `${n.toFixed(d).replace('.', ',')} %`);
const fmtDur = (s) => `${Math.floor(s / 60)}:${pad(Math.round(s % 60))}`;
const fmtK = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2).replace('.', ',')}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1).replace('.', ',')}k` : fmtInt(Math.round(n)));
function deltaTag(d, { abs = false, invert = false } = {}) {
  if (d == null || Number.isNaN(d)) return '<span class="text-slate-400">—</span>';
  const up = d > 0, color = (up !== invert) ? '#16a34a' : d === 0 ? '#64748b' : '#dc2626';
  const txt = abs ? `${d > 0 ? '+' : ''}${fmtInt(Math.round(d))}` : `${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${Math.abs(d).toFixed(1).replace('.', ',')} %`;
  return `<span style="color:${color}" class="font-medium whitespace-nowrap">${txt}</span>`;
}
const chips = (el, items, value, onPick) => {
  el.innerHTML = items.map((m) => `<button data-v="${esc(m)}" class="chip ${m === value ? 'chip-strong' : ''}">${esc(m)}</button>`).join('');
  el.onclick = (e) => { const v = e.target.closest('[data-v]')?.dataset.v; if (v) onPick(v); };
};
const card = (label, value, sub, color = '') => `<div class="card"${color ? ` style="border-left:4px solid ${color}"` : ''}>
  <p class="kpi-label">${label}</p><p class="kpi-value"${color ? ` style="color:${color}"` : ''}>${value}</p><p class="text-xs text-slate-500">${sub}</p></div>`;
const chartsOk = () => typeof window.Chart === 'function';
const legend = { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } };

/* ---------- Web ---------- */

const webView = { marca: null };

/** s: { data: respuesta ?view=web | null, months, loading, error, onRender } */
export function renderWeb(s) {
  const marcas = Object.keys(s.data?.marcas ?? {});
  $('#webInfo').textContent = s.loading || s.error || (!marcas.length ? 'Sin datos de GA4.' : '');
  if (!marcas.length) { $('#webBody').hidden = true; return; }
  if (!marcas.includes(webView.marca)) webView.marca = marcas[0];
  chips($('#webMarcas'), marcas, webView.marca, (v) => { webView.marca = v; s.onRender(); });

  const src = s.data.marcas[webView.marca];
  const rows = s.months.map((ym) => ({ ym, ...(webMonth(src.meses?.[ym]) ?? {}), prev: webMonth(src.meses?.[prevYm(ym)]) }))
    .filter((r) => r.visitas != null);
  $('#webBody').hidden = !rows.length;
  if (!rows.length) { $('#webInfo').textContent = `Sin datos de ${webView.marca} en el periodo.`; return; }
  const cur = rows.at(-1), prev = cur.prev;
  $('#webInfo').innerHTML = `${esc(src.propiedad || webView.marca)} · ${esc(monthLabel(cur.ym))}${prev ? ` vs ${esc(monthLabel(prevYm(cur.ym)))}` : ''}`
    + (cur.nota ? ` · <span class="text-amber-700" title="Ajuste manual">⚠ ${esc(cur.nota)}</span>` : '');

  $('#webKpis').innerHTML =
    card('Visitas', fmtInt(cur.visitas), `${prev ? `${fmtInt(prev.visitas)} el mes anterior · ` : ''}${deltaTag(prev && deltaPct(cur.visitas, prev.visitas))}`, WEB_COLOR)
    + card('Usuarios nuevos', fmtInt(cur.nuevos), deltaTag(prev && deltaPct(cur.nuevos, prev.nuevos)))
    + card('Tiempo de permanencia', fmtDur(cur.permanencia), `promedio por usuario · ${deltaTag(prev && deltaPct(cur.permanencia, prev.permanencia))}`)
    + card('Nuevos vs. recurrentes', fmtPct(cur.pctNuevos), `nuevos · ${fmtPct(cur.pctRecurrentes)} volvieron`)
    + card('Dispositivo', fmtPct(cur.pctComputador, 0), `computador · ${fmtPct(cur.pctCelular, 0)} celular`);

  if (chartsOk()) {
    upsert('webChart', 'bar', {
      labels: rows.map((r) => shortMonth(r.ym)),
      datasets: [
        { label: 'Visitas', data: rows.map((r) => r.visitas), backgroundColor: WEB_COLOR, borderRadius: 3, yAxisID: 'y' },
        { label: 'Usuarios nuevos', type: 'line', data: rows.map((r) => r.nuevos), borderColor: '#f59e0b', backgroundColor: '#f59e0b', tension: 0.25, yAxisID: 'y1' },
      ],
    }, {
      interaction: { mode: 'index', intersect: false },
      scales: { x: { grid: { display: false } }, y: { beginAtZero: true, position: 'left' }, y1: { beginAtZero: true, position: 'right', grid: { display: false } } },
      plugins: { legend },
    });
  }
  $('#webTabla').innerHTML = `<thead class="bg-slate-50 text-slate-600"><tr>${['Mes', 'Visitas', 'vs mes ant.', 'Usuarios nuevos', 'Permanencia', '% nuevos', '% celular', '% computador']
    .map((h, i) => `<th class="px-3 py-2 font-semibold whitespace-nowrap ${i ? 'text-right' : 'text-left'}">${h}</th>`).join('')}</tr></thead><tbody>`
    + [...rows].reverse().map((r) => `<tr class="border-t border-slate-100">
      <td class="px-3 py-2 whitespace-nowrap">${esc(monthLabel(r.ym))}${r.nota ? ` <span class="text-amber-600 cursor-help" title="${esc(r.nota)}">⚠</span>` : ''}</td>
      <td class="px-3 py-2 text-right tabular-nums">${fmtInt(r.visitas)}</td>
      <td class="px-3 py-2 text-right">${deltaTag(r.prev && deltaPct(r.visitas, r.prev.visitas))}</td>
      <td class="px-3 py-2 text-right tabular-nums">${fmtInt(r.nuevos)}</td>
      <td class="px-3 py-2 text-right tabular-nums">${fmtDur(r.permanencia)}</td>
      <td class="px-3 py-2 text-right tabular-nums">${fmtPct(r.pctNuevos)}</td>
      <td class="px-3 py-2 text-right tabular-nums">${fmtPct(r.pctCelular, 0)}</td>
      <td class="px-3 py-2 text-right tabular-nums">${fmtPct(r.pctComputador, 0)}</td></tr>`).join('') + '</tbody>';
}

/* ---------- Redes ---------- */

const redesView = { marca: null };

/** Resumen por red para un mes: seguidores (fin de mes) y su cambio; impresiones (suma) y su variación %. */
export function socialSummary(redes, ym) {
  const out = {};
  for (const [red, v] of Object.entries(redes || {})) {
    const seg = monthlyFromDaily(v.seguidores, 'last'), imp = monthlyFromDaily(v.impresiones, 'sum');
    out[red] = { seg: seg[ym] ?? null, segPrev: seg[prevYm(ym)] ?? null, imp: imp[ym] ?? null, impPrev: imp[prevYm(ym)] ?? null };
  }
  return out;
}

/** s: { data: respuesta ?view=redes | null, months, loading, error, onRender } */
export function renderRedes(s) {
  const marcas = Object.keys(s.data?.marcas ?? {});
  $('#redesInfo').textContent = s.loading || s.error || (!marcas.length ? 'Sin datos de Metricool.' : '');
  if (!marcas.length) { $('#redesBody').hidden = true; return; }
  if (!marcas.includes(redesView.marca)) redesView.marca = marcas[0];
  chips($('#redesMarcas'), marcas, redesView.marca, (v) => { redesView.marca = v; s.onRender(); });

  const redes = s.data.marcas[redesView.marca];
  const nets = Object.keys(NETS).filter((n) => redes[n]);
  const withData = s.months.filter((ym) => nets.some((n) => socialSummary(redes, ym)[n].seg != null || socialSummary(redes, ym)[n].imp != null));
  $('#redesBody').hidden = !withData.length;
  if (!withData.length) { $('#redesInfo').textContent = `Sin datos de ${redesView.marca} en el periodo (Metricool tiene datos desde mediados de 2026).`; return; }
  const ym = withData.at(-1);
  const sum = socialSummary(redes, ym);
  const tot = (k) => nets.reduce((a, n) => a + (sum[n][k] ?? 0), 0);
  const segTot = tot('seg'), segPrevTot = tot('segPrev'), impTot = tot('imp'), impPrevTot = tot('impPrev');
  $('#redesInfo').textContent = `${monthLabel(ym)} vs ${monthLabel(prevYm(ym))} · fuente Metricool`;

  const netChip = (n, val, delta) => `<div class="rounded-lg px-3 py-2 text-center min-w-[7rem]" style="background:${NETS[n].color}22">
      <div class="text-xs text-slate-500">${NETS[n].label}</div><div class="text-lg font-semibold tabular-nums">${val}</div><div class="text-xs">${delta}</div></div>`;
  const block = (title, total, totDelta, parts) => `<div class="card">
      <div class="flex flex-wrap items-center gap-3"><div class="min-w-[9rem]"><p class="kpi-label">${title}</p>
      <p class="kpi-value">${total}</p><p class="text-xs">${totDelta}</p></div><div class="flex flex-wrap gap-2 ml-auto">${parts}</div></div></div>`;
  $('#redesKpis').innerHTML =
    block('Seguidores', fmtK(segTot), `${deltaTag(segPrevTot ? segTot - segPrevTot : null, { abs: true })} en el mes`,
      nets.map((n) => netChip(n, sum[n].seg != null ? fmtK(sum[n].seg) : '—', deltaTag(sum[n].seg != null && sum[n].segPrev != null ? sum[n].seg - sum[n].segPrev : null, { abs: true }))).join(''))
    + block('Impresiones', fmtK(impTot), `${deltaTag(deltaPct(impTot, impPrevTot))} vs mes anterior`,
      nets.map((n) => netChip(n, sum[n].imp != null ? fmtK(sum[n].imp) : '—', deltaTag(deltaPct(sum[n].imp, sum[n].impPrev)))).join(''));

  if (chartsOk()) {
    // Un mes: evolución diaria (como el informe). Varios meses: mes a mes.
    const daily = s.months.length === 1;
    const inMonths = (d) => s.months.includes(d.slice(0, 7));
    const labels = daily
      ? [...new Set(nets.flatMap((n) => [...(redes[n].seguidores || []), ...(redes[n].impresiones || [])].map(([d]) => d)))].filter(inMonths).sort()
      : withData;
    const series = (n, k, mode) => {
      if (daily) { const m = new Map((redes[n][k] || []).map(([d, v]) => [d, v])); return labels.map((d) => m.get(d) ?? null); }
      const mm = monthlyFromDaily(redes[n][k], mode); return labels.map((x) => mm[x] ?? null);
    };
    const fmtLabel = (x) => (daily ? `${Number(x.slice(8))} ${MONTH_NAMES[Number(x.slice(5, 7)) - 1].slice(0, 3).toLowerCase()}` : shortMonth(x));
    // Seguidores: la red más grande va en el eje izquierdo y las demás en el derecho (escalas muy distintas).
    const big = nets.reduce((a, n) => ((sum[n].seg ?? 0) > (sum[a]?.seg ?? 0) ? n : a), nets[0]);
    upsert('redesSeg', 'line', {
      labels: labels.map(fmtLabel),
      datasets: nets.map((n) => ({ label: NETS[n].label, data: series(n, 'seguidores', 'last'), borderColor: NETS[n].color, backgroundColor: NETS[n].color, pointRadius: 2, tension: 0.2, spanGaps: true, yAxisID: n === big ? 'y' : 'y1' })),
    }, {
      interaction: { mode: 'index', intersect: false },
      scales: { x: { grid: { display: false } }, y: { position: 'left', title: { display: true, text: NETS[big].label } }, y1: { position: 'right', grid: { display: false } } },
      plugins: { legend },
    });
    upsert('redesImp', 'line', {
      labels: labels.map(fmtLabel),
      datasets: nets.map((n) => ({ label: NETS[n].label, data: series(n, 'impresiones', 'sum'), borderColor: NETS[n].color, backgroundColor: NETS[n].color, pointRadius: 2, tension: 0.2, spanGaps: true })),
    }, {
      interaction: { mode: 'index', intersect: false },
      scales: { x: { grid: { display: false } }, y: { beginAtZero: true } },
      plugins: { legend },
    });
  }

  // Tabla mes a mes: por red, seguidores (cambio) e impresiones (variación %).
  $('#redesTabla').innerHTML = `<thead class="bg-slate-50 text-slate-600"><tr><th class="px-3 py-2 text-left font-semibold">Mes</th>${nets.map((n) =>
    `<th class="px-3 py-2 text-right font-semibold whitespace-nowrap" style="color:${NETS[n].color}">${NETS[n].label}<br><span class="font-normal text-slate-500">seguidores · impresiones</span></th>`).join('')}</tr></thead><tbody>`
    + [...withData].reverse().map((x) => {
      const r = socialSummary(redes, x);
      return `<tr class="border-t border-slate-100"><td class="px-3 py-2 whitespace-nowrap">${esc(monthLabel(x))}</td>${nets.map((n) => `<td class="px-3 py-2 text-right tabular-nums whitespace-nowrap">
        ${r[n].seg != null ? fmtInt(r[n].seg) : '—'} ${deltaTag(r[n].seg != null && r[n].segPrev != null ? r[n].seg - r[n].segPrev : null, { abs: true })}
        <span class="text-slate-300">·</span> ${r[n].imp != null ? fmtK(r[n].imp) : '—'} ${deltaTag(deltaPct(r[n].imp, r[n].impPrev))}</td>`).join('')}</tr>`;
    }).join('') + '</tbody>';
}
