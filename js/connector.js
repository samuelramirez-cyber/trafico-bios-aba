// Conector de datos: Google Sheets (CSV export o Apps Script) con timeout, reintentos y caché local.
import { CONFIG } from '../config.js';
import { parseCSV } from './normalize.js';

const CACHE_KEY = 'bios-trafico:data:v1';
let inflight = null;

export function sourceMode() {
  if (CONFIG.SOURCE === 'apps_script' && CONFIG.APPS_SCRIPT_URL) return 'apps_script';
  if (CONFIG.SOURCE === 'csv' && CONFIG.SHEET_ID) return 'csv';
  return 'demo';
}

// Identifica la fuente para no mezclar cachés si cambia la configuración.
const sourceId = () => `${sourceMode()}|${CONFIG.SHEET_ID}|${CONFIG.APPS_SCRIPT_URL}|${CONFIG.TABS.map((t) => t.gid).join(',')}`;

class FetchError extends Error {
  constructor(msg, retryable = true) { super(msg); this.retryable = retryable; }
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (res.status === 401 || res.status === 403) {
      throw new FetchError('La hoja es privada: compártala como "Cualquier persona con el enlace → Lector" o use el modo apps_script', false);
    }
    if (!res.ok) throw new FetchError(`HTTP ${res.status} al leer la hoja`, res.status >= 500 || res.status === 429);
    const text = await res.text();
    if (/^\s*<(!doctype|html)/i.test(text)) {
      throw new FetchError('Google devolvió HTML: la hoja no es pública o el ID/gid es incorrecto', false);
    }
    return text;
  } catch (e) {
    if (e instanceof FetchError) throw e;
    throw new FetchError(e.name === 'AbortError'
      ? 'Tiempo de espera agotado al conectar con Google Sheets'
      : 'Sin conexión o acceso bloqueado (verifique red y que la hoja esté compartida por enlace)');
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (!e.retryable || i >= CONFIG.RETRIES) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i + Math.random() * 300));
    }
  }
}

async function fetchTabs() {
  const mode = sourceMode();
  if (mode === 'apps_script') {
    const text = await withRetry(() => fetchText(CONFIG.APPS_SCRIPT_URL));
    let json;
    try { json = JSON.parse(text); } catch { throw new FetchError('Respuesta no válida del Apps Script', false); }
    if (!json.ok) throw new FetchError(json.error || 'Error en Apps Script', false);
    return json.tabs.filter((t) => Array.isArray(t.rows));
  }
  if (mode === 'csv') {
    const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(CONFIG.SHEET_ID)}/export?format=csv&gid=`;
    return Promise.all(CONFIG.TABS.map(async (t) => ({
      name: t.name,
      rows: parseCSV(await withRetry(() => fetchText(base + encodeURIComponent(t.gid)))),
    })));
  }
  return [{ name: 'DEMO', rows: parseCSV(await fetchText('data/sample.csv')) }];
}

function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY));
    return c && c.src === sourceId() && Array.isArray(c.tabs) ? c : null;
  } catch { return null; }
}

function writeCache(tabs, ts) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ src: sourceId(), ts, tabs })); } catch { /* cuota llena / modo privado */ }
}

/**
 * Devuelve { tabs:[{name, rows}], ts, origin } con origin: 'network' | 'cache' | 'stale' (red caída,
 * se usa el último caché; incluye `error`). Lanza error solo si no hay red ni caché.
 * Llamadas concurrentes comparten la misma petición.
 */
export function loadData({ force = false } = {}) {
  if (inflight) return inflight;
  inflight = (async () => {
    const cached = readCache();
    if (!force && cached && Date.now() - cached.ts < CONFIG.CACHE_TTL_MIN * 60000) {
      return { ...cached, origin: 'cache' };
    }
    try {
      const tabs = await fetchTabs();
      const ts = Date.now();
      writeCache(tabs, ts);
      return { tabs, ts, origin: 'network' };
    } catch (e) {
      if (cached) return { ...cached, origin: 'stale', error: e.message };
      throw e;
    }
  })().finally(() => { inflight = null; });
  return inflight;
}
