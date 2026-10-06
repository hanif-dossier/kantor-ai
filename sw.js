// Service worker Kantor AI: selalu tanya server dulu (versi baru langsung terpakai), simpanan dipakai saat tanpa sinyal.
// Data status tidak pernah disimpan di sini.
const NAMA = 'kantor-v25';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(NAMA).then(c => c.addAll(['./', 'manifest.json']))); });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== NAMA).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url); if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  const segar = e.request.mode === 'navigate' ? new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }) : new Request(e.request, { cache: 'no-cache' });
  e.respondWith(fetch(segar).then(r => { const s = r.clone(); caches.open(NAMA).then(c => c.put(e.request, s)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('./'))));
});
