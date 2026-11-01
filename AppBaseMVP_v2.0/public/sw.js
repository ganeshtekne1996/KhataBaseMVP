const CACHE_NAME = 'mykhata-cache-v6';   // bump on every release
const APP_SHELL = ['index.html', 'db.js', 'firebase-config.js', 'manifest.json',
                   'privacy.html', 'terms.html', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) =>
    Promise.all(APP_SHELL.map((u) => c.add(u).catch(() => {})))));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))));
  self.clients.claim();
});
// App files only (same-origin GET): network-first, cache fallback offline.
// Never touches Firebase/Google requests or Firebase's own /__/ auth pages.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/__/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => { if (res.ok) { const c = res.clone(); caches.open(CACHE_NAME).then((x) => x.put(e.request, c)); } return res; })
      .catch(() => caches.match(e.request))
  );
});
