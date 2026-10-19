// Sticky notes block data: a board of notes and labelled group areas, stored as a JSON string in `props.data`.
//
//   { "v": 1,
//     "notes": [{ "id": "s1", "x": 40, "y": 40, "text": "Faster sign up", "color": "pink", "tags": ["ux"],
//                 "author": "k17abc" }],
//     "groups": [{ "id": "g1", "label": "Ideas", "x": 0, "y": 0, "w": 600, "h": 400 }] }
//
// Coordinates are in an unbounded logical space (the board pans and zooms); x/y is a note's top-left corner.
// A note belongs to the group its centre is in. On the wire `w`/`h` (default STICKY_SIZE), `color` (default
// yellow), `tags`, `author` (the writer's profile id) and `groups` are optional. `stickiesDataIssue` is the
// strict check the server runs on every write; `parseStickies` is the forgiving reader clients use.
import { LIMITS } from "./generated/schema";
import { ITEM_ID_RE, clamp, cleanItemId, cleanText, isNum, isObj, looseDataObject, oneOf, readDataObject, strayKey } from "./blockData";

export const STICKY_COLORS = ["yellow", "orange", "pink", "purple", "blue", "green", "gray"] as const;
export type StickyColor = (typeof STICKY_COLORS)[number];

export interface Sticky {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: StickyColor;
  tags: string[];
  /** Who wrote it (a profile id), when known. */
  author?: string;
}

export interface StickyGroup {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StickiesData {
  v: 1;
  notes: Sticky[];
  groups: StickyGroup[];
}

export const STICKIES_LIMITS = {
  maxNotes: 1000,
  maxGroups: 50,
  maxText: 500,
  maxLabel: 80,
  maxTags: 8,
  maxTagLength: 32,
  maxCoord: 100_000,
  minSize: 80,
  maxSize: 640,
  minGroupSize: 120,
  maxGroupSize: 10_000,
} as const;

export const STICKY_SIZE = 168;
export const STICKIES_DEFAULT_HEIGHT = 440;

const NOTE_KEYS = new Set(["id", "x", "y", "w", "h", "text", "color", "tags", "author"]);
const GROUP_KEYS = new Set(["id", "label", "x", "y", "w", "h"]);
const AUTHOR_RE = /^[A-Za-z0-9_|:-]{1,64}$/;

export const emptyStickies = (): StickiesData => ({ v: 1, notes: [], groups: [] });

/** Why `data` isn't valid sticky notes JSON, or null when it is (the server's check on every write). */
export function stickiesDataIssue(data: string): string | null {
  const { obj, issue } = readDataObject(data, LIMITS.maxStickiesDataLength, ["notes", "groups"], "sticky notes too large");
  if (issue || !obj) return issue;
  const L = STICKIES_LIMITS;
  const { notes, groups } = obj;
  if (!Array.isArray(notes)) return "notes must be an array";
  if (groups !== undefined && !Array.isArray(groups)) return "groups must be an array";
  if (notes.length > L.maxNotes) return "too many notes";
  if ((groups?.length ?? 0) > L.maxGroups) return "too many groups";
  const ids = new Set<string>();
  const coord = (v: unknown) => isNum(v) && Math.abs(v) <= L.maxCoord;
  for (const [i, n] of notes.entries()) {
    if (!isObj(n)) return `note ${i} must be an object`;
    const stray = strayKey(n, NOTE_KEYS);
    if (stray) return `note ${i}: unexpected field ${stray}`;
    if (typeof n.id !== "string" || !ITEM_ID_RE.test(n.id) || ids.has(n.id)) return `note ${i}: invalid id`;
    ids.add(n.id);
    if (!coord(n.x) || !coord(n.y)) return `note ${i}: invalid position`;
    for (const k of ["w", "h"] as const) if (n[k] !== undefined && (!isNum(n[k]) || n[k] < L.minSize || n[k] > L.maxSize)) return `note ${i}: invalid ${k}`;
    if (typeof n.text !== "string" || n.text.length > L.maxText) return `note ${i}: invalid text`;
    if (n.color !== undefined && !oneOf(STICKY_COLORS, n.color)) return `note ${i}: invalid color`;
    if (n.tags !== undefined && (!Array.isArray(n.tags) || n.tags.length > L.maxTags || n.tags.some((t) => typeof t !== "string" || !t.trim() || t.length > L.maxTagLength))) return `note ${i}: invalid tags`;
    if (n.author !== undefined && (typeof n.author !== "string" || !AUTHOR_RE.test(n.author))) return `note ${i}: invalid author`;
  }
  for (const [i, g] of (groups ?? []).entries()) {
    if (!isObj(g)) return `group ${i} must be an object`;
    const stray = strayKey(g, GROUP_KEYS);
    if (stray) return `group ${i}: unexpected field ${stray}`;
    if (typeof g.id !== "string" || !ITEM_ID_RE.test(g.id) || ids.has(g.id)) return `group ${i}: invalid id`;
    ids.add(g.id);
    if (typeof g.label !== "string" || g.label.length > L.maxLabel) return `group ${i}: invalid label`;
    if (!coord(g.x) || !coord(g.y)) return `group ${i}: invalid position`;
    for (const k of ["w", "h"] as const) if (!isNum(g[k]) || g[k] < L.minGroupSize || g[k] > L.maxGroupSize) return `group ${i}: invalid ${k}`;
  }
  return null;
}

/**
 * Forgiving reader for any board-shaped value (stored data, AI output, pasted JSON). Never throws: unusable
 * notes and groups are dropped, numbers clamped, strings trimmed to their limits, duplicate ids renamed.
 * Notes without a position are put in a row under the others.
 */
export function normalizeStickies(input: unknown): StickiesData {
  const out = emptyStickies();
  if (!isObj(input)) return out;
  const L = STICKIES_LIMITS;
  const used = new Set<string>();
  const pos = (v: unknown) => Math.round(clamp(v as number, -L.maxCoord, L.maxCoord));
  const unplaced: Sticky[] = [];
  for (const raw of Array.isArray(input.notes) ? input.notes : []) {
    if (out.notes.length >= L.maxNotes) break;
    if (!isObj(raw)) continue;
    const placed = isNum(raw.x) && isNum(raw.y);
    const note: Sticky = {
      id: cleanItemId(raw.id, used, "s"),
      x: placed ? pos(raw.x) : 0,
      y: placed ? pos(raw.y) : 0,
      w: Math.round(clamp(isNum(raw.w) ? raw.w : STICKY_SIZE, L.minSize, L.maxSize)),
      h: Math.round(clamp(isNum(raw.h) ? raw.h : STICKY_SIZE, L.minSize, L.maxSize)),
      text: cleanText(raw.text, L.maxText),
      color: oneOf(STICKY_COLORS, raw.color) ? raw.color : "yellow",
      tags: [...new Set((Array.isArray(raw.tags) ? raw.tags : []).map((t) => cleanText(t, L.maxTagLength).replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, L.maxTags),
    };
    if (typeof raw.author === "string" && AUTHOR_RE.test(raw.author)) note.author = raw.author;
    out.notes.push(note);
    if (!placed) unplaced.push(note);
  }
  if (unplaced.length) {
    const placed = out.notes.filter((n) => !unplaced.includes(n));
    const top = placed.length ? Math.max(...placed.map((n) => n.y + n.h)) + 40 : 0;
    unplaced.forEach((n, i) => {
      n.x = (i % 6) * (STICKY_SIZE + 24);
      n.y = top + Math.floor(i / 6) * (STICKY_SIZE + 24);
    });
  }
  for (const raw of Array.isArray(input.groups) ? input.groups : []) {
    if (out.groups.length >= L.maxGroups) break;
    if (!isObj(raw) || !isNum(raw.x) || !isNum(raw.y)) continue;
    out.groups.push({
      id: cleanItemId(raw.id, used, "g"),
      label: cleanText(raw.label, L.maxLabel).replace(/\n+/g, " "),
      x: pos(raw.x),
      y: pos(raw.y),
      w: Math.round(clamp(isNum(raw.w) ? raw.w : 480, L.minGroupSize, L.maxGroupSize)),
      h: Math.round(clamp(isNum(raw.h) ? raw.h : 360, L.minGroupSize, L.maxGroupSize)),
    });
  }
  return out;
}

/** Reads stored sticky notes data; anything unusable reads as an empty board (never throws). */
export function parseStickies(data: string | null | undefined): StickiesData {
  return normalizeStickies(looseDataObject(data, LIMITS.maxStickiesDataLength));
}

/** Compact wire JSON (defaults omitted). An empty board serialises to "". */
export function serializeStickies(board: StickiesData): string {
  if (!board.notes.length && !board.groups.length) return "";
  const o: Record<string, unknown> = {
    v: 1,
    notes: board.notes.map((n) => {
      const x: Record<string, unknown> = { id: n.id, x: Math.round(n.x), y: Math.round(n.y), text: n.text };
      if (n.w !== STICKY_SIZE) x.w = Math.round(n.w);
      if (n.h !== STICKY_SIZE) x.h = Math.round(n.h);
      if (n.color !== "yellow") x.color = n.color;
      if (n.tags.length) x.tags = n.tags;
      if (n.author) x.author = n.author;
      return x;
    }),
  };
  if (board.groups.length) o.groups = board.groups.map((g) => ({ id: g.id, label: g.label, x: Math.round(g.x), y: Math.round(g.y), w: Math.round(g.w), h: Math.round(g.h) }));
  return JSON.stringify(o);
}

/** The group a note sits in (its centre inside the area; the smallest when areas overlap), or null. */
export function stickyGroupOf(note: Pick<Sticky, "x" | "y" | "w" | "h">, groups: readonly StickyGroup[]): StickyGroup | null {
  const cx = note.x + note.w / 2;
  const cy = note.y + note.h / 2;
  let best: StickyGroup | null = null;
  for (const g of groups) {
    if (cx < g.x || cx > g.x + g.w || cy < g.y || cy > g.y + g.h) continue;
    if (!best || g.w * g.h < best.w * best.h) best = g;
  }
  return best;
}

/** Notes in reading order (rows top to bottom, then left to right), under their group; ungrouped last. */
export function stickiesByGroup(board: StickiesData): { group: StickyGroup | null; notes: Sticky[] }[] {
  const order = [...board.notes].sort((a, b) => Math.round(a.y / 40) - Math.round(b.y / 40) || a.x - b.x);
  const out: { group: StickyGroup | null; notes: Sticky[] }[] = board.groups.map((group) => ({ group, notes: [] }));
  const loose: Sticky[] = [];
  for (const n of order) {
    const g = stickyGroupOf(n, board.groups);
    if (g) out.find((x) => x.group === g)!.notes.push(n);
    else loose.push(n);
  }
  if (loose.length) out.push({ group: null, notes: loose });
  return out.filter((x) => x.notes.length || x.group?.label);
}

/** All of the board's words, for search. */
export const stickiesText = (board: StickiesData): string =>
  [...board.groups.map((g) => g.label), ...board.notes.flatMap((n) => [n.text, ...n.tags])]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");

const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, " ").trim();
const noteLine = (n: Sticky) => `${oneLine(n.text) || "Empty note"}${n.tags.length ? ` (${n.tags.join(", ")})` : ""}`;

/**
 * Markdown for exports: each group's label in bold over its notes as a bulleted list (tags in brackets),
 * then the notes outside any group. `esc` escapes Markdown; `indent` is the block's own nesting.
 */
export function stickiesToMarkdown(board: StickiesData, esc: (s: string) => string, indent = ""): string[] {
  const lines: string[] = [];
  for (const { group, notes } of stickiesByGroup(board)) {
    if (group) lines.push(`${indent}**${esc(oneLine(group.label) || "Group")}**`, "");
    for (const n of notes) lines.push(`${indent}- ${esc(noteLine(n))}`);
    lines.push("");
  }
  return lines;
}

/** HTML for exports: the same groups and lists. */
export function stickiesToHtml(board: StickiesData, esc: (s: string) => string): string {
  const parts = stickiesByGroup(board).map(({ group, notes }) => `${group ? `<p><strong>${esc(oneLine(group.label) || "Group")}</strong></p>` : ""}${notes.length ? `<ul>${notes.map((n) => `<li>${esc(noteLine(n))}</li>`).join("")}</ul>` : ""}`);
  return parts.length ? `<figure class="stickies">${parts.join("")}</figure>` : "";
}
