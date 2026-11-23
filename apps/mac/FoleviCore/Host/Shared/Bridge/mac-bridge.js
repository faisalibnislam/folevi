// What the web page gets from Folevi for Mac (docs/MAC_WEBKIT_PLAN.md §4.3 and §5): `window.foleviDesktop` (the
// Mac's own calls: Dock badge, notifications, menu bar, Quick Add, window buttons, commands from the menus) and
// `window.foleviShell` (the built-in interface's host: the library, sign-in, keys, Foli AI, places), the latter
// from the file shared with the iPhone and iPad app (shell-bridge.js). Added at document start to every web view
// of the app, on app://folevi only, by WebViewFactory, which fills in what the page starts with (BOOT) and places
// the shared files inside this function, never on the page's window. The page's types are apps/web/src/lib/desktop.ts
// and apps/web/src/lib/shell/types.ts; the native side is Bridge/MessageRouter.swift.
//
// The transport: call(plugin, method, options) posts { plugin, method, options } to the "folevi" message handler
// and resolves with the router's answer, or rejects with { code, message, data: { path } } (the shape Capacitor's
// errors have on iOS, so shell-bridge.js reads both alike). Options or answers above 256 KB go through
// app://folevi/_bridge/<id> instead of the message. Native events arrive through window.__foleviEmit(plugin,
// event, data) (Bridge/Events.swift), for this view only.
(function () {
  "use strict";
  var BOOT = "__FOLEVI_BOOT__";
  if (location.origin !== "app://folevi" || window.top !== window || !BOOT || typeof BOOT !== "object") return;
  var handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.folevi;
  if (!handler || typeof handler.postMessage !== "function") return;
  // Taken now, before any page script runs: the page replacing either later changes nothing here.
  var post = handler.postMessage.bind(handler);
  var send = window.fetch.bind(window);
  var LIMIT = 256 * 1024;

  var nextId = 0;
  var newId = function () {
    nextId += 1;
    var rand = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).slice(2) + Date.now().toString(36);
    return "c" + nextId + rand;
  };
  var failure = function (e) {
    var err = e && typeof e === "object" ? e : {};
    var out = { code: typeof err.code === "string" ? err.code : "io", message: typeof err.message === "string" ? err.message : "Folevi couldn't do that." };
    out.data = typeof err.path === "string" ? { path: err.path } : {};
    return out;
  };
  var answer = function (r) {
    if (!r || typeof r !== "object") throw failure(null);
    if (r.ok !== true) throw failure(r.error);
    if (typeof r.bodyId === "string") {
      return send("app://folevi/_bridge/" + r.bodyId).then(function (res) {
        if (!res.ok) throw failure({ code: "io", message: "Folevi couldn't read that answer." });
        return res.json();
      });
    }
    return r.value === undefined ? {} : r.value;
  };

  /** One call to the app: a promise of its answer (a plain object, as Capacitor's on iOS). */
  var call = function (plugin, method, options) {
    var text;
    try {
      text = JSON.stringify(options || {});
    } catch (e) {
      return Promise.reject(failure({ code: "invalid_argument", message: "Folevi couldn't send that." }));
    }
    var sent;
    if (text.length > LIMIT) {
      var id = newId();
      sent = send("app://folevi/_bridge/" + id, { method: "POST", body: text, headers: { "content-type": "application/json" } }).then(function (res) {
        if (!res.ok) throw failure({ code: "io", message: "Folevi couldn't send that." });
        return post({ plugin: String(plugin), method: String(method), bodyId: id });
      });
    } else {
      sent = post({ plugin: String(plugin), method: String(method), options: JSON.parse(text) });
    }
    return Promise.resolve(sent).then(answer, function (e) {
      throw failure(e && typeof e === "object" && "code" in e ? e : { code: "unavailable", message: "Folevi couldn't reach the app." });
    });
  };
  var quietly = function (promise) {
    return promise.then(
      function (v) {
        return v;
      },
      function () {
        return null;
      },
    );
  };

  // Native events, for this view only.
  var listeners = Object.create(null);
  /** Listens to a native event; returns the function that stops. */
  var listen = function (plugin, event, cb) {
    var key = String(plugin) + "\u0000" + String(event);
    var list = listeners[key] || (listeners[key] = []);
    var entry = { cb: cb };
    list.push(entry);
    return function () {
      var at = list.indexOf(entry);
      if (at >= 0) list.splice(at, 1);
    };
  };
  Object.defineProperty(window, "__foleviEmit", {
    value: function (plugin, event, data) {
      var list = listeners[String(plugin) + "\u0000" + String(event)];
      if (!list) return;
      list.slice().forEach(function (entry) {
        try {
          entry.cb(data);
        } catch (e) {
          /* the page's own listener failing changes nothing here */
        }
      });
    },
    enumerable: false,
    configurable: false,
    writable: false,
  });

  var toB64 = function (bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : null;
    if (!u8) return "";
    var out = "";
    for (var i = 0; i < u8.length; i += 0x8000) out += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(out);
  };

  // ---------------------------------------------------------------- foleviShell (shared with iOS)
  var shellBridge = null;
  var SHELL = BOOT.shell;
  if (SHELL && typeof SHELL === "object") {
    // The shared Dropbox and Google Drive code (apps/ios/scripts/bundle-cloud.mjs): `var FoleviCloudKit = …`.
    /*__FOLEVI_CLOUD_KIT__*/
    // apps/ios/ios/App/Native/Shell/shell-bridge.js: `var foleviShellBridge = …`.
    /*__FOLEVI_SHELL_BRIDGE__*/
    shellBridge = foleviShellBridge(SHELL, {
      call: call,
      listen: listen,
      platform: "mac",
      version: String(BOOT.version || "0.0.0"),
      deviceName: "Mac",
      fileBase: "app://folevi/_files/",
      cloudKit: typeof FoleviCloudKit === "object" && FoleviCloudKit ? FoleviCloudKit : null,
    });
    Object.defineProperty(window, "foleviShell", { value: shellBridge, enumerable: false, configurable: false, writable: false });
  }

  // ---------------------------------------------------------------- foleviDesktop
  // The calls Electron's preload.ts gave, answered by Bridge/DesktopRouter.swift. The optional ones (the page
  // checks for them) are only there once the app answers them: BOOT.desktop lists those it does.
  var has = Object.create(null);
  (Array.isArray(BOOT.desktop) ? BOOT.desktop : []).forEach(function (name) {
    has[String(name)] = true;
  });
  var desk = function (method, options) {
    return call("FoleviDesktop", method, options || {});
  };
  var fire = function (method, options) {
    void quietly(desk(method, options));
  };
  var spot = function (s) {
    var o = { x: Number(s && s.x), y: Number(s && s.y), height: Number(s && s.height) };
    return isFinite(o.x) && isFinite(o.y) && isFinite(o.height) ? o : null;
  };
  var desktop = {
    platform: "mac",
    e2ee: shellBridge ? shellBridge.e2ee : undefined,
    /** The number on the Dock icon (unread notifications); 0 clears it. */
    setBadge: function (count) {
      fire("setBadge", { count: Math.max(0, Math.floor(Number(count) || 0)) });
    },
    /** A Mac notification; clicking it brings Folevi forward at `path`. */
    notify: function (n) {
      var o = n || {};
      fire("notify", { id: String(o.id || ""), title: String(o.title || ""), body: o.body == null ? null : String(o.body), path: o.path == null ? null : String(o.path) });
    },
    /** The notes the menu bar icon lists. */
    setRecent: function (notes) {
      fire("setRecent", {
        notes: (Array.isArray(notes) ? notes : []).slice(0, 50).map(function (n) {
          return { id: String((n && n.id) || ""), title: String((n && n.title) || "") };
        }),
      });
    },
    /** The save state the menu bar menu shows ("All changes saved"). */
    setStatus: function (text) {
      fire("setStatus", { text: String(text || "") });
    },
    getSettings: function () {
      return quietly(desk("getSettings"));
    },
    setSettings: function (patch) {
      var plain = {};
      try {
        plain = JSON.parse(JSON.stringify(patch || {}));
      } catch (e) {
        plain = {};
      }
      return quietly(desk("setSettings", { patch: plain }));
    },
    /** Where the page keeps room for the window buttons: they go there. */
    placeWindowButtons: function (s) {
      var o = spot(s);
      if (o) fire("placeWindowButtons", o);
    },
    /** While Settings records a new shortcut, the current one stays quiet. */
    pauseShortcut: function (paused) {
      fire("pauseShortcut", { paused: paused === true });
    },
    closeQuickAdd: function () {
      fire("closeQuickAdd");
    },
    sizeQuickAdd: function (height) {
      var h = Number(height);
      if (isFinite(h)) fire("sizeQuickAdd", { height: h });
    },
    /** Opens a path in the main window and brings it forward (from Quick Add). */
    openInMain: function (path) {
      fire("openInMain", { path: String(path || "") });
    },
    /** Menu, menu bar and notification commands for the page; returns the function that stops listening. */
    onCommand: function (listener) {
      return listen("FoleviDesktop", "command", function (command) {
        if (command && typeof command.type === "string") listener(command);
      });
    },
  };
  if (has.signInInBrowser)
    desktop.signInInBrowser = function (url) {
      return quietly(desk("signInInBrowser", { url: String(url) })).then(function (r) {
        return r && typeof r.url === "string" ? r.url : null;
      });
    };
  if (has.dragFile)
    desktop.dragFile = function (file) {
      fire("dragFile", { name: String((file && file.name) || ""), text: String((file && file.text) || "") });
    };
  if (has.callCapture) desktop.callCapture = true;
  if (has.screenAccess)
    desktop.screenAccess = function () {
      return quietly(desk("screenAccess")).then(function (r) {
        return r && typeof r.value === "string" ? r.value : null;
      });
    };
  if (has.openSystemSettings)
    desktop.openSystemSettings = function (pane) {
      fire("openSystemSettings", { pane: String(pane) });
    };
  if (has.recognizeText)
    desktop.recognizeText = function (image, handwriting) {
      return quietly(desk("recognizeText", { data: toB64(image), handwriting: handwriting === true })).then(function (r) {
        return r && typeof r.text === "string" ? { text: r.text } : null;
      });
    };
  // Other packages' page-side pieces (drag regions, the native text menu, ...), each a file WebViewFactory
  // places here, with call, listen, desk, fire, quietly and BOOT in reach.
  /*__FOLEVI_EXTRAS__*/
  Object.defineProperty(window, "foleviDesktop", { value: Object.freeze(desktop), enumerable: false, configurable: false, writable: false });

  // The page knows from its first paint that it's in the Mac app (room for the window buttons, a draggable top).
  var mark = function () {
    if (document.documentElement) {
      document.documentElement.setAttribute("data-desktop", "mac");
      document.documentElement.setAttribute("data-mac-engine", "webkit");
    }
  };
  mark();
  if (!document.documentElement) document.addEventListener("DOMContentLoaded", mark, { once: true });
})();
