// The only thing the web page gets from the iPhone and iPad app: `window.foleviNative`, a few calls that reach
// the app (through Capacitor's bridge, window.Capacitor). Added before the page's own scripts
// (FoleviViewController), on Folevi's own site only: the app fills in that one origin below. The page's
// typed view of this is apps/web/src/lib/nativeApp.ts.
(function () {
  "use strict";
  var ORIGIN = "__FOLEVI_ORIGIN__";
  var VERSION = "__FOLEVI_VERSION__";
  if (location.origin !== ORIGIN || window.top !== window) return;
  var cap = window.Capacitor;
  if (!cap || typeof cap.nativePromise !== "function") return;

  var call = function (plugin, method, options) {
    return cap.nativePromise(plugin, method, options || {});
  };
  var quietly = function (promise) {
    return promise.then(
      function (value) {
        return value;
      },
      function () {
        return null;
      },
    );
  };
  var IMPACT = { light: "LIGHT", medium: "MEDIUM", heavy: "HEAVY" };
  var NOTICE = { success: "SUCCESS", warning: "WARNING", error: "ERROR" };

  var bridge = Object.freeze({
    platform: "ios",
    version: VERSION,
    /** A tap felt in the hand: "light" | "medium" | "heavy" impacts, or "success" | "warning" | "error". */
    haptic: function (kind) {
      if (IMPACT[kind]) void quietly(call("Haptics", "impact", { style: IMPACT[kind] }));
      else if (NOTICE[kind]) void quietly(call("Haptics", "notification", { type: NOTICE[kind] }));
    },
    /** The status bar's text for the page's theme: "dark" (a dark page, light text) or "light". */
    setStatusBar: function (theme) {
      void quietly(call("StatusBar", "setStyle", { style: theme === "dark" ? "DARK" : "LIGHT" }));
    },
    /** Opens a link outside the app: web pages in an in-app Safari view, mail and phone links with the system. */
    openExternal: function (url) {
      return quietly(call("FoleviNative", "openExternal", { url: String(url) })).then(function (r) {
        return r !== null;
      });
    },
    /** The Face ID lock: { lock, lockAfter (seconds), method: "faceID" | "touchID" | "opticID" | "passcode" | "none" }. */
    getSettings: function () {
      return quietly(call("FoleviNative", "getSettings"));
    },
    /** Changes the lock; turning it on asks to unlock once first. Answers with the settings as they now are. */
    setSettings: function (patch) {
      return call("FoleviNative", "setSettings", patch);
    },
    /**
     * This device and the REST API token the app holds for its widgets, share extension, Shortcuts and
     * Spotlight: { id, family, model, accountId, tokenId, scanner }. The token itself never comes back.
     */
    device: function () {
      return quietly(call("FoleviNative", "device"));
    },
    /** Keeps this device's token ({ token, tokenId, accountId }) in the Keychain for the app's extensions. */
    setCredential: function (credential) {
      return quietly(call("FoleviNative", "setCredential", credential)).then(function (r) {
        return r !== null;
      });
    },
    /** Signing out: the token, the widgets' copy of tasks and notes, and Spotlight's notes go. */
    clearCredential: function () {
      return quietly(call("FoleviNative", "clearCredential")).then(function () {});
    },
    /** What the share extension kept for the app: [{ id, title, text, url, place, files: [{ name, type, data }] }]. */
    takeShares: function () {
      return quietly(call("FoleviNative", "takeShares")).then(function (r) {
        return (r && r.value) || [];
      });
    },
    /** A kept share was saved: the app lets it go. */
    finishShare: function (id) {
      return quietly(call("FoleviNative", "finishShare", { id: String(id) })).then(function () {});
    },
    /** Scans a document ("camera") or reads pages from photos ("photos"): { pages, text }, or null if cancelled. */
    scanDocument: function (source) {
      return call("FoleviNative", "scanDocument", { source: source === "camera" ? "camera" : "photos" }).then(function (r) {
        return (r && r.value) || null;
      });
    },
    /**
     * folevi:// links opened from other apps (and one that opened the app), for the page to route; returns
     * the function that stops listening.
     */
    onCommand: function (listener) {
      var handle = cap.addListener("App", "appUrlOpen", function (event) {
        if (event && typeof event.url === "string") listener({ type: "link", url: event.url });
      });
      return function () {
        void handle.remove();
      };
    },
  });

  Object.defineProperty(window, "foleviNative", { value: bridge, enumerable: false, configurable: false, writable: false });

  // The app coming back to the front, said reliably (a web view's visibilitychange doesn't always fire when
  // iOS suspends and resumes the app): the page picks up what the share extension kept, for one.
  cap.addListener("App", "appStateChange", function (state) {
    if (state && state.isActive) window.dispatchEvent(new Event("folevi:app-active"));
  });

  // The page knows from its first paint that it's in the iPhone and iPad app (safe areas, no purchases).
  var mark = function () {
    if (document.documentElement) document.documentElement.setAttribute("data-native", "ios");
  };
  mark();
  if (!document.documentElement) document.addEventListener("DOMContentLoaded", mark, { once: true });

  // The page fills the screen, under the status bar and home indicator (viewport-fit=cover), and keeps its
  // content clear of them with env(safe-area-inset-*) (apps/web globals.css, data-native="ios"). The site's
  // viewport tags are the same for browsers, so the app adds this to each, and again if the page rewrites one.
  var watched = typeof WeakSet === "function" ? new WeakSet() : null;
  // And it stays at its own scale: focusing a small text field doesn't zoom the page in (an app never does;
  // the web view doesn't pinch-zoom either).
  var EXTRA = ["viewport-fit=cover", "maximum-scale=1"];
  var cover = function (meta) {
    var content = meta.getAttribute("content") || "";
    var missing = EXTRA.filter(function (part) {
      return content.indexOf(part.split("=")[0]) === -1;
    });
    if (missing.length) meta.setAttribute("content", (content ? content + ", " : "") + missing.join(", "));
  };
  var coverAll = function () {
    var metas = document.querySelectorAll('meta[name="viewport"]');
    for (var i = 0; i < metas.length; i++) {
      var meta = metas[i];
      cover(meta);
      if (watched && !watched.has(meta)) {
        watched.add(meta);
        new MutationObserver(cover.bind(null, meta)).observe(meta, { attributes: true, attributeFilter: ["content"] });
      }
    }
  };
  coverAll();
  // While the page is read, every new tag; after that only the head is watched (React may add or swap one).
  var reading = new MutationObserver(coverAll);
  reading.observe(document, { childList: true, subtree: true });
  document.addEventListener(
    "DOMContentLoaded",
    function () {
      reading.disconnect();
      coverAll();
      if (document.head) new MutationObserver(coverAll).observe(document.head, { childList: true });
    },
    { once: true },
  );
})();
