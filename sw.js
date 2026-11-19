/* Gut Check service worker: opens offline, updates cleanly.
 * - The page itself: network first (3s), falling back to the saved copy when offline.
 * - Versioned files (app.js?v=N, styles.css?v=N, icons): saved copy first, they never change.
 * - Anything on another site (GitHub, Google) is never touched.
 * VERSION must match the ?v= in index.html (the test suite checks this). */
const VERSION = '17';
const CACHE = `gutcheck-${VERSION}`;
const SHELL = [
  './', 'index.html', `styles.css?v=${VERSION}`, `app.js?v=${VERSION}`,
  'manifest.webmanifest?v=2', 'icon.svg?v=2', 'favicon-32.png?v=2', 'icon-180.png?v=2', 'icon-192.png?v=2',
  'icon-512.png?v=2', 'icon-maskable-512.png?v=2', 'google-sheet/Code.gs',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('gutcheck-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const timeout = (ms, p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await timeout(3000, fetch(req, { cache: 'no-store' }));
        if (res.ok) cache.put('index.html', res.clone());
        return res;
      } catch {
        return (await cache.match('index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && (url.search || /\/vendor\/|\/google-sheet\//.test(url.pathname))) cache.put(req, res.clone()); // versioned or library files
    return res;
  })());
});
