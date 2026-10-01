// Gráfico de estados (Chart.js vía CDN). Si la librería no cargó, se muestra un aviso y el resto sigue operando.
import { STATUS, fmtInt } from './ui.js';

let donut = null;

export function renderCharts(kpis) {
  const ok = typeof window.Chart === 'function';
  document.querySelectorAll('[data-chart-fallback]').forEach((el) => { el.hidden = ok; });
  if (!ok) return;

  const keys = Object.keys(STATUS).filter((k) => kpis[k] > 0);
  const donutData = {
    labels: keys.map((k) => STATUS[k].label),
    datasets: [{ data: keys.map((k) => kpis[k]), backgroundColor: keys.map((k) => STATUS[k].color), borderWidth: 2, borderColor: '#fff' }],
  };
  if (donut) { donut.data = donutData; donut.update(); } else {
    donut = new Chart(document.getElementById('chartStatus'), {
      type: 'doughnut',
      data: donutData,
      options: {
        maintainAspectRatio: false, cutout: '62%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } },
          tooltip: { callbacks: { label: (c) => {
            const total = c.dataset.data.reduce((a, b) => a + b, 0);
            return ` ${c.label}: ${fmtInt(c.raw)} (${((c.raw / total) * 100).toFixed(1)}%)`;
          } } },
        },
      },
    });
  }
}
