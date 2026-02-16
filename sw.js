/**
 * SPC Service Worker
 * 提供离线支持和资源缓存
 */

const CACHE_NAME = 'spc-v2.0';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/design-system.css',
  '/js/core/db.js',
  '/js/core/crypto.js',
  '/js/core/bus.js',
  '/js/services/TaskService.js',
  '/js/services/VaultService.js',
  '/js/services/NoteService.js',
  '/js/services/SyncService.js',
  '/js/app.js',
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap'
];

// 安装事件 - 缓存资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] 缓存资源...');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
  );
});

// 激活事件 - 清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] 删除旧缓存:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 请求事件 - 网络优先，失败时使用缓存
self.addEventListener('fetch', (event) => {
  // 跳过非 GET 请求
  if (event.request.method !== 'GET') return;

  // 跳过 Chrome 扩展等请求
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 如果响应有效，克隆并缓存
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => {
              cache.put(event.request, responseClone);
            });
        }
        return response;
      })
      .catch(() => {
        // 网络失败时使用缓存
        return caches.match(event.request)
          .then((response) => {
            if (response) {
              return response;
            }
            // 返回离线页面
            return caches.match('/index.html');
          });
      })
  );
});
