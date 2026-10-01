// Gráficos (Chart.js vía CDN). Si la librería no cargó, se muestra un aviso y el resto sigue operando.
import { STATUS, CATEGORY, fmtInt } from './ui.js';

const charts = {};
const legend = { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } };
const pctLabel = (c) => {
  const total = c.dataset.data.reduce((a, b) => a + b, 0);
  return ` ${c.label}: ${fmtInt(c.raw)} (${((c.raw / total) * 100).toFixed(1)}%)`;
};
const pointer = (enabled) => (e, els) => { e.native.target.style.cursor = enabled && els.length ? 'pointer' : 'default'; };

// Crea el gráfico la primera vez y luego solo actualiza datos/opciones.
function upsert(id, type, data, options) {
  if (charts[id]) {
    charts[id].data = data;
    Object.assign(charts[id].options, options);
    charts[id].update();
  } else {
    charts[id] = new Chart(document.getElementById(id), { type, data, options: { maintainAspectRatio: false, ...options } });
  }
}

function doughnut(id, items, onClick) {
  upsert(id, 'doughnut', {
    labels: items.map((i) => i.label),
    datasets: [{ data: items.map((i) => i.n), backgroundColor: items.map((i) => i.color), borderWidth: 2, borderColor: '#fff' }],
  }, {
    cutout: '62%',
    plugins: { legend, tooltip: { callbacks: { label: pctLabel } } },
    onClick: (_, els) => els.length && onClick(items[els[0].index]),
    onHover: pointer(true),
  });
}

/** kpis: conteo por estado · tab: crossTab(tipo × estado) · onPick({estado?, categoria?}) filtra la tabla. */
export function renderCharts(kpis, tab, onPick) {
  const ok = typeof window.Chart === 'function';
  document.querySelectorAll('[data-chart-fallback]').forEach((el) => { el.hidden = ok; });
  if (!ok) return;

  doughnut('chartStatus',
    Object.values(STATUS).filter((s) => kpis[s.key] > 0).map((s) => ({ ...s, n: kpis[s.key] })),
    (s) => onPick({ estado: s.key }));

  const cats = Object.values(CATEGORY).filter((c) => tab[c.key]?.total > 0);
  doughnut('chartCategory', cats.map((c) => ({ ...c, n: tab[c.key].total })), (c) => onPick({ categoria: c.key }));

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
      tooltip: { callbacks: { label: (c) => {
        const total = tab[cats[c.dataIndex].key].total;
        return ` ${c.dataset.label}: ${fmtInt(c.raw)} de ${fmtInt(total)} (${((c.raw / total) * 100).toFixed(1)}%)`;
      } } },
    },
    onClick: (_, els) => els.length &&
      onPick({ categoria: cats[els[0].index].key, estado: statuses[els[0].datasetIndex].key }),
    onHover: pointer(true),
  });
}
