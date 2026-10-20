// Sticky notes block data: a board of notes and labelled group areas, stored as a JSON string in `props.data`.
//
//   { "v": 1,
//     "notes": [{ "id": "s1", "x": 40, "y": 40, "text": "Faster sign up", "color": "pink", "tags": ["ux"],
//                 "author": "k17abc", "votes": { "k17abc": 2, "k29xyz": 1 } }],
//     "groups": [{ "id": "g1", "label": "Ideas", "x": 0, "y": 0, "w": 600, "h": 400 }],
//     "voteLimit": 5,
//     "timer": { "total": 300000, "left": 300000, "startedAt": 1792400000000 } }
//
// Coordinates are in an unbounded logical space (the board pans and zooms); x/y is a note's top-left corner.
// A note belongs to the group its centre is in. On the wire `w`/`h` (default STICKY_SIZE), `color` (default
// yellow), `tags`, `author` (the writer's profile id), `votes` (dot votes per profile id), `groups`,
// `voteLimit` (votes each person has on this board, default STICKY_VOTES) and `timer` are optional.
//
// The workshop timer is only data: while it runs, `startedAt` is when it (re)started and `left` the time
// that was left then, so every viewer counts down (stickyTimerLeft) and nothing runs on a server. The editor
// writes and reads `startedAt` in server time (each device learns its clock's offset from the server once per
// session), so viewers agree even when a device's clock is off. Paused, `startedAt` is gone and `left` is
// what's left.
//
// `stickiesDataIssue` is the strict check the server runs on every write; `parseStickies` is the forgiving
// reader clients use. `mergeStickies` folds two people's edits of one board together (votes are per person,
// so they never clash).
import { LIMITS } from "./generated/schema";
import { ITEM_ID_RE, clamp, cleanItemId, cleanText, isNum, isObj, itemId, looseDataObject, oneOf, readDataObject, strayKey } from "./blockData";

export const STICKY_COLORS = ["yellow", "orange", "pink", "purple", "blue", "green", "gray"] as const;
export type StickyColor = (typeof STICKY_COLORS)[number];

/** Names for the colours, as people read them (menus, arranging by colour). */
export const STICKY_COLOR_NAMES: Record<StickyColor, string> = { yellow: "Yellow", orange: "Orange", pink: "Pink", purple: "Purple", blue: "Blue", green: "Green", gray: "Gray" };

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
  /** Dot votes: how many each person (by profile id) put on it. */
  votes: Record<string, number>;
}

export interface StickyGroup {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The workshop timer: `left` ms remained at `startedAt` (running), or `left` ms remain (paused). */
export interface StickyTimer {
  /** What it was set to (with any minutes added), for the progress ring. */
  total: number;
  left: number;
  startedAt?: number;
}

export interface StickiesData {
  v: 1;
  notes: Sticky[];
  groups: StickyGroup[];
  /** Votes each person has on this board. */
  voteLimit: number;
  timer?: StickyTimer;
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
  /** People who can vote on one note. */
  maxVoters: 200,
  /** The most votes a board can give each person. */
  maxVoteLimit: 20,
  /** The longest timer (4 hours). */
  maxTimer: 4 * 3_600_000,
} as const;

export const STICKY_SIZE = 168;
export const STICKIES_DEFAULT_HEIGHT = 440;
/** Votes each person has on a board unless it says otherwise. */
export const STICKY_VOTES = 5;

const NOTE_KEYS = new Set(["id", "x", "y", "w", "h", "text", "color", "tags", "author", "votes"]);
const GROUP_KEYS = new Set(["id", "label", "x", "y", "w", "h"]);
const TIMER_KEYS = new Set(["total", "left", "startedAt"]);
const AUTHOR_RE = /^[A-Za-z0-9_|:-]{1,64}$/;
/** Plausible clock times for a timer's start (2020 to 2100). */
const MIN_TIME = 1_577_836_800_000;
const MAX_TIME = 4_102_444_800_000;

export const emptyStickies = (): StickiesData => ({ v: 1, notes: [], groups: [], voteLimit: STICKY_VOTES });

/** A fresh id for a note ("s…") or a group ("g…") on a board. */
export const newStickyId = (kind: "note" | "group" = "note"): string => itemId(kind === "note" ? "s" : "g");

function votesIssue(votes: unknown): string | null {
  if (!isObj(votes)) return "invalid votes";
  const entries = Object.entries(votes);
  if (entries.length > STICKIES_LIMITS.maxVoters) return "too many voters";
  for (const [who, n] of entries) {
    if (!AUTHOR_RE.test(who)) return "invalid voter";
    if (!isNum(n) || !Number.isInteger(n) || n < 1 || n > STICKIES_LIMITS.maxVoteLimit) return "invalid vote count";
  }
  return null;
}

function timerIssue(t: unknown): string | null {
  if (!isObj(t)) return "timer must be an object";
  if (strayKey(t, TIMER_KEYS)) return "timer: unexpected field";
  const L = STICKIES_LIMITS;
  if (!isNum(t.total) || t.total < 1000 || t.total > L.maxTimer) return "timer: invalid total";
  if (!isNum(t.left) || t.left < 0 || t.left > L.maxTimer) return "timer: invalid time left";
  if (t.startedAt !== undefined && (!isNum(t.startedAt) || t.startedAt < MIN_TIME || t.startedAt > MAX_TIME)) return "timer: invalid start";
  return null;
}

/** Why `data` isn't valid sticky notes JSON, or null when it is (the server's check on every write). */
export function stickiesDataIssue(data: string): string | null {
  const { obj, issue } = readDataObject(data, LIMITS.maxStickiesDataLength, ["notes", "groups", "voteLimit", "timer"], "sticky notes too large");
  if (issue || !obj) return issue;
  const L = STICKIES_LIMITS;
  const { notes, groups } = obj;
  if (!Array.isArray(notes)) return "notes must be an array";
  if (groups !== undefined && !Array.isArray(groups)) return "groups must be an array";
  if (notes.length > L.maxNotes) return "too many notes";
  if ((groups?.length ?? 0) > L.maxGroups) return "too many groups";
  if (obj.voteLimit !== undefined && (!isNum(obj.voteLimit) || !Number.isInteger(obj.voteLimit) || obj.voteLimit < 1 || obj.voteLimit > L.maxVoteLimit)) return "invalid vote limit";
  if (obj.timer !== undefined) {
    const t = timerIssue(obj.timer);
    if (t) return t;
  }
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
    if (n.votes !== undefined) {
      const v = votesIssue(n.votes);
      if (v) return `note ${i}: ${v}`;
    }
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

function cleanVotes(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(raw)) return out;
  let n = 0;
  for (const [who, count] of Object.entries(raw)) {
    if (n >= STICKIES_LIMITS.maxVoters) break;
    if (!AUTHOR_RE.test(who) || !isNum(count)) continue;
    const c = Math.round(clamp(count, 0, STICKIES_LIMITS.maxVoteLimit));
    if (c < 1) continue;
    out[who] = c;
    n++;
  }
  return out;
}

function cleanTimer(raw: unknown): StickyTimer | undefined {
  if (!isObj(raw) || !isNum(raw.total) || !isNum(raw.left)) return undefined;
  const L = STICKIES_LIMITS;
  const total = Math.round(clamp(raw.total, 1000, L.maxTimer));
  const timer: StickyTimer = { total, left: Math.round(clamp(raw.left, 0, L.maxTimer)) };
  if (isNum(raw.startedAt) && raw.startedAt >= MIN_TIME && raw.startedAt <= MAX_TIME) timer.startedAt = Math.round(raw.startedAt);
  return timer;
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
      tags: cleanTags(Array.isArray(raw.tags) ? raw.tags : []),
      votes: cleanVotes(raw.votes),
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
      // A board already reaching the edge of the space puts them at the edge rather than past it.
      n.y = pos(top + Math.floor(i / 6) * (STICKY_SIZE + 24));
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
  if (isNum(input.voteLimit)) out.voteLimit = Math.round(clamp(input.voteLimit, 1, L.maxVoteLimit));
  const timer = cleanTimer(input.timer);
  if (timer) out.timer = timer;
  return out;
}

/** Tags made usable: trimmed, single-spaced, within their limits, without repeats. */
export function cleanTags(tags: readonly unknown[]): string[] {
  const L = STICKIES_LIMITS;
  return [...new Set(tags.map((t) => cleanText(t, L.maxTagLength).replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, L.maxTags);
}

/** Reads stored sticky notes data; anything unusable reads as an empty board (never throws). */
export function parseStickies(data: string | null | undefined): StickiesData {
  return normalizeStickies(looseDataObject(data, LIMITS.maxStickiesDataLength));
}

/** Compact wire JSON (defaults omitted). An empty board serialises to "". */
export function serializeStickies(board: StickiesData): string {
  if (!board.notes.length && !board.groups.length && !board.timer && board.voteLimit === STICKY_VOTES) return "";
  const o: Record<string, unknown> = {
    v: 1,
    notes: board.notes.map((n) => {
      const x: Record<string, unknown> = { id: n.id, x: Math.round(n.x), y: Math.round(n.y), text: n.text };
      if (n.w !== STICKY_SIZE) x.w = Math.round(n.w);
      if (n.h !== STICKY_SIZE) x.h = Math.round(n.h);
      if (n.color !== "yellow") x.color = n.color;
      if (n.tags.length) x.tags = n.tags;
      if (n.author) x.author = n.author;
      const votes = Object.entries(n.votes ?? {}).filter(([, c]) => c > 0);
      if (votes.length) x.votes = Object.fromEntries(votes.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
      return x;
    }),
  };
  if (board.groups.length) o.groups = board.groups.map((g) => ({ id: g.id, label: g.label, x: Math.round(g.x), y: Math.round(g.y), w: Math.round(g.w), h: Math.round(g.h) }));
  if (board.voteLimit !== STICKY_VOTES) o.voteLimit = board.voteLimit;
  if (board.timer) o.timer = { total: Math.round(board.timer.total), left: Math.round(board.timer.left), ...(board.timer.startedAt !== undefined ? { startedAt: Math.round(board.timer.startedAt) } : {}) };
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
const noteLine = (n: Sticky) => {
  const votes = stickyVoteCount(n);
  return `${oneLine(n.text) || "Empty note"}${n.tags.length ? ` (${n.tags.join(", ")})` : ""}${votes ? ` [${votes} ${votes === 1 ? "vote" : "votes"}]` : ""}`;
};

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

// ---------------------------------------------------------------------------------------------------
// Votes and the timer
// ---------------------------------------------------------------------------------------------------

/** All the votes on a note. */
export const stickyVoteCount = (note: Pick<Sticky, "votes">): number => Object.values(note.votes ?? {}).reduce((a, b) => a + b, 0);

/** The votes one person has put on the board. */
export const stickyVotesBy = (board: Pick<StickiesData, "notes">, who: string): number => board.notes.reduce((a, n) => a + (n.votes?.[who] ?? 0), 0);

/** The board with one person's vote on a note added (`delta` 1) or taken back (-1), within their votes. */
export function voteOnSticky(board: StickiesData, noteId: string, who: string, delta: 1 | -1): StickiesData {
  if (!AUTHOR_RE.test(who)) return board;
  const note = board.notes.find((n) => n.id === noteId);
  if (!note) return board;
  const mine = note.votes[who] ?? 0;
  if (delta > 0 && (stickyVotesBy(board, who) >= board.voteLimit || (!mine && Object.keys(note.votes).length >= STICKIES_LIMITS.maxVoters))) return board;
  if (delta < 0 && !mine) return board;
  const votes = { ...note.votes };
  if (mine + delta > 0) votes[who] = mine + delta;
  else delete votes[who];
  return { ...board, notes: board.notes.map((n) => (n === note ? { ...n, votes } : n)) };
}

/** Milliseconds left on the timer at `now` (0 once it has run out). */
export function stickyTimerLeft(timer: StickyTimer | undefined, now: number): number {
  if (!timer) return 0;
  if (timer.startedAt === undefined) return Math.max(0, timer.left);
  return Math.max(0, timer.left - Math.max(0, now - timer.startedAt));
}

/** Whether the timer is counting down at `now` (started, and not run out). */
export const stickyTimerRunning = (timer: StickyTimer | undefined, now: number): boolean => Boolean(timer && timer.startedAt !== undefined && stickyTimerLeft(timer, now) > 0);

/** Whether the timer has run out. */
export const stickyTimerDone = (timer: StickyTimer | undefined, now: number): boolean => Boolean(timer && timer.startedAt !== undefined && stickyTimerLeft(timer, now) === 0);

// ---------------------------------------------------------------------------------------------------
// Merging two people's edits
// ---------------------------------------------------------------------------------------------------

const sameNote = (a: Sticky, b: Sticky) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.text === b.text && a.color === b.color && a.author === b.author && a.tags.join("\u0000") === b.tags.join("\u0000");
const sameGroup = (a: StickyGroup, b: StickyGroup) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.label === b.label;
const sameTimer = (a?: StickyTimer, b?: StickyTimer) => a?.total === b?.total && a?.left === b?.left && a?.startedAt === b?.startedAt;

/** One person's votes on a note from `mine`, everyone else's from `theirs`. */
function mergedVotes(theirs: Record<string, number> | undefined, mine: Record<string, number> | undefined, me: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [who, c] of Object.entries(theirs ?? {})) if (who !== me) out[who] = c;
  const own = mine?.[me];
  if (own) out[me] = own;
  return out;
}

function mergeItems<T extends { id: string }>(base: readonly T[], theirs: readonly T[], mine: readonly T[], same: (a: T, b: T) => boolean): T[] {
  const b = new Map(base.map((x) => [x.id, x]));
  const t = new Map(theirs.map((x) => [x.id, x]));
  const m = new Map(mine.map((x) => [x.id, x]));
  const out: T[] = [];
  const seen = new Set<string>();
  // Their order first (what everyone else sees), then what only I have.
  for (const x of [...theirs, ...mine]) {
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    const was = b.get(x.id);
    const their = t.get(x.id);
    const my = m.get(x.id);
    if (their && my) {
      // Changed here: mine; otherwise theirs (they may have changed it).
      out.push(was && same(was, my) ? their : my);
    } else if (their) {
      // Deleted here: gone, unless they changed it since (then their change is kept).
      if (was && same(was, their)) continue;
      out.push(their);
    } else if (my) {
      // Deleted there: gone, unless I changed it since; new here: kept.
      if (was && same(was, my)) continue;
      out.push(my);
    }
  }
  return out;
}

/**
 * Folds two versions of a board edited from the same `base` into one: the server's (`theirs`) and this
 * person's (`mine`, `me` their profile id). Notes and groups are merged one by one (a change on one side
 * wins over no change on the other; on both, mine wins; a delete wins over no change), votes are taken per
 * person (mine for `me`, theirs for everyone else), and the timer and vote limit follow whoever changed them.
 */
export function mergeStickies(base: StickiesData, theirs: StickiesData, mine: StickiesData, me: string): StickiesData {
  const notes = mergeItems(base.notes, theirs.notes, mine.notes, sameNote).map((n) => {
    const their = theirs.notes.find((x) => x.id === n.id);
    const my = mine.notes.find((x) => x.id === n.id);
    return { ...n, votes: mergedVotes(their?.votes, my?.votes, me) };
  });
  const out: StickiesData = {
    v: 1,
    notes: notes.slice(0, STICKIES_LIMITS.maxNotes),
    groups: mergeItems(base.groups, theirs.groups, mine.groups, sameGroup).slice(0, STICKIES_LIMITS.maxGroups),
    voteLimit: mine.voteLimit !== base.voteLimit ? mine.voteLimit : theirs.voteLimit,
  };
  const timer = sameTimer(mine.timer, base.timer) ? theirs.timer : mine.timer;
  if (timer) out.timer = timer;
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Lists of ideas: bulk add, pasting, and boards made from text (Foli AI chat, MCP, ```stickies fences)
// ---------------------------------------------------------------------------------------------------

/** One idea for a new note. */
export interface StickyIdea {
  text: string;
  color?: StickyColor;
  tags?: string[];
}

const LIST_MARK = /^\s*(?:[-*+•▪◦‣]\s+|\d{1,3}[.)]\s+|\[[ xX]?\]\s+|-\s\[[ xX]?\]\s+)/;
const COLOR_MARK = new RegExp(`^\\[(${STICKY_COLORS.join("|")})\\]\\s*`, "i");
const TAG_TAIL = /(?:\s+#([\p{L}\p{N}_-]{1,32}))+\s*$/u;

/**
 * One idea from a line of text: list markers dropped, a leading "[pink]" read as the colour and trailing
 * "#tags" as tags. Null for a blank line.
 */
export function stickyIdeaFromLine(line: string): StickyIdea | null {
  let text = cleanText(line, 2000).replace(/\t+/g, " ").trim();
  text = text.replace(LIST_MARK, "");
  const idea: StickyIdea = { text: "" };
  const color = COLOR_MARK.exec(text);
  if (color) {
    idea.color = color[1]!.toLowerCase() as StickyColor;
    text = text.slice(color[0].length);
  }
  const tail = TAG_TAIL.exec(text);
  if (tail && tail.index > 0) {
    idea.tags = cleanTags(tail[0].trim().split(/\s+/).map((t) => t.replace(/^#/, "")));
    text = text.slice(0, tail.index);
  }
  idea.text = text.trim().slice(0, STICKIES_LIMITS.maxText);
  return idea.text ? idea : null;
}

/** Cells of a pasted spreadsheet row (tab-separated, as Sheets, Excel and Numbers copy them). */
const cellsOf = (row: string) => row.split("\t").map((c) => c.replace(/^"(.*)"$/s, "$1").replace(/""/g, '"').trim());

/**
 * Ideas from typed or pasted text: one per line (a bulleted or numbered list, plain lines), or one per row
 * of a pasted spreadsheet (its cells joined; a cell naming a colour colours the note). At most `max`.
 */
export function stickyIdeasFromText(text: string, max = 200): StickyIdea[] {
  const rows = text.replace(/\r\n?/g, "\n").split("\n");
  const sheet = rows.filter((r) => r.trim()).some((r) => r.includes("\t"));
  const out: StickyIdea[] = [];
  for (const row of rows) {
    if (out.length >= max) break;
    if (!row.trim()) continue;
    if (sheet) {
      const cells = cellsOf(row).filter(Boolean);
      const color = cells.find((c) => oneOf(STICKY_COLORS, c.toLowerCase()));
      const words = cells.filter((c) => c !== color);
      const idea = stickyIdeaFromLine(words.join(" · "));
      if (!idea) continue;
      if (color && !idea.color) idea.color = color.toLowerCase() as StickyColor;
      out.push(idea);
    } else {
      const idea = stickyIdeaFromLine(row);
      if (idea) out.push(idea);
    }
  }
  return out;
}

/** Spacing for laid-out boards. */
const GAP = 24;
const GROUP_PAD = 24;
const GROUP_HEAD = 44;
const GROUP_GAP = 56;
const GROUPS_PER_ROW = 4;

/** A bucket of notes for arranging: a labelled group area (label null: no area) holding those notes. */
export interface StickyBucket {
  label: string | null;
  ids: string[];
}

/**
 * The board with its notes arranged into labelled group areas, one per bucket, side by side (four to a
 * row), each a tidy grid; notes in no bucket go in a grid under them. Earlier group areas are replaced.
 * `origin` is the top-left corner of the arrangement (default: where the board's notes start).
 */
export function arrangeStickies(board: StickiesData, buckets: readonly StickyBucket[], origin?: { x: number; y: number }): StickiesData {
  const byId = new Map(board.notes.map((n) => [n.id, n]));
  const placed = new Map<string, { x: number; y: number }>();
  const groups: StickyGroup[] = [];
  const used = new Set(board.notes.map((n) => n.id));
  const start = origin ?? (board.notes.length ? { x: Math.min(...board.notes.map((n) => n.x)), y: Math.min(...board.notes.map((n) => n.y)) } : { x: 0, y: 0 });
  let x = start.x;
  let y = start.y;
  let rowHeight = 0;
  let inRow = 0;
  const taken = new Set<string>();
  for (const bucket of buckets) {
    const notes = bucket.ids.map((id) => byId.get(id)).filter((n): n is Sticky => Boolean(n) && !taken.has(n!.id));
    if (!notes.length) continue;
    notes.forEach((n) => taken.add(n.id));
    const cell = { w: Math.max(...notes.map((n) => n.w)), h: Math.max(...notes.map((n) => n.h)) };
    const cols = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(notes.length))));
    const rows = Math.ceil(notes.length / cols);
    const labelled = bucket.label !== null && groups.length < STICKIES_LIMITS.maxGroups;
    const head = labelled ? GROUP_HEAD : 0;
    const pad = labelled ? GROUP_PAD : 0;
    const w = Math.max(STICKIES_LIMITS.minGroupSize, pad * 2 + cols * cell.w + (cols - 1) * GAP);
    const h = Math.max(STICKIES_LIMITS.minGroupSize, head + pad + rows * cell.h + (rows - 1) * GAP + pad);
    if (inRow >= GROUPS_PER_ROW) {
      x = start.x;
      y += rowHeight + GROUP_GAP;
      rowHeight = 0;
      inRow = 0;
    }
    if (labelled) groups.push({ id: cleanItemId(undefined, used, "g"), label: cleanText(bucket.label, STICKIES_LIMITS.maxLabel).replace(/\n+/g, " "), x, y, w: Math.min(w, STICKIES_LIMITS.maxGroupSize), h: Math.min(h, STICKIES_LIMITS.maxGroupSize) });
    notes.forEach((n, i) => placed.set(n.id, { x: x + pad + (i % cols) * (cell.w + GAP), y: y + head + pad + Math.floor(i / cols) * (cell.h + GAP) }));
    x += w + GROUP_GAP;
    rowHeight = Math.max(rowHeight, h);
    inRow++;
  }
  // The rest, in a grid under the arrangement (in reading order).
  const rest = [...board.notes].filter((n) => !taken.has(n.id)).sort((a, b) => Math.round(a.y / 40) - Math.round(b.y / 40) || a.x - b.x);
  if (rest.length) {
    const top = taken.size ? y + rowHeight + GROUP_GAP : start.y;
    rest.forEach((n, i) => placed.set(n.id, { x: start.x + (i % 6) * (STICKY_SIZE + GAP), y: top + Math.floor(i / 6) * (STICKY_SIZE + GAP) }));
  }
  const clampPos = (v: number) => Math.round(clamp(v, -STICKIES_LIMITS.maxCoord, STICKIES_LIMITS.maxCoord));
  return {
    ...board,
    groups,
    notes: board.notes.map((n) => {
      const p = placed.get(n.id);
      return p ? { ...n, x: clampPos(p.x), y: clampPos(p.y) } : n;
    }),
  };
}

/** A note from an idea (default size; placed by the caller). */
export function stickyFromIdea(idea: StickyIdea, id: string, at: { x: number; y: number }, author?: string): Sticky {
  const note: Sticky = {
    id,
    x: Math.round(at.x),
    y: Math.round(at.y),
    w: STICKY_SIZE,
    h: STICKY_SIZE,
    text: cleanText(idea.text, STICKIES_LIMITS.maxText),
    color: oneOf(STICKY_COLORS, idea.color) ? idea.color : "yellow",
    tags: cleanTags(idea.tags ?? []),
    votes: {},
  };
  if (author && AUTHOR_RE.test(author)) note.author = author;
  return note;
}

/**
 * A new board from ideas, laid out: groups of ideas in labelled areas side by side, loose ideas in a grid
 * under them. Notes are coloured per group when the ideas don't say (so themes read at a glance).
 */
export function stickiesFromIdeas(input: { groups?: readonly { label: string; ideas: readonly StickyIdea[] }[]; ideas?: readonly StickyIdea[] }, author?: string): StickiesData {
  const board = emptyStickies();
  const used = new Set<string>();
  const buckets: StickyBucket[] = [];
  const add = (idea: StickyIdea, fallback: StickyColor) => {
    if (board.notes.length >= STICKIES_LIMITS.maxNotes) return null;
    const note = stickyFromIdea({ ...idea, color: idea.color ?? fallback }, cleanItemId(undefined, used, "s"), { x: 0, y: 0 }, author);
    if (!note.text.trim()) return null;
    board.notes.push(note);
    return note.id;
  };
  (input.groups ?? []).forEach((g, i) => {
    const color = STICKY_COLORS[i % (STICKY_COLORS.length - 1)]!;
    const ids = g.ideas.map((idea) => add(idea, color)).filter((id): id is string => Boolean(id));
    if (ids.length) buckets.push({ label: cleanText(g.label, STICKIES_LIMITS.maxLabel).trim() || "Group", ids });
  });
  for (const idea of input.ideas ?? []) add(idea, "yellow");
  return arrangeStickies(board, buckets, { x: 0, y: 0 });
}

/**
 * A board from the body of a ```stickies fence: one idea per line ("[pink]" first for a colour, "#tags"
 * last), and "## Label" lines starting a labelled group. Lines before any heading are loose notes.
 */
export function stickiesFromFence(body: string, author?: string): StickiesData {
  const groups: { label: string; ideas: StickyIdea[] }[] = [];
  const ideas: StickyIdea[] = [];
  let current: { label: string; ideas: StickyIdea[] } | null = null;
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      current = { label: heading[1]!.trim(), ideas: [] };
      groups.push(current);
      continue;
    }
    const idea = stickyIdeaFromLine(line);
    if (!idea) continue;
    (current ? current.ideas : ideas).push(idea);
  }
  return stickiesFromIdeas({ groups: groups.filter((g) => g.ideas.length), ideas }, author);
}
