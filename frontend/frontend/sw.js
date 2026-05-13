// Service Worker for TMU Smart Attendance — Push + Offline Caching
const CACHE_NAME = 'tmu-attendance-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];

// Pre-cache critical assets on install
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(url).catch(err => console.warn('Cache miss:', url, err)))
      )
    )
  );
});

// Remove old caches on activate
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => k !== CACHE_NAME ? caches.delete(k) : null)))
      .then(() => self.clients.claim())
  );
});

// Fetch strategy:
//   - API calls → Network first, no cache
//   - Static assets (JS/CSS/images) → Cache first, update in background
//   - HTML pages → Network first, fall back to cache
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // API: always network, never cache
  if (url.pathname.startsWith('/api/') || url.pathname.match(/^\/(sessions|timetable|attendance|users|courses|settings)/)) {
    return; // let browser handle normally
  }

  // Static assets: cache first
  if (['style', 'script', 'font', 'image'].includes(e.request.destination)) {
    e.respondWith(cacheFirst(e.request));
    return;
  }

  // HTML pages: network first, fall back to cache
  e.respondWith(networkFirst(e.request));
});

async function cacheFirst(request) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (e) {
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (e) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const fallback = await cache.match('/index.html');
      if (fallback) return fallback;
    }
    return new Response('You are offline. Please reconnect.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

// Handle push notifications
self.addEventListener('push', e => {
  let data = { title: 'Smart Attendance', body: 'You have a notification', url: '/' };
  try {
    if (e.data) data = JSON.parse(e.data.text());
  } catch {}

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body:    data.body,
      icon:    '/icon-192.png',
      badge:   '/icon-192.png',
      vibrate: [200, 100, 200],
      data:    { url: data.url || '/' },
      actions: [
        { action: 'mark',    title: 'Mark Attendance' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    })
  );
});

// Handle notification click
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      return clients.openWindow(url);
    })
  );
});
