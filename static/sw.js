const CACHE_VERSION = 'spacebot-static-v1';
const STATIC_SHELL = ['/', '/logo.webp', '/site.webmanifest'];

self.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(STATIC_SHELL)));
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
				)
			)
	);
	self.clients.claim();
});

self.addEventListener('fetch', (event) => {
	const request = event.request;
	const url = new URL(request.url);

	if (request.method !== 'GET') return;
	if (url.pathname.startsWith('/api/') || request.headers.has('authorization')) return;
	if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/account')) return;

	event.respondWith(
		caches.match(request).then((cached) => {
			const network = fetch(request).then((response) => {
				if (
					response.ok &&
					(url.pathname.startsWith('/_app/') || STATIC_SHELL.includes(url.pathname))
				) {
					const copy = response.clone();
					caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
				}
				return response;
			});
			return cached || network;
		})
	);
});
