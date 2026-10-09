// Pointer-driven block drag and drop (docs/DESIGN_SYSTEM.md → "Drag and drop").
//
// Native HTML5 drag images are janky and fragile inside ProseMirror, so dragging is done by hand:
// a lifted copy follows the pointer, an ember line glides between blocks, horizontal movement changes
// nesting, and the page auto-scrolls near its edges. Nothing here mutates ProseMirror's DOM (the
// source fade and the drop glow are injected CSS rules), so the editor never re-parses mid-drag.
import type { Editor } from "@tiptap/core";
import { dropTarget, subtreeRange } from "./commands";
import { blockElements } from "./plugins";

export type DragPayload =
  | { kind: "block"; index: number; /** The last of several selected blocks (their subtrees move too). */ last?: number }
  | { kind: "insert"; label: string; icon?: string };

export interface DropResult {
  index: number;
  depth: number;
}

interface Options {
  editor: Editor;
  payload: DragPayload;
  event: PointerEvent | React.PointerEvent;
  /** Called with the landing spot; returns the new top-level index of what was dropped (for the glow). */
  onDrop: (target: DropResult) => { index: number; count: number } | null;
  onStart?: () => void;
  onEnd?: (dropped: boolean) => void;
}

const THRESHOLD = 4;
/** A finger wobbles more than a mouse: below this a touch on the grip is a tap (it opens the block menu). */
const TOUCH_THRESHOLD = 10;
const EDGE = 64;

let active = false;
/** True while a drag is running (hover affordances hide themselves). */
export function isDragging(): boolean {
  return active;
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  let cur: HTMLElement | null = el.parentElement;
  while (cur) {
    const oy = getComputedStyle(cur).overflowY;
    if ((oy === "auto" || oy === "scroll") && cur.scrollHeight > cur.clientHeight) return cur;
    cur = cur.parentElement;
  }
  return null;
}

let ruleSeq = 0;
function injectRule(css: string): () => void {
  const style = document.createElement("style");
  style.dataset.fbDrag = String(++ruleSeq);
  style.textContent = css;
  document.head.appendChild(style);
  return () => style.remove();
}

function rootSelector(dom: HTMLElement): string {
  const root = dom.closest<HTMLElement>("[data-fb-root]");
  return root ? `[data-fb-root="${CSS.escape(root.dataset.fbRoot!)}"] .fb-editor` : ".fb-editor";
}

/** The ids of a run of top-level blocks. */
function idsOf(editor: Editor, index: number, count: number): string[] {
  const ids: string[] = [];
  for (let i = index; i < index + count && i < editor.state.doc.childCount; i++) {
    const id = editor.state.doc.child(i).attrs.id as string | null;
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * Styles top-level blocks, by id, without touching their DOM. (By position it would drift: comment lines
 * sit between blocks, and a collaborator's edit can shift everything while the rule is up.)
 */
function blocksRule(dom: HTMLElement, ids: string[], body: string): () => void {
  if (!ids.length) return () => {};
  const root = rootSelector(dom);
  const sel = ids.map((id) => `${root} > [data-block-id="${CSS.escape(id)}"]`).join(", ");
  return injectRule(`${sel} { ${body} }`);
}

/** Briefly glows the blocks that just landed. */
export function glowBlocks(editor: Editor, index: number, count: number) {
  const dom = editor.view.dom as HTMLElement;
  const remove = blocksRule(
    dom,
    idsOf(editor, index, count),
    reducedMotion() ? "background: var(--color-ember-soft);" : "animation: fb-drop-glow 700ms var(--motion-easing) both;",
  );
  window.setTimeout(remove, 760);
}

export function beginPointerDrag({ editor, payload, event, onDrop, onStart, onEnd }: Options): void {
  if (event.button !== 0 || active) return;
  const view = editor.view;
  const dom = view.dom as HTMLElement;
  const startX = event.clientX;
  const startY = event.clientY;
  const threshold = event.pointerType === "touch" ? TOUCH_THRESHOLD : THRESHOLD;
  const reduce = reducedMotion();
  const fontSize = parseFloat(getComputedStyle(dom).fontSize) || 16;
  const indent = fontSize * 1.6; // matches `calc(var(--depth) * 1.6em)` in editor.css

  let started = false;
  let ghost: HTMLElement | null = null;
  let line: HTMLElement | null = null;
  let unfade: (() => void) | null = null;
  let raf = 0;
  let px = startX;
  let py = startY;
  let grabDX = 16;
  let grabDY = 16;
  let originRect: DOMRect | null = null;
  let target: DropResult | null = null;
  const scroller = scrollParent(dom);

  // What's being dragged: the block (or selected run of blocks) and everything nested under it. Found by
  // id each time, so an edit from someone else mid-drag doesn't swap in a different block.
  const firstId = payload.kind === "block" ? ((view.state.doc.maybeChild(payload.index)?.attrs.id as string | undefined) ?? null) : null;
  const lastId = payload.kind === "block" ? ((view.state.doc.maybeChild(payload.last ?? payload.index)?.attrs.id as string | undefined) ?? null) : null;
  const findSource = (): { index: number; count: number; depth: number } | null => {
    if (payload.kind !== "block") return null;
    let index = firstId ? -1 : payload.index;
    let last = lastId ? -1 : (payload.last ?? payload.index);
    view.state.doc.forEach((n, _offset, i) => {
      if (firstId && n.attrs.id === firstId) index = i;
      if (lastId && n.attrs.id === lastId) last = i;
    });
    if (index < 0 || last < index || last >= view.state.doc.childCount) return null;
    return { index, count: last - index + subtreeRange(view.state, last).count, depth: Number(view.state.doc.child(index).attrs.depth ?? 0) };
  };
  let source = findSource();

  const buildGhost = () => {
    const g = document.createElement("div");
    g.className = "fb-drag-ghost";
    g.setAttribute("aria-hidden", "true");
    if (payload.kind === "block" && source) {
      const children = blockElements(dom);
      const first = children[source.index];
      originRect = first?.getBoundingClientRect() ?? null;
      const page = dom.closest<HTMLElement>(".fb-page");
      const pageClone = document.createElement("div");
      pageClone.className = "fb-page";
      if (page) {
        pageClone.dataset.font = page.dataset.font ?? "sans";
        pageClone.setAttribute("style", page.getAttribute("style") ?? "");
      }
      const ed = document.createElement("div");
      ed.className = "fb-editor fb-editor-ghost";
      for (let i = source.index; i < source.index + source.count && i < children.length; i++) {
        const c = children[i]!;
        if (c.classList.contains("fb-hidden")) continue;
        const clone = c.cloneNode(true) as HTMLElement;
        clone.style.setProperty("--depth", String(Number(c.dataset.depth ?? 0) - source.depth));
        ed.appendChild(clone);
      }
      pageClone.appendChild(ed);
      g.appendChild(pageClone);
      g.style.width = `${Math.min(dom.getBoundingClientRect().width, 680)}px`;
      if (originRect) {
        grabDX = startX - originRect.left + 12;
        grabDY = startY - originRect.top + 8;
      }
    } else if (payload.kind === "insert") {
      g.classList.add("fb-drag-chip");
      g.textContent = `${payload.icon ? `${payload.icon}  ` : ""}${payload.label}`;
      grabDX = 18;
      grabDY = 18;
    }
    document.body.appendChild(g);
    return g;
  };

  const place = () => {
    if (!ghost) return;
    const tf = reduce ? "" : " rotate(-0.6deg) scale(1.02)";
    ghost.style.transform = `translate3d(${px - grabDX}px, ${py - grabDY}px, 0)${tf}`;
  };

  const measure = () => {
    const children = blockElements(dom);
    const boxes = children.map((c) => {
      const r = c.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, depth: Number(c.dataset.depth ?? 0), hidden: c.classList.contains("fb-hidden") };
    });
    const edRect = dom.getBoundingClientRect();
    // Inserting from the inspector: only while the pointer is over the page column.
    if (payload.kind === "insert" && (px < edRect.left - 96 || px > edRect.right + 96 || py < edRect.top - 48 || py > edRect.bottom + 24)) {
      target = null;
      if (line) line.style.opacity = "0";
      return;
    }
    source = findSource() ?? source;
    const desired =
      payload.kind === "block" && source ? source.depth + Math.round((px - startX) / indent) : Math.floor(Math.max(0, px - edRect.left) / indent);
    const t = dropTarget(boxes, py, desired, source ? { from: source.index, count: source.count } : null);
    target = { index: t.index, depth: t.depth };
    if (line) {
      const left = edRect.left + t.depth * indent;
      line.style.opacity = "1";
      line.style.transform = `translate3d(${left}px, ${t.lineY - 1.5}px, 0)`;
      line.style.width = `${Math.max(48, edRect.right - left)}px`;
    }
  };

  const autoScroll = () => {
    if (!scroller) return;
    const r = scroller.getBoundingClientRect();
    let dy = 0;
    if (py < r.top + EDGE) dy = -Math.ceil(((r.top + EDGE - py) / EDGE) * 18);
    else if (py > r.bottom - EDGE) dy = Math.ceil(((py - (r.bottom - EDGE)) / EDGE) * 18);
    if (dy) scroller.scrollTop += dy;
  };

  const frame = () => {
    raf = 0;
    if (!started) return;
    place();
    autoScroll();
    measure();
    raf = requestAnimationFrame(frame);
  };

  const start = () => {
    started = true;
    active = true;
    onStart?.();
    ghost = buildGhost();
    line = document.createElement("div");
    line.className = `fb-drop-line${reduce ? " fb-drop-line-instant" : ""}`;
    line.setAttribute("aria-hidden", "true");
    document.body.appendChild(line);
    if (source) unfade = blocksRule(dom, idsOf(editor, source.index, source.count), "opacity: 0.35; transition: opacity 120ms;");
    document.documentElement.classList.add("fb-dragging");
    raf = requestAnimationFrame(frame);
  };

  const cleanup = () => {
    active = false;
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onCancel, true);
    window.removeEventListener("keydown", onKey, true);
    document.documentElement.classList.remove("fb-dragging");
    line?.remove();
    unfade?.();
  };

  const finishGhost = (returnHome: boolean) => {
    const g = ghost;
    if (!g) return;
    if (returnHome && originRect && !reduce) {
      g.style.transition = "transform 180ms var(--motion-easing), opacity 180ms";
      g.style.transform = `translate3d(${originRect.left - 12}px, ${originRect.top - 8}px, 0)`;
      g.style.opacity = "0.4";
      window.setTimeout(() => g.remove(), 190);
    } else {
      g.remove();
    }
  };

  function onMove(e: PointerEvent) {
    px = e.clientX;
    py = e.clientY;
    if (!started) {
      if (Math.hypot(px - startX, py - startY) < threshold) return;
      start();
    }
    e.preventDefault();
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function onUp(e: PointerEvent) {
    if (!started) {
      cleanup();
      onEnd?.(false);
      return;
    }
    e.preventDefault();
    measure();
    const t = target;
    cleanup();
    if (t) {
      const landed = onDrop(t);
      finishGhost(!landed);
      if (landed) glowBlocks(editor, landed.index, landed.count);
      onEnd?.(Boolean(landed));
    } else {
      finishGhost(true);
      onEnd?.(false);
    }
  }

  function onCancel() {
    const was = started;
    cleanup();
    if (was) finishGhost(true);
    onEnd?.(false);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape" && started) {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  }

  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onCancel, true);
  window.addEventListener("keydown", onKey, true);
}
