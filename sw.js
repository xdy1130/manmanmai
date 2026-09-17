const CACHE = 'slow-buy-v69';
const ASSETS = ['./', './index.html', './manifest.json', './app-icon.svg', './storage.js', './offline.js', './migrations.js', './expenses.js', './refunds.js', './inventory.js', './selectors.js?v=69'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('slow-buy-v') && key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const request = event.request;
  const isHtml = request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html');
  if (isHtml) {
    event.respondWith(fetch(request).then(response => {
      if (!response.ok) throw new Error('HTML request failed');
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(request, copy));
      return response;
    }).catch(() => caches.match(request)));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
});
