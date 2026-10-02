/**
 * API "Dashboard Digital" (cuenta @tango.red): redes sociales (Metricool) y web (Google Analytics 4).
 *   ?view=redes&from=YYYY-MM-DD&to=YYYY-MM-DD → series diarias de seguidores e impresiones por marca y red
 *   ?view=web&from=YYYY-MM-DD&to=YYYY-MM-DD   → métricas web mensuales (GA4) de Contegral y Finca
 *   ?view=ga4props                            → diagnóstico: propiedades GA4 visibles para la cuenta
 * Secretos en Propiedades del script (Configuración del proyecto → Propiedades del script):
 *   METRICOOL_TOKEN, METRICOOL_USER_ID
 *   AJUSTES_WEB (opcional): correcciones manuales por marca y mes, p. ej.
 *     {"Contegral|2026-07": {"pctCelular": 1, "pctComputador": 99, "pctNuevos": 74.7, "nota": "Dato del informe"}}
 * Despliegue: Aplicación web · Ejecutar como: Yo · Acceso: Cualquier usuario.
 */
const MARCAS = ['Contegral', 'Finca', 'Cinta Azul'];          // inicio del nombre de la marca en Metricool
const WEB_MARCAS = ['Contegral', 'Finca'];                    // inicio del nombre de la propiedad GA4
const REDES = {
  instagram: { campo: 'instagram', seguidores: 'followers', impresiones: 'views' },
  facebook: { campo: 'facebook', seguidores: 'pageFollows', impresiones: 'page_media_view' },
  linkedin: { campo: 'linkedinCompany', seguidores: 'followers', impresiones: 'impressionCount' },
};
const MC = 'https://app.metricool.com/api';
const ZONA = 'America/Bogota';
const CACHE_SEG = 3600;

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const rango = rango_(p.from, p.to);
    if (p.view === 'redes') return out_(conCache_('redes|' + rango.from + '|' + rango.to, () => redes_(rango)));
    if (p.view === 'web') return out_(conCache_('web|' + rango.from + '|' + rango.to, () => web_(rango)));
    if (p.view === 'ga4props') return out_(JSON.stringify({ ok: true, propiedades: propiedadesGa4_() }));
    return out_(JSON.stringify({ ok: false, error: 'Use ?view=redes o ?view=web' }));
  } catch (err) {
    return out_(JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
  }
}

/* ---------- Redes (Metricool) ---------- */

function redes_(rango) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('METRICOOL_TOKEN');
  const userId = props.getProperty('METRICOOL_USER_ID');
  if (!token || !userId) throw new Error('Faltan METRICOOL_TOKEN / METRICOOL_USER_ID en Propiedades del script');
  const headers = { 'X-Mc-Auth': token };

  const perfiles = JSON.parse(UrlFetchApp.fetch(MC + '/admin/simpleProfiles?userId=' + userId, { headers }).getContentText());
  const marcas = MARCAS.map((m) => perfiles.find((p) => norm_(p.label).indexOf(norm_(m)) === 0)).filter(Boolean);

  // Una petición por marca × red × métrica, todas en paralelo.
  const pedidos = [];
  marcas.forEach((perfil) => Object.keys(REDES).forEach((red) => {
    if (!perfil[REDES[red].campo]) return;                    // la marca no tiene esa red conectada
    ['seguidores', 'impresiones'].forEach((cual) => pedidos.push({ perfil, red, cual }));
  }));
  const resps = UrlFetchApp.fetchAll(pedidos.map((x) => ({
    url: MC + '/v2/analytics/timelines?' + qs_({
      userId, blogId: x.perfil.id, network: x.red, metric: REDES[x.red][x.cual], subject: 'account',
      timezone: ZONA, from: rango.from + 'T00:00:00', to: rango.to + 'T23:59:59',
    }),
    headers, muteHttpExceptions: true,
  })));

  const out = {};
  pedidos.forEach((x, i) => {
    const marca = MARCAS.find((m) => norm_(x.perfil.label).indexOf(norm_(m)) === 0);
    const red = ((out[marca] = out[marca] || {})[x.red] = out[marca][x.red] || {});
    const code = resps[i].getResponseCode();
    if (code !== 200) { red[x.cual] = []; red.error = 'HTTP ' + code; return; }
    const data = JSON.parse(resps[i].getContentText()).data || [];
    // Algunas redes (LinkedIn) traen dos registros el mismo día: impresiones se suman, seguidores toman el último.
    const puntos = {};
    data.forEach((s) => (s.values || []).forEach((v) => {
      if (v.value == null) return;
      const d = String(v.dateTime).slice(0, 10);
      puntos[d] = x.cual === 'impresiones' ? (puntos[d] || 0) + v.value : v.value;
    }));
    red[x.cual] = Object.keys(puntos).sort().map((d) => [d, puntos[d]]);
  });
  return JSON.stringify({ ok: true, ts: new Date().toISOString(), rango, marcas: out });
}

/* ---------- Web (Google Analytics 4, API de datos) ---------- */

function propiedadesGa4_() {
  const r = gapi_('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200');
  const props = [];
  (r.accountSummaries || []).forEach((a) => (a.propertySummaries || []).forEach((p) =>
    props.push({ cuenta: a.displayName, propiedad: p.property, nombre: p.displayName })));
  return props;
}

function web_(rango) {
  const props = propiedadesGa4_();
  const out = {};
  WEB_MARCAS.forEach((marca) => {
    const p = props.find((x) => norm_(x.nombre).indexOf(norm_(marca)) === 0) || props.find((x) => norm_(x.nombre).indexOf(norm_(marca)) >= 0);
    if (!p) { out[marca] = { error: 'Propiedad GA4 no encontrada' }; return; }
    const dateRanges = [{ startDate: rango.from, endDate: rango.to }];
    const r = gapi_('https://analyticsdata.googleapis.com/v1beta/' + p.propiedad + ':batchRunReports', {
      requests: [
        { dateRanges, dimensions: [{ name: 'yearMonth' }],
          metrics: ['sessions', 'screenPageViews', 'totalUsers', 'newUsers', 'activeUsers', 'averageSessionDuration', 'userEngagementDuration'].map((name) => ({ name })) },
        { dateRanges, dimensions: [{ name: 'yearMonth' }, { name: 'deviceCategory' }], metrics: [{ name: 'sessions' }] },
        { dateRanges, dimensions: [{ name: 'yearMonth' }, { name: 'newVsReturning' }], metrics: [{ name: 'activeUsers' }] },
      ],
    });
    const meses = {};
    const mes = (ym) => (meses[ym.slice(0, 4) + '-' + ym.slice(4)] = meses[ym.slice(0, 4) + '-' + ym.slice(4)] || { dispositivos: {}, tipoUsuario: {} });
    const [base, disp, tipo] = r.reports || [];
    const nombres = (base.metricHeaders || []).map((h) => h.name);
    (base.rows || []).forEach((row) => {
      const m = mes(row.dimensionValues[0].value);
      row.metricValues.forEach((v, i) => { m[nombres[i]] = Number(v.value); });
    });
    (disp.rows || []).forEach((row) => { mes(row.dimensionValues[0].value).dispositivos[row.dimensionValues[1].value] = Number(row.metricValues[0].value); });
    (tipo.rows || []).forEach((row) => { mes(row.dimensionValues[0].value).tipoUsuario[row.dimensionValues[1].value] = Number(row.metricValues[0].value); });
    out[marca] = { propiedad: p.nombre, meses };
  });
  // Ajustes manuales (p. ej. un mes reportado con otras cifras): el dashboard los muestra marcados.
  const ajustes = JSON.parse(PropertiesService.getScriptProperties().getProperty('AJUSTES_WEB') || '{}');
  Object.keys(ajustes).forEach((k) => {
    const [marca, ym] = k.split('|');
    const m = out[marca] && out[marca].meses && out[marca].meses[ym];
    if (m) m.ajuste = ajustes[k];
  });
  return JSON.stringify({ ok: true, ts: new Date().toISOString(), rango, marcas: out });
}

function gapi_(url, body) {
  const res = UrlFetchApp.fetch(url, {
    method: body ? 'post' : 'get', contentType: 'application/json', payload: body ? JSON.stringify(body) : undefined,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true,
  });
  const json = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() !== 200) throw new Error('Google API ' + res.getResponseCode() + ': ' + ((json.error && json.error.message) || ''));
  return json;
}

/* ---------- Utilidades ---------- */

// Rango por defecto: desde el 1 de enero del año actual hasta hoy.
function rango_(from, to) {
  const hoy = Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd');
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  return { from: ok(from) ? from : hoy.slice(0, 4) + '-01-01', to: ok(to) ? (to > hoy ? hoy : to) : hoy };
}

// CacheService admite 100 KB por clave: respuestas grandes se guardan en trozos.
function conCache_(key, fn) {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(key + '#n') || 0);
  if (n) {
    const parts = cache.getAll(Array.from({ length: n }, (_, i) => key + '#' + i));
    if (Object.keys(parts).length === n) return Array.from({ length: n }, (_, i) => parts[key + '#' + i]).join('');
  }
  const payload = fn();
  const size = 90000, chunks = {};
  for (let i = 0; i * size < payload.length; i++) chunks[key + '#' + i] = payload.slice(i * size, (i + 1) * size);
  chunks[key + '#n'] = String(Object.keys(chunks).length);
  cache.putAll(chunks, CACHE_SEG);
  return payload;
}

function qs_(o) { return Object.keys(o).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(o[k])).join('&'); }
function norm_(s) { return String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim(); }
function out_(json) { return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON); }
