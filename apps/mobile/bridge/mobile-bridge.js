// What the web page gets from Folevi's mobile app (iPhone, iPad, iPhone Duo and Android; docs/MOBILE.md):
// `window.foleviNative` and, for the interface built into the app, `window.foleviShell`. The page's typed view of
// them is apps/web/src/lib/nativeApp.ts and lib/shell/types.ts, the same contract the Mac app answers.
//
// The app adds this before the page's own scripts, on its own page only, filling in the placeholders below
// (ios: FoleviViewController.swift; android: MainActivity.kt). Capacitor carries every call:
// - Capacitor's own plugins where one does the job: Haptics, StatusBar, Share, Clipboard, ActionSheet, App;
// - Folevi's plugins (FoleviShell: the library, sign-in, keys; FoleviNative: the lock, the device's token for the
//   share extension, kept shares, notifications, the scanner) through one Capacitor plugin, "FoleviHost":
//   call(plugin, method, options) resolves with the answer or rejects with { code, message, data }, and their
//   events arrive as FoleviHost's "event" ({ plugin, event, data }).
(function () {
  "use strict";
  var PLATFORM = "__FOLEVI_PLATFORM__";
  var ORIGIN = "__FOLEVI_ORIGIN__";
  var VERSION = "__FOLEVI_VERSION__";
  if (location.origin !== ORIGIN || window.top !== window) return;
  var capacitor = window.Capacitor;
  if (!capacitor || typeof capacitor.nativePromise !== "function") return;
  // Taken now, before any page script runs: the page replacing either later changes nothing here.
  var nativePromise = capacitor.nativePromise.bind(capacitor);
  var registerPlugin = typeof capacitor.registerPlugin === "function" ? capacitor.registerPlugin.bind(capacitor) : null;
  // registerPlugin comes with @capacitor/core, which the page may never load; Capacitor's own native bridge already
  // has every plugin the app registered in Capacitor.Plugins, ready from the start, so their events come from there.
  var plugins = capacitor.Plugins && typeof capacitor.Plugins === "object" ? capacitor.Plugins : null;
  var pluginObject = function (name) {
    if (registerPlugin) return registerPlugin(name);
    return (plugins && plugins[name]) || null;
  };
  var ios = PLATFORM === "ios";

  var failure = function (e) {
    var err = e && typeof e === "object" ? e : {};
    var out = { message: typeof err.message === "string" ? err.message : "Folevi couldn't do that." };
    if (typeof err.code === "string") out.code = err.code;
    out.data = err.data && typeof err.data === "object" ? err.data : typeof err.path === "string" ? { path: err.path } : {};
    return out;
  };

  /** A Capacitor plugin's method: a promise of its answer (a plain object). */
  var plugin = function (name, method, options) {
    try {
      return Promise.resolve(nativePromise(name, method, options || {})).then(
        function (r) {
          return r === undefined || r === null ? {} : r;
        },
        function (e) {
          throw failure(e);
        },
      );
    } catch (e) {
      return Promise.reject(failure({ code: "unavailable", message: "Folevi couldn't reach the app." }));
    }
  };

  /** One call to a Folevi plugin (FoleviShell, FoleviNative): a promise of its answer. */
  var call = function (name, method, options) {
    var copy;
    try {
      copy = JSON.parse(JSON.stringify(options || {}));
    } catch (e) {
      return Promise.reject(failure({ code: "invalid_argument", message: "Folevi couldn't send that." }));
    }
    return plugin("FoleviHost", "call", { plugin: String(name), method: String(method), options: copy });
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

  // Folevi's plugins' events, for this page only.
  var listeners = Object.create(null);
  var earlyLinks = [];
  var emit = function (name, event, data) {
    var list = listeners[String(name) + "\u0000" + String(event)];
    if (name === "App" && event === "appUrlOpen" && (!list || !list.length)) {
      if (earlyLinks.length < 20) earlyLinks.push(data);
      return;
    }
    if (!list) return;
    list.slice().forEach(function (entry) {
      try {
        entry.cb(data);
      } catch (e) {
        /* the page's own listener failing changes nothing here */
      }
    });
  };
  /** Listens to a Folevi plugin's event; returns the function that stops. */
  var listen = function (name, event, cb) {
    var key = String(name) + "\u0000" + String(event);
    var list = listeners[key] || (listeners[key] = []);
    var entry = { cb: cb };
    list.push(entry);
    return function () {
      var at = list.indexOf(entry);
      if (at >= 0) list.splice(at, 1);
    };
  };
  var host = pluginObject("FoleviHost");
  if (host && typeof host.addListener === "function") {
    host.addListener("event", function (e) {
      if (e && typeof e.plugin === "string" && typeof e.event === "string") emit(e.plugin, e.event, e.data);
    });
  }
  /** A Capacitor plugin's event (App's appStateChange, Keyboard's moves). */
  var onPlugin = function (name, event, cb) {
    var p = pluginObject(name);
    if (!p || typeof p.addListener !== "function") return function () {};
    var handle = Promise.resolve(p.addListener(event, cb)).catch(function () {
      return null;
    });
    return function () {
      void handle.then(function (h) {
        if (h && typeof h.remove === "function") h.remove();
      });
    };
  };

  // Haptics (Capacitor's Haptics plugin): impacts, a selection tick, and the notices.
  var IMPACT = { light: "LIGHT", soft: "LIGHT", medium: "MEDIUM", heavy: "HEAVY", rigid: "HEAVY" };
  var NOTICE = { success: "SUCCESS", warning: "WARNING", error: "ERROR" };
  var haptic = function (kind) {
    if (IMPACT[kind]) return void quietly(plugin("Haptics", "impact", { style: IMPACT[kind] }));
    if (NOTICE[kind]) return void quietly(plugin("Haptics", "notification", { type: NOTICE[kind] }));
    if (kind === "selection") {
      void quietly(plugin("Haptics", "selectionStart", {}))
        .then(function () {
          return quietly(plugin("Haptics", "selectionChanged", {}));
        })
        .then(function () {
          return quietly(plugin("Haptics", "selectionEnd", {}));
        });
    }
  };

  var actionList = function (actions) {
    return (Array.isArray(actions) ? actions : []).map(function (a) {
      return { id: String((a && a.id) || ""), title: String((a && a.title) || ""), style: a && (a.style === "cancel" || a.style === "destructive") ? a.style : "default" };
    });
  };

  /** folevi.com/pricing: where plans are sold. Never opened from the app (App Store rule 3.1.1). */
  var isPricing = function (raw) {
    try {
      var u = new URL(raw);
      var h = u.hostname.toLowerCase();
      return (h === "folevi.com" || /\.folevi\.com$/.test(h) || h === "localhost") && (u.pathname === "/pricing" || u.pathname.indexOf("/pricing/") === 0);
    } catch (e) {
      return false;
    }
  };

  // Local mode on iOS (no account, so no REST API for the widgets, Shortcuts and Spotlight): the page that holds the
  // library feeds them and takes what they did meanwhile (apps/ios Native/LocalExtensions.swift). Android has none.
  var localExtensions = !ios
    ? {}
    : {
        /** The widgets' tasks and recent notes, and the notes Shortcuts can pick from (`catalog`). */
        setWidgetSnapshot: function (snapshot) {
          var s = snapshot || {};
          return quietly(call("FoleviNative", "setWidgetSnapshot", { day: String(s.day || ""), tasks: s.tasks || [], notes: s.notes || [], catalog: s.catalog || [] })).then(function () {});
        },
        /** What a widget, Siri or Shortcuts did while the page wasn't there, oldest first. */
        takeLocalActions: function () {
          return quietly(call("FoleviNative", "takeLocalActions")).then(function (r) {
            return (r && r.value) || [];
          });
        },
        /** An action is in the library now (or there was nothing to do): the app lets it go. */
        finishLocalAction: function (id) {
          return quietly(call("FoleviNative", "finishLocalAction", { id: String(id) })).then(function () {});
        },
        /** The notes Spotlight finds ([{ id, title, excerpt, location, starred, updatedAt }]), exactly these. */
        indexSpotlight: function (items) {
          return quietly(call("FoleviNative", "indexSpotlight", { items: items || [] })).then(function () {});
        },
      };
  // The app's "folevi:…" window events (a widget or an intent queued something: "folevi:local-actions").
  listen("FoleviHost", "windowEvent", function (data) {
    var name = data && typeof data.name === "string" ? data.name : "";
    if (/^folevi:[a-z-]+$/.test(name)) window.dispatchEvent(new Event(name));
  });

  // iOS: the keyboard's own moves, before it moves (its height when it lands, the duration and iOS's curve), from
  // the app (apps/ios Native/UI/KeyboardBridge.swift), as the iPhone and iPad app sent them. Without these the page
  // falls back to Capacitor's keyboard events and the visual viewport, which reads "no keyboard" once the web view
  // has shrunk for it, so a sheet's composer dropped behind the keyboard.
  var keyboardMoves = !ios
    ? {}
    : {
        /** Every move of the keyboard ({ height, duration, curve, visible, late }); returns the function that stops. */
        onKeyboard: function (listener) {
          return listen("FoleviNative", "keyboard", function (event) {
            if (!event) return;
            try {
              var late = Number(event.sentAt) > 0 ? Math.max(0, Math.min(250, Date.now() - Number(event.sentAt))) : 0;
              listener({ height: Number(event.height) || 0, duration: Number(event.duration) || 0, curve: event.curve === "keyboard" ? "keyboard" : "linear", visible: !!event.visible, late: late });
            } catch (e) {
              /* the page's own listener failing changes nothing here */
            }
          });
        },
        /** { interactiveDismiss }: whether a drag down in a scrolling view takes the keyboard with the finger. */
        keyboard: function (o) {
          return quietly(call("FoleviNative", "keyboard", { interactiveDismiss: !!(o && o.interactiveDismiss) })).then(function () {});
        },
      };

  var bridge = Object.freeze(Object.assign(localExtensions, keyboardMoves, {
    platform: PLATFORM,
    version: VERSION,
    haptic: haptic,
    /** An action sheet ({ title, message, actions: [{ id, title, style }] }): the chosen id, or null. */
    actionSheet: function (o) {
      var actions = actionList(o && o.actions);
      var options = actions.map(function (a) {
        return { title: a.title, style: a.style === "destructive" ? "DESTRUCTIVE" : a.style === "cancel" ? "CANCEL" : "DEFAULT" };
      });
      // Android's sheet has no cancel row of its own: a tap outside is the cancel there.
      var opts = { options: options };
      if (o && o.title) opts.title = String(o.title);
      if (o && o.message) opts.message = String(o.message);
      return plugin("ActionSheet", "showActions", opts).then(
        function (r) {
          var a = r && typeof r.index === "number" ? actions[r.index] : null;
          return a && a.style !== "cancel" ? a.id : null;
        },
        function () {
          return null;
        },
      );
    },
    /** The share sheet ({ title, text, url }): true when something was shared. */
    share: function (o) {
      var opts = {};
      ["title", "text", "url"].forEach(function (k) {
        if (o && typeof o[k] === "string" && o[k]) opts[k] = o[k];
      });
      return plugin("Share", "share", opts).then(
        function () {
          return true;
        },
        function () {
          return false;
        },
      );
    },
    /** Text onto the clipboard (true once it's there). */
    copyText: function (text) {
      return plugin("Clipboard", "write", { string: String(text) }).then(
        function () {
          return true;
        },
        function () {
          return false;
        },
      );
    },
    /** The status bar's text for the page's theme: "dark" (a dark page, light text) or "light". */
    setStatusBar: function (theme) {
      void quietly(plugin("StatusBar", "setStyle", { style: theme === "dark" ? "DARK" : "LIGHT" }));
    },
    /** Opens a link outside the app: web pages in the in-app browser, mail and phone links with the system. */
    openExternal: function (url) {
      var raw = String(url);
      if (isPricing(raw)) return Promise.resolve(false);
      if (/^https?:/i.test(raw) && !ios) {
        return plugin("Browser", "open", { url: raw }).then(
          function () {
            return true;
          },
          function () {
            return false;
          },
        );
      }
      return quietly(call("FoleviNative", "openExternal", { url: raw })).then(function (r) {
        return r !== null;
      });
    },
    /** The lock: { lock, lockAfter (seconds), method }. */
    getSettings: function () {
      return quietly(call("FoleviNative", "getSettings"));
    },
    setSettings: function (patch) {
      return call("FoleviNative", "setSettings", patch);
    },
    device: function () {
      return quietly(call("FoleviNative", "device"));
    },
    setCredential: function (credential) {
      return quietly(call("FoleviNative", "setCredential", credential)).then(function (r) {
        return r !== null;
      });
    },
    clearCredential: function () {
      return quietly(call("FoleviNative", "clearCredential")).then(function () {});
    },
    takeShares: function () {
      return quietly(call("FoleviNative", "takeShares")).then(function (r) {
        return (r && r.value) || [];
      });
    },
    finishShare: function (id) {
      return quietly(call("FoleviNative", "finishShare", { id: String(id) })).then(function () {});
    },
    scanDocument: function (source) {
      return call("FoleviNative", "scanDocument", { source: source === "camera" ? "camera" : "photos" }).then(function (r) {
        return (r && r.value) || null;
      });
    },
    pushStatus: function () {
      return quietly(call("FoleviNative", "pushStatus"));
    },
    enablePush: function () {
      return quietly(call("FoleviNative", "enablePush"));
    },
    disablePush: function () {
      return quietly(call("FoleviNative", "disablePush")).then(function () {});
    },
    authenticate: function (url) {
      return quietly(call("FoleviNative", "authenticate", { url: String(url) })).then(function (r) {
        return r && typeof r.url === "string" ? r.url : null;
      });
    },
    signInWithApple: function (o) {
      return quietly(call("FoleviNative", "signInWithApple", { nonce: String((o && o.nonce) || "") })).then(function (r) {
        return r && typeof r.idToken === "string" ? { idToken: r.idToken, authorizationCode: String(r.authorizationCode || ""), firstName: r.firstName || null, lastName: r.lastName || null } : null;
      });
    },
    setBackdrop: function (r, g, b) {
      void quietly(call("FoleviNative", "setBackdrop", { r: Number(r) || 0, g: Number(g) || 0, b: Number(b) || 0 }));
    },
    setBadge: function (count) {
      void quietly(call("FoleviNative", "setBadge", { count: Math.max(0, Math.floor(Number(count) || 0)) }));
    },
    openNotificationSettings: function () {
      return quietly(call("FoleviNative", "openNotificationSettings")).then(function () {});
    },
    recognizeText: function (image) {
      var input = image || {};
      return quietly(call("FoleviNative", "recognizeText", { data: String(input.data || ""), type: String(input.type || ""), handwriting: Boolean(input.handwriting) })).then(function (r) {
        return r && typeof r.text === "string" ? { text: r.text } : null;
      });
    },
    /** folevi:// links opened from other apps, notifications and universal links, for the page to route. */
    onCommand: function (listener) {
      var deliver = function (event) {
        if (event && typeof event.url === "string") listener({ type: "link", url: event.url });
      };
      var stop = listen("App", "appUrlOpen", deliver);
      var early = earlyLinks;
      earlyLinks = [];
      early.forEach(function (event) {
        setTimeout(function () {
          deliver(event);
        }, 0);
      });
      return stop;
    },
  }));

  Object.defineProperty(window, "foleviNative", { value: bridge, enumerable: false, configurable: false, writable: false });

  // The page's clipboard needs a tap to allow it, and the web view doesn't count every touch as one: when it says
  // no, the app puts the text on the clipboard instead.
  try {
    var clip = navigator.clipboard;
    if (clip && typeof clip.writeText === "function") {
      var writeText = clip.writeText.bind(clip);
      clip.writeText = function (text) {
        return writeText(text).catch(function (e) {
          return plugin("Clipboard", "write", { string: String(text) }).then(
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

  // ---------------------------------------------------------------- foleviShell (the built-in interface)
  // What it starts with is filled in by the app: the mode (read before any page script runs), this device's name
  // and family, the open place, where to open, and where the library's attachments are served (fileBase).
  var SHELL = "__FOLEVI_SHELL__";
  if (SHELL && typeof SHELL === "object") {
    // The shared Dropbox and Google Drive code (`var FoleviCloudKit = …`), inside this function.
    /*__FOLEVI_CLOUD_KIT__*/
    // The half shared with the Mac app (apps/ios/ios/App/Native/Shell/shell-bridge.js): `var foleviShellBridge = …`.
    /*__FOLEVI_SHELL_BRIDGE__*/
    var family = SHELL.deviceFamily;
    var shellBridge = foleviShellBridge(SHELL, {
      call: call,
      listen: listen,
      platform: PLATFORM,
      version: VERSION,
      deviceName: ios ? "iPhone" : "Android",
      deviceFamily: ios ? (family === "iPad" ? "iPad" : "iPhone") : family === "tablet" ? "tablet" : "phone",
      fileBase: typeof SHELL.fileBase === "string" ? SHELL.fileBase : "folevi-file://lib/",
      cloudKit: typeof FoleviCloudKit === "object" && FoleviCloudKit ? FoleviCloudKit : null,
    });
    Object.defineProperty(window, "foleviShell", { value: shellBridge, enumerable: false, configurable: false, writable: false });
  }

  // The app coming back to the front, and leaving, said reliably (Capacitor's App plugin): the page picks up what
  // the share extension kept, and saves what was typed in the last second before the app is suspended.
  onPlugin("App", "appStateChange", function (state) {
    if (!state) return;
    window.dispatchEvent(new Event(state.isActive ? "folevi:app-active" : "folevi:app-inactive"));
  });

  // Android's Back (the button and the gesture): the page closes what's open (a sheet, a menu) or goes back a screen
  // (a cancelable "folevi:back" event); with nothing left, the app goes to the background as Android apps do.
  if (!ios) {
    onPlugin("App", "backButton", function (e) {
      var ask = new Event("folevi:back", { cancelable: true });
      if (!window.dispatchEvent(ask)) return;
      if (e && e.canGoBack) history.back();
      else void quietly(plugin("App", "minimizeApp", {}));
    });
  }

  // What iOS knows and a web view can't read (apps/ios Native/SystemSettings.swift), as marks on <html>: Reduce
  // Transparency, Increase Contrast, Bold Text, a hardware keyboard, and the text size as --ios-text-scale.
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
      if (!a || !Object.keys(a).length) return;
      accessibility = a;
      applyAccessibility();
    });
  };
  if (ios) {
    readAccessibility();
    window.addEventListener("folevi:accessibility", readAccessibility);
  }

  // The page knows from its first paint that it's in the app (safe areas, no purchases, the platform's touches).
  var mark = function () {
    if (document.documentElement) document.documentElement.setAttribute("data-native", PLATFORM);
    applyAccessibility();
  };
  mark();
  if (!document.documentElement) document.addEventListener("DOMContentLoaded", mark, { once: true });

  // A tap on the status bar (Capacitor's "statusTap" on iOS): what scrolls under the middle of the screen goes back
  // to its top, as in any iOS app. The page can take it first (a cancelable "folevi:scroll-to-top" event).
  var scrollable = function (el) {
    if (!(el instanceof Element)) return false;
    var style = getComputedStyle(el);
    return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
  };
  var scrollToTop = function () {
    var ask = new Event("folevi:scroll-to-top", { cancelable: true });
    if (!window.dispatchEvent(ask)) return;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var w = window.innerWidth;
    var h = window.innerHeight;
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
  };
  window.addEventListener("statusTap", scrollToTop);
  window.addEventListener("folevi:status-bar-tap", scrollToTop);

  // The page fills the screen, under the status bar and the home indicator or navigation bar (viewport-fit=cover),
  // and keeps clear of them with the safe-area insets. It stays at its own scale (no zoom on a small field).
  var watched = typeof WeakSet === "function" ? new WeakSet() : null;
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

  // The splash screen goes once the page has drawn its first frame.
  var hideSplash = function () {
    void quietly(plugin("SplashScreen", "hide", { fadeOutDuration: 150 }));
  };
  if (document.readyState === "complete") requestAnimationFrame(hideSplash);
  else window.addEventListener("load", function () {
    requestAnimationFrame(hideSplash);
  }, { once: true });
  // Whatever happens to the page, the app never stays behind its splash screen (a hide that comes before the splash
  // is up is ignored, so it's asked again; hiding a hidden splash does nothing).
  [1500, 4000, 8000].forEach(function (ms) {
    setTimeout(hideSplash, ms);
  });

  // The bridge is up: links the app kept for this page come now.
  void quietly(plugin("FoleviHost", "ready", {}));
})();
