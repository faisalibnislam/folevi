// Board operations for the sticky notes editor (StickiesView.tsx): pure functions from one board to the next,
// so every change is one value the history and the merge (useStickiesDoc.ts) can work with. Changes made
// during a gesture patch only what they touch on the current board, so other people's edits that arrive
// meanwhile are never dropped.
import {
  STICKIES_LIMITS,
  STICKY_COLORS,
  STICKY_COLOR_NAMES,
  STICKY_SIZE,
  arrangeStickies,
  cleanTags,
  newStickyId,
  stickiesByGroup,
  stickyFromIdea,
  stickyGroupOf,
  stickyVoteCount,
  type StickiesData,
  type Sticky,
  type StickyBucket,
  type StickyColor,
  type StickyGroup,
  type StickyIdea,
} from "@folevi/editor-schema";

export interface Pt {
  x: number;
  y: number;
}
export interface Rect extends Pt {
  w: number;
  h: number;
}

export interface Selection {
  notes: string[];
  groups: string[];
}
export const NO_SELECTION: Selection = { notes: [], groups: [] };

const GAP = 24;
const L = STICKIES_LIMITS;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const coord = (n: number) => Math.round(clamp(n, -L.maxCoord, L.maxCoord));

export const rectsOverlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The box around some notes or groups, or null. */
export function boxOf(items: readonly Rect[]): Rect | null {
  if (!items.length) return null;
  const x = Math.min(...items.map((i) => i.x));
  const y = Math.min(...items.map((i) => i.y));
  return { x, y, w: Math.max(...items.map((i) => i.x + i.w)) - x, h: Math.max(...items.map((i) => i.y + i.h)) - y };
}

/** The box around the whole board (notes and group areas), or null when it's empty. */
export const boardBounds = (b: StickiesData): Rect | null => boxOf([...b.notes, ...b.groups]);

export function updateNotes(b: StickiesData, ids: readonly string[], fn: (n: Sticky) => Sticky): StickiesData {
  const set = new Set(ids);
  if (!set.size) return b;
  let changed = false;
  const notes = b.notes.map((n) => {
    if (!set.has(n.id)) return n;
    const next = fn(n);
    if (next !== n) changed = true;
    return next;
  });
  return changed ? { ...b, notes } : b;
}

export function updateGroups(b: StickiesData, ids: readonly string[], fn: (g: StickyGroup) => StickyGroup): StickiesData {
  const set = new Set(ids);
  if (!set.size) return b;
  return { ...b, groups: b.groups.map((g) => (set.has(g.id) ? fn(g) : g)) };
}

/** The notes whose centre is in a group area (the group they belong to). */
export const notesInGroup = (b: StickiesData, groupId: string): string[] => b.notes.filter((n) => stickyGroupOf(n, b.groups)?.id === groupId).map((n) => n.id);

/** Where things started when a drag began. */
export interface Origin {
  notes: Map<string, Pt>;
  groups: Map<string, Pt>;
}

/** Moves the dragged notes and groups by (dx, dy) from where they started, on the board as it is now. */
export function moveItems(b: StickiesData, origin: Origin, dx: number, dy: number): StickiesData {
  let next = b;
  if (origin.notes.size) next = { ...next, notes: next.notes.map((n) => (origin.notes.has(n.id) ? { ...n, x: coord(origin.notes.get(n.id)!.x + dx), y: coord(origin.notes.get(n.id)!.y + dy) } : n)) };
  if (origin.groups.size) next = { ...next, groups: next.groups.map((g) => (origin.groups.has(g.id) ? { ...g, x: coord(origin.groups.get(g.id)!.x + dx), y: coord(origin.groups.get(g.id)!.y + dy) } : g)) };
  return next;
}

/** What a drag moves: the chosen notes, and each chosen group with the notes in it. */
export function dragOrigin(b: StickiesData, sel: Selection): Origin {
  const notes = new Map<string, Pt>();
  const groups = new Map<string, Pt>();
  for (const g of b.groups) {
    if (!sel.groups.includes(g.id)) continue;
    groups.set(g.id, { x: g.x, y: g.y });
    for (const id of notesInGroup(b, g.id)) notes.set(id, { x: 0, y: 0 });
  }
  for (const n of b.notes) if (sel.notes.includes(n.id) || notes.has(n.id)) notes.set(n.id, { x: n.x, y: n.y });
  return { notes, groups };
}

/** A note resized from its bottom-right corner (within the limits). */
export const resizeNote = (n: Sticky, w: number, h: number): Sticky => ({ ...n, w: Math.round(clamp(w, L.minSize, L.maxSize)), h: Math.round(clamp(h, L.minSize, L.maxSize)) });
export const resizeGroup = (g: StickyGroup, w: number, h: number): StickyGroup => ({ ...g, w: Math.round(clamp(w, L.minGroupSize, L.maxGroupSize)), h: Math.round(clamp(h, L.minGroupSize, L.maxGroupSize)) });

/**
 * Somewhere near `near` with room for a block of `w` by `h` that covers no note: the spot itself, else the
 * nearest free one on a widening ring around it.
 */
export function freeSpot(b: StickiesData, near: Pt, w: number, h: number): Pt {
  const step = STICKY_SIZE + GAP;
  const fits = (p: Pt) => !b.notes.some((n) => rectsOverlap({ x: p.x - 8, y: p.y - 8, w: w + 16, h: h + 16 }, n));
  const start = { x: Math.round(near.x - w / 2), y: Math.round(near.y - h / 2) };
  if (fits(start)) return start;
  for (let ring = 1; ring <= 12; ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (const p of [
        { x: start.x + i * step, y: start.y + ring * step },
        { x: start.x + ring * step, y: start.y + i * step },
        { x: start.x + i * step, y: start.y - ring * step },
        { x: start.x - ring * step, y: start.y + i * step },
      ]) {
        if (fits(p)) return p;
      }
    }
  }
  const box = boardBounds(b);
  return box ? { x: box.x, y: box.y + box.h + GAP * 2 } : start;
}

/**
 * New notes from ideas, in a tidy grid near `at` where they cover nothing (one row for a few, more for many),
 * written by `author`. Returns the board and the new notes' ids (none past the board's limit).
 */
export function addIdeas(b: StickiesData, ideas: readonly StickyIdea[], at: Pt, author?: string, color?: StickyColor): { board: StickiesData; ids: string[] } {
  const room = L.maxNotes - b.notes.length;
  const list = ideas.slice(0, Math.max(0, room));
  if (!list.length) return { board: b, ids: [] };
  const cols = Math.max(1, Math.min(6, list.length <= 4 ? list.length : Math.ceil(Math.sqrt(list.length * 1.6))));
  const rows = Math.ceil(list.length / cols);
  const step = STICKY_SIZE + GAP;
  const origin = freeSpot(b, at, cols * step - GAP, rows * step - GAP);
  const used = new Set([...b.notes.map((n) => n.id), ...b.groups.map((g) => g.id)]);
  const fresh: Sticky[] = list.map((idea, i) => {
    let id = newStickyId("note");
    while (used.has(id)) id = newStickyId("note");
    used.add(id);
    return stickyFromIdea({ ...idea, color: idea.color ?? color }, id, { x: origin.x + (i % cols) * step, y: origin.y + Math.floor(i / cols) * step }, author);
  });
  return { board: { ...b, notes: [...b.notes, ...fresh] }, ids: fresh.map((n) => n.id) };
}

/** A new labelled group area. */
export function addGroup(b: StickiesData, r: Rect, label = ""): { board: StickiesData; id: string } | null {
  if (b.groups.length >= L.maxGroups) return null;
  const used = new Set([...b.notes.map((n) => n.id), ...b.groups.map((g) => g.id)]);
  let id = newStickyId("group");
  while (used.has(id)) id = newStickyId("group");
  const g: StickyGroup = { id, label: label.slice(0, L.maxLabel), x: coord(r.x), y: coord(r.y), w: Math.round(clamp(r.w, L.minGroupSize, L.maxGroupSize)), h: Math.round(clamp(r.h, L.minGroupSize, L.maxGroupSize)) };
  return { board: { ...b, groups: [...b.groups, g] }, id };
}

/** The board without the chosen notes and group areas (a group's notes stay on the board). */
export function deleteSelection(b: StickiesData, sel: Selection): StickiesData {
  if (!sel.notes.length && !sel.groups.length) return b;
  const notes = new Set(sel.notes);
  const groups = new Set(sel.groups);
  return { ...b, notes: b.notes.filter((n) => !notes.has(n.id)), groups: b.groups.filter((g) => !groups.has(g.id)) };
}

/** Copies of the chosen notes, a little down and to the right, without their votes. */
export function duplicateNotes(b: StickiesData, ids: readonly string[], author?: string): { board: StickiesData; ids: string[] } {
  const chosen = b.notes.filter((n) => ids.includes(n.id)).slice(0, Math.max(0, L.maxNotes - b.notes.length));
  const used = new Set([...b.notes.map((n) => n.id), ...b.groups.map((g) => g.id)]);
  const copies = chosen.map((n) => {
    let id = newStickyId("note");
    while (used.has(id)) id = newStickyId("note");
    used.add(id);
    const copy: Sticky = { ...n, id, x: coord(n.x + GAP), y: coord(n.y + GAP), votes: {} };
    if (author) copy.author = author;
    return copy;
  });
  return { board: { ...b, notes: [...b.notes, ...copies] }, ids: copies.map((n) => n.id) };
}

export const setColor = (b: StickiesData, ids: readonly string[], color: StickyColor) => updateNotes(b, ids, (n) => (n.color === color ? n : { ...n, color }));
export const addTag = (b: StickiesData, ids: readonly string[], tag: string) => updateNotes(b, ids, (n) => (n.tags.includes(tag) || n.tags.length >= L.maxTags ? n : { ...n, tags: cleanTags([...n.tags, tag]) }));
export const removeTag = (b: StickiesData, ids: readonly string[], tag: string) => updateNotes(b, ids, (n) => (n.tags.includes(tag) ? { ...n, tags: n.tags.filter((t) => t !== tag) } : n));

/** Every tag on the board, most used first. */
export function boardTags(b: StickiesData): string[] {
  const counts = new Map<string, number>();
  for (const n of b.notes) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, c) => c[1] - a[1] || a[0].localeCompare(c[0])).map(([t]) => t);
}

export type ArrangeKey = "tidy" | "color" | "tag" | "author" | "votes";

export const ARRANGE_LABEL: Record<ArrangeKey, string> = {
  tidy: "Tidy up",
  color: "By colour",
  tag: "By tag",
  author: "By author",
  votes: "By votes",
};

/**
 * The buckets for arranging: one labelled group area per colour, tag (a note goes under its first), author
 * or vote count (most votes first), or for Tidy up, the board's own groups kept as they are.
 */
export function arrangeBuckets(b: StickiesData, key: ArrangeKey, nameOf: (profileId: string) => string | null): StickyBucket[] {
  const order = stickiesByGroup(b).flatMap((g) => g.notes);
  const bucket = (label: (n: Sticky) => string, sort?: (a: string, c: string) => number): StickyBucket[] => {
    const map = new Map<string, string[]>();
    for (const n of order) {
      const k = label(n);
      map.set(k, [...(map.get(k) ?? []), n.id]);
    }
    const keys = [...map.keys()];
    if (sort) keys.sort(sort);
    return keys.map((k) => ({ label: k, ids: map.get(k)! }));
  };
  switch (key) {
    case "tidy":
      return stickiesByGroup(b).map(({ group, notes }) => ({ label: group ? group.label : null, ids: notes.map((n) => n.id) }));
    case "color": {
      const idx = (c: string) => STICKY_COLORS.findIndex((x) => STICKY_COLOR_NAMES[x] === c);
      return bucket((n) => STICKY_COLOR_NAMES[n.color], (a, c) => idx(a) - idx(c));
    }
    case "tag":
      return bucket(
        (n) => n.tags[0] ?? "No tag",
        (a, c) => (a === "No tag" ? 1 : c === "No tag" ? -1 : 0),
      );
    case "author":
      return bucket(
        (n) => (n.author ? (nameOf(n.author) ?? "Someone") : "Unknown"),
        (a, c) => (a === "Unknown" ? 1 : c === "Unknown" ? -1 : a.localeCompare(c)),
      );
    case "votes": {
      const votes = new Map(order.map((n) => [n.id, stickyVoteCount(n)]));
      const label = (n: number) => (n === 0 ? "No votes" : n === 1 ? "1 vote" : `${n} votes`);
      const counts = [...new Set(votes.values())].sort((a, c) => c - a);
      return counts.map((c) => ({ label: label(c), ids: order.filter((n) => votes.get(n.id) === c).map((n) => n.id) }));
    }
  }
}

/** The board arranged by a key (one undo step for the caller), starting where its content starts. */
export function arrangeBy(b: StickiesData, key: ArrangeKey, nameOf: (profileId: string) => string | null): StickiesData {
  const box = boardBounds(b);
  return arrangeStickies(b, arrangeBuckets(b, key, nameOf), box ? { x: box.x, y: box.y } : undefined);
}

/** A note's text shown on the board: larger when it's short, smaller when it's long. */
export function noteFontSize(n: Pick<Sticky, "text" | "w" | "h">): number {
  const area = (n.w * n.h) / (STICKY_SIZE * STICKY_SIZE);
  const len = n.text.length / Math.max(0.5, area);
  return len <= 24 ? 18 : len <= 60 ? 15.5 : len <= 120 ? 13.5 : 12;
}

// ------------------------------------------------------------------------------------------ history

/** One change of mine: the board before and after it. Undo takes back only what it changed. */
export interface Step {
  before: StickiesData;
  after: StickiesData;
}

export class StickyHistory {
  private past: (Step & { key: string | null; at: number })[] = [];
  private future: Step[] = [];

  push(step: Step, key?: string, now = Date.now()): void {
    const last = this.past[this.past.length - 1];
    if (key && last && last.key === key && now - last.at < 800) {
      last.after = step.after;
      last.at = now;
      return;
    }
    this.past.push({ ...step, key: key ?? null, at: now });
    if (this.past.length > 200) this.past.shift();
    this.future = [];
  }
  undo(): Step | null {
    const s = this.past.pop();
    if (!s) return null;
    this.future.push({ before: s.before, after: s.after });
    return s;
  }
  redo(): Step | null {
    const s = this.future.pop();
    if (!s) return null;
    this.past.push({ ...s, key: null, at: 0 });
    return s;
  }
  clear(): void {
    this.past = [];
    this.future = [];
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
}

/** Initials for an avatar ("Sam Rivera" → "SR"). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = [...parts[0]!][0] ?? "";
  const last = parts.length > 1 ? ([...parts[parts.length - 1]!][0] ?? "") : "";
  return (first + last).toUpperCase();
}
