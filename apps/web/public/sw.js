/**
 * Homebase app-shell service worker.
 *
 * It may cache only static shell assets (hashed JS/CSS, fonts, icons,
 * manifest). It must never cache /api/* responses, the event stream, message
 * history, approvals, questions, attachments, or provider usage — private data
 * always comes from the network with `no-store`.
 */
const VERSION = "homebase-shell-v2";
const SHELL = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => undefined),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // never touch private data

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            caches
              .open(VERSION)
              .then((cache) => cache.put(request, copy))
              .catch(() => undefined);
          }
          return response;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? network;
    }),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "homebase:clear-caches") {
    caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))));
  }
});
