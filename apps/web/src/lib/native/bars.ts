// The room the apps' own bars take over the page: at the top the bar, at the foot the keyboard and the bar on
// it while writing (else the floating tool bars). In the apps the page fills the screen under these, keyboard
// included: the native frame says how much they cover (the editor command "insets"), and the page keeps what
// is being written clear of them, as iOS does for its own text views. Without this the page knew the numbers
// only as padding: a line tapped in the lower half of the screen stayed behind the keyboard, and typing went
// on there unseen until the caret reached the very bottom of the screen.

let bars = { top: 0, bottom: 0 };
let watching = false;
let frame = 0;

/** The bars' room now, in px from the top and the bottom edge of the page. Zero outside the apps. */
export const nativeBars = (): Readonly<{ top: number; bottom: number }> => bars;

/** How far the caret is kept from a bar once the page has scrolled for it. */
const CLEAR = 16;

/**
 * Takes the bars' room from the native frame: written on the root for the stylesheets
 * (--native-inset-top/bottom), kept for the editor's own scrolling (scrollEdges.ts) and for menus
 * (visibleBottom), and when the foot's room grew (the keyboard came up) what is being written is brought
 * back into view.
 */
export function setNativeBars(top: number, bottom: number) {
  const grew = bottom > bars.bottom;
  bars = { top, bottom };
  const root = document.documentElement;
  root.style.setProperty("--native-inset-top", `${top}px`);
  root.style.setProperty("--native-inset-bottom", `${bottom}px`);
  if (!watching) {
    watching = true;
    // As the caret moves (typing in a field of a block, the arrow keys, a tap): the note's own text scrolls
    // itself with these numbers (scrollEdges.ts); this covers every other place text is written.
    document.addEventListener("selectionchange", revealSoon);
  }
  if (grew) revealSoon(true);
}

function revealSoon(field: boolean | Event = false) {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => revealWriting(field === true));
}

/** The nearest element around `node` that scrolls up and down. */
export function scrollerAround(node: Node | null): HTMLElement | null {
  for (let el = node instanceof HTMLElement ? node : (node?.parentElement ?? null); el; el = el.parentElement) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) return el;
  }
  return null;
}

/** Where the caret is on screen in the text being written, or null (no caret, or a range is selected). */
export function caretRect(): DOMRect | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !active.isContentEditable) return null;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed || !active.contains(sel.focusNode)) return null;
  const range = sel.getRangeAt(0).cloneRange();
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
  if (rect && (rect.height || rect.top)) return rect;
  // An empty line has no box of its own: its block's.
  const block = (sel.focusNode instanceof HTMLElement ? sel.focusNode : sel.focusNode?.parentElement)?.closest("p, li, h1, h2, h3, h4, div");
  return block?.getBoundingClientRect() ?? null;
}

/**
 * How far a scroller has to move so `rect` clears the bars (positive: down the page), or 0. `box` is the
 * scroller's place on screen, `height` the page's.
 */
export function scrollToClear(rect: { top: number; bottom: number }, box: { top: number; bottom: number }, height: number, room = bars): number {
  const bottom = Math.min(box.bottom, height - room.bottom);
  const top = Math.max(box.top, room.top);
  if (rect.bottom > bottom) return Math.ceil(rect.bottom - bottom + CLEAR);
  // (Never for something taller than the room there is: its foot is what matters while writing.)
  if (rect.top < top && rect.bottom - rect.top < bottom - top) return Math.floor(rect.top - top - CLEAR);
  return 0;
}

/**
 * Scrolls what is being written clear of the bars: the caret in editable text, or (`field`, when the keyboard
 * has just come up) the focused field itself, such as the title or a table's cell.
 */
export function revealWriting(field = false) {
  if (!bars.top && !bars.bottom) return;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) return;
  const rect = caretRect() ?? (field && !active.isContentEditable ? active.getBoundingClientRect() : null);
  if (!rect) return;
  const scroller = scrollerAround(active);
  if (!scroller) return;
  // At once, not smoothly: a smooth scroll is cut short by the next key.
  const by = scrollToClear(rect, scroller.getBoundingClientRect(), window.innerHeight);
  if (by > 0 || (by < 0 && scroller.scrollTop > 0)) scroller.scrollTop += by;
}
