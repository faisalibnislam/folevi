// "Find to-dos" in the browser (docs/AI_ASSISTANT.md, notes that schedule themselves): Foli AI's action
// items (convex/aiTodos.ts) become proposed to-dos the person checks before anything is added. Dates are
// worked out here, never by the model: the phrase the note wrote ("by Friday", "next Tuesday 3pm") is read
// with chrono (lib/nlDate.ts) from the person's today, in their time zone. Owners were matched on the server
// with the same helper this file re-exports (matchOwner); a name that matched nobody, or more than one
// person, stays unassigned and is shown as a hint ("Sam?").
import { SCHEMA_VERSION, rankSequence, type WireBlock } from "@folevi/editor-schema";
import { parseNaturalDate } from "@/lib/nlDate";

export { matchOwner, type AssignablePerson, type OwnerMatch } from "@folevi/editor-schema";

/** An action item as the server proposes it (aiTodos.find). */
export interface ActionItemIn {
  text: string;
  owner: string | null;
  when: string | null;
  quote: string | null;
  assigneeId: string | null;
  match: "matched" | "ambiguous" | "unknown" | "none";
}

/** A proposed to-do as the person edits it. `date` is YYYY-MM-DD and `time` HH:MM, or "" for none. */
export interface ProposedTodo {
  key: string;
  checked: boolean;
  text: string;
  date: string;
  time: string;
  assigneeId: string;
  owner: string | null;
  match: ActionItemIn["match"];
  when: string | null;
  quote: string | null;
  /** The note said when, but it isn't a date we can read ("after the launch"): shown, so it isn't lost. */
  unreadWhen: boolean;
}

/**
 * Now as a wall clock in `timeZone`, as a local Date (what chrono reads): "Friday" and "tomorrow" then mean
 * the person's Friday and tomorrow, wherever this browser thinks it is.
 */
export function wallClockNow(timeZone: string, at: number = Date.now()): Date {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(at));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return new Date(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  } catch {
    return new Date(at);
  }
}

/** The due date (and time, when one was said) a "when" phrase means from `now`, or null when it names no day or time. */
export function resolveWhen(when: string | null | undefined, now: Date): { date: string; time: string | null } | null {
  if (!when?.trim()) return null;
  const parsed = parseNaturalDate(when, now);
  return parsed ? { date: parsed.date, time: parsed.time ?? null } : null;
}

/** The proposal for these action items: all checked, dates resolved from `now`, owners as the server matched them. */
export function proposalsFrom(items: readonly ActionItemIn[], now: Date): ProposedTodo[] {
  return items.map((item, i) => {
    const due = resolveWhen(item.when, now);
    return {
      key: `${i}`,
      checked: true,
      text: item.text,
      date: due?.date ?? "",
      time: due?.time ?? "",
      assigneeId: item.assigneeId ?? "",
      owner: item.owner,
      match: item.match,
      when: item.when,
      quote: item.quote,
      unreadWhen: Boolean(item.when && !due),
    };
  });
}

/** "Sam?": a name the note gave that matched nobody here, or more than one person. Null otherwise. */
export function ownerHint(p: Pick<ProposedTodo, "owner" | "match" | "assigneeId">): string | null {
  if (p.assigneeId || !p.owner || (p.match !== "unknown" && p.match !== "ambiguous")) return null;
  return /^(me|i|myself)$/i.test(p.owner) ? null : `${p.owner}?`;
}

/**
 * The checked proposals as to-do blocks (fresh ids are given when they're inserted), with their due date,
 * time and assignee. A to-do whose owner matched nobody keeps the name at the front ("Sam: send the deck"),
 * so who it's for isn't lost. With `heading`, a "To-dos" heading comes first.
 */
export function todoBlocksFor(proposals: readonly ProposedTodo[], opts: { heading?: string } = {}): WireBlock[] {
  const chosen = proposals.filter((p) => p.checked && p.text.trim());
  if (!chosen.length) return [];
  const ranks = rankSequence(chosen.length + 1);
  const blocks: WireBlock[] = [];
  if (opts.heading) blocks.push({ id: "todos-heading", type: "heading", parentId: null, rank: ranks[0]!, schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text: opts.heading }], props: { level: 2 } });
  chosen.forEach((p, i) => {
    const hint = !p.assigneeId && p.owner && ownerHint(p) ? `${p.owner}: ` : "";
    const props: Record<string, unknown> = { checked: false };
    if (p.date) props.dueDate = p.date;
    if (p.date && p.time) props.dueTime = p.time;
    if (p.assigneeId) props.assigneeId = p.assigneeId;
    blocks.push({ id: `todo-${i}`, type: "todo", parentId: null, rank: ranks[i + 1]!, schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text: `${hint}${p.text.trim()}` }], props });
  });
  return blocks;
}

/** An action item handed to Find to-dos as it is (no model call): owner and date as the result wrote them. */
export type PresetTodo = Pick<ActionItemIn, "text" | "owner" | "when" | "quote">;

const TODO_LINE = /^\s*[-*+] \[ \] (.+)$/;

/** Whether a result (Markdown) has open to-dos in it ("- [ ] …"), so "Add dates and people" has something to work on. */
export function hasTodoLines(markdown: string): boolean {
  return markdown.split("\n").some((l) => TODO_LINE.test(l));
}

/**
 * A meeting summary's action items (convex/lib/ai/studyTools.ts meetingMarkdown writes each one as
 * "- [ ] @Owner: task (due YYYY-MM-DD)", owner and date only when the meeting said them), in order.
 */
export function meetingActionItems(markdown: string): PresetTodo[] {
  const out: PresetTodo[] = [];
  for (const line of markdown.split("\n")) {
    const m = TODO_LINE.exec(line);
    if (!m) continue;
    let text = m[1]!.trim();
    const quote = text;
    let owner: string | null = null;
    let when: string | null = null;
    const o = /^@([^:\n]{1,60}):\s*/.exec(text);
    if (o) {
      owner = o[1]!.trim();
      text = text.slice(o[0].length);
    }
    const d = /\s*\(due (\d{4}-\d{2}-\d{2})\)\s*$/.exec(text);
    if (d) {
      when = d[1]!;
      text = text.slice(0, d.index);
    }
    out.push({ text: text.trim(), owner, when, quote });
  }
  return out;
}
