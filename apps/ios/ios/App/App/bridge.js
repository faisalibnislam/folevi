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
     * Notifications on this device: { permission: "notDetermined" | "denied" | "granted", enabled, asked,
     * token (Apple's device token, hex, while enabled), environment: "sandbox" | "production", bundleId }.
     */
    pushStatus: function () {
      return quietly(call("FoleviNative", "pushStatus"));
    },
    /** Turns them on: iOS asks the first time, then Apple gives the device token. Answers with the status. */
    enablePush: function () {
      return quietly(call("FoleviNative", "enablePush"));
    },
    /** Turns them off on this device (the page tells Folevi first). */
    disablePush: function () {
      return quietly(call("FoleviNative", "disablePush")).then(function () {});
    },
    /** The number on the app icon: what's unread in the bell. */
    setBadge: function (count) {
      void quietly(call("FoleviNative", "setBadge", { count: Math.max(0, Math.floor(Number(count) || 0)) }));
    },
    /** Folevi's notification settings in the iOS Settings app. */
    openNotificationSettings: function () {
      return quietly(call("FoleviNative", "openNotificationSettings")).then(function () {});
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

  // What iOS knows and a web view can't read (Native/SystemSettings.swift), as marks on <html>: Reduce
  // Transparency (glass becomes solid), Increase Contrast, Bold Text, and the text size (Dynamic Type) as
  // --ios-text-scale, which globals.css applies to the page's text (not its layout). Asked again whenever one
  // changes in iOS Settings. Text follows Dynamic Type from the smallest size up to 150%: past that the
  // app's screens don't have the room, and iOS's own zoom is there for more.
  var accessibility = null;
  var applyAccessibility = function () {
    var root = document.documentElement;
    if (!root || !accessibility) return;
    var a = accessibility;
    var flag = function (name, on) {
      if (on) root.setAttribute(name, "");
      else root.removeAttribute(name);
    };
    flag("data-reduce-transparency", a.reduceTransparency === true);
    flag("data-increase-contrast", a.increaseContrast === true);
    flag("data-bold-text", a.boldText === true);
    var scale = Math.max(80, Math.min(150, Math.round(Number(a.textScale) || 100)));
    root.style.setProperty("--ios-text-scale", scale + "%");
    root.setAttribute("data-text-scale", String(scale));
  };
  var readAccessibility = function () {
    void quietly(call("FoleviNative", "accessibility")).then(function (a) {
      if (!a) return;
      accessibility = a;
      applyAccessibility();
    });
  };
  readAccessibility();
  window.addEventListener("folevi:accessibility", readAccessibility);

  // The page knows from its first paint that it's in the iPhone and iPad app (safe areas, no purchases).
  var mark = function () {
    if (document.documentElement) document.documentElement.setAttribute("data-native", "ios");
    applyAccessibility();
  };
  mark();
  if (!document.documentElement) document.addEventListener("DOMContentLoaded", mark, { once: true });

  // A tap on the status bar (FoleviViewController): what scrolls under the middle of the screen goes back to
  // its top, as in any iOS app. The page can take it first (a cancelable "folevi:scroll-to-top" event).
  var scrollable = function (el) {
    if (!(el instanceof Element)) return false;
    var style = getComputedStyle(el);
    return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
  };
  window.addEventListener("folevi:status-bar-tap", function () {
    var ask = new Event("folevi:scroll-to-top", { cancelable: true });
    if (!window.dispatchEvent(ask)) return;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var w = window.innerWidth;
    var h = window.innerHeight;
    // The middle of the screen first, then a little above and below it (a sheet, a short list).
    var points = [[w / 2, h / 2], [w / 2, h * 0.3], [w / 2, h * 0.7]];
    for (var i = 0; i < points.length; i++) {
      var el = document.elementFromPoint(points[i][0], points[i][1]);
      while (el && el !== document.documentElement) {
        if (scrollable(el) && el.scrollTop > 0) {
          el.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
          return;
        }
        el = el.parentElement;
      }
    }
    if (document.scrollingElement && document.scrollingElement.scrollTop > 0) document.scrollingElement.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  });

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
