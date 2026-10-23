// The page's half of the Mac chrome (Chrome/*.swift), placed inside mac-bridge.js's function by WebViewFactory
// (extraScripts), with call, listen, desk, fire, quietly, desktop and BOOT in reach:
// - the drag areas of the page's top bar (.ui-drag, minus what's clickable in it and whatever floats over the
//   page), reported to the app, which moves the window from them (TitleBar.swift; WebKit has no -webkit-app-region);
// - the window's state on <html>: data-fullscreen (present only in full screen), data-window-active,
//   data-keyboard-navigation, data-vibrancy and data-mac-panel (Quick Add's panel, the Settings window), set by the
//   app through window.__foleviChrome;
// - more foleviDesktop members: setMenuState (what the menu bar can do now), closeWindow, and the text services
//   Folevi's own text menu offers (spelling suggestions, learning a word, Look Up), answered natively
//   (TextMenu.swift); Share is foleviDesktop.share (Mac capabilities, Sharing.swift).
(function () {
  var root = function () {
    return document.documentElement;
  };
  var setAttr = function (name, value) {
    var el = root();
    if (!el) return;
    if (value === null || value === undefined || value === "") el.removeAttribute(name);
    else el.setAttribute(name, String(value));
  };
  var apply = function (a) {
    if (!a || typeof a !== "object") return;
    // Present only in full screen (the page's CSS reads [data-fullscreen]); data-fullscreen-native says the app
    // keeps it.
    var el = root();
    if (el) {
      el.setAttribute("data-fullscreen-native", "");
      if (a.fullscreen === true) el.setAttribute("data-fullscreen", "");
      else el.removeAttribute("data-fullscreen");
    }
    setAttr("data-window-active", a.active === false ? "false" : "true");
    setAttr("data-keyboard-navigation", a.keyboard === true ? "true" : null);
    setAttr("data-vibrancy", typeof a.vibrancy === "string" ? a.vibrancy : null);
    setAttr("data-mac-panel", typeof a.panel === "string" ? a.panel : null);
  };
  Object.defineProperty(window, "__foleviChrome", { value: apply, enumerable: false, configurable: false, writable: false });
  var background = !!(BOOT.shell && BOOT.shell.places && BOOT.shell.places.background === true);
  var hello = function () {
    void quietly(desk("chromeHello")).then(apply);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hello, { once: true });
  else hello();

  // The page's own theme (Settings > Appearance can differ from the Mac's): the materials behind it follow it.
  var lastTheme = "";
  var tellTheme = function () {
    var t = root() && root().getAttribute("data-theme");
    if ((t === "dark" || t === "light") && t !== lastTheme) {
      lastTheme = t;
      fire("pageTheme", { theme: t });
    }
  };
  if (!background) {
    var themeWatch = new MutationObserver(tellTheme);
    var watchTheme = function () {
      if (!root()) return;
      themeWatch.observe(root(), { attributes: true, attributeFilter: ["data-theme"] });
      tellTheme();
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watchTheme, { once: true });
    else watchTheme();
  }

  // ---------------------------------------------------------------- drag areas
  var CLICKABLE = 'a, button, input, textarea, select, [role="button"], [role="tab"], [role="combobox"], [role="switch"], [role="checkbox"], [tabindex], [contenteditable=""], [contenteditable="true"]';
  var FLOATING = 'dialog[open], .ui-pop, [role="menu"], [role="listbox"], [role="dialog"], [role="tooltip"], [data-radix-popper-content-wrapper]';
  var box = function (r) {
    return [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10];
  };
  var shown = function (r) {
    return r.width > 0 && r.height > 0;
  };
  var measure = function () {
    var drag = [];
    var noDrag = [];
    var el = root();
    if (!el || !document.body) return { drag: drag, noDrag: noDrag };
    var areas = document.querySelectorAll(".ui-drag");
    for (var i = 0; i < areas.length && drag.length < 200; i++) {
      var r = areas[i].getBoundingClientRect();
      if (!shown(r)) continue;
      drag.push(box(r));
      var inner = areas[i].querySelectorAll(CLICKABLE);
      for (var j = 0; j < inner.length && noDrag.length < 2000; j++) {
        var q = inner[j].getBoundingClientRect();
        if (shown(q)) noDrag.push(box(q));
      }
    }
    // The strip across the window's top (8 px over the app, 36 px over other pages, globals.css), except in
    // Quick Add's panel.
    if (!document.querySelector(".ui-desktop-quick-add")) drag.push([0, 0, window.innerWidth, document.querySelector(".ui-canvas") ? 8 : 36]);
    var floating = [];
    try {
      floating = Array.prototype.slice.call(document.querySelectorAll(FLOATING + ", [popover]:popover-open"));
    } catch (e) {
      floating = Array.prototype.slice.call(document.querySelectorAll(FLOATING));
    }
    for (var k = 0; k < floating.length && noDrag.length < 2000; k++) {
      var f = floating[k].getBoundingClientRect();
      if (shown(f)) noDrag.push(box(f));
    }
    return { drag: drag, noDrag: noDrag };
  };
  var last = "";
  var frame = 0;
  var timer = 0;
  var report = function () {
    if (frame) cancelAnimationFrame(frame);
    if (timer) clearTimeout(timer);
    frame = 0;
    timer = 0;
    var m = measure();
    var key = JSON.stringify(m);
    if (key === last) return;
    last = key;
    fire("dragRegions", m);
  };
  // On the next frame; a window behind others gets no frames, so a timer too (whichever comes first).
  var soon = function () {
    if (!frame) frame = requestAnimationFrame(report);
    if (!timer) timer = setTimeout(report, 120);
  };
  // Typing in a note changes nothing up there: mutations inside an editor don't count.
  var inEditor = function (node) {
    var el = node && (node.nodeType === 1 ? node : node.parentElement);
    return !!(el && el.closest && el.closest('[contenteditable="true"], [contenteditable=""]'));
  };
  if (!background) {
    var watch = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        if (!inEditor(records[i].target)) {
          soon();
          return;
        }
      }
    });
    var start = function () {
      watch.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "open", "hidden", "data-full", "data-state"] });
      soon();
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
    window.addEventListener("resize", soon);
    document.addEventListener("transitionend", soon, true);
    document.addEventListener("animationend", soon, true);
    document.addEventListener("scroll", soon, true);
  }

  // ---------------------------------------------------------------- foleviDesktop: menus and text services
  var strings = function (list, max) {
    return (Array.isArray(list) ? list : []).slice(0, max || 400).map(String);
  };
  var flag = function (v) {
    return v === true ? true : v === false ? false : null;
  };
  /** What the menu bar can do for this page now: { disabled, checked, ai, sidebar, inspector, focus, find, locked, route }. */
  desktop.setMenuState = function (s) {
    var o = s || {};
    fire("setMenuState", {
      disabled: strings(o.disabled),
      checked: strings(o.checked),
      ai: flag(o.ai),
      sidebar: flag(o.sidebar),
      inspector: flag(o.inspector),
      focus: flag(o.focus),
      find: o.find === true,
      locked: flag(o.locked),
      route: typeof o.route === "string" ? o.route.slice(0, 40) : null,
    });
  };
  /** Closes this window (⌘W on the last tab). */
  desktop.closeWindow = function () {
    fire("closeWindow");
  };
  /** Spelling for a word under the pointer: { misspelled, guesses } from the Mac's spell checker. */
  desktop.spelling = function (word) {
    return quietly(desk("spelling", { word: String(word || "").slice(0, 100) })).then(function (r) {
      return r && typeof r.misspelled === "boolean" ? { misspelled: r.misspelled, guesses: strings(r.guesses, 8) } : null;
    });
  };
  /** Adds a word to the Mac's dictionary ("Learn Spelling") or ignores it in this document ("Ignore Spelling"). */
  desktop.learnWord = function (word) {
    fire("learnWord", { word: String(word || "").slice(0, 100) });
  };
  desktop.ignoreWord = function (word) {
    fire("ignoreWord", { word: String(word || "").slice(0, 100) });
  };
  /** Look Up: the Mac's dictionary panel for `text`, at a point in the page (CSS px). */
  desktop.lookUp = function (o) {
    var a = o || {};
    fire("lookUp", { text: String(a.text || "").slice(0, 2000), x: Number(a.x) || 0, y: Number(a.y) || 0 });
  };
})();
