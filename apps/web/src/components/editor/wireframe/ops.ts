// Pure wireframe edits used by the canvas: adding screens and parts, moving (parts can change screens),
// resizing, deleting, duplicating, aligning, links, snapping with guides, the undo history, and Foli AI
// results placed into the wireframe. Free of React so it can be tested on its own.
import {
  WIREFRAME_FRAME_LABEL,
  WIREFRAME_FRAME_SIZE,
  WIREFRAME_LIMITS,
  WIREFRAME_SCREEN_GAP,
  normalizeWireframe,
  wireframeMargin,
  wireframeNextSpot,
  wireframePartSize,
  type WireItem,
  type WireLink,
  type WireScreen,
  type WireframeComponent,
  type WireframeData,
  type WireframeFrame,
} from "@folevi/editor-schema";
import { FRAME_INSET, frameBox, type Box, type Pt } from "./draw";

export interface Selection {
  screens: string[];
  items: string[];
  links: string[];
}
export const NO_SELECTION: Selection = { screens: [], items: [], links: [] };
export const isEmpty = (s: Selection) => !s.screens.length && !s.items.length && !s.links.length;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** A new id for a screen, part or link (unique inside the wireframe). */
export function wid(prefix: string, wf?: WireframeData): string {
  const taken = wf ? new Set([...wf.screens.map((s) => s.id), ...wf.items.map((i) => i.id), ...wf.links.map((l) => l.id)]) : null;
  for (;;) {
    let s = prefix;
    for (let i = 0; i < 7; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)];
    if (!taken?.has(s)) return s;
  }
}

export const screenOf = (wf: WireframeData, id: string) => wf.screens.find((s) => s.id === id);

/** A part's place on the canvas. */
export function itemBox(wf: WireframeData, it: WireItem): Box {
  const s = screenOf(wf, it.screen);
  return { x: (s?.x ?? 0) + it.x, y: (s?.y ?? 0) + it.y, w: it.w, h: it.h };
}

export function boxOf(boxes: readonly Box[]): Box | null {
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const inside = (p: Pt, b: Box) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
export const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** The screen whose area holds a canvas point (the top-most one). */
export function screenAt(wf: WireframeData, p: Pt, pad = 0): WireScreen | null {
  for (let i = wf.screens.length - 1; i >= 0; i--) {
    const s = wf.screens[i]!;
    if (inside(p, { x: s.x - pad, y: s.y - pad, w: s.w + pad * 2, h: s.h + pad * 2 })) return s;
  }
  return null;
}

// ------------------------------------------------------------------------------------------ adding

/** A new screen of `frame`, right of the others (or at `at`), named "Screen 3" and so on. */
export function addScreen(wf: WireframeData, frame: WireframeFrame, at?: Pt): { doc: WireframeData; id: string } | null {
  if (wf.screens.length >= WIREFRAME_LIMITS.maxScreens) return null;
  const size = WIREFRAME_FRAME_SIZE[frame];
  const right = wf.screens.reduce((x, s) => Math.max(x, frameBox(s).x + frameBox(s).w), -Infinity);
  const inset = FRAME_INSET[frame];
  const x = at ? at.x : Number.isFinite(right) ? right + WIREFRAME_SCREEN_GAP + inset.left : 0;
  const y = at ? at.y : (wf.screens[0]?.y ?? 0);
  const used = new Set(wf.screens.map((s) => s.name));
  let n = wf.screens.length + 1;
  while (used.has(`Screen ${n}`)) n++;
  const screen: WireScreen = { id: wid("s", wf), name: `Screen ${n}`, frame, x: Math.round(x), y: Math.round(y), ...size };
  return { doc: { ...wf, screens: [...wf.screens, screen] }, id: screen.id };
}

/** A new part on a screen: centred on `at` (screen coordinates), or under the parts already there. */
export function addPart(wf: WireframeData, screenId: string, kind: WireframeComponent, at?: Pt, extra: Partial<WireItem> = {}): { doc: WireframeData; id: string } | null {
  const screen = screenOf(wf, screenId);
  if (!screen || wf.items.length >= WIREFRAME_LIMITS.maxItems) return null;
  const size = wireframePartSize(kind, screen);
  const spot = at ? { x: at.x - size.w / 2, y: at.y - size.h / 2 } : wireframeNextSpot(screen, wf.items, size, kind);
  const item: WireItem = {
    id: wid("i", wf),
    screen: screenId,
    kind,
    x: Math.round(clamp(spot.x, 0, screen.w - size.w)),
    y: Math.round(clamp(spot.y, 0, screen.h - size.h)),
    ...size,
    text: "",
    ...extra,
  };
  return { doc: { ...wf, items: [...wf.items, item] }, id: item.id };
}

// ------------------------------------------------------------------------------------------ changing

export function updateItems(wf: WireframeData, ids: readonly string[], patch: (it: WireItem) => WireItem): WireframeData {
  const set = new Set(ids);
  return { ...wf, items: wf.items.map((it) => (set.has(it.id) ? patch(it) : it)) };
}

export function updateScreens(wf: WireframeData, ids: readonly string[], patch: (s: WireScreen) => WireScreen): WireframeData {
  const set = new Set(ids);
  return { ...wf, screens: wf.screens.map((s) => (set.has(s.id) ? patch(s) : s)) };
}

/** A part kept inside its screen (no wider or taller than it, its corner on it). */
export function fitInScreen(it: WireItem, s: Pick<WireScreen, "w" | "h">): WireItem {
  const w = Math.round(clamp(it.w, WIREFRAME_LIMITS.minItem, s.w));
  const h = Math.round(clamp(it.h, WIREFRAME_LIMITS.minItem, s.h));
  return { ...it, w, h, x: Math.round(clamp(it.x, 0, s.w - w)), y: Math.round(clamp(it.y, 0, s.h - h)) };
}

/**
 * Moves parts by (dx, dy) from where they started. A part whose centre ends up over another screen moves
 * onto it; every part stays inside its screen.
 */
export function moveItems(base: WireframeData, origin: ReadonlyMap<string, Pt>, dx: number, dy: number): WireframeData {
  return {
    ...base,
    items: base.items.map((it) => {
      const o = origin.get(it.id);
      if (!o) return it;
      const from = screenOf(base, it.screen);
      if (!from) return it;
      const abs = { x: from.x + o.x + dx, y: from.y + o.y + dy };
      const centre = { x: abs.x + it.w / 2, y: abs.y + it.h / 2 };
      const to = inside(centre, from) ? from : (screenAt(base, centre) ?? from);
      return fitInScreen({ ...it, screen: to.id, x: abs.x - to.x, y: abs.y - to.y }, to);
    }),
  };
}

export function moveScreens(base: WireframeData, origin: ReadonlyMap<string, Pt>, dx: number, dy: number): WireframeData {
  const L = WIREFRAME_LIMITS.maxCoord;
  return { ...base, screens: base.screens.map((s) => (origin.has(s.id) ? { ...s, x: Math.round(clamp(origin.get(s.id)!.x + dx, -L, L)), y: Math.round(clamp(origin.get(s.id)!.y + dy, -L, L)) } : s)) };
}

export type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
export const RESIZE_HANDLES: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** A box resized by dragging a handle by (dx, dy), at least `min` and inside `bounds` when given. */
export function resizeBox(orig: Box, handle: ResizeHandle, dx: number, dy: number, min: number, max: number, bounds?: Box, keepRatio = false): Box {
  let x0 = orig.x;
  let y0 = orig.y;
  let x1 = orig.x + orig.w;
  let y1 = orig.y + orig.h;
  if (handle.includes("w")) x0 = Math.min(x0 + dx, x1 - min);
  if (handle.includes("e")) x1 = Math.max(x1 + dx, x0 + min);
  if (handle.includes("n")) y0 = Math.min(y0 + dy, y1 - min);
  if (handle.includes("s")) y1 = Math.max(y1 + dy, y0 + min);
  if (bounds) {
    x0 = Math.max(bounds.x, x0);
    y0 = Math.max(bounds.y, y0);
    x1 = Math.min(bounds.x + bounds.w, x1);
    y1 = Math.min(bounds.y + bounds.h, y1);
  }
  let w = Math.min(max, x1 - x0);
  let h = Math.min(max, y1 - y0);
  if (keepRatio && orig.w && orig.h) {
    const k = Math.max(w / orig.w, h / orig.h);
    w = Math.min(max, orig.w * k);
    h = Math.min(max, orig.h * k);
  }
  if (handle.includes("w")) x0 = x1 - w;
  if (handle.includes("n")) y0 = y1 - h;
  return { x: Math.round(x0), y: Math.round(y0), w: Math.round(w), h: Math.round(h) };
}

/** A screen's new size: its parts stay inside it. */
export function resizeScreen(base: WireframeData, id: string, box: Box): WireframeData {
  const L = WIREFRAME_LIMITS;
  const s = screenOf(base, id);
  if (!s) return base;
  const next = { ...s, x: box.x, y: box.y, w: Math.round(clamp(box.w, L.minScreen, L.maxScreen)), h: Math.round(clamp(box.h, L.minScreen, L.maxScreen)) };
  // Dragging the left or top edge keeps the parts where they are on the canvas.
  const ox = s.x - next.x;
  const oy = s.y - next.y;
  return {
    ...base,
    screens: base.screens.map((x) => (x.id === id ? next : x)),
    items: base.items.map((it) => (it.screen === id ? fitInScreen({ ...it, x: it.x + ox, y: it.y + oy }, next) : it)),
  };
}

/** A different frame for screens, at that frame's size (a part that no longer fits is brought in). */
export function setFrame(wf: WireframeData, ids: readonly string[], frame: WireframeFrame): WireframeData {
  const set = new Set(ids);
  const screens = wf.screens.map((s) => (set.has(s.id) ? { ...s, frame, ...WIREFRAME_FRAME_SIZE[frame] } : s));
  const byId = new Map(screens.map((s) => [s.id, s]));
  return { ...wf, screens, items: wf.items.map((it) => (set.has(it.screen) ? fitInScreen(it, byId.get(it.screen)!) : it)) };
}

/** Removes the selection: screens with their parts, parts, links, and every link that pointed at them. */
export function deleteSelection(wf: WireframeData, sel: Selection): WireframeData {
  const screens = new Set(sel.screens);
  const items = new Set(sel.items);
  for (const it of wf.items) if (screens.has(it.screen)) items.add(it.id);
  const links = new Set(sel.links);
  return {
    ...wf,
    screens: wf.screens.filter((s) => !screens.has(s.id)),
    items: wf.items.filter((i) => !items.has(i.id)),
    links: wf.links.filter((l) => !links.has(l.id) && !screens.has(l.to) && !screens.has(l.from) && !items.has(l.from)),
  };
}

/**
 * Copies the selection: parts a little down and to the right on their screen; screens (with their parts
 * and the links among them) to the right of everything.
 */
export function duplicate(wf: WireframeData, sel: Selection): { doc: WireframeData; sel: Selection } {
  const L = WIREFRAME_LIMITS;
  let doc = wf;
  const out: Selection = { screens: [], items: [], links: [] };
  const screenIds = sel.screens.filter((id) => screenOf(wf, id)).slice(0, Math.max(0, L.maxScreens - wf.screens.length));
  if (screenIds.length) {
    const right = Math.max(...wf.screens.map((s) => frameBox(s).x + frameBox(s).w));
    const left = Math.min(...screenIds.map((id) => frameBox(screenOf(wf, id)!).x));
    const dx = right + WIREFRAME_SCREEN_GAP - left;
    const map = new Map<string, string>();
    const screens: WireScreen[] = [];
    for (const id of screenIds) {
      const s = screenOf(wf, id)!;
      const nid = wid("s", doc);
      map.set(id, nid);
      screens.push({ ...s, id: nid, x: s.x + dx, name: `${s.name || "Screen"} copy`.slice(0, L.maxName) });
    }
    doc = { ...doc, screens: [...doc.screens, ...screens] };
    const items: WireItem[] = [];
    for (const it of wf.items) {
      if (!map.has(it.screen) || doc.items.length + items.length >= L.maxItems) continue;
      const nid = wid("i", doc);
      map.set(it.id, nid);
      items.push({ ...it, id: nid, screen: map.get(it.screen)! });
    }
    const links: WireLink[] = wf.links.filter((l) => map.has(l.from) && map.has(l.to)).map((l) => ({ id: wid("l", doc), from: map.get(l.from)!, to: map.get(l.to)! }));
    doc = { ...doc, items: [...doc.items, ...items], links: [...doc.links, ...links].slice(0, L.maxLinks) };
    out.screens = screens.map((s) => s.id);
  }
  const itemIds = sel.items.filter((id) => !screenIds.includes(wf.items.find((i) => i.id === id)?.screen ?? ""));
  if (itemIds.length) {
    const copies: WireItem[] = [];
    for (const id of itemIds) {
      const it = wf.items.find((i) => i.id === id);
      const s = it && screenOf(doc, it.screen);
      if (!it || !s || doc.items.length + copies.length >= L.maxItems) continue;
      copies.push(fitInScreen({ ...it, id: wid("i", doc), x: it.x + 16, y: it.y + 16 }, s));
    }
    doc = { ...doc, items: [...doc.items, ...copies] };
    out.items = copies.map((c) => c.id);
  }
  return { doc, sel: out };
}

export type Align = "left" | "center" | "right" | "top" | "middle" | "bottom";

/**
 * Lines parts up: with several, against the group's own edge or centre (on canvas positions); one part
 * goes against its screen's margin or centre.
 */
export function align(wf: WireframeData, ids: readonly string[], how: Align): WireframeData {
  const items = wf.items.filter((i) => ids.includes(i.id));
  if (!items.length) return wf;
  const boxes = new Map(items.map((i) => [i.id, itemBox(wf, i)]));
  let target: Box;
  if (items.length === 1) {
    const s = screenOf(wf, items[0]!.screen)!;
    const m = wireframeMargin(s);
    target = { x: s.x + m, y: s.y + m, w: s.w - m * 2, h: s.h - m * 2 };
  } else target = boxOf([...boxes.values()])!;
  return updateItems(wf, ids, (it) => {
    const b = boxes.get(it.id)!;
    const s = screenOf(wf, it.screen)!;
    let x = b.x;
    let y = b.y;
    if (how === "left") x = target.x;
    if (how === "center") x = target.x + target.w / 2 - b.w / 2;
    if (how === "right") x = target.x + target.w - b.w;
    if (how === "top") y = target.y;
    if (how === "middle") y = target.y + target.h / 2 - b.h / 2;
    if (how === "bottom") y = target.y + target.h - b.h;
    return fitInScreen({ ...it, x: x - s.x, y: y - s.y }, s);
  });
}

/** Spaces three or more parts evenly, across or down. */
export function distribute(wf: WireframeData, ids: readonly string[], axis: "x" | "y"): WireframeData {
  const items = wf.items.filter((i) => ids.includes(i.id));
  if (items.length < 3) return wf;
  const boxes = items.map((i) => ({ it: i, b: itemBox(wf, i) })).sort((a, b) => (axis === "x" ? a.b.x - b.b.x : a.b.y - b.b.y));
  const first = boxes[0]!.b;
  const last = boxes[boxes.length - 1]!.b;
  const span = axis === "x" ? last.x + last.w - first.x : last.y + last.h - first.y;
  const used = boxes.reduce((n, x) => n + (axis === "x" ? x.b.w : x.b.h), 0);
  const gap = (span - used) / (boxes.length - 1);
  let at = axis === "x" ? first.x : first.y;
  const place = new Map<string, number>();
  for (const { it, b } of boxes) {
    place.set(it.id, at);
    at += (axis === "x" ? b.w : b.h) + gap;
  }
  return updateItems(wf, ids, (it) => {
    const s = screenOf(wf, it.screen)!;
    const v = place.get(it.id)!;
    return fitInScreen(axis === "x" ? { ...it, x: v - s.x } : { ...it, y: v - s.y }, s);
  });
}

/** A link from a screen or part to a screen (once; not to its own screen). */
export function addLink(wf: WireframeData, from: string, to: string): { doc: WireframeData; id: string } | null {
  if (from === to || wf.links.length >= WIREFRAME_LIMITS.maxLinks || !screenOf(wf, to)) return null;
  const it = wf.items.find((i) => i.id === from);
  if (it?.screen === to) return null;
  if (!it && !screenOf(wf, from)) return null;
  const dup = wf.links.find((l) => l.from === from && l.to === to);
  if (dup) return { doc: wf, id: dup.id };
  const link: WireLink = { id: wid("l", wf), from, to };
  return { doc: { ...wf, links: [...wf.links, link] }, id: link.id };
}

export function removeLink(wf: WireframeData, from: string, to: string): WireframeData {
  return { ...wf, links: wf.links.filter((l) => !(l.from === from && l.to === to)) };
}

// ------------------------------------------------------------------------------------------ snapping

export interface Guide {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
}

/**
 * Snaps a moving box to lines (edges and centres of other boxes, a screen's edges, centre and margins)
 * within `threshold`, with a guide for each snap; otherwise to a `grid` step.
 */
export function snapBox(moving: Box, lines: { x: number[]; y: number[] }, threshold: number, grid: number, span: { x: [number, number]; y: [number, number] }): { dx: number; dy: number; guides: Guide[] } {
  const guides: Guide[] = [];
  const pick = (axis: "x" | "y") => {
    const pos = axis === "x" ? moving.x : moving.y;
    const size = axis === "x" ? moving.w : moving.h;
    let best: { d: number; at: number } | null = null;
    for (const target of lines[axis]) {
      for (const l of [pos, pos + size / 2, pos + size]) {
        const d = target - l;
        if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: target };
      }
    }
    if (!best) return Math.round(pos / grid) * grid - pos;
    const [a, b] = axis === "x" ? span.y : span.x;
    guides.push({ axis, at: best.at, from: a, to: b });
    return best.d;
  };
  const dx = pick("x");
  const dy = pick("y");
  return { dx, dy, guides };
}

/** The lines a part can snap to on its screen (canvas coordinates): the screen's edges, centre and margins, and its other parts. */
export function itemSnapLines(wf: WireframeData, screen: WireScreen, skip: ReadonlySet<string>): { x: number[]; y: number[] } {
  const m = wireframeMargin(screen);
  const x = [screen.x, screen.x + m, screen.x + screen.w / 2, screen.x + screen.w - m, screen.x + screen.w];
  const y = [screen.y, screen.y + screen.h / 2, screen.y + screen.h];
  for (const it of wf.items) {
    if (it.screen !== screen.id || skip.has(it.id)) continue;
    const b = itemBox(wf, it);
    x.push(b.x, b.x + b.w / 2, b.x + b.w);
    y.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { x, y };
}

/** The lines a screen can snap to: the other screens' edges and centres. */
export function screenSnapLines(wf: WireframeData, skip: ReadonlySet<string>): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  for (const s of wf.screens) {
    if (skip.has(s.id)) continue;
    x.push(s.x, s.x + s.w / 2, s.x + s.w);
    y.push(s.y, s.y + s.h / 2, s.y + s.h);
  }
  return { x, y };
}

// ------------------------------------------------------------------------------------------ Foli AI

/**
 * Puts screens from Foli AI into the wireframe: fresh ids (so nothing collides), checked again by the
 * forgiving reader (never trust the network), and placed from `origin`.
 */
export function placeScreens(wf: WireframeData, incoming: WireframeData, origin: Pt): { doc: WireframeData; ids: string[] } {
  const safe = normalizeWireframe(incoming);
  if (!safe.screens.length) return { doc: wf, ids: [] };
  const room = WIREFRAME_LIMITS.maxScreens - wf.screens.length;
  const b = boxOf(safe.screens.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h })))!;
  const map = new Map<string, string>();
  let doc = wf;
  const screens: WireScreen[] = [];
  for (const s of safe.screens.slice(0, Math.max(0, room))) {
    const id = wid("s", doc);
    map.set(s.id, id);
    screens.push({ ...s, id, x: Math.round(origin.x + s.x - b.x), y: Math.round(origin.y + s.y - b.y) });
  }
  doc = { ...doc, screens: [...doc.screens, ...screens] };
  const items: WireItem[] = [];
  for (const it of safe.items) {
    if (!map.has(it.screen) || doc.items.length + items.length >= WIREFRAME_LIMITS.maxItems) continue;
    const id = wid("i", doc);
    map.set(it.id, id);
    items.push({ ...it, id, screen: map.get(it.screen)! });
  }
  const links = safe.links.filter((l) => map.has(l.from) && map.has(l.to)).map((l) => ({ id: wid("l", doc), from: map.get(l.from)!, to: map.get(l.to)! }));
  doc = { ...doc, items: [...doc.items, ...items], links: [...doc.links, ...links].slice(0, WIREFRAME_LIMITS.maxLinks) };
  return { doc, ids: screens.map((s) => s.id) };
}

/** A screen's parts swapped for Foli AI's refined ones (the screen keeps its place, name and links in). */
export function replaceScreen(wf: WireframeData, screenId: string, incoming: WireframeData): WireframeData {
  const target = screenOf(wf, screenId);
  const safe = normalizeWireframe(incoming);
  const src = safe.screens[0];
  if (!target || !src) return wf;
  const next: WireScreen = { ...target, frame: src.frame, w: src.w, h: src.h };
  const kept = wf.items.filter((i) => i.screen !== screenId);
  const gone = new Set(wf.items.filter((i) => i.screen === screenId).map((i) => i.id));
  let doc: WireframeData = { ...wf, screens: wf.screens.map((s) => (s.id === screenId ? next : s)), items: kept, links: wf.links.filter((l) => !gone.has(l.from)) };
  const items: WireItem[] = [];
  for (const it of safe.items) {
    if (it.screen !== src.id || kept.length + items.length >= WIREFRAME_LIMITS.maxItems) continue;
    items.push(fitInScreen({ ...it, id: wid("i", doc), screen: screenId }, next));
  }
  doc = { ...doc, items: [...doc.items, ...items] };
  return doc;
}

/** One screen and its parts as wireframe JSON (what Foli AI is sent to make variations or refine). */
export function screenData(wf: WireframeData, screenId: string): WireframeData {
  const s = screenOf(wf, screenId);
  return { v: 1, style: wf.style, screens: s ? [s] : [], items: wf.items.filter((i) => i.screen === screenId), links: [] };
}

/** A readable name for a screen ("Sign in", or "Untitled phone screen"). */
export const screenLabel = (s: WireScreen) => s.name.trim() || `Untitled ${WIREFRAME_FRAME_LABEL[s.frame].toLowerCase()} screen`;

// ------------------------------------------------------------------------------------------ history

/**
 * Undo and redo for one wireframe, separate from the note's (the canvas handles ⌘Z while it has focus);
 * cleared when the wireframe changes from outside. Quick edits with the same key (typing, nudging)
 * make one step.
 */
export class WireHistory<T> {
  private past: T[] = [];
  private future: T[] = [];
  private lastKey: string | null = null;
  private lastAt = 0;

  push(before: T, key?: string, now = Date.now()): void {
    if (key && key === this.lastKey && now - this.lastAt < 800) {
      this.lastAt = now;
      return;
    }
    this.past.push(before);
    if (this.past.length > 200) this.past.shift();
    this.future = [];
    this.lastKey = key ?? null;
    this.lastAt = now;
  }
  undo(current: T): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(current);
    this.lastKey = null;
    return prev;
  }
  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    this.lastKey = null;
    return next;
  }
  clear(): void {
    this.past = [];
    this.future = [];
    this.lastKey = null;
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
