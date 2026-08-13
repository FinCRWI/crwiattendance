const BUILD_ID = "1786643955";
const STATIC_CACHE = `crwi-attendance-static-${BUILD_ID}`;
const RUNTIME_CACHE = `crwi-attendance-runtime-${BUILD_ID}`;
const OFFLINE_URL = '/offline.html';
const APP_SHELL_URL = '/';
const PRECACHE_URLS = [APP_SHELL_URL, OFFLINE_URL];

self.addEventListener('install', (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(STATIC_CACHE);
            await cache.addAll(PRECACHE_URLS);
        })()
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            const cacheNames = await caches.keys();
            await Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== STATIC_CACHE && cacheName !== RUNTIME_CACHE) {
                        return caches.delete(cacheName);
                    }
                    return undefined;
                })
            );
            await self.clients.claim();
        })()
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') {
        return;
    }

    const requestUrl = new URL(event.request.url);
    const isSameOrigin = requestUrl.origin === self.location.origin;

    if (event.request.mode === 'navigate') {
        event.respondWith(
            (async () => {
                try {
                    const networkResponse = await fetch(event.request);
                    const runtimeCache = await caches.open(RUNTIME_CACHE);
                    runtimeCache.put(event.request, networkResponse.clone());
                    return networkResponse;
                } catch (_error) {
                    const cachedPage = await caches.match(event.request);
                    if (cachedPage) {
                        return cachedPage;
                    }
                    const offlineResponse = await caches.match(OFFLINE_URL);
                    if (offlineResponse) {
                        return offlineResponse;
                    }
                    return Response.error();
                }
            })()
        );
        return;
    }

    if (isSameOrigin && ['style', 'script', 'image', 'font', 'manifest'].includes(event.request.destination)) {
        event.respondWith(
            (async () => {
                const cached = await caches.match(event.request);
                const networkPromise = (async () => {
                    try {
                        const response = await fetch(event.request);
                        if (response && response.ok) {
                            const runtimeCache = await caches.open(RUNTIME_CACHE);
                            runtimeCache.put(event.request, response.clone());
                        }
                        return response;
                    } catch (_error) {
                        return cached;
                    }
                })();

                return cached || networkPromise;
            })()
        );
    }
});
