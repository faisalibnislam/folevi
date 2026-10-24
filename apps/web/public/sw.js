/* Folevi service worker.
 * - Hashed static assets (/_next/static, fonts, icons): cache-first (immutable).
 * - Product navigations: network-first; the last good app shell is kept so Folevi opens offline.
 *   The shell HTML contains no private data. Documents load through the authenticated Convex
 *   connection and the per-account IndexedDB store.
 * - Never cached: /api, /auth, /admin, /s (public share pages), /signin, /signup, cross-origin requests.
 * - Share target (manifest share_target): a POST to /share-target from another app's share sheet is kept
 *   in SHARE (its title, text, link and files, on this device only) and the app opens /share?received=<id>,
 *   which reads it, saves the note and deletes it. Shares left unread are dropped after a day.
 */
const STATIC = "folevi-static-v3"; // v3: the Graphite app icon (2026-10-16)
const SHELL = "folevi-shell-v1";
const SHARE = "folevi-share-v1";
const APP = /^\/(documents|notes|d\/|ai(?:\/|$)|graph(?:\/|$)|tasks|calendar|review(?:\/|$)|changes(?:\/|$)|daily|shared|templates|starred|archive|trash|drafts|unsorted|folders|tags|settings|help|onboarding|invite|share-invite|share(?:\/|$))/;
const SHARE_FILES = 10;
const SHARE_FILE_BYTES = 20 * 1024 * 1024;
const SHARE_TTL_MS = 24 * 60 * 60 * 1000;
const NEVER = /^\/(api|auth|admin|s\/|signin|signup|signout|verify-email|dev-auth)/;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // The device copy's attachments (folevi-files-<account>) are the app's own data, not this worker's cache:
      // signing out removes them (lib/sync/db.ts), not an update of the worker.
      for (const key of await caches.keys()) if (key.startsWith("folevi-") && !key.startsWith("folevi-files-") && key !== STATIC && key !== SHELL && key !== SHARE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

/** A share from another app: kept on this device, then the app opens it (never sent anywhere from here). */
async function receiveShare(req) {
  const form = await req.formData();
  const field = (name) => {
    const v = form.get(name);
    return typeof v === "string" ? v.slice(0, 20000) : "";
  };
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const cache = await caches.open(SHARE);
  // Shares never opened (the app was closed before it loaded) don't pile up.
  for (const key of await cache.keys()) {
    const at = parseInt((new URL(key.url).pathname.split("/")[2] || "").split("-")[0], 36);
    if (!at || Date.now() - at > SHARE_TTL_MS) await cache.delete(key);
  }
  const files = [];
  const skipped = [];
  for (const f of form.getAll("files")) {
    if (typeof f === "string") continue;
    if (files.length >= SHARE_FILES || f.size > SHARE_FILE_BYTES || f.size === 0) {
      skipped.push(String(f.name || "file").slice(0, 120));
      continue;
    }
    await cache.put(`/__share/${id}/file/${files.length}`, new Response(f, { headers: { "content-type": f.type || "application/octet-stream" } }));
    files.push({ name: String(f.name || "file").slice(0, 200), type: f.type || "application/octet-stream" });
  }
  const meta = { title: field("title"), text: field("text"), url: field("url"), files, skipped };
  await cache.put(`/__share/${id}/meta`, new Response(JSON.stringify(meta), { headers: { "content-type": "application/json" } }));
  return Response.redirect(new URL(`/share?received=${id}`, self.location.origin).href, 303);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method === "POST") {
    const target = new URL(req.url);
    if (target.origin === self.location.origin && target.pathname === "/share-target") {
      // If keeping it fails, the server's own /share-target still takes the text and link.
      event.respondWith(receiveShare(req.clone()).catch(() => fetch(req)));
    }
    return;
  }
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
