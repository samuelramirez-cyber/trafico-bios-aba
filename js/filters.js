// Motor de filtros temporales y agregados (KPIs, serie mensual).
import { normKey } from './normalize.js';

export const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// Rango semiabierto [from, to) del periodo seleccionado; null = sin filtro temporal.
export function periodRange(s) {
  const y = +s.year;
  switch (s.period) {
    case 'month': {
      const m = +s.month;
      return { from: new Date(y, m - 1, 1), to: new Date(y, m, 1), label: `${MONTH_NAMES[m - 1]} ${y}` };
    }
    case 'quarter': {
      const q = +s.quarter;
      return { from: new Date(y, (q - 1) * 3, 1), to: new Date(y, q * 3, 1), label: `Q${q} ${y}` };
    }
    case 'half': {
      const h = +s.half;
      return { from: new Date(y, (h - 1) * 6, 1), to: new Date(y, h * 6, 1),
        label: `H${h} ${y} (${h === 1 ? 'Ene–Jun' : 'Jul–Dic'})` };
    }
    case 'year':
      return { from: new Date(y, 0, 1), to: new Date(y + 1, 0, 1), label: `Año ${y}` };
    default:
      return null;
  }
}

export function applyFilters(records, s) {
  const range = periodRange(s);
  const q = normKey(s.q);
  return records.filter((r) => {
    if (range) {
      const d = r[s.dateField];
      if (!d || d < range.from || d >= range.to) return false;
    }
    if (s.gerente && r.gerente !== s.gerente) return false;
    if (s.responsable && r.responsable !== s.responsable && r.responsable2 !== s.responsable) return false;
    if (s.estado && r.estado !== s.estado) return false;
    if (s.categoria && r.categoria !== s.categoria) return false;
    if (q && !r._search.includes(q)) return false;
    return true;
  });
}

// Conteo total y por estado + piezas (CANTIDAD): { total, entregado: n, ..., pz: { total, entregado, ... } }
export function computeKPIs(list) {
  const k = { total: list.length, pz: { total: 0 } };
  for (const r of list) {
    k[r.estado] = (k[r.estado] ?? 0) + 1;
    k.pz.total += r.cantidad ?? 0;
    if (r.pzExcluida) k.pzExcluidas = (k.pzExcluidas ?? 0) + (r.cantidadTotal ?? 0);
    k.pz[r.estado] = (k.pz[r.estado] ?? 0) + (r.cantidad ?? 0);
  }
  return k;
}

// Tabla cruzada tipo × estado: { fachadas: { total, entregado: n, ... }, ... }
export function crossTab(list) {
  const t = {};
  for (const r of list) {
    const row = (t[r.categoria] ??= { total: 0, pz: { total: 0 } });
    row.total++;
    row[r.estado] = (row[r.estado] ?? 0) + 1;
    row.pz.total += r.cantidad ?? 0;
    row.pz[r.estado] = (row.pz[r.estado] ?? 0) + (r.cantidad ?? 0);
  }
  return t;
}

export const uniqueSorted = (list, ...fields) =>
  [...new Set(list.flatMap((r) => fields.map((f) => r[f])).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));

export const yearsIn = (list, field, extra = []) =>
  [...new Set([...extra, ...list.map((r) => r[field]?.getFullYear()).filter(Boolean)])].sort();

/**
 * Evolución mensual del año: OTs nuevas (por ingreso), acumulado, piezas, entregadas (estado Entregado con
 * entrega en el mes) y en curso al cierre (ingresadas hasta fin de mes y no entregadas a esa fecha).
 * Solo hasta el mes actual si el año está en curso.
 */
export function yearEvolution(records, year, today = new Date()) {
  const last = year === today.getFullYear() ? today.getMonth() : year < today.getFullYear() ? 11 : -1;
  const rows = [];
  let acum = 0;
  for (let m = 0; m <= last; m++) {
    const from = new Date(year, m, 1), to = new Date(year, m + 1, 1);
    const nuevas = records.filter((r) => r.ingreso && r.ingreso >= from && r.ingreso < to);
    const entregadas = records.filter((r) => r.estado === 'entregado' && r.entrega && r.entrega >= from && r.entrega < to);
    const enCurso = records.filter((r) => r.ingreso && r.ingreso >= new Date(year, 0, 1) && r.ingreso < to
      && !(r.estado === 'entregado' && r.entrega && r.entrega < to));
    acum += nuevas.length;
    const prev = rows.at(-1);
    const piezas = nuevas.reduce((a, r) => a + (r.cantidad ?? 0), 0);
    rows.push({
      mes: m + 1, nuevas: nuevas.length, acumulado: acum, piezas, entregadas: entregadas.length, enCurso: enCurso.length,
      deltaNuevas: prev && prev.nuevas ? ((nuevas.length - prev.nuevas) / prev.nuevas) * 100 : null,
      deltaPiezas: prev && prev.piezas ? ((piezas - prev.piezas) / prev.piezas) * 100 : null,
    });
  }
  return rows;
}
