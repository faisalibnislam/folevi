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
    /** Google or Apple sign-in in iOS's sign-in sheet: answers with the folevi://auth/google link it ends on, or null. */
    authenticate: function (url) {
      return quietly(call("FoleviNative", "authenticate", { url: String(url) })).then(function (r) {
        return r && typeof r.url === "string" ? r.url : null;
      });
    },
    /** The colour behind the web view, which shows round the keyboard's corners (0 to 255 each). */
    setBackdrop: function (r, g, b) {
      void quietly(call("FoleviNative", "setBackdrop", { r: Number(r) || 0, g: Number(g) || 0, b: Number(b) || 0 }));
    },
    /** The number on the app icon: what's unread in the bell. */
    setBadge: function (count) {
      void quietly(call("FoleviNative", "setBadge", { count: Math.max(0, Math.floor(Number(count) || 0)) }));
    },
    /** Folevi's notification settings in the iOS Settings app. */
    openNotificationSettings: function () {
      return quietly(call("FoleviNative", "openNotificationSettings")).then(function () {});
    },
    /** The words in an image ({ data: base64, type, handwriting }), read on the device with Vision: { text }, or null. */
    recognizeText: function (image) {
      var input = image || {};
      return quietly(call("FoleviNative", "recognizeText", { data: String(input.data || ""), type: String(input.type || ""), handwriting: Boolean(input.handwriting) })).then(function (r) {
        return r && typeof r.text === "string" ? { text: r.text } : null;
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

  // ---------------------------------------------------------------- foleviShell (the built-in interface only)
  // docs/LOCAL_MODE_PLAN.md §4.1, the page's types in apps/web/src/lib/shell/types.ts, the native side in
  // Native/Shell/FoleviShellPlugin.swift. Filled in by FoleviViewController when the app shows the interface
  // built into it: the mode it opens in (read before any page script runs), its version and this device's name.
  var SHELL = "__FOLEVI_SHELL__";
  if (SHELL && typeof SHELL === "object") {
    // The app starts at index.html ("/"); the product's start page is /documents (as on the website, where "/"
    // is a redirect). Set before the page's router reads the address.
    if (location.pathname === "/" || location.pathname === "/index.html") history.replaceState(history.state, "", "/documents" + location.search + location.hash);
    var toB64 = function (bytes) {
      var u8 = bytes instanceof Uint8Array ? bytes : ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : null;
      if (!u8) throw { name: "LocalFsError", code: "invalid_argument", message: "Bytes are needed." };
      var out = "";
      for (var i = 0; i < u8.length; i += 0x8000) out += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return btoa(out);
    };
    var fromB64 = function (text) {
      var bin = atob(String(text || ""));
      var u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return u8;
    };
    // A rejection the page can read: { name, code, message, path } (local-store's isNotFound reads `code`).
    var plainError = function (name) {
      return function (e) {
        var data = (e && e.data) || {};
        var err = { name: name, code: (e && e.code) || "io", message: (e && e.message) || "Folevi couldn't do that." };
        if (typeof data.path === "string") err.path = data.path;
        throw err;
      };
    };
    var shellCall = function (method, options, errorName) {
      return call("FoleviShell", method, options).catch(plainError(errorName || "LocalFsError"));
    };
    var value = function (r) {
      return r ? r.value : null;
    };
    var nothing = function () {};
    var libraryWatchers = 0;
    var aiRequests = 0;

    var shellBridge = Object.freeze({
      platform: "ios",
      shellVersion: VERSION,
      deviceName: String(SHELL.deviceName || "iPhone"),
      deviceFamily: SHELL.deviceFamily === "iPad" ? "iPad" : "iPhone",
      initialMode: SHELL.mode === "local" || SHELL.mode === "account" ? SHELL.mode : "unset",
      setMode: function (mode) {
        return shellCall("setMode", { mode: String(mode) }).then(nothing);
      },
      library: Object.freeze({
        setup: function (o) {
          return shellCall("libSetup", { kind: String((o && o.kind) || "") }).then(function (r) {
            return r && r.value === null ? null : r;
          });
        },
        info: function () {
          return shellCall("libInfo");
        },
        list: function (dir) {
          return shellCall("libList", { dir: String(dir) }).then(function (r) {
            return (r && r.entries) || [];
          });
        },
        read: function (path) {
          return shellCall("libRead", { path: String(path) }).then(function (r) {
            return r.notDownloaded ? { notDownloaded: true } : { bytes: fromB64(r.bytes), etag: r.etag };
          });
        },
        write: function (path, bytes, o) {
          var has = o && Object.prototype.hasOwnProperty.call(o, "ifMatch") && o.ifMatch !== undefined;
          var mode = !has ? "any" : o.ifMatch === null ? "create" : "match";
          var opts = { path: String(path), bytes: toB64(bytes), mode: mode };
          if (mode === "match") opts.ifMatch = String(o.ifMatch);
          return shellCall("libWrite", opts).then(function (r) {
            return r.mismatch ? { mismatch: true, etag: r.etag } : { etag: r.etag };
          });
        },
        remove: function (path, o) {
          var opts = { path: String(path) };
          if (o && typeof o.ifMatch === "string") opts.ifMatch = o.ifMatch;
          return shellCall("libRemove", opts).then(nothing);
        },
        conflictVersions: function (path) {
          return shellCall("libConflictVersions", { path: String(path) }).then(function (r) {
            return ((r && r.versions) || []).map(function (v) {
              return { id: v.id, bytes: fromB64(v.bytes) };
            });
          });
        },
        resolveConflicts: function (path, ids) {
          return shellCall("libResolveConflicts", { path: String(path), ids: Array.isArray(ids) ? ids.map(String) : [] }).then(nothing);
        },
        startDownload: function (paths) {
          return shellCall("libStartDownload", { paths: Array.isArray(paths) ? paths.map(String) : [] }).then(nothing);
        },
        /** Change batches from the app's watcher; returns the function that stops listening. */
        watch: function (cb) {
          var handle = cap.addListener("FoleviShell", "libraryChanges", function (event) {
            if (event && Array.isArray(event.changes)) cb(event.changes);
          });
          if (libraryWatchers++ === 0) void shellCall("libWatch").catch(nothing);
          var on = true;
          return function () {
            if (!on) return;
            on = false;
            void handle.remove();
            if (--libraryWatchers === 0) void shellCall("libUnwatch").catch(nothing);
          };
        },
        journal: Object.freeze({
          append: function (record) {
            return shellCall("journalAppend", { record: toB64(record) }).then(nothing);
          },
          readAll: function () {
            return shellCall("journalRead").then(function (r) {
              return ((r && r.records) || []).map(fromB64);
            });
          },
          truncate: function (n) {
            return shellCall("journalTruncate", { n: Number(n) }).then(nothing);
          },
        }),
        unlock: function (passphrase) {
          return shellCall("libUnlock", { passphrase: String(passphrase) }).then(value);
        },
        setPassphrase: function (passphrase) {
          return shellCall("libSetPassphrase", passphrase === null ? {} : { passphrase: String(passphrase) }).then(nothing);
        },
        changePassphrase: function (oldPassphrase, newPassphrase) {
          return shellCall("libChangePassphrase", { old: String(oldPassphrase), new: String(newPassphrase) }).then(value);
        },
        /** Served by the app (Native/Shell/LibraryFileHandler.swift) from the library. */
        fileUrl: function (sha256, mime) {
          var sha = String(sha256).toLowerCase();
          if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error("Not a SHA-256 file name.");
          return "folevi-file://lib/" + sha + (mime ? "?type=" + encodeURIComponent(String(mime)) : "");
        },
        move: function (to) {
          return shellCall("libMove", { kind: String((to && to.kind) || "") });
        },
      }),
      // The person's Foli AI keys, kept in the Keychain: stored and removed, never read back.
      secrets: Object.freeze({
        has: function (name) {
          return shellCall("secretsHas", { name: String(name) }).then(function (r) {
            return Boolean(r && r.value);
          });
        },
        set: function (name, v) {
          return shellCall("secretsSet", { name: String(name), value: typeof v === "string" ? v : "" }, "Error").then(nothing);
        },
        delete: function (name) {
          return shellCall("secretsDelete", { name: String(name) }, "Error").then(nothing);
        },
      }),
      // The account session lives in the app (Native/Shell/ShellAuth.swift) and never comes here.
      auth: Object.freeze({
        signIn: function () {
          return shellCall("authSignIn", {}, "Error").then(function (r) {
            return Boolean(r && r.value);
          });
        },
        signOut: function () {
          return shellCall("authSignOut", {}, "Error").then(nothing);
        },
        fetch: function (path, init) {
          var i = init || {};
          var headers = {};
          if (i.headers && typeof i.headers === "object") {
            if (typeof i.headers.forEach === "function" && !Array.isArray(i.headers)) i.headers.forEach(function (v, k) { headers[k] = String(v); });
            else Object.keys(i.headers).forEach(function (k) { headers[k] = String(i.headers[k]); });
          }
          var opts = { path: String(path), method: typeof i.method === "string" ? i.method : "GET", headers: headers };
          if (typeof i.body === "string") opts.body = i.body;
          return shellCall("authFetch", opts, "Error");
        },
        convexToken: function () {
          return shellCall("authConvexToken", {}, "Error").then(value);
        },
      }),
      // Foli AI on this device (Native/Shell/ShellAI.swift): Apple's on-device model or the person's own keys.
      ai: Object.freeze({
        capabilities: function () {
          return shellCall("aiCapabilities", {}, "Error");
        },
        generate: function (req, onChunk) {
          aiRequests += 1;
          var id = "g" + aiRequests + Math.random().toString(36).slice(2, 10);
          var handle = cap.addListener("FoleviShell", "aiChunk", function (event) {
            if (!event || event.id !== id || typeof event.text !== "string") return;
            try {
              onChunk(event.text);
            } catch (e) {
              /* The page's own callback failing doesn't stop the answer. */
            }
          });
          var plain;
          try {
            plain = JSON.parse(JSON.stringify(req || null));
          } catch (e) {
            plain = null;
          }
          var done = call("FoleviShell", "aiGenerate", { id: id, req: plain })
            .catch(function () {
              return { text: "", stopReason: "error", error: "Folevi couldn't reach Foli AI.", errorCode: "unavailable" };
            })
            .then(function (r) {
              void handle.remove();
              return r;
            });
          return {
            done: done,
            cancel: function () {
              void call("FoleviShell", "aiCancel", { id: id }).catch(nothing);
            },
          };
        },
        testKey: function (provider) {
          return shellCall("aiTestKey", { provider: String(provider) }, "Error");
        },
      }),
      // The Face ID lock: its settings; turning it on asks for Face ID.
      lock: Object.freeze({
        getSettings: function () {
          return shellCall("lockGet", {}, "LockError");
        },
        setSettings: function (patch) {
          var p = patch || {};
          var opts = {};
          if (typeof p.lock === "boolean") opts.lock = p.lock;
          if (typeof p.lockAfter === "number") opts.lockAfter = p.lockAfter;
          return shellCall("lockSet", opts, "LockError");
        },
      }),
      /** Reminders as iOS notifications (Native/Shell/ShellServices.swift). */
      notify: Object.freeze({
        schedule: function (n) {
          var r = n || {};
          return shellCall("notifySchedule", { id: String(r.id), at: Number(r.at), title: String(r.title || ""), body: String(r.body || ""), path: String(r.path || "/tasks") }, "Error").then(function (x) {
            if (!x || !x.value) throw new Error("Folevi couldn't schedule that reminder.");
          });
        },
        cancel: function (id) {
          return shellCall("notifyCancel", { id: String(id) }, "Error").then(nothing);
        },
      }),
      files: Object.freeze({
        /** Saves a file the page made where the person picks in the Files app; false when cancelled. */
        save: function (name, bytes) {
          return shellCall("filesSave", { name: String(name), bytes: toB64(bytes) }, "Error").then(function (r) {
            return Boolean(r && r.value);
          });
        },
      }),
      http: Object.freeze({
        preview: function (url) {
          return shellCall("httpPreview", { url: String(url) }, "Error").then(value);
        },
        calendar: function (url, previous) {
          var p = previous || {};
          return shellCall("httpCalendar", { url: String(url), previous: { etag: p.etag || null, lastModified: p.lastModified || null } }, "Error");
        },
      }),
      // This device's end-to-end encryption keys (Native/Shell/E2eeKeys.swift): the private halves stay in
      // the app; the page gets the public halves, what a box sealed to this device holds, and signatures.
      e2ee: Object.freeze({
        deviceKeys: function () {
          return shellCall("e2eeDeviceKeys", {}, "E2eeBridgeError").then(function (r) {
            return { deviceId: r.deviceId, x25519Pub: fromB64(r.x25519Pub), ed25519Pub: fromB64(r.ed25519Pub) };
          });
        },
        open: function (sealedBox, context) {
          return shellCall("e2eeOpen", { box: toB64(sealedBox), context: String(context) }, "E2eeBridgeError").then(function (r) {
            return fromB64(r.bytes);
          });
        },
        sign: function (kind, body) {
          return shellCall("e2eeSign", { kind: String(kind), body: String(body) }, "E2eeBridgeError").then(value);
        },
        reset: function () {
          return shellCall("e2eeReset", {}, "E2eeBridgeError").then(nothing);
        },
        /** "Ask for Face ID to unlock encrypted notes" (Settings > This device): { touchId, available }. */
        settings: function () {
          return shellCall("e2eeSettings", {}, "E2eeBridgeError");
        },
        setTouchId: function (on) {
          return shellCall("e2eeSetTouchId", { on: on === true }, "E2eeBridgeError");
        },
      }),
    });
    Object.defineProperty(window, "foleviShell", { value: shellBridge, enumerable: false, configurable: false, writable: false });
  }

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
