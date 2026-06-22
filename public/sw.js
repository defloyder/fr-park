const CACHE_NAME = 'auralith-navigation-v13';
const SHELL_URLS = [
    '/offline.html',
    '/site.webmanifest',
    '/images/auralith-mark.svg',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(SHELL_URLS))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys
                .filter((key) => key !== CACHE_NAME)
                .map((key) => caches.delete(key))))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;

    if (request.method !== 'GET') {
        return;
    }

    const url = new URL(request.url);

    if (request.mode === 'navigate') {
        event.respondWith(networkFirst(request, '/offline.html'));
        return;
    }

    if (url.origin === self.location.origin && url.pathname.startsWith('/build/')) {
        event.respondWith(fetch(request, { cache: 'no-store' }));
        return;
    }

    if (url.origin === self.location.origin && url.pathname.startsWith('/data/')) {
        event.respondWith(fetch(request, { cache: 'no-store' }));
        return;
    }

    if (url.origin === self.location.origin && (
        url.pathname.startsWith('/images/')
        || url.pathname === '/site.webmanifest'
        || url.pathname === '/offline.html'
    )) {
        event.respondWith(staleWhileRevalidate(request));
        return;
    }

    if (
        url.hostname === 'tiles.openfreemap.org'
        || url.hostname === 'api.tomtom.com'
        || url.hostname === 'server.arcgisonline.com'
    ) {
        event.respondWith(staleWhileRevalidate(request));
    }
});

async function networkFirst(request, fallbackUrl) {
    const cache = await caches.open(CACHE_NAME);

    try {
        return await fetch(request, { cache: 'no-store' });
    } catch {
        return await cache.match(fallbackUrl)
            || new Response('Приложение недоступно без подключения к сети.', {
                status: 503,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            });
    }
}

async function staleWhileRevalidate(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    const fetched = fetch(request)
        .then((response) => {
            if (response.ok || response.type === 'opaque') {
                cache.put(request, response.clone());
            }
            return response;
        })
        .catch(() => null);

    return cached || await fetched || new Response('Ресурс недоступен без подключения к сети.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
}
