// Service worker: caches the app shell so Fuel Gauge opens and logs offline.
// Bump VERSION (and docs/js/version.js) with every release; a new version makes
// the phone download the new files and offer "Update available, tap to reload".
// tests/sw.test.js checks that VERSION and ASSETS stay in step with docs/.

const VERSION = '0.3.0';
const CACHE = `fuel-gauge-${VERSION}`;

const ASSETS = [
  './',
  'index.html',
  'example-foods.txt',
  'manifest.webmanifest',
  'css/app.css',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon.svg',
  'js/app.js',
  'js/chart.js',
  'js/day.js',
  'js/foodsFile.js',
  'js/fuzzy.js',
  'js/nutrients.js',
  'js/parser.js',
  'js/store.js',
  'js/units.js',
  'js/version.js',
  'js/ui/dom.js',
  'js/ui/foods.js',
  'js/ui/settings.js',
  'js/ui/today.js',
  'js/ui/voice.js',
];

self.addEventListener('install', (event) => {
  // 'reload' bypasses the browser's HTTP cache so a new version is never built from stale files.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith('fuel-gauge-') && key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

// The page asks a waiting worker to take over when the user taps the update banner.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Only the app's own files are served from cache. Anything else (such as
  // AI lookups to another origin) goes straight to the network, untouched.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached =
        (await cache.match(request, { ignoreSearch: true })) ||
        (request.mode === 'navigate' ? await cache.match('index.html') : undefined);
      return cached || fetch(request);
    }),
  );
});
