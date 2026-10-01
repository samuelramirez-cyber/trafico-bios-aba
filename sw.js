// Service worker: cachea el shell y las librerías CDN para abrir el dashboard sin red.
// Los datos de Google NO pasan por aquí: los gestiona connector.js con su propio caché y reintentos.
const VERSION = 'trafico-v5';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'config.js', 'manifest.webmanifest', 'icon-192.png',
  'js/connector.js', 'js/normalize.js', 'js/filters.js', 'js/charts.js', 'js/table.js', 'js/ui.js', 'js/weekly.js',
];
const CDN = ['https://cdn.tailwindcss.com', 'https://cdnjs.cloudflare.com/'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = request.url;
  const sameOrigin = url.startsWith(self.location.origin);
  if (request.method !== 'GET' || !(sameOrigin || CDN.some((p) => url.startsWith(p)))) return;
  if (sameOrigin && url.includes('/data/')) return;   // sample.csv lo maneja el conector

  // Archivos propios: red primero (cambios visibles al instante). CDN: caché primero.
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const hit = await cache.match(request);
    // Propios: revalidar siempre (evita mezclar módulos viejos y nuevos tras publicar). CDN: petición normal.
    const net = fetch(sameOrigin ? new Request(request.url, { cache: 'no-cache', credentials: 'same-origin' }) : request).then((res) => {
      if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
      return res;
    });
    if (sameOrigin) return net.catch(() => hit || Response.error());
    return hit || net;
  }));
});
