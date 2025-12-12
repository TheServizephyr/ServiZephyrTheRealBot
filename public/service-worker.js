// ServiZephyr Service Worker - Basic PWA Support
const CACHE_VERSION = '2025-12-12-16-20'; // Update this on each deployment
const CACHE_NAME = `servizephyr-v${CACHE_VERSION}`;
const urlsToCache = [
    '/offline.html'
];

// Install event - cache essential files only
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Opened cache');
                return cache.addAll(urlsToCache);
            })
            .catch((err) => {
                console.error('[SW] Cache install failed:', err);
            })
    );
    self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch event - network first, minimal caching
self.addEventListener('fetch', (event) => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Skip chrome extensions and other non-http requests
    if (!event.request.url.startsWith('http')) return;

    // CRITICAL: Skip API calls - don't cache them!
    if (event.request.url.includes('/api/')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // CRITICAL: Skip Next.js static assets - they have version hashes
    // Caching these causes stale chunk issues after deployments
    if (event.request.url.includes('/_next/')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // For navigation requests, just fetch from network
    // Only use cache as fallback for offline
    event.respondWith(
        fetch(event.request)
            .catch(() => {
                // Network failed, try cache for navigation requests
                if (event.request.mode === 'navigate') {
                    return caches.match('/offline.html');
                }
                return caches.match(event.request);
            })
    );
});
