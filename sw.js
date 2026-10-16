// Offline-Hülle: App-Dateien aus dem Cache, wenn kein Netz da ist. Die API läuft nie über den Cache.
// Wichtig: Nur eigene Caches (nova-*) aufräumen – WebLLM legt dort das Handy-Modell ab.
const CACHE = 'nova-v2';
const LIB_CACHE = 'nova-lib-v1';
const ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'local.js', 'llm-worker.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('nova-') && k !== CACHE && k !== LIB_CACHE)
      .map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // WebLLM-Bibliothek (versioniert, ändert sich nie) – Cache zuerst, damit der Handy-Modus offline startet
  if (url.hostname === 'esm.run' || (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('@mlc-ai/web-llm'))) {
    e.respondWith(caches.open(LIB_CACHE).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin || url.pathname.includes('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
