/**
 * API de solo lectura para el Dashboard de Tráfico.
 * La hoja permanece PRIVADA: este script la lee con la cuenta del propietario y devuelve
 * únicamente el encabezado + las filas cuyo CLIENTE está en CLIENTES (filtro en servidor).
 *
 * Despliegue: Implementar → Nueva implementación → Tipo: Aplicación web
 *   Ejecutar como: Yo · Quién tiene acceso: Cualquier usuario
 * Copiar la URL que termina en /exec en CONFIG.APPS_SCRIPT_URL (config.js).
 * Tras editar este archivo: Implementar → Gestionar implementaciones → Editar → Versión nueva.
 */
const SHEET_ID = 'PEGAR_AQUI_EL_ID_DEL_SHEET';
const GID = 0;                          // pestaña "OT 2026" (número tras #gid= en la URL)
const CLIENTES = ['GRUPO BIOS ABA'];    // único cliente expuesto
const CACHE_SEG = 60;                   // evita leer la hoja en cada visita

function doGet(e) {
  try {
    const view = e && e.parameter && e.parameter.view;
    if (view === 'pestanas') return out_(pestanas_());                       // Semanal.gs
    if (view === 'semana') return out_(semana_(Number(e.parameter.gid)));    // Semanal.gs
    const cache = CacheService.getScriptCache();
    const hit = cache.get('payload');
    if (hit) return out_(hit);

    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheets().find((s) => s.getSheetId() === GID);
    if (!sheet) throw new Error('Pestaña no encontrada (revise GID)');

    const rows = sheet.getDataRange().getDisplayValues();
    const head = rows.findIndex((r) => r.some((c) => norm_(c) === 'CLIENTE'));
    if (head < 0) throw new Error('Columna CLIENTE no encontrada');
    const col = rows[head].findIndex((c) => norm_(c) === 'CLIENTE');
    const allowed = CLIENTES.map(norm_);
    const data = rows.slice(head + 1).filter((r) => allowed.includes(norm_(r[col])));

    const payload = JSON.stringify({
      ok: true,
      ts: new Date().toISOString(),
      tabs: [{ name: sheet.getName(), rows: [rows[head], ...data] }],
    });
    if (payload.length < 95000) cache.put('payload', payload, CACHE_SEG);   // límite de CacheService: 100 KB
    return out_(payload);
  } catch (err) {
    return out_(JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
  }
}

function norm_(s) {
  return String(s).normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

function out_(json) {
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
