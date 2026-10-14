/* Folevi service worker.
 * - Hashed static assets (/_next/static, fonts, icons): cache-first (immutable).
 * - Product navigations: network-first; the last good app shell is kept so Folevi opens offline.
 *   The shell HTML contains no private data. Documents load through the authenticated Convex
 *   connection and the per-account IndexedDB store.
 * - Never cached: /api, /auth, /admin, /s (public share pages), /signin, /signup, cross-origin requests.
 */
const STATIC = "folevi-static-v2"; // v2: new brand icons (2026-09-29)
const SHELL = "folevi-shell-v1";
const APP = /^\/(documents|notes|d\/|ai(?:\/|$)|graph(?:\/|$)|tasks|calendar|review(?:\/|$)|changes(?:\/|$)|daily|shared|templates|starred|archive|trash|drafts|unsorted|folders|tags|settings|help|onboarding|invite|share-invite)/;
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
            "<!doctype html><meta charset=utf-8><title>Folevi: offline</title><body style='font:16px system-ui;padding:3rem;background:#F4F1E9;color:#18201C'><h1>You're offline</h1><p>Open Folevi once while online on this device, and it will open offline next time.</p>",
            { headers: { "content-type": "text/html; charset=utf-8" } },
          );
        }
      })(),
    );
  }
});

self.addEventListener("message", (event) => {
  if (event.data === "clear") event.waitUntil(Promise.all([STATIC, SHELL].map((k) => caches.delete(k))));
});

// Push (reminders and mentions; convex/pushSend.ts). The payload says what to show and where it leads.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Folevi";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : undefined,
      tag: typeof data.tag === "string" ? data.tag : undefined,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: typeof data.url === "string" ? data.url : "/" },
    }),
  );
});

// Clicking one opens its page in Folevi (an open tab if there is one); only ever a page of this site.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let target = "/documents";
  try {
    const url = new URL(event.notification.data && event.notification.data.url ? event.notification.data.url : "/", self.location.origin);
    if (url.origin === self.location.origin) target = url.pathname + url.search + url.hash;
  } catch {
    // Keep the default.
  }
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin) {
          await w.focus();
          return w.navigate(target);
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});
