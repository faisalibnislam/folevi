// Folevi for Windows and Linux: what the page gets before its first script runs. Tauri injects this into Folevi's
// own pages only (lib.rs: app://folevi, https://app.localhost on Windows), with BOOT filled in for that page:
//   window.foleviShell    the shared bridge of the iPhone, iPad and Mac apps (apps/ios/ios/App/Native/Shell/
//                         shell-bridge.js, included below as it is), over Tauri's IPC: host.call(plugin, method,
//                         options) -> the "shell_call" command, host.listen -> events lib.rs sends by script.
//   window.foleviDesktop  the desktop app's chrome (apps/web/src/lib/desktop.ts): the taskbar badge, notifications,
//                         the notification area icon's menu, Quick Add, settings, printing, window commands.
//   <html data-desktop>   "windows" or "linux" from the first paint (apps/web globals.css), with Windows' accent color.
// Also: the window's own caption buttons on Windows (Folevi's top bar fills the window, the owner's 2026-11-24
// pick), dragging the window by the page's top bar, and the keys a browser keeps for itself (Ctrl+T, Ctrl+W...).
(function () {
  "use strict";
  if (window.__foleviHost) return;
  var BOOT = /*BOOT*/ { shell: false, platform: "windows", window: "main" } /*BOOT_END*/;
  var origin = location.origin;
  // Only Folevi's own pages (an http(s) page a link opened in this window gets nothing).
  if (BOOT.origins && BOOT.origins.indexOf(origin) < 0 && origin !== "null") return;

  var invoke = function (cmd, args) {
    var t = window.__TAURI_INTERNALS__;
    if (!t || typeof t.invoke !== "function") return Promise.reject({ code: "unavailable", message: "Folevi's bridge isn't ready." });
    return t.invoke(cmd, args);
  };
  // A rejection the bridge can read: { code, message, data }.
  var asError = function (e) {
    if (e && typeof e === "object" && typeof e.code === "string") return e;
    return { code: "io", message: typeof e === "string" ? e : (e && e.message) || "Folevi couldn't do that." };
  };
  var listeners = {};
  var host = {
    platform: BOOT.platform,
    version: BOOT.version,
    deviceName: BOOT.deviceName,
    fileBase: origin + "/_files/",
    cloudKit: null,
    call: function (plugin, method, options) {
      return invoke("shell_call", { plugin: String(plugin), method: String(method), options: options || {} }).catch(function (e) {
        throw asError(e);
      });
    },
    listen: function (plugin, event, cb) {
      var key = plugin + ":" + event;
      (listeners[key] = listeners[key] || []).push(cb);
      return function () {
        var list = listeners[key] || [];
        var at = list.indexOf(cb);
        if (at >= 0) list.splice(at, 1);
      };
    },
  };
  var desktop = function (name, args) {
    return invoke("desktop_call", { name: String(name), args: args || {} });
  };
  // lib.rs delivers events by script: window.__foleviHost.emit("FoleviShell:libraryChanges", { changes }).
  var hostApi = {
    emit: function (key, payload) {
      (listeners[key] || []).slice().forEach(function (cb) {
        try {
          cb(payload);
        } catch (e) {
          /* a page callback failing changes nothing here */
        }
      });
    },
  };
  // ---------------------------------------------------------------- window.foleviShell (the built-in interface)

  // Each page's own start (its place, mode and where it opens) comes with the page itself: the app puts
  // `window.__foleviHost.boot({...})` first in its <head> (lib.rs serve), so a place switch only loads the page again
  // and foleviShell is there before the page's own scripts run.
  /*SHELL_BRIDGE*/
  var booted = false;
  hostApi.boot = function (state) {
    if (booted || !BOOT.shell || !state || typeof state !== "object") return;
    booted = true;
    var shellBridge = foleviShellBridge(state, host); // eslint-disable-line no-undef
    Object.defineProperty(window, "foleviShell", { value: shellBridge, enumerable: true });
  };
  Object.defineProperty(window, "__foleviHost", { value: Object.freeze(hostApi) });

  // ---------------------------------------------------------------- window.foleviDesktop

  var commandListeners = [];
  var sendCommand = function (command) {
    commandListeners.slice().forEach(function (l) {
      try {
        l(command);
      } catch (e) {
        /* the page's own listener */
      }
    });
  };
  host.listen("desktop", "command", sendCommand);
  var answers = {};
  var serial = 0;
  /** A command that carries an id; resolves with the page's answer (commandDone), or null after a while. */
  var ask = function (command, ms) {
    var id = "c" + ++serial;
    return new Promise(function (resolve) {
      var timer = setTimeout(function () {
        delete answers[id];
        resolve(null);
      }, ms || 60000);
      answers[id] = function (value) {
        clearTimeout(timer);
        delete answers[id];
        resolve(value);
      };
      sendCommand(Object.assign({}, command, { id: id }));
    });
  };
  var e2eeCall = function (method, options) {
    return host.call("FoleviShell", method, options).catch(function (e) {
      throw { name: "E2eeBridgeError", code: e.code, message: e.message };
    });
  };
  var b64 = function (u8) {
    var out = "";
    for (var i = 0; i < u8.length; i += 0x8000) out += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(out);
  };
  var unb64 = function (text) {
    var bin = atob(String(text || ""));
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  };
  var printNow = function () {
    return ask({ type: "print" }, 60000).then(function (answer) {
      if (!answer || answer.handled !== true) return desktop("print");
    });
  };
  var bridge = {
    platform: BOOT.platform,
    // Recording a call: WebView2's screen capture carries the PC's sound ("Share system audio"); WebKitGTK's doesn't.
    callCapture: BOOT.platform === "windows",
    setBadge: function (count) {
      void desktop("badge", { count: Number(count) || 0 }).catch(function () {});
    },
    notify: function (n) {
      var x = n || {};
      void desktop("notify", { title: String(x.title || ""), body: x.body ? String(x.body) : "", path: x.path ? String(x.path) : "" }).catch(function () {});
    },
    setRecent: function (notes) {
      var list = Array.isArray(notes) ? notes.slice(0, 8).map(function (n) { return { id: String((n && n.id) || ""), title: String((n && n.title) || "") }; }) : [];
      void desktop("recent", { notes: list }).catch(function () {});
    },
    setStatus: function (text) {
      void desktop("status", { text: String(text || "") }).catch(function () {});
    },
    getSettings: function () {
      return desktop("getSettings");
    },
    setSettings: function (patch) {
      return desktop("setSettings", { patch: JSON.parse(JSON.stringify(patch || {})) });
    },
    placeWindowButtons: function () {},
    pauseShortcut: function (paused) {
      void desktop("pauseShortcut", { paused: paused === true }).catch(function () {});
    },
    closeQuickAdd: function () {
      void desktop("quickAddClose").catch(function () {});
    },
    sizeQuickAdd: function (height) {
      void desktop("quickAddSize", { height: Number(height) || 0 }).catch(function () {});
    },
    openInMain: function (path) {
      void desktop("open", { path: String(path || "") }).catch(function () {});
    },
    print: function () {
      void desktop("print").catch(function () {});
    },
    closeWindow: function () {
      void desktop("closeWindow").catch(function () {});
    },
    commandDone: function (id, value) {
      var a = answers[String(id)];
      if (a) a(value && typeof value === "object" ? value : {});
    },
    onCommand: function (listener) {
      commandListeners.push(listener);
      return function () {
        var at = commandListeners.indexOf(listener);
        if (at >= 0) commandListeners.splice(at, 1);
      };
    },
    // This PC's end-to-end encryption keys (the same calls as foleviShell.e2ee).
    e2ee: Object.freeze({
      deviceKeys: function () {
        return e2eeCall("e2eeDeviceKeys", {}).then(function (r) {
          return { deviceId: r.deviceId, x25519Pub: unb64(r.x25519Pub), ed25519Pub: unb64(r.ed25519Pub) };
        });
      },
      open: function (box, context) {
        return e2eeCall("e2eeOpen", { box: b64(box instanceof Uint8Array ? box : new Uint8Array(box)), context: String(context) }).then(function (r) {
          return unb64(r.bytes);
        });
      },
      sign: function (kind, body) {
        return e2eeCall("e2eeSign", { kind: String(kind), body: String(body) }).then(function (r) {
          return r ? r.value : null;
        });
      },
      reset: function () {
        return e2eeCall("e2eeReset", {}).then(function () {});
      },
      settings: function () {
        return e2eeCall("e2eeSettings", {});
      },
      setTouchId: function (on) {
        return e2eeCall("e2eeSetTouchId", { on: on === true });
      },
    }),
  };
  Object.defineProperty(window, "foleviDesktop", { value: Object.freeze(bridge), enumerable: true });

  // ---------------------------------------------------------------- the look: data-desktop, accent, theme

  var root = function () {
    return document.documentElement;
  };
  var applyAccent = function (accent) {
    var r = root();
    if (!r) return;
    if (typeof accent === "string" && /^#[0-9A-F]{6}$/i.test(accent)) {
      r.style.setProperty("--win-accent", accent);
      r.setAttribute("data-win-accent", "");
    } else {
      r.style.removeProperty("--win-accent");
      r.removeAttribute("data-win-accent");
    }
  };
  var mark = function () {
    var r = root();
    if (!r) return;
    r.setAttribute("data-desktop", BOOT.platform);
    if (BOOT.platform === "windows") applyAccent(BOOT.accent);
  };
  mark();
  if (!root()) document.addEventListener("DOMContentLoaded", mark, { once: true });
  host.listen("desktop", "accent", applyAccent);

  var lastDark = null;
  var reportTheme = function () {
    var r = root();
    if (!r) return;
    var theme = r.getAttribute("data-theme");
    var dark = theme === "dark" || (theme !== "light" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark === lastDark) return;
    lastDark = dark;
    if (captions) captions.setAttribute("data-dark", dark ? "true" : "false");
    void desktop("theme", { dark: !!dark }).catch(function () {});
  };

  // ---------------------------------------------------------------- Windows' caption buttons

  // Folevi's own top bar fills the window, so the minimize, maximize and close buttons are drawn here, as Windows 11
  // draws them (Segoe Fluent Icons, 46 px wide, a red close), in the top right corner the page keeps clear
  // (--win-caption-inset, globals.css). Not in Quick Add, and not on Linux (its window manager draws the title bar).
  var captions = null;
  var CAPTION_WIDTH = 46 * 3;
  var buildCaptions = function () {
    if (BOOT.platform !== "windows" || BOOT.window !== "main" || captions || !document.body) return;
    var hostEl = document.createElement("folevi-captions");
    hostEl.setAttribute("aria-hidden", "false");
    var shadow = hostEl.attachShadow({ mode: "closed" });
    shadow.innerHTML =
      "<style>" +
      ":host{position:fixed;top:0;right:0;z-index:2147483647;display:flex;height:" + (BOOT.captionHeight || 40) + "px;-webkit-app-region:no-drag}" +
      ":host([data-hidden=true]){display:none}" +
      "button{all:unset;width:46px;height:100%;display:grid;place-items:center;font:10px/1 'Segoe Fluent Icons','Segoe MDL2 Assets';color:#1c1c1e;cursor:default}" +
      ":host([data-dark=true]) button{color:#f2f2f2}" +
      "button:hover{background:rgba(0,0,0,.06)}:host([data-dark=true]) button:hover{background:rgba(255,255,255,.08)}" +
      "button:active{background:rgba(0,0,0,.1)}:host([data-dark=true]) button:active{background:rgba(255,255,255,.12)}" +
      "button.close:hover{background:#c42b1c;color:#fff}button.close:active{background:#c83c31;color:#fff}" +
      ":host([data-active=false]) button:not(:hover){opacity:.45}" +
      "button:focus-visible{outline:2px solid var(--win-accent,#0078d4);outline-offset:-2px}" +
      "</style>" +
      '<button class="min" aria-label="Minimize" title="Minimize"></button>' +
      '<button class="max" aria-label="Maximize" title="Maximize"></button>' +
      '<button class="close" aria-label="Close" title="Close"></button>';
    var max = shadow.querySelector(".max");
    shadow.querySelector(".min").addEventListener("click", function () {
      void desktop("minimize");
    });
    max.addEventListener("click", function () {
      void desktop("toggleMaximize");
    });
    shadow.querySelector(".close").addEventListener("click", function () {
      void desktop("closeWindow");
    });
    host.listen("desktop", "window", function (s) {
      if (!s) return;
      if (typeof s.maximized === "boolean") {
        max.textContent = s.maximized ? "" : "";
        max.setAttribute("aria-label", s.maximized ? "Restore" : "Maximize");
        max.title = s.maximized ? "Restore" : "Maximize";
      }
      if (typeof s.fullscreen === "boolean") hostEl.setAttribute("data-hidden", s.fullscreen ? "true" : "false");
      if (typeof s.focused === "boolean") hostEl.setAttribute("data-active", s.focused ? "true" : "false");
    });
    document.body.appendChild(hostEl);
    captions = hostEl;
    root().style.setProperty("--win-caption-inset", CAPTION_WIDTH - 8 + 6 + "px");
    lastDark = null;
    reportTheme();
  };

  // ---------------------------------------------------------------- moving the window by the page's top bar

  // The page marks its top bars .ui-drag (and its 8 px margin above the panels moves the window too), as for the
  // Mac's -webkit-app-region; here a press there starts the system's own window move, and a double-click maximizes.
  var INTERACTIVE = "a,button,input,textarea,select,label,[role=button],[role=tab],[role=combobox],[role=menuitem],[tabindex],[contenteditable],[popover],dialog,.ui-pop,[role=menu],[role=listbox],[role=dialog],folevi-captions";
  var dragArea = function (e) {
    if (e.button !== 0 || BOOT.window !== "main") return false;
    var t = e.target;
    if (!(t instanceof Element)) return false;
    if (t.closest(INTERACTIVE)) return false;
    if (t.closest(".ui-drag")) return true;
    // The strip above the panels: 8 px in the app, 36 px outside its frame (sign-in, onboarding).
    var strip = document.querySelector(".ui-canvas") ? 8 : 36;
    return e.clientY < strip && (t === document.body || t === root() || !!t.closest(".ui-canvas") && e.clientY < 8);
  };
  document.addEventListener(
    "mousedown",
    function (e) {
      if (!dragArea(e)) return;
      e.preventDefault();
      if (e.detail === 2) void desktop("toggleMaximize");
      else void desktop("drag");
    },
    true,
  );

  // ---------------------------------------------------------------- keys a browser keeps for itself

  // (Apps/desktop keys.ts in the Electron build, the same table.) Tab commands go to the page as menu commands, which
  // opens and closes tabs exactly as the web app does.
  var digit = function (e) {
    var m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code || "");
    if (m) return Number(m[1]);
    return /^[1-9]$/.test(e.key) ? Number(e.key) : null;
  };
  var keyAction = function (e) {
    var mod = BOOT.mac ? e.metaKey : e.ctrlKey;
    var other = BOOT.mac ? e.ctrlKey : e.metaKey;
    var key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (other) return null;
    if (!mod && !e.altKey && !e.shiftKey && key === "F11") return { kind: "fullscreen" };
    if ((!mod && !e.altKey && !e.shiftKey && key === "F12") || (mod && e.shiftKey && !e.altKey && key === "i")) return { kind: "devtools" };
    if (e.altKey && !mod && !e.shiftKey && key === "ArrowLeft") return { kind: "menu", id: "go.back" };
    if (e.altKey && !mod && !e.shiftKey && key === "ArrowRight") return { kind: "menu", id: "go.forward" };
    if (!mod || e.altKey) return null;
    if (key === "Tab") return { kind: "menu", id: e.shiftKey ? "go.previous-tab" : "go.next-tab" };
    if (!e.shiftKey && key === "PageDown") return { kind: "menu", id: "go.next-tab" };
    if (!e.shiftKey && key === "PageUp") return { kind: "menu", id: "go.previous-tab" };
    var n = digit(e);
    if (n !== null && !e.shiftKey) return { kind: "menu", id: "go.tab-" + n };
    if (e.shiftKey) {
      if (key === "t") return { kind: "menu", id: "file.reopen-closed-tab" };
      if (key === "n") return { kind: "new-window" };
      if (key === "w") return { kind: "close-window" };
      if (key === "\\" || key === "|" || e.code === "Backslash") return { kind: "menu", id: "file.tab-overview" };
      return null;
    }
    if (key === "t") return { kind: "menu", id: "file.new-tab" };
    if (key === "w" || key === "F4") return { kind: "menu", id: "file.close-tab" };
    if (key === "p") return { kind: "print" };
    if (key === ",") return { kind: "settings" };
    if (key === "=" || key === "+") return { kind: "zoom", by: 1 };
    if (key === "-") return { kind: "zoom", by: -1 };
    if (key === "0") return { kind: "zoom", by: 0 };
    return null;
  };
  window.addEventListener(
    "keydown",
    function (e) {
      if (BOOT.window === "quickadd") {
        if (e.key === "Escape" && !e.defaultPrevented) {
          void desktop("quickAddClose");
        }
        return;
      }
      var a = keyAction(e);
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      if (a.kind === "menu") sendCommand({ type: "menu", id: a.id });
      else if (a.kind === "print") void printNow();
      else void desktop(a.kind === "new-window" ? "newWindow" : a.kind === "close-window" ? "closeWindow" : a.kind, a.kind === "zoom" ? { by: a.by } : {});
    },
    true,
  );
  // The mouse's Back and Forward buttons.
  window.addEventListener(
    "mouseup",
    function (e) {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        sendCommand({ type: "menu", id: e.button === 3 ? "go.back" : "go.forward" });
      }
    },
    true,
  );

  var start = function () {
    buildCaptions();
    reportTheme();
    var r = root();
    if (r) new MutationObserver(reportTheme).observe(r, { attributes: true, attributeFilter: ["data-theme", "class"] });
    if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", reportTheme);
    void desktop("ready").catch(function () {});
    if (BOOT.probe) {
      var probe = function (when) {
        var r = root();
        var send = function (data) {
          try {
            fetch(origin + "/_probe?" + encodeURIComponent(JSON.stringify(data))).catch(function () {});
          } catch (e) {
            /* development only */
          }
        };
        var text = document.body ? document.body.innerText.replace(/\s+/g, " ").slice(0, 300) : "";
        void desktop("probe", {
          when: when,
          url: location.href,
          desktop: r && r.getAttribute("data-desktop"),
          shell: window.foleviShell ? window.foleviShell.platform : null,
          mode: window.foleviShell ? window.foleviShell.initialMode : null,
          captions: !!captions,
          inset: r ? getComputedStyle(r).getPropertyValue("--win-caption-inset") : "",
          font: document.body ? getComputedStyle(document.body).fontFamily : "",
          text: text,
        }).then(
          function () { send({ when: when, ipc: "ok" }); },
          function (e) { send({ when: when, ipc: "failed", error: String((e && (e.message || e.code)) || e) }); },
        );
        send({ when: when, url: location.href, desktop: r && r.getAttribute("data-desktop"), shell: window.foleviShell ? window.foleviShell.platform : null, tauri: !!window.__TAURI_INTERNALS__, captions: !!captions, text: text.slice(0, 160) });
      };
      setTimeout(function () { probe("5s"); }, 5000);
      window.__foleviProbe = probe;
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
