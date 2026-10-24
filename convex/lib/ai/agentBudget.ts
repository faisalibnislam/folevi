// How much one agent run may do (convex/aiAgent.ts), and what it says when it runs out. A run about a long
// note gets more steps (it reads a page at a time and edits in batches), but never more credits than it
// held: before each model call the run checks what it has spent plus what the call would cost, and when
// that would pass the hold, the call is its last (it answers instead of using tools). Old tool results are
// shortened once the conversation with the model grows, so each call doesn't resend every page it read.
// When a run stops before it's done it says what it did, what's left and offers Continue, never a
// generic "couldn't finish". Pure functions, so they're testable alone.
import { costNano, CREDIT_NANO_USD, tokensForChars, type CallUsage, type PlannedCall } from "../credits";
import type { Content, Part } from "./provider";
import type { AgentOp } from "./tools/ops";

export interface AgentBudget {
  /** Model calls one run may make (planning, after each round of tools, and the answer). */
  modelCalls: number;
  /** Tool calls one run may make in all. */
  toolCalls: number;
  /** However it's going, a run stops planning after this long and reports what it has. */
  timeoutMs: number;
  /** Output tokens one model call may write (a batch of edits is the biggest). */
  maxOutputTokens: number;
  /** What the run's credits are held at; the run never plans past it. */
  plan: PlannedCall[];
}

/** A run about a short note, or about notes in general. */
export const STANDARD_BUDGET: AgentBudget = {
  modelCalls: 6,
  toolCalls: 12,
  timeoutMs: 150_000,
  maxOutputTokens: 4_096,
  plan: Array.from({ length: 6 }, () => ({ fast: false, inputChars: 24_000, maxOutputTokens: 2_048 })),
};

/**
 * A run about a long note: room to read it a page at a time and edit it in batches of 40. Held at about 25
 * credits on Flash (a heading pass over a 6,000-word note uses well under that), so a long note never
 * silently costs a fortune: past the hold the run stops and offers Continue.
 */
export const LONG_BUDGET: AgentBudget = {
  modelCalls: 14,
  toolCalls: 40,
  timeoutMs: 300_000,
  maxOutputTokens: 8_192,
  plan: Array.from({ length: 8 }, () => ({ fast: false, inputChars: 40_000, maxOutputTokens: 2_048 })),
};

/** A note is long when its first page can't show it whole (about 12,000 characters of block lines). */
export function isLongNote(n: { blockCount: number; wordCount: number }): boolean {
  return n.wordCount > 1_800 || n.blockCount > 200;
}

/** Characters of a conversation with the model (what the next call resends). */
export function contentChars(contents: Content[]): number {
  let n = 0;
  for (const c of contents) for (const p of c.parts) n += partChars(p);
  return n;
}

function partChars(p: Part): number {
  if ("text" in p) return p.text.length;
  if ("functionCall" in p) return JSON.stringify(p.functionCall.args).length + p.functionCall.name.length;
  if ("functionResponse" in p) return JSON.stringify(p.functionResponse.response).length;
  return 0;
}

/**
 * Whether the next model call has to be the run's last: what's been spent, plus that call and the answer
 * after it (each at least as big as the last call's input, which only grows, and a typical reply), would
 * pass what the run held. So the run's own last word still fits in the hold. Costs are in nano-dollars.
 */
export function mustWrapUp(o: { spent: CallUsage[]; nextInputChars: number; model: string; heldCredits: number; outputGuess?: number }): boolean {
  const promptTokens = Math.max(tokensForChars(o.nextInputChars), o.spent.at(-1)?.promptTokens ?? 0);
  const next = costNano([{ model: o.model, promptTokens, outputTokens: o.outputGuess ?? 1_024, thoughtsTokens: 0 }]);
  return costNano(o.spent) + 2 * next > o.heldCredits * CREDIT_NANO_USD;
}

/** Once a conversation with the model passes this many characters, older tool results are shortened. */
export const COMPACT_AFTER_CHARS = 60_000;
const SHORTENED = "Shortened to save room: this was read earlier. Read it again if you still need it.";

/** A tool result shortened to what identifies it (ids, titles, counts, where a page ended). */
function shorten(response: Record<string, unknown>): Record<string, unknown> {
  if (response.shortened) return response;
  const kept: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(response)) {
    if ((typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length <= 200)) && k !== "partial") kept[k] = v;
  }
  return { ...kept, shortened: SHORTENED };
}

/**
 * Shortens tool results in older turns (all but the last `keep` turns with results) while the conversation
 * is longer than `max` characters. The first user turn (the request, with the note) and the model's own
 * turns (their calls and signatures) are never touched. Changes `contents` in place; returns the
 * characters saved.
 */
export function compactContents(contents: Content[], max = COMPACT_AFTER_CHARS, keep = 2): number {
  let size = contentChars(contents);
  if (size <= max) return 0;
  const start = size;
  const withResults = contents.map((c, i) => (c.role === "user" && c.parts.some((p) => "functionResponse" in p) ? i : -1)).filter((i) => i >= 0);
  for (const i of withResults.slice(0, Math.max(0, withResults.length - keep))) {
    if (size <= max) break;
    const turn = contents[i]!;
    const before = turn.parts.reduce((n, p) => n + partChars(p), 0);
    turn.parts = turn.parts.map((p) => ("functionResponse" in p ? { functionResponse: { ...p.functionResponse, response: shorten(p.functionResponse.response) } } : p));
    size -= before - turn.parts.reduce((n, p) => n + partChars(p), 0);
  }
  return start - size;
}

/** Why a run stopped before it was done. */
export type StopReason = "budget" | "error";

/** The edits a run proposed, in a few words ("40 edits to “Plans”", "3 changes"). */
function proposedWords(ops: AgentOp[]): string {
  const edits = ops.filter((o) => o.kind === "update_note");
  if (ops.length === 1 && edits.length === 1) {
    const n = edits[0]!.edits?.length ?? 0;
    return `${n} edit${n === 1 ? "" : "s"} to “${(edits[0]!.noteTitle ?? "Untitled").slice(0, 80)}”`;
  }
  return `${ops.length} change${ops.length === 1 ? "" : "s"}`;
}

/**
 * What a run says when it stopped before it was done and has no answer of its own: what it proposed (kept
 * for review), what happened, and that Continue picks up from there. `problem` is a stored error's message.
 */
export function stoppedText(o: { ops: AgentOp[]; reason: StopReason; problem?: string; long?: boolean }): string {
  const why = o.reason === "error" ? `Something went wrong partway${o.problem ? ` (${o.problem.replace(/\.$/, "")})` : ""}` : o.long ? "This note is long, and I reached the most one request can do" : "I reached the most one request can do";
  if (o.ops.length) return `${why}. So far I've proposed ${proposedWords(o.ops)}. Check them and approve what you want, then press Continue and I'll carry on from where I stopped.`;
  return `${why} before I could propose any changes. Press Continue and I'll carry on from where I stopped, or ask about one part of the note at a time.`;
}

/** What the run's last call is told when the run is out of room (so its answer says what's left). */
export const WRAP_UP_RULE =
  "This is your last step for this request: you can't use tools now. In 1 to 3 sentences, say what you did and, if anything is left, what's left. The person can press Continue to have you carry on, so don't say you couldn't finish.";

/** The text Continue sends (apps/web editIntent.ts CONTINUE_AGENT says the same). */
export const CONTINUE_TEXT = "Continue where you stopped.";
