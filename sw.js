// sw.js — NoteLoop Service Worker
// アプリシェル（HTML/CSS/JS/アイコン）をキャッシュし、インストール可能＆起動高速化。
// 文字起こしモデル等の外部CDNはブラウザのHTTPキャッシュに任せ、ここでは扱わない。

const CACHE = 'noteloop-shell-v10';
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

// 録音中通知のクリック / 「停止」アクション → アプリを前面化して停止を伝える
self.addEventListener('notificationclick', (event) => {
  const wantStop = event.action === 'stop';
  event.notification.close();
  event.waitUntil((async () => {
    const clis = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    let client = clis.find((c) => 'focus' in c) || null;
    try { if (client) await client.focus(); else if (self.clients.openWindow) client = await self.clients.openWindow('./'); } catch (_) {}
    if (client && wantStop) client.postMessage({ type: 'stop-recording' });
  })());
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
