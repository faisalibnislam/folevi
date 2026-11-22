// Core's half of the page's text menu, placed inside mac-bridge.js's function (with desk, fire, quietly and desktop
// in reach) after capabilities.js. The same as today's Folevi chrome-page.js text part: where the last right-click
// landed, so the word's own paragraph goes to the Mac's spell checker (its language picks the guesses) and Learn or
// Ignore Spelling can select the word for WebKit to drop its red underline.
(function () {
  var clicked = null;
  document.addEventListener(
    "contextmenu",
    function (e) {
      clicked = null;
      var r = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
      if (r && r.startContainer && r.startContainer.nodeType === 3) clicked = { node: r.startContainer, offset: r.startOffset };
    },
    true,
  );
  var spot = function () {
    if (clicked && clicked.node.isConnected) return clicked;
    var s = window.getSelection();
    return s && s.anchorNode && s.anchorNode.nodeType === 3 ? { node: s.anchorNode, offset: s.anchorOffset } : null;
  };
  /** About 600 characters of the word's paragraph, or "" when the word isn't in it. */
  var around = function (word) {
    try {
      var at = spot();
      var el = at && at.node.parentElement;
      while (el && el.parentElement && getComputedStyle(el).display.indexOf("inline") === 0) el = el.parentElement;
      if (!el) return "";
      var r = document.createRange();
      r.selectNodeContents(el);
      r.setEnd(at.node, Math.min(at.offset, at.node.length));
      var before = r.toString().length;
      var text = el.textContent || "";
      var from = Math.max(0, before - 300);
      var to = Math.min(text.length, before + 300);
      var piece = text.slice(from, to);
      if (from > 0) piece = piece.replace(/^\S*\s+/, "");
      if (to < text.length) piece = piece.replace(/\s+\S*$/, "");
      return piece.indexOf(word) >= 0 ? piece : "";
    } catch (e) {
      return "";
    }
  };
  var WORD = /[\p{L}\p{N}\p{M}'’-]/u;
  /** Selects `word` where the last right-click landed; true when it is now the selection. */
  var selectWord = function (word) {
    try {
      var s = window.getSelection();
      if (!s || typeof word !== "string" || !word) return false;
      if (s.toString() === word) return true;
      var at = spot();
      if (at) {
        var text = at.node.data;
        var start = Math.min(at.offset, text.length);
        var end = start;
        while (start > 0 && WORD.test(text[start - 1])) start--;
        while (end < text.length && WORD.test(text[end])) end++;
        while (start < end && /['’-]/.test(text[start])) start++;
        while (end > start && /['’-]/.test(text[end - 1])) end--;
        if (text.slice(start, end) === word) {
          s.setBaseAndExtent(at.node, start, at.node, end);
          return true;
        }
      }
      return s.toString().trim() === word;
    } catch (e) {
      return false;
    }
  };
  Object.defineProperty(window, "__foleviSelectWord", { value: selectWord, enumerable: false, configurable: false, writable: false });
  var strings = function (v, max) {
    return Array.isArray(v) ? v.filter(function (x) { return typeof x === "string"; }).slice(0, max) : [];
  };
  desktop.spelling = function (word) {
    var w = String(word || "").slice(0, 100);
    return quietly(desk("spelling", { word: w, context: around(w) })).then(function (r) {
      return r && typeof r.misspelled === "boolean" ? { misspelled: r.misspelled, guesses: strings(r.guesses, 8) } : null;
    });
  };
  desktop.learnWord = function (word) {
    fire("learnWord", { word: String(word || "").slice(0, 100) });
  };
  desktop.ignoreWord = function (word) {
    fire("ignoreWord", { word: String(word || "").slice(0, 100) });
  };
  desktop.lookUp = function (o) {
    var a = o || {};
    fire("lookUp", { text: String(a.text || "").slice(0, 2000), x: Number(a.x) || 0, y: Number(a.y) || 0 });
  };
})();
