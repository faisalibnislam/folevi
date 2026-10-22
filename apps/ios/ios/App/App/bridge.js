// The only thing the web page gets from the iPhone and iPad app: `window.foleviNative`, a few calls that reach
// the app (through Capacitor's bridge, window.Capacitor). Added before the page's own scripts
// (FoleviViewController), on Folevi's own site only: the app fills in that one origin below. The page's
// typed view of this is apps/web/src/lib/nativeApp.ts.
(function () {
  "use strict";
  var ORIGIN = "__FOLEVI_ORIGIN__";
  var VERSION = "__FOLEVI_VERSION__";
  var BUILD = "__FOLEVI_BUILD__";
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
  var HAPTICS = { light: 1, medium: 1, heavy: 1, rigid: 1, soft: 1, selection: 1, success: 1, warning: 1, error: 1 };
  // A rectangle on screen from the page ({ x, y, width, height }, CSS pixels of what's visible), as plain numbers.
  var rect = function (r) {
    if (!r || typeof r !== "object") return undefined;
    var out = { x: Number(r.x), y: Number(r.y), width: Number(r.width), height: Number(r.height) };
    return isFinite(out.x) && isFinite(out.y) && isFinite(out.width) && isFinite(out.height) ? out : undefined;
  };
  var actionList = function (actions) {
    return (Array.isArray(actions) ? actions : []).map(function (a) {
      return { id: String((a && a.id) || ""), title: String((a && a.title) || ""), style: a && (a.style === "cancel" || a.style === "destructive") ? a.style : "default" };
    });
  };

  var bridge = Object.freeze({
    platform: "ios",
    version: VERSION,
    /** The build number (CFBundleVersion), shown with the version in Settings. */
    build: BUILD || undefined,
    /**
     * A tap felt in the hand (Native/UI/Haptics.swift): "light" | "medium" | "heavy" | "rigid" | "soft" impacts,
     * a "selection" tick, or "success" | "warning" | "error".
     */
    haptic: function (kind) {
      if (HAPTICS[kind] === 1) void quietly(call("FoleviNative", "haptic", { kind: kind }));
    },
    /** Readies the generator for `kind` (a control that will fire one was touched). */
    hapticPrepare: function (kind) {
      if (HAPTICS[kind] === 1) void quietly(call("FoleviNative", "hapticPrepare", { kind: kind }));
    },
    /** The long press's lifted preview (Native/UI/LiftPreview.swift), 1: a picture of `rect` ({ id, rect, radius }). */
    liftArm: function (o) {
      var r = rect(o && o.rect);
      if (!o || !r) return;
      void quietly(call("FoleviNative", "liftArm", { id: String(o.id), rect: r, radius: Number(o.radius) || 0 }));
    },
    /** 2: the picture lifts over the page ({ id, from }); false when there's none. */
    lift: function (o) {
      return quietly(call("FoleviNative", "lift", { id: String((o && o.id) || ""), from: Number(o && o.from) || 1 })).then(function (r) {
        return !!(r && r.value);
      });
    },
    /** 2b: the lifted picture moves up ({ id, dy }; 0 is back) so the page's menu fits whole under it. */
    liftMove: function (o) {
      if (!o) return;
      void quietly(call("FoleviNative", "liftMove", { id: String(o.id || ""), dy: Math.max(0, Number(o.dy) || 0) }));
    },
    /** 3: it settles back ({ id, to: "back" }) or fades ({ to: "fade" }); resolves once it's in place. */
    liftDrop: function (o) {
      return quietly(call("FoleviNative", "liftDrop", { id: String((o && o.id) || ""), to: o && o.to === "fade" ? "fade" : "back" })).then(function () {});
    },
    /** An action sheet ({ title, message, actions: [{ id, title, style }], anchor }): the chosen id, or null. */
    actionSheet: function (o) {
      var opts = { title: String((o && o.title) || ""), message: String((o && o.message) || ""), actions: actionList(o && o.actions) };
      var a = rect(o && o.anchor);
      if (a) opts.anchor = a;
      return call("FoleviNative", "actionSheet", opts).then(function (r) {
        return r && typeof r.value === "string" ? r.value : null;
      });
    },
    /** An alert ({ title, message, actions, field: { value, placeholder, capitalize } }): { id, text } or null. */
    alert: function (o) {
      var opts = { title: String((o && o.title) || ""), message: String((o && o.message) || ""), actions: actionList(o && o.actions) };
      if (o && o.field) opts.field = { value: String(o.field.value || ""), placeholder: String(o.field.placeholder || ""), capitalize: String(o.field.capitalize || "sentences") };
      return call("FoleviNative", "alert", opts).then(function (r) {
        var v = r && r.value;
        return v && typeof v.id === "string" ? (typeof v.text === "string" ? { id: v.id, text: v.text } : { id: v.id }) : null;
      });
    },
    /** The date and time picker in a sheet ({ value, mode, min, max, title, clearable }): { value } or null. */
    pickDate: function (o) {
      var opts = { mode: String((o && o.mode) || "date"), clearable: !!(o && o.clearable) };
      ["value", "min", "max", "title"].forEach(function (k) {
        if (o && typeof o[k] === "string" && o[k]) opts[k] = o[k];
      });
      return call("FoleviNative", "pickDate", opts).then(function (r) {
        var v = r && r.value;
        return v && typeof v === "object" ? { value: typeof v.value === "string" ? v.value : null } : null;
      });
    },
    /** The colour picker ({ value: "#rrggbb", title }): "#rrggbb", or null. */
    pickColor: function (o) {
      var opts = {};
      if (o && typeof o.value === "string") opts.value = o.value;
      if (o && typeof o.title === "string") opts.title = o.title;
      return call("FoleviNative", "pickColor", opts).then(function (r) {
        return r && typeof r.value === "string" ? r.value : null;
      });
    },
    /** The share sheet ({ title, text, url, anchor }): true when something was shared. */
    share: function (o) {
      var opts = {};
      ["title", "text", "url"].forEach(function (k) {
        if (o && typeof o[k] === "string" && o[k]) opts[k] = o[k];
      });
      var a = rect(o && o.anchor);
      if (a) opts.anchor = a;
      return call("FoleviNative", "share", opts).then(function (r) {
        return !!(r && r.value);
      });
    },
    /** Text onto the pasteboard (true once it's there). */
    copyText: function (text) {
      return quietly(call("FoleviNative", "copyText", { text: String(text) })).then(function (r) {
        return !!(r && r.value);
      });
    },
    /** How the keyboard behaves ({ interactiveDismiss }): a drag down in a scrolling view takes it away. */
    keyboard: function (o) {
      void quietly(call("FoleviNative", "keyboard", { interactiveDismiss: !!(o && o.interactiveDismiss) }));
    },
    /** Every move of the keyboard ({ height, duration, curve, visible, late }); returns the function that stops. */
    onKeyboard: function (listener) {
      var handle = cap.addListener("FoleviNative", "keyboard", function (event) {
        if (!event) return;
        try {
          // How long the news took to get here (the app stamps it as the keyboard sets off): a bar moving with the
          // keyboard starts that far along.
          var late = Number(event.sentAt) > 0 ? Math.max(0, Math.min(250, Date.now() - Number(event.sentAt))) : 0;
          listener({ height: Number(event.height) || 0, duration: Number(event.duration) || 0, curve: event.curve === "keyboard" ? "keyboard" : "linear", visible: !!event.visible, late: late });
        } catch (e) {
          /* the page's own listener failing changes nothing here */
        }
      });
      return function () {
        void Promise.resolve(handle).then(function (h) {
          if (h && h.remove) h.remove();
        });
      };
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
    /**
     * Local mode (no account): the widgets' copy ({ day, tasks, notes, catalog }), handed over by the page that
     * holds the library; the app draws the widgets again and offers `catalog`'s notes in Shortcuts.
     */
    setWidgetSnapshot: function (snapshot) {
      var s = snapshot || {};
      return quietly(call("FoleviNative", "setWidgetSnapshot", { day: String(s.day || ""), tasks: s.tasks || [], notes: s.notes || [], catalog: s.catalog || [] })).then(function () {});
    },
    /** Local mode: what a widget, Siri or Shortcuts did while the page wasn't there, oldest first. */
    takeLocalActions: function () {
      return quietly(call("FoleviNative", "takeLocalActions")).then(function (r) {
        return (r && r.value) || [];
      });
    },
    /** Local mode: an action is in the library now (or there was nothing to do): the app lets it go. */
    finishLocalAction: function (id) {
      return quietly(call("FoleviNative", "finishLocalAction", { id: String(id) })).then(function () {});
    },
    /** Local mode: the notes Spotlight finds ([{ id, title, excerpt, location, starred, updatedAt }]), exactly these. */
    indexSpotlight: function (items) {
      return quietly(call("FoleviNative", "indexSpotlight", { items: items || [] })).then(function () {});
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
    /**
     * Sign in with Apple in Apple's own sheet: { idToken, authorizationCode, firstName, lastName }, or null when
     * it was closed. `nonce` is the page's own random string (the request carries its SHA-256).
     */
    signInWithApple: function (o) {
      return quietly(call("FoleviNative", "signInWithApple", { nonce: String((o && o.nonce) || "") })).then(function (r) {
        return r && typeof r.idToken === "string" ? { idToken: r.idToken, authorizationCode: String(r.authorizationCode || ""), firstName: r.firstName || null, lastName: r.lastName || null } : null;
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

  // The page's clipboard needs a tap to allow it, and WebKit doesn't count every touch as one (a held finger let
  // go on a menu item's "Copy link", say): when it says no, the app puts the text on the pasteboard instead.
  try {
    var clip = navigator.clipboard;
    if (clip && typeof clip.writeText === "function") {
      var writeText = clip.writeText.bind(clip);
      clip.writeText = function (text) {
        return writeText(text).catch(function (e) {
          return call("FoleviNative", "copyText", { text: String(text) }).then(
            function () {
              return undefined;
            },
            function () {
              throw e;
            },
          );
        });
      };
    }
  } catch (e) {
    /* the page's own clipboard stays as it is */
  }

  // ---------------------------------------------------------------- foleviShell (the built-in interface only)
  // docs/LOCAL_MODE_PLAN.md §4.1, the page's types in apps/web/src/lib/shell/types.ts, the native side in
  // Native/Shell/FoleviShellPlugin.swift. Filled in by FoleviViewController when the app shows the interface
  // built into it: the mode it opens in (read before any page script runs), its version and this device's name.
  var SHELL = "__FOLEVI_SHELL__";
  if (SHELL && typeof SHELL === "object") {
    // The shared Dropbox and Google Drive code (scripts/bundle-cloud.mjs), filled in by FoleviViewController:
    // `var FoleviCloudKit = …`, inside this function, never on the page's window.
    /*__FOLEVI_CLOUD_KIT__*/
    // The shared half (Native/Shell/shell-bridge.js, the Mac app's too), filled in by FoleviViewController:
    // `var foleviShellBridge = …`, inside this function too.
    /*__FOLEVI_SHELL_BRIDGE__*/
    var shellBridge = foleviShellBridge(SHELL, {
      call: call,
      listen: function (plugin, event, cb) {
        var handle = cap.addListener(plugin, event, cb);
        return function () {
          if (handle && typeof handle.remove === "function") void handle.remove();
          else
            void Promise.resolve(handle).then(function (h) {
              if (h && h.remove) h.remove();
            });
        };
      },
      platform: "ios",
      version: VERSION,
      deviceName: "iPhone",
      deviceFamily: SHELL.deviceFamily === "iPad" ? "iPad" : "iPhone",
      fileBase: "folevi-file://lib/",
      cloudKit: typeof FoleviCloudKit === "object" && FoleviCloudKit ? FoleviCloudKit : null,
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
    // A hardware keyboard attached (the iPad layout's ⌘K hints, Shell.tsx); data-keyboard-known says the app
    // answers this, so the page doesn't guess from key presses.
    if (typeof a.hardwareKeyboard === "boolean") {
      flag("data-keyboard-known", true);
      flag("data-hardware-keyboard", a.hardwareKeyboard);
    }
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
