const PREVIEW_VERSION = '20260722-hd';
const PREVIEW_CACHE = `ranshengxiang-previews-${PREVIEW_VERSION}`;
const ORIGINAL_VERSION = '20260722-originals';
const ORIGINAL_CACHE = `ranshengxiang-originals-${ORIGINAL_VERSION}`;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => (
        (name.startsWith('ranshengxiang-previews-') && name !== PREVIEW_CACHE)
        || (name.startsWith('ranshengxiang-originals-') && name !== ORIGINAL_CACHE)
      ))
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isPreview = url.pathname.includes('/assets/previews/');
  const isOriginal = url.pathname.includes('/assets/originals/');
  if (!isPreview && !isOriginal) return;

  event.respondWith((async () => {
    let cache;
    try {
      cache = await caches.open(isPreview ? PREVIEW_CACHE : ORIGINAL_CACHE);
    } catch {
      return fetch(event.request);
    }
    const cached = await cache.match(event.request);
    if (cached) return cached;

    const response = await fetch(event.request);
    if (response.ok) {
      try { await cache.put(event.request, response.clone()); } catch { /* The network response still remains usable. */ }
    }
    return response;
  })());
});
