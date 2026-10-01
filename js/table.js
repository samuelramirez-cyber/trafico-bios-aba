// Tabla de OTs: orden por columna y paginación.
import { STATUS, CATEGORY, badge, esc, fmtInt, $ } from './ui.js';

const COLS = [
  { key: 'ot', label: 'OT' },
  { key: 'desc', label: 'Descripción' },
  { key: 'categoria', label: 'Tipo' },
  { key: 'pieza', label: 'Pieza' },
  { key: 'gerente', label: 'Gerente / Director' },
  { key: 'responsable', label: 'Responsable' },
  { key: 'ingreso', label: 'Ingreso' },
  { key: 'entrega', label: 'Entrega' },
  { key: 'estado', label: 'Estado' },
];

const isEmpty = (v) => v == null || v === '';
const dash = '<span class="text-slate-400">—</span>';

// Vacíos siempre al final, sin importar la dirección.
function compare(a, b, key, dir) {
  const x = a[key], y = b[key];
  if (isEmpty(x) || isEmpty(y)) return isEmpty(x) - isEmpty(y);
  const r = (x instanceof Date || typeof x === 'number') ? x - y
    : String(x).localeCompare(String(y), 'es', { numeric: true });
  return r * dir;
}

export function renderTable(list, view, pageSize, onChange) {
  const { sortKey, sortDir } = view;
  $('#tableHead').innerHTML = COLS.map((c) => {
    const arrow = c.key === sortKey ? (sortDir === 1 ? ' ▲' : ' ▼') : '';
    return `<th data-sort="${c.key}" class="px-3 py-2 font-semibold cursor-pointer select-none whitespace-nowrap text-left">${c.label}${arrow}</th>`;
  }).join('');

  const sorted = sortKey ? [...list].sort((a, b) => compare(a, b, sortKey, sortDir)) : list;

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  view.page = Math.min(view.page, pages);
  const start = (view.page - 1) * pageSize;
  const slice = sorted.slice(start, start + pageSize);

  $('#tableBody').innerHTML = slice.length ? slice.map((r) => {
    const warn = r.issues.length ? ` <span class="text-amber-600 cursor-help" title="${esc(r.issues.join('\n'))}">⚠</span>` : '';
    const resp = [r.responsable, r.responsable2].filter(Boolean).join(' · ');
    return `<tr class="border-t border-slate-100 hover:bg-slate-50">
      <td class="px-3 py-2 font-medium whitespace-nowrap">${esc(r.ot)}${warn}</td>
      <td class="px-3 py-2 max-w-xs truncate" title="${esc(r.desc)}">${esc(r.desc) || dash}</td>
      <td class="px-3 py-2 whitespace-nowrap">${esc(CATEGORY[r.categoria].label)}</td>
      <td class="px-3 py-2 whitespace-nowrap">${esc(r.pieza) || dash}</td>
      <td class="px-3 py-2 whitespace-nowrap">${esc(r.gerente) || dash}</td>
      <td class="px-3 py-2 whitespace-nowrap">${esc(resp) || dash}</td>
      <td class="px-3 py-2 whitespace-nowrap tabular-nums">${r.ingresoTxt || dash}</td>
      <td class="px-3 py-2 whitespace-nowrap tabular-nums">${r.entregaTxt || dash}</td>
      <td class="px-3 py-2">${badge(r.estado, r.estadoRaw || STATUS[r.estado].label)}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="${COLS.length}" class="px-3 py-10 text-center text-slate-500">Sin OTs para los filtros seleccionados</td></tr>`;

  $('#pageInfo').textContent = sorted.length
    ? `${fmtInt(start + 1)}–${fmtInt(start + slice.length)} de ${fmtInt(sorted.length)} · pág. ${view.page}/${pages}`
    : '0 resultados';
  $('#prevPage').disabled = view.page <= 1;
  $('#nextPage').disabled = view.page >= pages;

  $('#tableHead').onclick = (e) => {
    const key = e.target.closest('th')?.dataset.sort;
    if (!key) return;
    view.sortDir = view.sortKey === key ? -view.sortDir : 1;
    view.sortKey = key;
    onChange();
  };
}
