/* Folevi service worker.
 * - Hashed static assets (/_next/static, fonts, icons): cache-first (immutable).
 * - Product navigations: network-first; the last good app shell is kept so Folevi opens offline.
 *   The shell HTML contains no private data — documents load through the authenticated Convex
 *   connection and the per-account IndexedDB store.
 * - Never cached: /api, /auth, /admin, /s (public share pages), /signin, /signup, cross-origin requests.
 */
const STATIC = "folevi-static-v1";
const SHELL = "folevi-shell-v1";
const APP = /^\/(documents|d\/|tasks|calendar|daily|shared|templates|starred|archive|trash|unsorted|folders|tags|settings|help|onboarding|invite)/;
const NEVER = /^\/(api|auth|admin|s\/|signin|signup|signout|verify-email|dev-auth)/;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("folevi-") && key !== STATIC && key !== SHELL) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || NEVER.test(url.pathname)) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/fonts/") || url.pathname.startsWith("/icons/") || url.pathname === "/icon.svg") {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === "navigate" && APP.test(url.pathname)) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          // Only cache a real shell (not redirects to sign-in).
          if (res.ok && !res.redirected) {
            const cache = await caches.open(SHELL);
            await cache.put("/__shell", res.clone());
          }
          return res;
        } catch {
          const cache = await caches.open(SHELL);
          const shell = await cache.match("/__shell");
          if (shell) return shell;
          return new Response(
            "<!doctype html><meta charset=utf-8><title>Folevi — offline</title><body style='font:16px system-ui;padding:3rem;background:#F4F1E9;color:#18201C'><h1>You're offline</h1><p>Open Folevi once while online on this device, and it will open offline next time.</p>",
            { headers: { "content-type": "text/html; charset=utf-8" } },
          );
        }
      })(),
    );
  }
});

self.addEventListener("message", (event) => {
  if (event.data === "clear") event.waitUntil(Promise.all(["folevi-static-v1", "folevi-shell-v1"].map((k) => caches.delete(k))));
});
