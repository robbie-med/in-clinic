// Service Worker: In-Clinic
//
// Cache-first: once installed the app makes no network requests for its own files, so it opens instantly and
// works offline in exam rooms with bad wifi. A changed VERSION (written by `node tools/version-sw.mjs`, a hash of
// every cached file) installs a fresh copy of everything in one step. Run it after changing ANY cached file.

const VERSION = '59acc54e50c7';
const CACHE = 'in-clinic-' + VERSION;

const APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './library.json',
    './css/app.css',
    './js/app.js',
    './js/library.js',
    './js/note.js',
    './js/schedule.js',
    './js/store.js',
    './icons/icon.svg',
    './icons/icon-180.png',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-maskable-512.png',
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE)
            // cache: 'reload' bypasses the HTTP cache so a new version never mixes in stale files
            .then(cache => cache.addAll(APP_SHELL.map(url => new Request(url, { cache: 'reload' }))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k.startsWith('in-clinic-') && k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    event.respondWith(
        caches.match(event.request, { ignoreSearch: true }).then(hit => hit || fetch(event.request))
    );
});
