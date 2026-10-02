// Interacciones en redes (Metricool): total, engagement y desglose por tipo para el mes elegido.
// Engagement = interacciones ÷ impresiones × 100 (misma fórmula para todas las redes, para poder compararlas).
import { NETS, monthlyFromDaily, prevYm, monthLabel, deltaPct } from './digital.js';
import { upsert } from './charts.js';
import { $, esc, fmtInt } from './ui.js';

export const TIPOS = {
  likes: { label: 'Me gusta', color: '#ec4899' },
  reacciones: { label: 'Reacciones', color: '#6366f1' },
  comentarios: { label: 'Comentarios', color: '#f59e0b' },
  compartidos: { label: 'Compartidos', color: '#10b981' },
  guardados: { label: 'Guardados', color: '#8b5cf6' },
  clics: { label: 'Clics', color: '#0ea5e9' },
};

/** Por red: { tipos: {tipo: n}, total, prevTotal, imp, impPrev, eng, engPrev } para el mes ym. */
export function interactionSummary(inter, redes, ym) {
  const out = {};
  for (const red of Object.keys(NETS)) {
    const meses = inter?.[red];
    if (!meses) continue;
    const tipos = meses[ym] ?? {}, prev = meses[prevYm(ym)] ?? {};
    const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
    const imp = monthlyFromDaily(redes?.[red]?.impresiones, 'sum');
    const r = { tipos, total: sum(tipos), prevTotal: sum(prev), imp: imp[ym] ?? 0, impPrev: imp[prevYm(ym)] ?? 0 };
    r.eng = r.imp ? (100 * r.total) / r.imp : null;
    r.engPrev = r.impPrev ? (100 * r.prevTotal) / r.impPrev : null;
    out[red] = r;
  }
  return out;
}

const fmtEng = (n) => (n == null ? '—' : `${n.toFixed(2).replace('.', ',')} %`);
function delta(d, abs = false) {
  if (d == null || Number.isNaN(d)) return '<span class="text-slate-400">—</span>';
  const color = d > 0 ? '#16a34a' : d < 0 ? '#dc2626' : '#64748b';
  const txt = abs ? `${d > 0 ? '+' : ''}${d.toFixed(2).replace('.', ',')} pts` : `${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${Math.abs(d).toFixed(1).replace('.', ',')} %`;
  return `<span style="color:${color}" class="font-medium whitespace-nowrap">${txt}</span>`;
}

/** s: { inter: respuesta ?view=interacciones | null, redes: series de la marca, marca, ym } */
export function renderInteractions(s) {
  const box = $('#interBox');
  const inter = s.inter?.marcas?.[s.marca];
  if (!inter || !s.ym) { box.hidden = true; return; }
  const sum = interactionSummary(inter, s.redes, s.ym);
  const nets = Object.keys(sum);
  const total = nets.reduce((a, n) => a + sum[n].total, 0), prevTotal = nets.reduce((a, n) => a + sum[n].prevTotal, 0);
  const imp = nets.reduce((a, n) => a + sum[n].imp, 0), impPrev = nets.reduce((a, n) => a + sum[n].impPrev, 0);
  const eng = imp ? (100 * total) / imp : null, engPrev = impPrev ? (100 * prevTotal) / impPrev : null;
  box.hidden = !nets.length;
  if (!nets.length) return;

  $('#interTitulo').textContent = `Interacciones · ${monthLabel(s.ym)}`;
  const tipoChips = (tipos) => Object.entries(tipos).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
    .map(([t, v]) => `<span class="inline-flex items-center gap-1 whitespace-nowrap"><span class="h-2 w-2 rounded-full" style="background:${TIPOS[t]?.color ?? '#94a3b8'}"></span>${esc(TIPOS[t]?.label ?? t)} <b class="tabular-nums">${fmtInt(Math.round(v))}</b></span>`).join('');
  $('#interKpis').innerHTML = `<div class="card">
      <div class="flex flex-wrap gap-6">
        <div><p class="kpi-label">Interacciones</p><p class="kpi-value">${fmtInt(Math.round(total))}</p><p class="text-xs">${delta(deltaPct(total, prevTotal))} vs ${esc(monthLabel(prevYm(s.ym)))}</p></div>
        <div><p class="kpi-label">Engagement</p><p class="kpi-value">${fmtEng(eng)}</p><p class="text-xs">${delta(eng != null && engPrev != null ? eng - engPrev : null, true)} · interacciones ÷ impresiones</p></div>
      </div>
      <div class="grid md:grid-cols-3 gap-3 mt-3">${nets.map((n) => `<div class="rounded-lg p-3" style="background:${NETS[n].color}14">
          <div class="flex items-baseline justify-between gap-2"><span class="text-sm font-semibold" style="color:${NETS[n].color}">${NETS[n].label}</span>
            <span class="text-xs text-slate-500">eng. <b>${fmtEng(sum[n].eng)}</b></span></div>
          <div class="text-2xl font-bold tabular-nums">${fmtInt(Math.round(sum[n].total))} <span class="text-xs font-normal">${delta(deltaPct(sum[n].total, sum[n].prevTotal))}</span></div>
          <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600 mt-1">${tipoChips(sum[n].tipos) || 'Sin interacciones'}</div></div>`).join('')}</div></div>`;

  if (typeof window.Chart !== 'function') return;
  const tipos = Object.keys(TIPOS).filter((t) => nets.some((n) => sum[n].tipos[t] > 0));
  upsert('interChart', 'bar', {
    labels: nets.map((n) => NETS[n].label),
    datasets: tipos.map((t) => ({ label: TIPOS[t].label, backgroundColor: TIPOS[t].color, data: nets.map((n) => Math.round(sum[n].tipos[t] ?? 0)) })),
  }, {
    indexAxis: 'y',
    scales: { x: { stacked: true, beginAtZero: true }, y: { stacked: true, grid: { display: false } } },
    plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } }, valueLabels: { mode: 'value' } },
  });
}
