// Evolución anual de OTs (para gerencia): tabla de crecimiento mes a mes + gráfico.
import { yearEvolution, MONTH_NAMES } from './filters.js';
import { upsert } from './charts.js';
import { $, esc, fmtInt } from './ui.js';

const COLORS = { nuevas: '#2563eb', entregadas: '#16a34a', acumulado: '#0f172a', enCurso: '#d97706' };

function delta(d) {
  if (d == null) return '<span class="text-slate-400">—</span>';
  const color = d > 0 ? '#16a34a' : d < 0 ? '#dc2626' : '#64748b';
  return `<span style="color:${color}" class="font-medium whitespace-nowrap">${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${Math.abs(d).toFixed(0)} %</span>`;
}

/** records: OTs con los filtros de detalle aplicados (sin filtro de periodo) · year: año elegido arriba. */
export function renderAnnual(records, year, filtrosLabel) {
  const rows = yearEvolution(records, year);
  // El mes actual está incompleto: se marca y no se compara (evita un "▼ 98 %" engañoso a principio de mes).
  const now = new Date();
  const enCursoMes = year === now.getFullYear() ? now.getMonth() + 1 : null;
  const pendiente = '<span class="text-xs text-slate-400">en curso</span>';
  $('#anualTitulo').textContent = `Evolución de OTs · ${year}`;
  $('#anualInfo').textContent = rows.length
    ? `Por fecha de ingreso · enero a ${MONTH_NAMES[rows.length - 1].toLowerCase()}${filtrosLabel ? ` · ${filtrosLabel}` : ''}`
    : `Sin OTs registradas en ${year}.`;
  $('#anualBody').hidden = !rows.length;
  if (!rows.length) return;

  const tot = rows.reduce((a, r) => ({ nuevas: a.nuevas + r.nuevas, piezas: a.piezas + r.piezas, entregadas: a.entregadas + r.entregadas }), { nuevas: 0, piezas: 0, entregadas: 0 });
  const cerrados = rows.filter((r) => r.mes !== enCursoMes);
  const prom = cerrados.length ? cerrados.reduce((a, r) => a + r.nuevas, 0) / cerrados.length : 0;   // promedio de meses cerrados
  const th = (h, right = true) => `<th class="px-3 py-2 font-semibold whitespace-nowrap ${right ? 'text-right' : 'text-left'}">${h}</th>`;
  $('#anualTabla').innerHTML = `<thead class="bg-slate-50 text-slate-600"><tr>${th('Mes', false)}${th('OTs nuevas')}${th('vs mes ant.')}${th('Acumulado')}${th('Piezas')}${th('vs mes ant.')}${th('Entregadas')}${th('En curso al cierre')}</tr></thead><tbody>`
    + rows.map((r) => `<tr class="border-t border-slate-100">
        <td class="px-3 py-2 whitespace-nowrap">${esc(MONTH_NAMES[r.mes - 1])}${r.mes === enCursoMes ? ' <span class="text-xs text-slate-400">(en curso)</span>' : ''}</td>
        <td class="px-3 py-2 text-right tabular-nums font-semibold">${fmtInt(r.nuevas)}</td>
        <td class="px-3 py-2 text-right">${r.mes === enCursoMes ? pendiente : delta(r.deltaNuevas)}</td>
        <td class="px-3 py-2 text-right tabular-nums">${fmtInt(r.acumulado)}</td>
        <td class="px-3 py-2 text-right tabular-nums">${fmtInt(r.piezas)}</td>
        <td class="px-3 py-2 text-right">${r.mes === enCursoMes ? pendiente : delta(r.deltaPiezas)}</td>
        <td class="px-3 py-2 text-right tabular-nums">${fmtInt(r.entregadas)}</td>
        <td class="px-3 py-2 text-right tabular-nums">${fmtInt(r.enCurso)}</td></tr>`).join('')
    + `<tr class="border-t-2 border-slate-300 bg-slate-50 font-semibold">
        <td class="px-3 py-2">Total ${year}</td><td class="px-3 py-2 text-right tabular-nums">${fmtInt(tot.nuevas)}</td>
        <td class="px-3 py-2 text-right text-xs font-normal text-slate-500">${prom.toFixed(1).replace('.', ',')} / mes</td>
        <td class="px-3 py-2"></td><td class="px-3 py-2 text-right tabular-nums">${fmtInt(tot.piezas)}</td><td class="px-3 py-2"></td>
        <td class="px-3 py-2 text-right tabular-nums">${fmtInt(tot.entregadas)}</td><td class="px-3 py-2 text-right tabular-nums">${fmtInt(rows.at(-1).enCurso)}</td></tr></tbody>`;

  if (typeof window.Chart !== 'function') return;
  upsert('anualChart', 'bar', {
    labels: rows.map((r) => MONTH_NAMES[r.mes - 1].slice(0, 3) + (r.mes === enCursoMes ? '*' : '')),
    datasets: [
      { label: 'OTs nuevas', data: rows.map((r) => r.nuevas), backgroundColor: COLORS.nuevas, borderRadius: 3, yAxisID: 'y' },
      { label: 'Entregadas', data: rows.map((r) => r.entregadas), backgroundColor: COLORS.entregadas, borderRadius: 3, yAxisID: 'y' },
      { label: 'Acumulado del año', type: 'line', data: rows.map((r) => r.acumulado), borderColor: COLORS.acumulado, backgroundColor: COLORS.acumulado, pointRadius: 3, tension: 0.2, yAxisID: 'y1' },
    ],
  }, {
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: { grid: { display: false } },
      y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'OTs por mes' } },
      y1: { beginAtZero: true, position: 'right', grid: { display: false }, title: { display: true, text: 'Acumulado' } },
    },
    plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } }, valueLabels: { mode: 'value' } },
  });
}
