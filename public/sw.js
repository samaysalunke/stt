const CACHE = 'stt-v1';
const PRECACHE = ['/manifest.webmanifest', '/favicon.svg', '/logo.jpg'];

// Never cache these paths — they are dynamic SSR or write endpoints
const NO_CACHE = ['/api/', '/admin/', '/keystatic/'];

function shouldCache(url) {
  const { pathname } = new URL(url);
  return !NO_CACHE.some((p) => pathname.startsWith(p));
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (!shouldCache(e.request.url)) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
