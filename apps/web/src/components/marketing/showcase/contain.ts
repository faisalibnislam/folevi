// The showcase's frames sit in the visitor's page: nothing the app does inside them may move that page. A
// browser's scrollIntoView and focus() scroll every frame up to the top page, so here they scroll only the
// frame's own scroll areas, and focus never scrolls.

function scrollParents(el: Element): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let p = el.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (/(auto|scroll|overlay)/.test(`${s.overflowY}${s.overflowX}`) && (p.scrollHeight > p.clientHeight || p.scrollWidth > p.clientWidth)) out.push(p);
  }
  return out;
}

/** Brings `el` into view inside this frame only (the nearest edge, as "nearest" does). */
export function revealInFrame(el: Element, block: ScrollLogicalPosition = "nearest"): void {
  for (const box of scrollParents(el)) {
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (block === "center" || block === "start") {
      const target = block === "center" ? r.top - b.top - (b.height - r.height) / 2 : r.top - b.top;
      box.scrollTop += target;
    } else if (r.top < b.top) box.scrollTop -= b.top - r.top + 8;
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 8;
    if (r.left < b.left) box.scrollLeft -= b.left - r.left + 8;
    else if (r.right > b.right) box.scrollLeft += r.right - b.right + 8;
  }
}

export function containFrame(): void {
  Element.prototype.scrollIntoView = function (arg?: boolean | ScrollIntoViewOptions) {
    const block = typeof arg === "object" ? (arg.block ?? "start") : arg === false ? "end" : "start";
    revealInFrame(this, block === "end" ? "nearest" : block);
  };
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (opts?: FocusOptions) {
    focus.call(this, { ...opts, preventScroll: true });
  };
  const svgFocus = SVGElement.prototype.focus;
  SVGElement.prototype.focus = function (opts?: FocusOptions) {
    svgFocus.call(this, { ...opts, preventScroll: true });
  };
}
