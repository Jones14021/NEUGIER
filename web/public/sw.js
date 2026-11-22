// Offline-Cache für Gegenden ohne Netz.
// - App-Shell (HTML/JS/CSS): stale-while-revalidate
// - API-GETs: network-first, Fallback Cache
// - Fotos & Google-Maps-Kacheln: cache-first (begrenzt)
const VERSION = '__APP_VERSION__';
const SHELL = `neugier-shell-${VERSION}`;
const DATA = 'neugier-data-v1';
const MEDIA = 'neugier-media-v1';
const BUILD_ASSETS = ["__BUILD_ASSETS__"];
const MAX_MEDIA = 1500;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll(['/', '/manifest.webmanifest', '/icon.svg', ...BUILD_ASSETS]);
    const html = await (await cache.match('/')).text();
    const referenced = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"'?#]+)(?:[^"']*)["']/g)].map((match) => match[1]);
    if (!referenced.some((asset) => asset.endsWith('.js')) || referenced.some((asset) => !BUILD_ASSETS.includes(asset))) {
      throw new Error('App shell does not match the service worker');
    }
    for (const asset of BUILD_ASSETS) {
      const response = await cache.match(asset);
      const contentType = response?.headers.get('content-type') || '';
      if (!response || !(asset.endsWith('.js') ? /javascript/i : /text\/css/i).test(contentType)) {
        throw new Error('Invalid app asset: ' + asset);
      }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('neugier-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then((clients) => { for (const client of clients) void client.navigate(client.url).catch(() => {}); }),
  );
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName);
  const keys = await c.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await c.delete(k);
}

async function networkFirst(req, cacheName) {
  const c = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) c.put(req, res.clone());
    return res;
  } catch {
    const hit = await c.match(req);
    if (hit) return hit;
    throw new Error('offline');
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req);
  const update = fetch(req)
    .then((res) => {
      if (res.ok) c.put(req, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || update;
}

async function cacheFirst(req, cacheName) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  // Opaque Antworten (Kacheln ohne CORS) dürfen ebenfalls gecacht werden
  if (res.ok || res.type === 'opaque') {
    c.put(req, res.clone());
    trim(cacheName, MAX_MEDIA);
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    if (url.pathname.startsWith('/ws')) return;
    if (url.pathname.startsWith('/api/auth')) return;
    if (url.pathname.startsWith('/api/admin/backup')) return;
    if (url.pathname === '/api/admin/settings') return;
    if (/^\/api\/trips\/[^/]+\/conversations(?:\/|$)/.test(url.pathname)) return;
    if (/^\/api\/trips\/[^/]+\/podcasts(?:\/|$)/.test(url.pathname)) return;
    if (url.pathname === '/manifest.webmanifest') return e.respondWith(networkFirst(req, SHELL));
    if (url.pathname.startsWith('/api/')) return e.respondWith(networkFirst(req, DATA));
    if (url.pathname.startsWith('/uploads/')) return e.respondWith(cacheFirst(req, MEDIA));
    if (url.pathname.startsWith('/assets/')) return e.respondWith(cacheFirst(req, SHELL));
    // SPA-Navigation: immer die App-Shell
    if (req.mode === 'navigate') return e.respondWith(caches.open(SHELL).then((c) => c.match('/')).then((hit) => hit || fetch(req)));
    return e.respondWith(staleWhileRevalidate(req, SHELL));
  }

  if (url.hostname === 'maps.googleapis.com' && (url.pathname.startsWith('/maps/api/js') || url.pathname.startsWith('/maps-api-v3/'))) return;
  // Google-Maps-Kacheln und Schriften (bereits angesehene Gebiete bleiben offline sichtbar)
  if (/(^|\.)(googleapis|gstatic|ggpht)\.com$/.test(url.hostname)) {
    return e.respondWith(cacheFirst(req, MEDIA).catch(() => fetch(req)));
  }
});
