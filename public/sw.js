"use strict";

// Caches only the static shell (HTML/CSS/JS) — never the WebSocket traffic
// or API responses, which must always be live. This is what lets the page
// still open and show "you're offline, message queued" instead of a blank
// tab when someone's connection drops mid-session.
const CACHE_NAME = "setu-shell-v1";
const SHELL_FILES = ["/", "/dashboard.html", "/css/styles.css", "/js/chat.js", "/js/dashboard.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls or anything cross-origin (fonts CDN etc.) —
  // only the app shell itself is served stale-while-offline.
  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
