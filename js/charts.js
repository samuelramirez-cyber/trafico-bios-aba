// Gráficos (Chart.js vía CDN). Si la librería no cargó, se muestra un aviso y el resto sigue operando.
import { STATUS, CATEGORY, fmtInt } from './ui.js';

const charts = {};
const legend = { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } };
const pctLabel = (items) => (c) => {
  const total = c.dataset.data.reduce((a, b) => a + b, 0);
  const pz = items[c.dataIndex]?.pz;
  return ` ${c.label}: ${fmtInt(c.raw)} OTs (${((c.raw / total) * 100).toFixed(1)}%)${pz != null ? ` · ${fmtInt(pz)} piezas` : ''}`;
};
const pointer = (enabled) => (e, els) => { e.native.target.style.cursor = enabled && els.length ? 'pointer' : 'default'; };

const compact = (n) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e4 ? `${Math.round(n / 1e3)}k` : fmtInt(Math.round(n)));

/**
 * Etiquetas fijas sobre los gráficos (sin pasar el mouse). Se activa por gráfico con
 * options.plugins.valueLabels = { mode: 'pct' | 'stackPct' | 'value' }:
 *   pct: % del total del dataset (donas) · stackPct: % dentro de la barra apilada · value: el número.
 * Se omiten las etiquetas que no caben (porciones < 4 %, barras muy cortas).
 */
const valueLabels = {
  id: 'valueLabels',
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts?.mode) return;
    const { ctx } = chart;
    const stacked = chart.options.scales?.x?.stacked || chart.options.scales?.y?.stacked;
    ctx.save();
    ctx.font = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    chart.data.datasets.forEach((ds, di) => {
      const meta = chart.getDatasetMeta(di);
      if (meta.hidden || !chart.isDatasetVisible(di) || (meta.type === 'line' && opts.lines !== true)) return;
      const total = ds.data.reduce((a, b) => a + (Number(b) || 0), 0);
      meta.data.forEach((el, i) => {
        const v = Number(ds.data[i]);
        if (!v) return;
        let text;
        if (opts.mode === 'pct') {
          const p = (100 * v) / total;
          if (p < 4) return;
          text = `${Math.round(p)}%`;
        } else if (opts.mode === 'stackPct') {
          const col = chart.data.datasets.reduce((a, d, k) => a + (chart.isDatasetVisible(k) ? Number(d.data[i]) || 0 : 0), 0);
          text = `${Math.round((100 * v) / col)}%`;
        } else text = compact(v);
        const pos = el.tooltipPosition();
        let x = pos.x, y = pos.y, color = '#fff';
        if (el.width !== undefined) {               // barras
          const horizontal = chart.options.indexAxis === 'y';
          const size = horizontal ? Math.abs(el.x - el.base) : Math.abs(el.base - el.y);
          const need = horizontal ? ctx.measureText(text).width + 6 : 14;
          if (size < need) {
            if (stacked) return;                    // no cabe dentro de un segmento apilado
            color = '#334155';
            if (horizontal) x = el.x + ctx.measureText(text).width / 2 + 4; else y = el.y - 8;
          } else if (horizontal) x = (el.x + el.base) / 2; else y = (el.y + el.base) / 2;
        } else if (meta.type === 'line') { y -= 10; color = '#334155'; }
        ctx.fillStyle = color;
        if (color === '#fff') { ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 2; } else ctx.shadowBlur = 0;
        ctx.fillText(text, x, y);
      });
    });
    ctx.restore();
  },
};
let registered = false;

// Crea el gráfico la primera vez y luego solo actualiza datos/opciones.
export function upsert(id, type, data, options) {
  if (!registered) { Chart.register(valueLabels); registered = true; }
  if (charts[id]) {
    charts[id].data = data;
    Object.assign(charts[id].options, options);
    charts[id].update();
  } else {
    charts[id] = new Chart(document.getElementById(id), { type, data, options: { maintainAspectRatio: false, ...options } });
  }
}

export function doughnut(id, items, onClick) {
  upsert(id, 'doughnut', {
    labels: items.map((i) => i.label),
    datasets: [{ data: items.map((i) => i.n), backgroundColor: items.map((i) => i.color), borderWidth: 2, borderColor: '#fff' }],
  }, {
    cutout: '62%',
    plugins: { legend, tooltip: { callbacks: { label: pctLabel(items) } }, valueLabels: { mode: 'pct' } },
    onClick: (_, els) => els.length && onClick?.(items[els[0].index]),
    onHover: pointer(Boolean(onClick)),
  });
}

/** kpis: conteo por estado · tab: crossTab(tipo × estado) · onPick({estado?, categoria?}) filtra la tabla. */
export function renderCharts(kpis, tab, onPick) {
  const ok = typeof window.Chart === 'function';
  document.querySelectorAll('[data-chart-fallback]').forEach((el) => { el.hidden = ok; });
  if (!ok) return;

  doughnut('chartStatus',
    Object.values(STATUS).filter((s) => kpis[s.key] > 0).map((s) => ({ ...s, n: kpis[s.key], pz: kpis.pz[s.key] ?? 0 })),
    (s) => onPick({ estado: s.key }));

  const cats = Object.values(CATEGORY).filter((c) => tab[c.key]?.total > 0);
  doughnut('chartCategory', cats.map((c) => ({ ...c, n: tab[c.key].total, pz: tab[c.key].pz.total })), (c) => onPick({ categoria: c.key }));

  // Barras apiladas: una fila por tipo, un segmento por estado.
  const statuses = Object.values(STATUS).filter((s) => cats.some((c) => tab[c.key][s.key]));
  document.getElementById('chartCategoryStatus').parentElement.style.height = `${Math.max(160, cats.length * 44 + 70)}px`;
  upsert('chartCategoryStatus', 'bar', {
    labels: cats.map((c) => c.label),
    datasets: statuses.map((s) => ({
      label: s.label, backgroundColor: s.color, borderRadius: 3,
      data: cats.map((c) => tab[c.key][s.key] ?? 0),
    })),
  }, {
    indexAxis: 'y',
    scales: { x: { stacked: true, ticks: { precision: 0 } }, y: { stacked: true, grid: { display: false } } },
    plugins: {
      legend,
      valueLabels: { mode: 'stackPct' },
      tooltip: { callbacks: { label: (c) => {
        const row = tab[cats[c.dataIndex].key];
        const pz = row.pz[statuses[c.datasetIndex].key] ?? 0;
        return ` ${c.dataset.label}: ${fmtInt(c.raw)} de ${fmtInt(row.total)} OTs (${((c.raw / row.total) * 100).toFixed(1)}%) · ${fmtInt(pz)} piezas`;
      } } },
    },
    onClick: (_, els) => els.length &&
      onPick({ categoria: cats[els[0].index].key, estado: statuses[els[0].datasetIndex].key }),
    onHover: pointer(true),
  });
}
