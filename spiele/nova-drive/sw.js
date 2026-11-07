// Nova Drive offline: alles, was das Spiel einmal geladen hat, bleibt auf dem Gerät.
// Seiten/Code: erst Netz (für Updates), sonst Speicher. Modelle/Texturen/Bibliotheken: sofort aus dem Speicher,
// im Hintergrund aktualisieren (stale-while-revalidate). Eigener Cache „novadrive-*“ – die Nova-App bleibt unberührt.
const CACHE = 'novadrive-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('novadrive-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Schriften usw. von außen: Browser-Cache
  const asset = /\/(models|lib)\//.test(url.pathname) || /\.(glb|webp|png|jpg|svg|woff2?)$/.test(url.pathname);
  if (asset) {
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
  } else {
    e.respondWith(fetch(req).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return r;
    }).catch(() => caches.match(req).then(h => h || caches.match('index.html'))));
  }
});
