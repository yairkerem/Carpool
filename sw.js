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
const CACHE_VERSION = 'v80';
const CACHE = 'carpool-shell-' + CACHE_VERSION;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-car-192.png',
  './icon-car-512.png',
  './icon-car-maskable-192.png',
  './icon-car-maskable-512.png',
  './badge-96.png'
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
    /* The app, and only the app. This used to answer every navigation on the
       origin with the app's shell, which is fine while the app is the only
       page here — and wrong the moment it is not. guide.html, sitting beside
       it and sent to parents, opened the board instead, on every phone that
       had ever cached the app. A second page is not a route of this one. */
    const home = new URL('./', self.location).pathname;
    const isApp = url.pathname === home || url.pathname === home + 'index.html';
    if (isApp) {
      event.respondWith(caches.match('./index.html').then(hit => hit || fetch(req)));
    }
    return;
  }

  event.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});

/* ---- push ------------------------------------------------------
 * The payload is the whole notification, written by the backend and encrypted
 * end to end: the push service carries it without being able to read it.
 *
 * userVisibleOnly is not a preference — browsers grant a push subscription on
 * the promise that every message becomes a notification, and one that quietly
 * does not is how a site loses the permission. So there is a fallback line
 * rather than a path that shows nothing. */
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (err) { data = {}; }

  const title = data.title || 'הסעות';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || 'יש עדכון בלוח ההסעות.',
    icon: './icon-car-192.png',
    /* A badge is a stencil, not an icon: Android tints it with the system
       colour and reads only its alpha channel, so the colour icon arrived
       as a plain grey square in the status bar. This one is the car cut out
       of its blue, cropped to fill the frame because it is drawn at about
       24px. iOS ignores it entirely, which costs nothing. */
    badge: './badge-96.png',
    lang: 'he',
    dir: 'rtl',
    /* Same tag replaces rather than stacks: two reminders for one ride, sent
       because a trigger ran twice, should look like one reminder. */
    tag: data.tag || 'carpool',
    data: { url: data.url || './' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || './',
                         self.location.href).href;

  /* Focus the app if it is already open rather than opening a second copy of
     it — a parent who taps a reminder wants the board, not a new tab. */
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(list => {
      for (const c of list) {
        if (c.url.indexOf(self.location.origin) === 0 && 'focus' in c) return c.focus();
      }
      return clients.openWindow(target);
    }));
});
