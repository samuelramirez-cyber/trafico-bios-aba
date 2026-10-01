// Utilidades de presentación compartidas.
import { CONFIG } from '../config.js';

// Estados en orden de flujo (entregado primero) + "Sin estado".
export const STATUS = Object.fromEntries([
  ...[...CONFIG.STATUSES].reverse().map((s) => [s.key, s]),
  ['otro', { key: 'otro', label: 'Sin estado', color: '#64748b' }],
]);

export const CATEGORY = Object.fromEntries([
  ...CONFIG.CATEGORIES.map((c) => [c.key, c]),
  ['otro', { key: 'otro', label: 'Otros', color: '#94a3b8' }],
]);

// Badge con color del estado (estilo inline: no depende de clases generadas por Tailwind).
export const badge = (key, text) => {
  const c = STATUS[key].color;
  return `<span class="inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap" style="background:${c}1f;color:${c}">${esc(text)}</span>`;
};

const int = new Intl.NumberFormat(CONFIG.LOCALE);

export const fmtInt = (n) => int.format(n ?? 0);
export const fmtTime = (ts) => new Date(ts).toLocaleString(CONFIG.LOCALE, { dateStyle: 'short', timeStyle: 'short' });

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const $ = (sel) => document.querySelector(sel);

export function fillSelect(el, options, value, allLabel) {
  el.innerHTML = (allLabel != null ? `<option value="">${esc(allLabel)}</option>` : '') +
    options.map((o) => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(v)}">${esc(l)}</option>`;
    }).join('');
  el.value = options.some((o) => String(Array.isArray(o) ? o[0] : o) === String(value)) ? value : '';
}
