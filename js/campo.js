// Pestaña "Campo Azul · Licitación": KPIs orgánicos (hoja de Google por enlace) + OTs de Campo Azul.
// Sigue el periodo global: tarjetas = último mes del periodo con datos vs el mes anterior; gráfico = evolución.
import { CONFIG } from '../config.js';
import { normKey } from './normalize.js';
import { computeKPIs } from './filters.js';
import { monthLabel, prevYm, deltaPct, evolutionMonths } from './digital.js';
import { upsert } from './charts.js';
import { STATUS, $, badge, esc, fmtInt } from './ui.js';

export const CANALES = {
  web: { label: 'Web', color: '#0f766e' },
  linkedin: { label: 'LinkedIn', color: '#0a66c2' },
  whatsapp: { label: 'WhatsApp', color: '#16a34a' },
  youtube: { label: 'YouTube', color: '#dc2626' },
};

// match = inicio del encabezado de la columna (sin tildes/mayúsculas).
export const KPIS = [
  { key: 'webVisitas', canal: 'web', label: 'Visitas', match: 'WEB VISITAS' },
  { key: 'webTiempo', canal: 'web', label: 'Tiempo promedio en la página', match: 'WEB TIEMPO', fmt: 'min' },
  { key: 'webLeads', canal: 'web', label: 'Leads orgánicos', match: 'WEB LEADS' },
  { key: 'liViews', canal: 'linkedin', label: 'Views', match: 'LINKEDIN VIEWS' },
  { key: 'liEng', canal: 'linkedin', label: 'Engagement', match: 'LINKEDIN ENGAGEMENT', fmt: 'pct' },
  { key: 'liTrafico', canal: 'linkedin', label: 'Tráfico cruzado', match: 'LINKEDIN TRAFICO' },
  { key: 'waMensajes', canal: 'whatsapp', label: 'Mensajes salientes', match: 'WHATSAPP MENSAJES' },
  { key: 'waHistorias', canal: 'whatsapp', label: 'Clics CTA · historias', match: 'WHATSAPP CLICS CTA HISTORIAS' },
  { key: 'waAuto', canal: 'whatsapp', label: 'Clics CTA · automatizaciones', match: 'WHATSAPP CLICS CTA AUTOMATIZACIONES' },
  { key: 'ytViews', canal: 'youtube', label: 'Views', match: 'YOUTUBE VIEWS' },
];
const KPI = Object.fromEntries(KPIS.map((k) => [k.key, k]));

/** "1.234" / "1,40" / "3.1" / "4,6 %" → número (null si vacío). */
export function parseNum(raw) {
  let s = String(raw ?? '').replace(/[%\s]/g, '');
  if (!s) return null;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');   // coma decimal
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "2026-01", "1/1/2026", "01/2026", "Enero 2026" → "YYYY-MM" (null si no se reconoce). */
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
export function parseYm(raw) {
  const s = String(raw ?? '').trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(?:\d{1,2}\/)?(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  const k = normKey(s).split(' ');
  const i = MESES.findIndex((x) => k[0]?.startsWith(x.slice(0, 3)));
  if (i >= 0 && /^\d{4}$/.test(k[1] ?? '')) return `${k[1]}-${String(i + 1).padStart(2, '0')}`;
  return null;
}

/**
 * Filas de la hoja → { meses: { ym: { kpi: n } }, industrias: [label], seguidores: { ym: { label: n } },
 *                      funciones: [label], roles: { ym: { label: n } } }.
 * Columnas "Seguidores · <industria>" y "Función · <rol>" = demografía de seguidores de LinkedIn (taxonomía de LinkedIn).
 */
export function parseCampo(rows) {
  const h = rows.findIndex((r) => normKey(r[0]) === 'MES');
  const out = { meses: {}, industrias: [], seguidores: {}, funciones: [], roles: {} };
  if (h < 0) return out;
  const head = rows[h].map((x) => String(x ?? '').trim());
  const cols = head.map((txt) => {
    const k = normKey(txt);
    const kpi = KPIS.find((x) => k.startsWith(x.match));
    if (kpi) return { kpi: kpi.key };
    if (k.startsWith('SEGUIDORES')) return { ind: txt.replace(/^seguidores\s*[·:\-–]?\s*/i, '').trim() || txt };
    if (k.startsWith('FUNCION') || k.startsWith('ROL')) return { rol: txt.replace(/^(funci[oó]n|rol)\s*[·:\-–]?\s*/i, '').trim() || txt };
    return null;
  });
  out.industrias = cols.filter((c) => c?.ind).map((c) => c.ind);
  out.funciones = cols.filter((c) => c?.rol).map((c) => c.rol);
  for (const r of rows.slice(h + 1)) {
    const ym = parseYm(r[0]);
    if (!ym) continue;
    const mes = {}, seg = {}, rol = {};
    cols.forEach((c, i) => {
      const n = c && parseNum(r[i]);
      if (n == null) return;
      if (c.kpi) mes[c.kpi] = n; else if (c.ind) seg[c.ind] = n; else rol[c.rol] = n;
    });
    if (Object.keys(mes).length) out.meses[ym] = mes;
    if (Object.keys(seg).length) out.seguidores[ym] = seg;
    if (Object.keys(rol).length) out.roles[ym] = rol;
  }
  return out;
}

/** OTs de Campo Azul: descripción/pieza contiene alguno de los textos de CONFIG.CAMPO_AZUL.OT_MATCH. */
export function campoRecords(records) {
  const terms = CONFIG.CAMPO_AZUL.OT_MATCH.map(normKey);
  return records.filter((r) => terms.some((t) => r._search.includes(t)));
}

const num1 = new Intl.NumberFormat(CONFIG.LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtKpi = (k, v) => (v == null ? '—' : k.fmt === 'min' ? `${num1.format(v)} min` : k.fmt === 'pct' ? `${num1.format(v)} %` : fmtInt(Math.round(v)));

function delta(cur, prev, pts = false) {
  const d = cur == null || prev == null ? null : pts ? cur - prev : deltaPct(cur, prev);
  if (d == null || Number.isNaN(d)) return '<span class="text-slate-400">—</span>';
  const color = d > 0 ? '#16a34a' : d < 0 ? '#dc2626' : '#64748b';
  const txt = pts ? `${d > 0 ? '+' : ''}${num1.format(d)} pts` : `${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${Math.abs(d).toFixed(1).replace('.', ',')} %`;
  return `<span style="color:${color}" class="font-medium whitespace-nowrap">${txt}</span>`;
}

let evoKpi = 'webVisitas';

/**
 * s: { rows: filas de la hoja | null, loading, error, months: meses del periodo, ots: OTs de Campo Azul en el periodo,
 *      periodLabel, onRender }
 */
export function renderCampo(s) {
  const cfg = CONFIG.CAMPO_AZUL;
  $('#campoPrueba').hidden = !cfg.PRUEBA;
  renderOTs(s.ots, s.periodLabel);

  const data = s.rows ? parseCampo(s.rows) : null;
  const disponibles = data ? Object.keys(data.meses).sort() : [];
  const last = s.months.at(-1);
  const ym = disponibles.filter((m) => !last || m <= last).at(-1);
  $('#campoKpiInfo').textContent = s.error ? s.error : s.loading ? 'Cargando…'
    : !ym ? 'La hoja no tiene datos para el periodo elegido.'
    : `${monthLabel(ym)} vs ${monthLabel(prevYm(ym))}${last && ym !== last ? ` · último mes con datos (${monthLabel(last)} aún sin cargar)` : ''}`;
  $('#campoKpiBody').hidden = !ym;
  if (!ym) return;

  const cur = data.meses[ym], prev = data.meses[prevYm(ym)] ?? {};
  $('#campoKpis').innerHTML = Object.entries(CANALES).map(([c, info]) => {
    const items = KPIS.filter((k) => k.canal === c);
    return `<div class="card" style="border-top:4px solid ${info.color}">
      <h3 class="text-sm font-semibold mb-2" style="color:${info.color}">${esc(info.label)}</h3>
      <div class="space-y-2">${items.map((k) => {
        const meta = k.key === 'webTiempo' && cur[k.key] != null
          ? `<span class="ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium" style="${cur[k.key] >= cfg.META_TIEMPO_MIN ? 'background:#dcfce7;color:#166534' : 'background:#fef3c7;color:#92400e'}">meta +${num1.format(cfg.META_TIEMPO_MIN)} min</span>` : '';
        return `<div><p class="kpi-label">${esc(k.label)}${meta}</p>
          <p class="text-2xl font-bold tabular-nums leading-tight">${fmtKpi(k, cur[k.key])}</p>
          <p class="text-xs">${delta(cur[k.key], prev[k.key], k.fmt === 'pct')} <span class="text-slate-400">vs mes ant.</span></p></div>`;
      }).join('')}</div></div>`;
  }).join('');

  // Selector del KPI a graficar (evolución desde enero hasta el mes elegido).
  $('#campoEvoChips').innerHTML = KPIS.map((k) => `<button data-kpi="${k.key}" class="rounded-full border px-2.5 py-0.5 text-xs font-medium"
      style="${k.key === evoKpi ? `background:${CANALES[k.canal].color};border-color:${CANALES[k.canal].color};color:#fff` : `border-color:#cbd5e1;color:#334155`}">${esc(CANALES[k.canal].label)} · ${esc(k.label)}</button>`).join('');
  $('#campoEvoChips').onclick = (e) => {
    const k = e.target.closest('[data-kpi]')?.dataset.kpi;
    if (k && k !== evoKpi) { evoKpi = k; s.onRender?.(); }
  };

  const aud = audiencia(data, ym);
  $('#campoAudTitulo').textContent = `LinkedIn · audiencia de seguidores · ${monthLabel(ym)}`;
  $('#campoCruce').innerHTML = cruceHtml(aud);
  $('#campoIndInfo').innerHTML = resumen(aud.ind, 'industrias objetivo');
  $('#campoRolInfo').innerHTML = resumen(aud.rol, 'roles objetivo');
  if (typeof window.Chart !== 'function') return;
  const k = KPI[evoKpi], meses = evolutionMonths([ym]);
  $('#campoEvoTitulo').textContent = `${CANALES[k.canal].label} · ${k.label} · ${monthLabel(meses[0])} a ${monthLabel(ym)}`;
  upsert('campoEvo', 'line', {
    labels: meses.map((m) => monthLabel(m).replace(/ \d{4}$/, '').slice(0, 3)),
    datasets: [
      { label: k.label, data: meses.map((m) => data.meses[m]?.[k.key] ?? null), borderColor: CANALES[k.canal].color, backgroundColor: `${CANALES[k.canal].color}22`, fill: true, tension: 0.3, pointRadius: 4 },
      ...(k.key === 'webTiempo' ? [{ label: 'Meta', data: meses.map(() => cfg.META_TIEMPO_MIN), borderColor: '#f59e0b', borderDash: [6, 4], pointRadius: 0, fill: false }] : []),
    ],
  }, {
    scales: { y: { beginAtZero: k.key !== 'webTiempo' } },
    plugins: { legend: { display: k.key === 'webTiempo', position: 'bottom' }, valueLabels: {} },
  });
  barras('campoInd', aud.ind);
  barras('campoRol', aud.rol);
}

/* ---------- Audiencia LinkedIn: industria × rol ---------- */

// Las columnas que empiezan por "Otr…" (Otras industrias / Otras funciones) no son objetivo.
const esObjetivo = (label) => !normKey(label).startsWith('OTR');

function dist(labels, mes, prev) {
  const items = labels.filter((l) => mes[l] != null).map((l) => ({ label: l, n: mes[l], objetivo: esObjetivo(l) }))
    .sort((a, b) => (b.objetivo - a.objetivo) || (b.n - a.n));
  const total = items.reduce((a, i) => a + i.n, 0);
  const obj = items.filter((i) => i.objetivo).reduce((a, i) => a + i.n, 0);
  const objPrev = labels.filter(esObjetivo).reduce((a, l) => a + (prev?.[l] ?? 0), 0);
  return { items, total, obj, objPrev: prev ? objPrev : null, pct: total ? (100 * obj) / total : null };
}

/** Distribuciones del mes + cruce estimado (LinkedIn entrega industria y rol por separado). */
export function audiencia(data, ym) {
  const ind = dist(data.industrias, data.seguidores[ym] ?? {}, data.seguidores[prevYm(ym)]);
  const rol = dist(data.funciones, data.roles[ym] ?? {}, data.roles[prevYm(ym)]);
  const total = ind.total || rol.total;
  // Seguidores en industria objetivo Y con rol objetivo, suponiendo que ambas variables son independientes.
  const ideal = ind.pct != null && rol.pct != null ? Math.round((total * ind.pct * rol.pct) / 10000) : null;
  return { ind, rol, total, ideal };
}

const pct1 = (n) => (n == null ? '—' : `${n.toFixed(1).replace('.', ',')} %`);

function resumen(d, txt) {
  if (!d.items.length) return 'Sin datos';
  return `<b>${fmtInt(d.obj)}</b> en ${txt} (${pct1(d.pct)}) ${delta(d.obj, d.objPrev)}`;
}

function cruceHtml(a) {
  if (!a.total) return '<p class="text-sm text-slate-500">Sin datos de audiencia.</p>';
  const topInd = a.ind.items.filter((i) => i.objetivo).slice(0, 3), topRol = a.rol.items.filter((i) => i.objetivo).slice(0, 3);
  const cell = (i, r) => Math.round((a.total * (i.n / a.ind.total) * (r.n / a.rol.total)));
  return `<div class="flex flex-wrap gap-6">
      <div><p class="kpi-label">Seguidores</p><p class="kpi-value">${fmtInt(a.total)}</p></div>
      <div><p class="kpi-label">Industria objetivo</p><p class="kpi-value" style="color:#0a66c2">${pct1(a.ind.pct)}</p></div>
      <div><p class="kpi-label">Rol objetivo</p><p class="kpi-value" style="color:#0a66c2">${pct1(a.rol.pct)}</p></div>
      <div><p class="kpi-label">Audiencia ideal (estimada)</p><p class="kpi-value" style="color:#16a34a">${a.ideal == null ? '—' : fmtInt(a.ideal)}</p>
        <p class="text-xs text-slate-500">industria objetivo × rol objetivo</p></div>
    </div>
    ${topInd.length && topRol.length ? `<div class="overflow-x-auto mt-3"><table class="min-w-full text-xs">
      <thead><tr class="text-slate-500"><th class="px-2 py-1 text-left font-semibold">Industria ↓ · Rol →</th>${topRol.map((r) => `<th class="px-2 py-1 text-right font-semibold">${esc(r.label)}</th>`).join('')}</tr></thead>
      <tbody>${topInd.map((i) => `<tr class="border-t border-slate-100"><td class="px-2 py-1">${esc(i.label)}</td>${topRol.map((r) => `<td class="px-2 py-1 text-right tabular-nums">${fmtInt(cell(i, r))}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>` : ''}
    <p class="text-xs text-slate-500 mt-2">LinkedIn entrega la industria y el rol de los seguidores por separado; el cruce es una estimación (proporcional), no un dato exacto de LinkedIn.</p>`;
}

// Etiquetas largas del eje en dos líneas (Chart.js acepta arreglos).
const wrap = (t, max = 22) => {
  if (t.length <= max) return t;
  const cut = t.lastIndexOf(' ', max);
  return cut > 0 ? [t.slice(0, cut), t.slice(cut + 1)] : t;
};

function barras(id, d) {
  if (typeof window.Chart !== 'function') return;
  upsert(id, 'bar', {
    labels: d.items.map((i) => wrap(i.label)),
    datasets: [{ label: 'Seguidores', data: d.items.map((i) => i.n), backgroundColor: d.items.map((i) => (i.objetivo ? CANALES.linkedin.color : '#cbd5e1')) }],
  }, {
    indexAxis: 'y',
    scales: { x: { beginAtZero: true }, y: { grid: { display: false }, ticks: { autoSkip: false } } },
    plugins: { legend: { display: false }, valueLabels: { mode: 'value' } },
  });
}

function renderOTs(list, periodLabel) {
  const k = computeKPIs(list);
  $('#campoOtInfo').textContent = `${periodLabel} · ${fmtInt(k.total)} OTs · ${fmtInt(k.pz.total ?? 0)} piezas`;
  $('#campoOtKpis').innerHTML = [['Total OTs', k.total, ''], ...Object.values(STATUS).filter((st) => k[st.key]).map((st) => [st.label, k[st.key], st.color])]
    .map(([l, n, c]) => `<div class="rounded-lg border border-slate-200 px-3 py-2"${c ? ` style="border-left:4px solid ${c}"` : ''}><p class="kpi-label">${esc(l)}</p><p class="text-xl font-bold tabular-nums">${fmtInt(n)}</p></div>`).join('');
  const rows = [...list].sort((a, b) => (b.ingreso ?? 0) - (a.ingreso ?? 0));
  $('#campoOtBody').innerHTML = rows.length ? rows.map((r) => `<tr class="border-t border-slate-100 align-top">
      <td class="px-3 py-2 tabular-nums whitespace-nowrap">${esc(r.ot)}</td>
      <td class="px-3 py-2 tabular-nums whitespace-nowrap text-slate-600">${esc(r.ingresoTxt || '—')}</td>
      <td class="px-3 py-2">${esc(r.desc)}</td>
      <td class="px-3 py-2 whitespace-nowrap">${esc(r.pieza || '—')}</td>
      <td class="px-3 py-2 text-right tabular-nums">${r.cantidad == null ? '—' : fmtInt(r.cantidad)}</td>
      <td class="px-3 py-2">${badge(r.estado, r.estadoRaw || STATUS[r.estado].label)}</td></tr>`).join('')
    : `<tr><td colspan="6" class="px-3 py-8 text-center text-slate-500">Aún no hay OTs de Campo Azul en ${esc(periodLabel)}.
        <div class="text-xs mt-1">Se identifican por la descripción (contiene "${esc(CONFIG.CAMPO_AZUL.OT_MATCH.join('", "').toLowerCase())}").</div></td></tr>`;
}
