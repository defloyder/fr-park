const CACHE_NAME = 'auralith-navigation-v4';
const SHELL_URLS = [
    '/',
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
        event.respondWith(networkFirst(request, '/'));
        return;
    }

    if (url.origin === self.location.origin && (
        url.pathname.startsWith('/build/')
        || url.pathname.startsWith('/storage/')
        || url.pathname.startsWith('/images/')
        || url.pathname === '/site.webmanifest'
        || url.pathname === '/'
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
        const response = await fetch(request);
        cache.put(request, response.clone());
        cache.put(fallbackUrl, response.clone());
        return response;
    } catch {
        return await cache.match(request)
            || await cache.match(fallbackUrl)
            || new Response('', { status: 503, statusText: 'Offline' });
    }
}

async function staleWhileRevalidate(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    const fetched = fetch(request)
        .then((response) => {
            cache.put(request, response.clone());
            return response;
        })
        .catch(() => null);

    return cached || await fetched || new Response('', { status: 503, statusText: 'Offline' });
}
