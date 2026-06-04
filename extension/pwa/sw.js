const CACHE = 'mtb-v1';
const PRECACHE = ['/', '/manifest.json'];

self.addEventListener('install', e =>
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)))
);

self.addEventListener('activate', e =>
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ))
);

// Network-first: 앱 셸만 캐시, API/WS는 항상 네트워크
self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/') || e.request.url.includes('/ws')) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
