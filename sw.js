// Keeps a copy of the panel's own files so it opens instantly and survives a poor connection.
// It always tries the network first, so a new version of the panel is picked up as soon as it is published.
// Requests to Supabase are never stored: the emails and studios always come fresh from the database.
const CACHE = 'automail-panel-v2';
const SHELL = ['./', 'index.html', 'styles.css', 'config.js', 'js/app.js', 'js/data.js', 'js/demo.js', 'vendor/supabase.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/logo.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((cached) => cached ?? Response.error())),
  );
});
