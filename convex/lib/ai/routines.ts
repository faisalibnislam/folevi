// Foli AI routines (convex/routines.ts has the schedule and the jobs): the two kinds, their defaults, what
// each reads, the requests they make, the credit estimate and the monthly cap's period. Pure, so it's tested
// without a clock or a database.
//
//   morning:   Morning brief, daily at an hour. Today's and overdue to-dos, notes other people changed and
//              their new comments since the last one, written up by the main model in under 200 words.
//   openLoops: Open loops, weekly on a day at an hour. At most 7 items found without AI (old open to-dos,
//              overdue ones, questions left in notes, contradictions from the graph), each citing its block;
//              the fast model only writes a short intro that puts them in order.
//
// The cap's period is the calendar month on the person's clock (their time zone): "2026-10". Credits a run
// really cost (after it settles) are added to it; a new month starts from zero.
import type { PlannedCall } from "../credits";
import type { GenerateRequest } from "./provider";
import { localParts, safeZone, type DigestSchedule } from "./digest";
import { untrusted, UNTRUSTED_RULE } from "./tools/untrusted";

export type RoutineKind = "morning" | "openLoops";
export const ROUTINE_KINDS: RoutineKind[] = ["morning", "openLoops"];

/** What the person sees each one called. */
export const ROUTINE_NAMES: Record<RoutineKind, string> = { morning: "Morning brief", openLoops: "Open loops" };

/** The schedule a routine starts with: the brief at 08:00, open loops on Monday at 09:00. */
export const ROUTINE_DEFAULTS: Record<RoutineKind, { hour: number; weekday: number }> = { morning: { hour: 8, weekday: 1 }, openLoops: { hour: 9, weekday: 1 } };

/** The monthly credit limits a person can pick, and the one a routine starts with. */
export const CAP_CHOICES = [10, 30, 60, 100] as const;
export const DEFAULT_CAP = 30;

/** The most runs a routine can make in a month (every day, or every week). */
export const RUNS_PER_MONTH: Record<RoutineKind, number> = { morning: 31, openLoops: 5 };

/** Only Pro and Pro AI include routines (a Pro AI trial counts as Pro AI). */
export const routineTier = (tier: string) => tier === "pro" || tier === "pro_ai";
export const PLAN_NOTE = "Routines are part of Pro and Pro AI.";

/** A routine's schedule in the digest's terms (lib/ai/digest.ts nextDigestAt). */
export const routineSchedule = (kind: RoutineKind, hour: number, weekday: number): DigestSchedule => ({ frequency: kind === "morning" ? "daily" : "weekly", hour, weekday });

/** The cap's period at `at`: the month on the person's clock ("2026-10"). */
export function periodKey(at: number, timeZone: string): string {
  const p = localParts(at, safeZone(timeZone));
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

/** Credits a routine spent in `period` (a stored spend from an earlier month counts as nothing). */
export const spentIn = (spend: { period: string; credits: number } | undefined, period: string) => (spend?.period === period ? spend.credits : 0);

/** The first day of the month after `period`: "1 November". */
export function nextPeriodLabel(period: string, locale = "en-GB"): string {
  const [y, m] = period.split("-").map(Number);
  const at = Date.UTC(y!, m!, 1);
  try {
    return new Date(at).toLocaleDateString(locale || "en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
  } catch {
    return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
  }
}

/** A routine note's title: "Morning brief, 14 Oct". */
export function routineTitle(kind: RoutineKind, at: number, timeZone: string, locale = "en-GB"): string {
  let day: string;
  try {
    day = new Date(at).toLocaleDateString(locale || "en-GB", { day: "numeric", month: "short", timeZone: safeZone(timeZone) });
  } catch {
    day = new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  }
  return `${ROUTINE_NAMES[kind]}, ${day}`;
}

/** Where a block opens in the app (DocumentView scrolls to `#block-<id>`). */
export const blockHref = (notePublicId: string, blockId: string) => `/d/${notePublicId}#block-${blockId}`;

// ---------------------------------------------------------------------------------------------------
// Morning brief
// ---------------------------------------------------------------------------------------------------

/** Most of each kind a brief reads (it stays small and cheap whatever happened). */
export const MORNING_LIMITS = { tasks: 15, notes: 10, noteChars: 500, comments: 12, commentChars: 240 } as const;

export interface MorningMaterial {
  today: string;
  /** Open to-dos due today or before. */
  tasks: { title: string; due: string; note: string; overdue: boolean }[];
  /** Notes someone else changed since the last brief. */
  changed: { id: string; title: string; text: string; by: string }[];
  comments: { note: string; author: string; text: string }[];
}

/** Nothing to tell: no brief, nothing spent. */
export const morningEmpty = (m: MorningMaterial) => !m.tasks.length && !m.changed.length && !m.comments.length;

export const MORNING_SYSTEM = [
  "You are Foli AI, writing someone's short morning brief in a calm note-taking app. Write to them as 'you'.",
  "Be concrete and brief. Only say what the material below says; never invent tasks, dates or people.",
  "Format with simple Markdown: '##' section headings, '-' bullets, **bold** note titles. No tables, no HTML, no greeting or sign-off.",
  UNTRUSTED_RULE,
].join(" ");

const MORNING_OUTPUT = 800;

/** The credits held for a brief: one call reading everything at its largest. */
export const MORNING_PLAN: PlannedCall[] = [
  {
    fast: false,
    inputChars: MORNING_SYSTEM.length + 1_000 + MORNING_LIMITS.tasks * 300 + MORNING_LIMITS.notes * (MORNING_LIMITS.noteChars + 160) + MORNING_LIMITS.comments * (MORNING_LIMITS.commentChars + 140),
    maxOutputTokens: MORNING_OUTPUT,
  },
];

/** The request for a morning brief. */
export function morningRequest(m: MorningMaterial): GenerateRequest {
  const tasks = m.tasks.map((t) => untrusted("note", { note: t.note, due: t.due, ...(t.overdue ? { overdue: "yes" } : {}) }, t.title.replace(/\s+/g, " "))).join("\n");
  const changed = m.changed.map((n) => untrusted("note", { title: n.title, changed_by: n.by }, n.text)).join("\n\n");
  const comments = m.comments.map((c) => untrusted("note", { note: c.note, comment_by: c.author }, c.text)).join("\n");
  return {
    system: MORNING_SYSTEM,
    prompt: [
      `Today is ${m.today}.`,
      `<due_tasks>\n${tasks || "(none)"}\n</due_tasks>`,
      `<changed_by_others>\n${changed || "(none)"}\n</changed_by_others>`,
      `<new_comments>\n${comments || "(none)"}\n</new_comments>`,
      "Write the brief: '## Today' with the to-dos due today and the overdue ones (overdue first, say so), then '## Changed by others' with who changed which note and what changed, then '## Comments' with what people said. Leave out a section that has nothing in it. Under 200 words.",
    ].join("\n\n"),
    temperature: 0.3,
    maxOutputTokens: MORNING_OUTPUT,
  };
}

// ---------------------------------------------------------------------------------------------------
// Open loops
// ---------------------------------------------------------------------------------------------------

/** The most items an Open loops note lists, and the most of each kind looked at. */
export const MAX_LOOPS = 7;
/** An open to-do older than this is a loop. */
export const STALE_TODO_MS = 7 * 24 * 60 * 60_000;
/** Questions are looked for in notes the person edited this recently. */
export const QUESTION_WINDOW_MS = 30 * 24 * 60 * 60_000;
export const LOOP_TEXT_CHARS = 200;

export type LoopKind = "overdue" | "stale" | "question" | "contradiction";

export interface LoopItem {
  kind: LoopKind;
  noteId: string;
  noteTitle: string;
  blockId: string;
  /** The line itself (cut short). */
  text: string;
  /** A few words on why it's here: "due 2026-10-01", "open since 2026-10-01". */
  detail: string;
}

/** A line of note text as one short line. */
export const loopText = (s: string) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > LOOP_TEXT_CHARS ? `${one.slice(0, LOOP_TEXT_CHARS - 3).trimEnd()}...` : one;
};

/** Blocks whose text can be a question left in a note (lib/ai/suggestions.ts reads the same ones). */
export const PROSE_BLOCKS = new Set(["paragraph", "bulleted", "numbered", "quote", "callout", "toggle"]);

/** A line that asks something: three words or more, ending with a question mark. */
export const isQuestion = (s: string) => /\?\s*$/.test(s) && s.trim().split(/\s+/).length >= 3;

/**
 * Up to `max` items, taking one of each kind in turn (overdue, old, contradictions, questions) so no kind
 * crowds out the rest. A block listed once isn't listed again.
 */
export function pickLoops(lists: LoopItem[][], max = MAX_LOOPS): LoopItem[] {
  const out: LoopItem[] = [];
  const seen = new Set<string>();
  const queues = lists.map((l) => [...l]);
  while (out.length < max && queues.some((q) => q.length)) {
    for (const q of queues) {
      if (out.length >= max) break;
      while (q.length) {
        const item = q.shift()!;
        const key = `${item.noteId}/${item.blockId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
        break;
      }
    }
  }
  return out;
}

export const OPEN_LOOPS_SYSTEM = [
  "You are Foli AI, writing a short weekly look at someone's open loops in a calm note-taking app. Write to them as 'you'.",
  "Write 2 to 4 plain sentences of prose that say which items matter most and why, in order of priority. No headings, no lists, no greeting or sign-off.",
  "Only use what the items say; never invent tasks, dates or people.",
  UNTRUSTED_RULE,
].join(" ");

const OPEN_LOOPS_OUTPUT = 300;

/** The credits held for Open loops: one short call on the fast model. */
export const OPEN_LOOPS_PLAN: PlannedCall[] = [{ fast: true, inputChars: OPEN_LOOPS_SYSTEM.length + 600 + MAX_LOOPS * (LOOP_TEXT_CHARS + 260), maxOutputTokens: OPEN_LOOPS_OUTPUT }];

const LOOP_KIND_LABELS: Record<LoopKind, string> = { overdue: "overdue to-do", stale: "old open to-do", question: "open question", contradiction: "contradiction" };

/** The request for Open loops' intro (the list itself is written without AI). */
export function openLoopsRequest(today: string, items: LoopItem[]): GenerateRequest {
  const list = items.map((it, i) => untrusted("note", { item: String(i + 1), kind: LOOP_KIND_LABELS[it.kind], note: it.noteTitle, detail: it.detail }, it.text)).join("\n");
  return {
    system: OPEN_LOOPS_SYSTEM,
    prompt: [`Today is ${today}.`, `<open_loops>\n${list}\n</open_loops>`, "Write the intro: 2 to 4 sentences, under 90 words."].join("\n\n"),
    fast: true,
    temperature: 0.3,
    maxOutputTokens: OPEN_LOOPS_OUTPUT,
  };
}

/** The plan a routine holds credits for. */
export const routinePlan = (kind: RoutineKind) => (kind === "morning" ? MORNING_PLAN : OPEN_LOOPS_PLAN);
