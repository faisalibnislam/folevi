// Finds controls whose words or icon sit against the edge of their own hover (or pressed) fill: the owner's
// 2026-11-18 example was the Style panel's "Note theme" row, its words 4 px from the hover's left edge.
// An async function body for the page (mac.mjs eval @apps/mac/scripts/hover-lint.js, or Playwright's evaluate):
// returns the controls on screen now that fail, each with its words, classes, box and insets in CSS px.
//
// A control counts when a :hover rule gives it a background (Tailwind's hover:bg-*, or a rule in globals.css).
// Its content is its words and pictures. The least inset allowed: 6 px at the sides of a control that holds
// words, 3 px for a control that is only an icon, 2 px above and below.
const SIDE = 6, ICON = 3, VERTICAL = 2;
const hover = [];
const walk = (rules, parent) => {
  for (const r of rules) {
    let sel = r.selectorText;
    if (sel && parent) sel = sel.includes("&") ? sel.replace(/&/g, `:is(${parent})`) : `:is(${parent}) ${sel}`;
    if (sel && /:hover/.test(sel) && r.style && (r.style.backgroundColor || r.style.background || r.style.backgroundImage)) {
      for (const part of sel.split(/,(?![^()]*\))/)) {
        if (!/:hover/.test(part)) continue;
        // The element that takes the fill is the selector's last compound: a hover on an ancestor
        // (group-hover) still fills this element.
        hover.push(part.replace(/:hover/g, "").replace(/:is\(\)|:where\(\)/g, "").trim());
      }
    }
    if (r.cssRules && r.cssRules.length) walk(r.cssRules, sel ?? parent);
  }
};
for (const sheet of document.styleSheets) {
  try {
    walk(sheet.cssRules, null);
  } catch {
    // A sheet from another origin.
  }
}
const selectors = [...new Set(hover)].filter((s) => {
  try {
    document.querySelector(s);
    return true;
  } catch {
    return false;
  }
});
const shown = (el) => {
  const r = el.getBoundingClientRect();
  // (Controls scrolled out of sight count too: a panel's lower half is checked without scrolling to it.)
  if (r.width < 2 || r.height < 2) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05;
};
const contentBox = (el) => {
  let box = null;
  const add = (r) => {
    if (r.width < 1 || r.height < 1) return;
    box = box ? { left: Math.min(box.left, r.left), right: Math.max(box.right, r.right), top: Math.min(box.top, r.top), bottom: Math.max(box.bottom, r.bottom) } : { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  };
  let words = false;
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === 3) {
      if (!n.textContent.trim()) continue;
      const host = n.parentElement;
      if (!host || !shown(host) || host.closest(".sr-only")) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) add(r);
      words = true;
    } else if (/^(svg|img|canvas|video)$/i.test(n.tagName) && shown(n)) {
      add(n.getBoundingClientRect());
    } else if (!n.childElementCount && !n.textContent.trim() && shown(n)) {
      // A drawn leaf (a colour swatch, a switch's knob, a dot): a fill, a picture or an edge of its own.
      const cs = getComputedStyle(n);
      const r = n.getBoundingClientRect();
      const drawn = (cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent") || cs.backgroundImage !== "none" || cs.boxShadow !== "none" || parseFloat(cs.borderTopWidth) > 0;
      if (drawn && r.width >= 6 && r.height >= 6 && r.width < el.getBoundingClientRect().width * 0.8) add(r);
    }
  }
  return box ? { ...box, words } : null;
};
const out = [];
const seen = new Set();
for (const sel of selectors) {
  for (const el of document.querySelectorAll(sel)) {
    if (seen.has(el) || !shown(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    // A fill that has no shape of its own to sit against (a whole page section) isn't a control.
    const r = el.getBoundingClientRect();
    if (r.width > 700 || r.height > 200) continue;
    const c = contentBox(el);
    if (!c) continue;
    const left = c.left - r.left, right = r.right - c.right, top = c.top - r.top, bottom = r.bottom - c.bottom;
    const side = c.words ? SIDE : ICON;
    // Clipped words (a truncated label) end at the box's edge by design: only the start side counts then.
    const clipped = cs.overflow !== "visible" || [...el.querySelectorAll("*")].some((d) => getComputedStyle(d).textOverflow === "ellipsis" && d.scrollWidth > d.clientWidth);
    const bad = [];
    if (left < side - 0.5) bad.push(`left ${left.toFixed(1)}`);
    if (right < side - 0.5 && !clipped) bad.push(`right ${right.toFixed(1)}`);
    if (top < VERTICAL - 0.5) bad.push(`top ${top.toFixed(1)}`);
    if (bottom < VERTICAL - 0.5) bad.push(`bottom ${bottom.toFixed(1)}`);
    if (!bad.length) continue;
    out.push({
      what: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50),
      tag: el.tagName.toLowerCase(),
      bad: bad.join(", "),
      box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      cls: String(el.className?.baseVal ?? el.className).slice(0, 160),
    });
  }
}
return out;
