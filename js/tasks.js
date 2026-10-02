// Tareas web por marca (hoja "Tareas" de Contegral/Finca, servida por el Apps Script digital).
import { normKey, parseDate, formatDate } from './normalize.js';
import { MONTH_NAMES } from './filters.js';
import { $, esc, fmtInt } from './ui.js';

const MESES = MONTH_NAMES.map((m) => normKey(m));

/**
 * Filas crudas de una pestaña → [{ tarea, solicitud, resolucion, fecha, responsable, estado, entregable, notas, mes }].
 * Tolera título encima del encabezado y filas separadoras de mes ("Julio"). fecha = resolución (o solicitud).
 * Si un año viene mal digitado (04/08/06), se corrige con el año de la otra fecha.
 */
export function parseTareas(rows) {
  const h = rows.findIndex((r) => normKey(r[0]) === 'TAREA');
  if (h < 0) return [];
  const H = rows[h].map(normKey);
  const col = (n) => H.findIndex((x) => x.startsWith(n));
  const c = { t: col('TAREA'), s: col('FECHA SOLICITUD'), r: col('FECHA RESOLUCION'), p: col('RESPONSABLE'), e: col('ESTADO'), x: col('ENTREGABLE'), n: col('NOTAS') };
  const get = (row, i) => (i >= 0 ? String(row[i] ?? '').trim() : '');
  const out = [];
  let mes = '';
  for (const row of rows.slice(h + 1)) {
    const tarea = get(row, c.t);
    if (!tarea) continue;
    const rest = row.filter((_, i) => i !== c.t).some((v) => String(v).trim());
    if (!rest && MESES.includes(normKey(tarea))) { mes = tarea; continue; }   // separador de mes
    let solicitud = parseDate(get(row, c.s)).date, resolucion = parseDate(get(row, c.r)).date;
    const fix = (d, ref) => (d && ref && Math.abs(d.getFullYear() - ref.getFullYear()) > 1 ? new Date(ref.getFullYear(), d.getMonth(), d.getDate()) : d);
    solicitud = fix(solicitud, resolucion);
    resolucion = fix(resolucion, solicitud);
    out.push({ tarea, solicitud, resolucion, fecha: resolucion ?? solicitud, responsable: get(row, c.p), estado: get(row, c.e),
      entregable: get(row, c.x), notas: get(row, c.n), mes });
  }
  return out;
}

// Links de Drive/Sheets/Docs pueden contener datos personales (respuestas de formularios): no se enlazan.
const isPrivateLink = (u) => /(?:docs|drive|sheets)\.google\.com/i.test(u);

function entregableCell(u) {
  if (!u) return '<span class="text-slate-400">—</span>';
  if (!/^https?:\/\//i.test(u)) return esc(u);
  if (isPrivateLink(u)) return '<span class="text-slate-500" title="Documento interno (no se enlaza en el dashboard público)">📁 Entregable en Drive</span>';
  let label = u;
  try { const x = new URL(u); label = x.hostname.replace(/^www\./, '') + (x.pathname.length > 1 ? x.pathname.replace(/\/$/, '') : ''); } catch { /* texto */ }
  return `<a href="${esc(u)}" target="_blank" rel="noopener" class="text-teal-700 underline break-all">${esc(label.length > 48 ? `${label.slice(0, 48)}…` : label)}</a>`;
}

const estadoBadge = (e) => {
  const k = normKey(e);
  const [bg, fg] = k.startsWith('COMPLET') ? ['#dcfce7', '#166534'] : !k ? ['#f1f5f9', '#64748b'] : ['#fef3c7', '#92400e'];
  return `<span class="inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap" style="background:${bg};color:${fg}">${esc(e || 'Sin estado')}</span>`;
};

/** s: { data: respuesta ?view=tareas | null, marca, range (periodRange | null), periodLabel, loading, error } */
export function renderTareas(s) {
  const box = $('#tareasWeb');
  const raw = s.data?.marcas?.[s.marca];
  // Sin datos (cargando, error o marca sin pestaña): el bloque no se muestra en la página pública.
  if (!s.marca || !Array.isArray(raw)) {
    box.hidden = true;
    if (s.error || raw?.error) console.warn('Tareas web:', s.error || raw.error);
    return;
  }
  box.hidden = false;
  const all = parseTareas(raw);
  const list = all.filter((t) => !s.range || (t.fecha && t.fecha >= s.range.from && t.fecha < s.range.to))
    .sort((a, b) => (b.fecha ?? 0) - (a.fecha ?? 0));
  const completas = list.filter((t) => normKey(t.estado).startsWith('COMPLET')).length;
  $('#tareasTitulo').textContent = `Tareas web realizadas · ${s.marca}`;
  $('#tareasInfo').textContent = `${s.periodLabel} · ${fmtInt(list.length)} tareas · ${fmtInt(completas)} completas`;

  if (!list.length) {
    $('#tareasBody').innerHTML = `<tr><td colspan="5" class="px-3 py-8 text-center text-slate-500">Sin tareas registradas en ${esc(s.periodLabel)}</td></tr>`;
    return;
  }
  // Agrupadas por mes de la fecha (resolución o solicitud).
  let mesActual = '';
  $('#tareasBody').innerHTML = list.map((t) => {
    const mes = t.fecha ? `${MONTH_NAMES[t.fecha.getMonth()]} ${t.fecha.getFullYear()}` : 'Sin fecha';
    const head = mes !== mesActual
      ? `<tr class="bg-slate-50"><td colspan="5" class="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">${esc(mes)} · ${fmtInt(list.filter((x) => (x.fecha ? `${MONTH_NAMES[x.fecha.getMonth()]} ${x.fecha.getFullYear()}` : 'Sin fecha') === mes).length)} tareas</td></tr>`
      : '';
    mesActual = mes;
    return `${head}<tr class="border-t border-slate-100 align-top">
      <td class="px-3 py-2 whitespace-nowrap tabular-nums text-slate-600" title="Solicitud: ${esc(formatDate(t.solicitud) || '—')}">${esc(formatDate(t.fecha) || '—')}</td>
      <td class="px-3 py-2">${esc(t.tarea)}${t.notas ? `<div class="text-xs text-slate-500">${esc(t.notas)}</div>` : ''}</td>
      <td class="px-3 py-2 whitespace-nowrap">${esc(t.responsable) || '—'}</td>
      <td class="px-3 py-2">${estadoBadge(t.estado)}</td>
      <td class="px-3 py-2 max-w-xs">${entregableCell(t.entregable)}</td></tr>`;
  }).join('');
}
