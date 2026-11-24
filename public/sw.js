// Kill switch. The PWA service worker was unregistered from the site in the
// v2.0 redesign, but browsers that installed it in June 2026 keep running it
// until this URL serves a worker that removes itself. Safe to delete once
// those installs have aged out.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
  );
});
