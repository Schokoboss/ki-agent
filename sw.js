// Service Worker: Offline-Hülle, Benachrichtigungen (Web Push) und „Teilen mit Nova“.
// Wichtig: Nur eigene Caches (nova-*) aufräumen – WebLLM legt dort das Handy-Modell ab.
const CACHE = 'nova-v7';
const LIB_CACHE = 'nova-lib-v1';
const SHARE_CACHE = 'nova-share';
const ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'local.js', 'llm-worker.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/badge-96.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('nova-') && ![CACHE, LIB_CACHE, SHARE_CACHE].includes(k))
      .map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// ---------- Teilen mit Nova: andere Apps schicken Text/Links/Fotos per POST hierher
async function handleShare(request) {
  const form = await request.formData();
  const files = [];
  for (const f of form.getAll('files')) {
    if (f && f.size) files.push({ name: f.name, type: f.type, data: await blobToDataURL(f) });
  }
  const share = {
    text: [form.get('title'), form.get('text'), form.get('url')].filter(Boolean).join('\n'),
    files, ts: Date.now(),
  };
  const c = await caches.open(SHARE_CACHE);
  await c.put('pending-share', new Response(JSON.stringify(share), { headers: { 'Content-Type': 'application/json' } }));
  return Response.redirect('./?share=1', 303);
}

async function blobToDataURL(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`;
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share')) {
    e.respondWith(handleShare(e.request));
    return;
  }
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
  // Immer beim Server nachfragen (GitHub Pages lässt sonst 10 min alte Dateien im Browser-Cache)
  e.respondWith(
    fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});

// ---------- Benachrichtigungen vom Laptop
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Nova', body: e.data && e.data.text() }; }
  const title = d.title || 'Nova';
  const opts = {
    body: d.body || '',
    tag: d.tag || 'nova',
    renotify: true,
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    data: { conv: d.conv || null, kind: d.kind || '' },
    vibrate: d.kind === 'approve' || d.kind === 'reminder' ? [120, 60, 120, 60, 120] : [80],
    requireInteraction: d.kind === 'approve',
    timestamp: d.ts ? d.ts * 1000 : Date.now(),
  };
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Ist die App gerade offen und zeigt genau diesen Chat, reicht die Anzeige in der App
    if (wins.some(w => w.visibilityState === 'visible') && d.kind === 'done') {
      wins.forEach(w => w.postMessage({ type: 'push', data: d }));
      return;
    }
    if (self.navigator.setAppBadge) self.navigator.setAppBadge().catch(() => {});
    await self.registration.showNotification(title, opts);
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const conv = e.notification.data && e.notification.data.conv;
  const target = new URL(conv ? `./?conv=${encodeURIComponent(conv)}` : './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) {
        await w.focus();
        w.postMessage({ type: 'open', conv });
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
