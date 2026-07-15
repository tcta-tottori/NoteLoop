// sw.js — NoteLoop Service Worker
// アプリシェル（HTML/CSS/JS/アイコン）をキャッシュし、インストール可能＆起動高速化。
// 文字起こしモデル等の外部CDNはブラウザのHTTPキャッシュに任せ、ここでは扱わない。

const CACHE = 'noteloop-shell-v4';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './worker.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 同一オリジン（アプリシェル）のみ扱う。CDN等はそのままネットワークへ。
  if (url.origin !== self.location.origin) return;

  // stale-while-revalidate: まずキャッシュを返しつつ、裏で更新する
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    )
  );
});
