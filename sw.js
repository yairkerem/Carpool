/* Service worker — app shell only.
 *
 * Bump CACHE_VERSION on every deploy, in step with APP_VERSION in index.html.
 * That one number is what makes phones pick up new code; nothing here
 * revalidates on its own.
 *
 * Backend traffic is never cached: every call to the Apps Script endpoint is a
 * cross-origin POST, and the guard in fetch() below only ever handles
 * same-origin GETs.
 */
const CACHE_VERSION = 'v39';
const CACHE = 'carpool-shell-' + CACHE_VERSION;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-car-192.png',
  './icon-car-512.png',
  './icon-car-maskable-192.png',
  './icon-car-maskable-512.png'
];

/* No skipWaiting() here on purpose. A new worker installs and then waits, so
 * the app can offer the update instead of reloading out from under someone
 * halfway through typing an event. The page sends SKIP_WAITING when the
 * parent accepts. */
/* Not cache.addAll(SHELL).
 *
 * GitHub Pages serves everything through a CDN with a ten-minute lifetime, so
 * a worker that has only just been fetched can turn round and fill its cache
 * with the *previous* index.html from an edge node — leaving a new service
 * worker serving an old app, which is worse than not updating at all.
 *
 * Each file is therefore requested under a URL carrying this build's version,
 * which no edge node has ever seen, and stored under its clean name so that
 * fetch() can still match a plain request against it.
 *
 * The two files the app cannot run without are required; a missing icon is
 * not worth failing an install over, because a failed install is an update
 * that never arrives. */
const REQUIRED = ['./', './index.html'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async url => {
      try {
        const res = await fetch(url + '?v=' + CACHE_VERSION, { cache: 'reload' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        await cache.put(url, res);          // stored clean, fetched cache-busted
      } catch (err) {
        if (REQUIRED.indexOf(url) >= 0) throw err;
      }
    }));
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;

  /* POSTs to the backend fall straight through to the network, uncached. */
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* Navigations: serve the cached shell so the app opens instantly and still
     shows a sane screen with no network. */
  if (req.mode === 'navigate') {
    event.respondWith(caches.match('./index.html').then(hit => hit || fetch(req)));
    return;
  }

  event.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
