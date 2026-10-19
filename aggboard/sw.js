/*
 * AggBoard, Copyright (c) 2026 Carsten Dominik. MIT License (see LICENSE).
 *
 * Service worker: keeps a complete copy of the app on the device so it starts
 * without network. Each release is cached as one complete set under its
 * version. A new release installs in the background and waits; the page shows
 * a "Reload" prompt and only switches when the user taps it.
 */
const VERSION = '2026.10.18-29';
const CACHE = 'aggboard-' + VERSION;
const FILES = [
  './',
  'index.html',
  'app.js?v=' + VERSION,
  'aggregate-engine.js?v=' + VERSION,
  'manifest.webmanifest',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' bypasses the HTTP cache, so the set really is this release
    await cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })));
    // First installation: nothing to replace, take over right away.
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('aggboard-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// The page asks the waiting worker to take over when the user taps "Reload".
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'VERSION' && event.ports && event.ports[0]) event.ports[0].postMessage(VERSION);
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Page loads: always the cached page of this release (works offline).
    if (req.mode === 'navigate') {
      return (await cache.match('index.html')) || (await cache.match('./')) || fetch(req);
    }
    const hit = await cache.match(req);
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (err) {
      // Offline and not cached: try the same file without its version query.
      const plain = await cache.match(url.pathname.replace(/^.*\//, ''), { ignoreSearch: true });
      if (plain) return plain;
      throw err;
    }
  })());
});
