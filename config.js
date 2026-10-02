// Configuración del Dashboard de Tráfico — único archivo a editar para conectar la hoja.
export const CONFIG = {
  // 'apps_script' (recomendado) → Web App de apps-script/DashboardApi.gs: la hoja sigue PRIVADA y el
  //                 script devuelve solo las filas del cliente permitido. La URL /exec no expone la hoja.
  // 'csv'         → exportación CSV directa (exige compartir la hoja por enlace = TODOS los clientes visibles).
  //                 Usar solo en local. Nunca publicar un SHEET_ID de una hoja compartida por enlace.
  // Si falta APPS_SCRIPT_URL / SHEET_ID el dashboard arranca en MODO DEMO con data/sample.csv.
  SOURCE: 'apps_script',
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxlTOL12fWzQCnbfvoV7ZfWMPbtRPOgFGKH2GCP7pzHNbbKE3HuwEmSvsJRTcNhYtfv8g/exec',

  SHEET_ID: '',

  // Web (GA4) y redes (Metricool): Apps Script "Dashboard Digital API" (cuenta tango.red). Los tokens viven allí.
  DIGITAL_API_URL: 'https://script.google.com/macros/s/AKfycbwhzxKtDPq4CSm8nErUeTEinKQhN98FprS6AMkwtBrIzQuRIKFEn8ldEcq7HMC7dOZ5/exec',
  DIGITAL_FROM: '2026-01-01',   // inicio del histórico digital (con periodo "Todo")
  TABS: [
    { name: 'OT 2026', gid: '0' },
  ],

  // Filtro fijo en el navegador (segunda capa; el filtro que protege los datos es el del Apps Script).
  CLIENT_FILTER: ['GRUPO BIOS ABA'],

  CACHE_TTL_MIN: 5,        // no se vuelve a pedir la hoja si el caché local tiene menos de N minutos
  AUTO_REFRESH_MIN: 5,     // refresco automático (solo con la pestaña visible)
  FETCH_TIMEOUT_MS: 15000,
  RETRIES: 3,              // reintentos con backoff exponencial (1s, 2s, 4s)
  PAGE_SIZE: 25,

  DATE_ORDER: 'DMY',       // orden de fechas ambiguas tipo 03/04/2026 → 3 de abril
  YEARS: [2024, 2025, 2026],
  LOCALE: 'es-CO',

  // Estados (columna ESTADO). Se evalúan en orden; cada término se compara como prefijo de palabra,
  // sin tildes ni mayúsculas. Filas sin coincidencia → "Sin estado".
  STATUSES: [
    { key: 'norealizado', label: 'No realizado', color: '#dc2626', match: ['NO REALIZ', 'CANCEL', 'ANUL', 'RECHAZ'] },
    { key: 'reproceso',   label: 'En reproceso', color: '#7c3aed', match: ['REPROCESO', 'CORRECCION', 'AJUSTE'] },
    { key: 'revision',    label: 'En revisión',  color: '#d97706', match: ['REVISION', 'PENDIENT', 'ESPERA'] },
    { key: 'proceso',     label: 'En proceso',   color: '#2563eb', match: ['PROCESO', 'CURSO', 'PRODUCCION'] },
    { key: 'entregado',   label: 'Entregado',    color: '#16a34a', match: ['ENTREGAD', 'APROB', 'FINALIZ', 'TERMINAD'] },
  ],

  // Seguimiento semanal (Cuadro Tango): semanas que se cargan al abrir; el resto con "Cargar histórico".
  WEEKS_INITIAL: 12,
  STALE_WEEKS: 3,          // "estancada": mismo estado (no aprobado) durante ≥ N semanas seguidas
  // Colores del Cuadro que no están en su leyenda → estado. Ej.: '#34a853': 'APROBADO'.
  CUADRO_COLORES: { '#34a853': 'APROBADO', '#ff0000': 'CANCELADO', '#4a86e8': 'AJUSTES' },   // definidos por las ejecutivas (2026-10)

  // OTs cuyas piezas NO se suman (siguen contando como OT). Mismo formato de términos que CATEGORIES.
  // Hoy: parrillas de contenido (p. ej. OT 001557, 640 piezas a dic-2026) que distorsionan el conteo.
  PIECES_EXCLUDE: ['PARRILLA'],

  // Tipos de pieza, detectados en DESCRIPCIÓN + PIEZA (en orden; la primera que coincide gana).
  // Término = prefijo de palabra ('FACH' → fachada, fach); con '$' = palabra exacta ('INV$' → inv, no investigación).
  // Lo que no coincide queda en "Otros".
  CATEGORIES: [
    { key: 'fachadas',     label: 'Fachadas',             color: '#0f766e', match: ['FACH'] },
    { key: 'invitaciones', label: 'Invitaciones',         color: '#db2777', match: ['INV$', 'INVI'] },
    { key: 'eventos',      label: 'Eventos',              color: '#ea580c', match: ['CHAR', 'FERIA', 'JORN', 'ENCUENTRO', 'RODEO', 'STAND', 'CONGRES', 'EVENTO', 'FENAVI', 'PORKAMERICAS'] },
    { key: 'empaques',     label: 'Empaques y etiquetas', color: '#7c3aed', match: ['EMPAQUE', 'ETIQUETA'] },
    { key: 'audiovisual',  label: 'Audiovisual',          color: '#0284c7', match: ['VIDEO', 'FOTO', 'GRAB'] },
  ],
};
