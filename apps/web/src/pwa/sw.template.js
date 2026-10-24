/* AIOS service worker (template; the build replaces the placeholders).
 * Caches ONLY the static app shell. API traffic is never cached or intercepted. A new worker waits until the
 * user applies the update, so new assets never silently pair with an old API contract (and vice versa). */
const BUILD = "__BUILD_ID__";
const CACHE = "aios-shell-" + BUILD;
const SHELL = __SHELL_ASSETS__;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith("aios-shell-") && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;              // never cache or touch authenticated API calls
  if (req.mode === "navigate") {                              // fresh HTML when online; offline shell otherwise
    event.respondWith(fetch(req).catch(() => caches.match("/index.html")));
    return;
  }
  if (url.pathname.startsWith("/assets/") || SHELL.includes(url.pathname)) {   // hashed assets: cache-first
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});
