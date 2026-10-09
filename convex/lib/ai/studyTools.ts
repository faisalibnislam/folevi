// Milestone 8's writing tasks (docs/AI_ASSISTANT.md): meeting summaries, flashcards and quizzes, and the
// decision and brainstorming frameworks. Their prompts live in writing.ts (WRITING_TASKS); this file checks
// and tidies what comes back before anyone sees it.
//
// Meeting summaries, flashcards and quizzes answer in JSON, so every field is checked here and the Markdown
// is ours: action items are always to-dos (with "(due YYYY-MM-DD)", which the Markdown reader turns into a
// due date), and a card is a toggle whose answer is hidden inside it, a block the editor already has. The
// frameworks answer in Markdown: their tables are made well formed, a decision matrix gets its weighted
// totals worked out here (never by the model), and every result is kept to a sensible size.
import { fail } from "../errors";

/** A tool's result is at most this much Markdown (it goes into a note). */
export const MAX_TOOL_CHARS = 20_000;
/** At most this many flashcards or quiz questions, and items in each list of a meeting summary. */
export const MAX_CARDS = 30;
export const MAX_LIST = 20;

/** A JSON reply, read leniently (a code fence around it, or a sentence before it). Null when it isn't JSON. */
export function parseJsonReply(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?[ \t]*\n?/i, "").replace(/\n?```\s*$/, "");
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

const cut = (s: string, max: number) => (s.length > max ? `${Array.from(s).slice(0, max - 1).join("").trimEnd()}…` : s);

/**
 * A model's string as one line of a block: whitespace collapsed, no block marks at the start (so it can't
 * turn into a heading, quote or list), none of the toggle tags that hold flashcards, at most `max` characters.
 */
export function oneLine(raw: unknown, max = 300): string {
  if (typeof raw !== "string" && typeof raw !== "number") return "";
  const s = String(raw)
    .replace(/<\/?\s*(details|summary)\b[^>]*>/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:[-*+>#]+|\d{1,3}[.)]|\[[ xX]?\])\s+/, "")
    .trim();
  return cut(s, max);
}

const strings = (raw: unknown, max = 300): string[] =>
  (Array.isArray(raw) ? raw : [])
    .map((x) => oneLine(x, max))
    .filter(Boolean)
    .slice(0, MAX_LIST);

/** A date the model gave, kept only when it is a real YYYY-MM-DD date. */
export function cleanDate(raw: unknown): string | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return null;
  const d = new Date(`${raw.trim()}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw.trim() ? raw.trim() : null;
}

const MEETING_HEADINGS = { attendees: "Attendees", decisions: "Decisions", actionItems: "Action items", openQuestions: "Open questions", nextSteps: "Next steps" };

/**
 * A meeting summary as Markdown: the summary, then attendees, decisions, action items (to-dos, "@Owner:"
 * first and "(due …)" last when given), open questions and next steps. Empty sections are left out.
 */
export function meetingMarkdown(raw: unknown): string {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const given = (r.headings && typeof r.headings === "object" ? r.headings : {}) as Record<string, unknown>;
  const heading = (k: keyof typeof MEETING_HEADINGS) => oneLine(given[k], 40) || MEETING_HEADINGS[k];
  const actions = (Array.isArray(r.actionItems) ? r.actionItems : [])
    .map((a) => {
      const item = (a && typeof a === "object" ? a : { task: a }) as Record<string, unknown>;
      const task = oneLine(item.task, 300);
      if (!task) return "";
      const owner = oneLine(item.owner, 60).replace(/^@+/, "").replace(/:+$/, "");
      const due = cleanDate(item.due);
      return `- [ ] ${owner ? `@${owner}: ` : ""}${task}${due ? ` (due ${due})` : ""}`;
    })
    .filter(Boolean)
    .slice(0, MAX_LIST);
  const out: string[] = [];
  const summary = oneLine(r.summary, 800);
  if (summary) out.push(summary, "");
  const section = (k: keyof typeof MEETING_HEADINGS, items: string[]) => {
    if (items.length) out.push(`## ${heading(k)}`, "", ...items, "");
  };
  section("attendees", strings(r.attendees, 80).map((x) => `- ${x}`));
  section("decisions", strings(r.decisions).map((x) => `- ${x}`));
  section("actionItems", actions);
  section("openQuestions", strings(r.openQuestions).map((x) => `- ${x}`));
  section("nextSteps", strings(r.nextSteps).map((x) => `- ${x}`));
  return out.join("\n").trim();
}

/**
 * A flashcard or quiz question as a toggle: the question is the toggle, the answer is inside it. The toggle is
 * marked (`data-study`, the toggle's `study` prop once inserted) so study mode can tell it from any other toggle.
 */
const toggle = (kind: "card" | "quiz", summary: string, inside: string[]) => [`<details data-study="${kind}"><summary>${summary}</summary>`, "", ...inside, "", "</details>", ""];

/** Flashcards as toggles (question, then the answer hidden inside). Cards without both halves are dropped. */
export function flashcardsMarkdown(raw: unknown): string {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const cards = (Array.isArray(r.cards) ? r.cards : [])
    .map((c) => {
      const card = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
      return { q: oneLine(card.q ?? card.question, 300), a: oneLine(card.a ?? card.answer, 800) };
    })
    .filter((c) => c.q && c.a)
    .slice(0, MAX_CARDS);
  return cards.flatMap((c) => toggle("card", c.q, [c.a])).join("\n").trim();
}

const LETTERS = "ABCDEF";

/**
 * A quiz as toggles: the question, and inside it the options ("- A. …") and the answer with its explanation
 * ("Answer: B. …"), which study mode reads back. A question needs 2 to 6 different options and a right
 * answer among them.
 */
export function quizMarkdown(raw: unknown): string {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const questions = (Array.isArray(r.questions) ? r.questions : [])
    .map((x) => {
      const q = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      const options = (Array.isArray(q.options) ? q.options : []).map((o) => oneLine(o, 200));
      const answer = typeof q.answer === "number" ? q.answer : Number.parseInt(String(q.answer ?? ""), 10);
      return { q: oneLine(q.q ?? q.question, 300), options, answer, explanation: oneLine(q.explanation, 400) };
    })
    .filter((q) => q.q && q.options.length >= 2 && q.options.length <= LETTERS.length && q.options.every(Boolean) && new Set(q.options.map((o) => o.toLowerCase())).size === q.options.length && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length)
    .slice(0, MAX_CARDS);
  return questions
    .flatMap((q) => toggle("quiz", q.q, [...q.options.map((o, i) => `- ${LETTERS[i]}. ${o}`), "", `Answer: ${LETTERS[q.answer]}.${q.explanation ? ` ${q.explanation}` : ""}`]))
    .join("\n")
    .trim();
}

// ---------------------------------------------------------------------------------------------------
// Markdown tidying for the frameworks.
// ---------------------------------------------------------------------------------------------------

const MAX_TABLE_COLUMNS = 12;
const MAX_TABLE_ROWS = 60;
const TABLE_LINE = /^\s*\|/;
const SEPARATOR_CELL = /^:?-{2,}:?$/;

/** A table row's cells (a "|" escaped with a backslash stays in its cell). */
function cellsOf(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|\s*$/, "");
  return inner.split(/(?<!\\)\|/).map((c) => c.trim());
}

/**
 * Every Markdown table well formed: a header row, then the separator, then rows with exactly the header's
 * columns (short rows padded, long ones cut), within the editor's limits.
 */
export function tidyTables(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; ) {
    if (!TABLE_LINE.test(lines[i]!)) {
      out.push(lines[i]!);
      i++;
      continue;
    }
    const rows: string[][] = [];
    while (i < lines.length && TABLE_LINE.test(lines[i]!)) {
      const cells = cellsOf(lines[i]!);
      if (!cells.every((c) => SEPARATOR_CELL.test(c))) rows.push(cells);
      i++;
    }
    if (!rows.length) continue;
    const width = Math.min(MAX_TABLE_COLUMNS, Math.max(1, rows[0]!.length));
    const fit = (r: string[]) => `| ${Array.from({ length: width }, (_, k) => r[k] ?? "").join(" | ")} |`;
    out.push(fit(rows[0]!), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...rows.slice(1, MAX_TABLE_ROWS + 1).map(fit));
  }
  return out.join("\n");
}

const numberIn = (cell: string): number | null => {
  const m = /-?\d+(?:[.,]\d+)?/.exec(cell);
  return m ? Number(m[0].replace(",", ".")) : null;
};
const formatNumber = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * A weighted decision matrix with its totals worked out here: in the first table, any total row the model
 * wrote is dropped, and a "Weighted total" row (each option's scores times the weights, added up) is added.
 * Expects a tidied table: criterion, weight, then one column per option.
 */
export function addMatrixTotals(markdown: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => TABLE_LINE.test(l));
  if (start < 0) return markdown;
  let end = start;
  while (end < lines.length && TABLE_LINE.test(lines[end]!)) end++;
  const header = cellsOf(lines[start]!);
  const weightCol = Math.max(1, header.findIndex((h) => /weight/i.test(h)));
  const options = header.map((_, k) => k).filter((k) => k > weightCol);
  if (!options.length) return markdown;
  const body = lines.slice(start + 2, end).filter((l) => !/total/i.test(cellsOf(l)[0] ?? ""));
  const totals = options.map(() => 0);
  let counted = 0;
  for (const line of body) {
    const cells = cellsOf(line);
    const weight = numberIn(cells[weightCol] ?? "");
    if (weight === null) continue;
    counted++;
    options.forEach((k, j) => {
      totals[j]! += weight * (numberIn(cells[k] ?? "") ?? 0);
    });
  }
  if (!counted) return markdown;
  const total = `| **Weighted total** | ${Array.from({ length: header.length - 1 }, (_, k) => (options.includes(k + 1) ? formatNumber(totals[options.indexOf(k + 1)]!) : "")).join(" | ")} |`;
  return [...lines.slice(0, start + 2), ...body, total, ...lines.slice(end)].join("\n");
}

const TODO = /^(\s*)[-*+]\s+\[[ xX]\]\s+/;
const LIST_ITEM = /^(\s*)(?:[-*+]|\d{1,3}[.)])\s+/;

/** List items after the last heading become to-dos (a pre-mortem's "What to do now"). */
export function todosInLastSection(markdown: string): string {
  const lines = markdown.split("\n");
  let last = -1;
  lines.forEach((l, i) => {
    if (/^#{1,3}\s/.test(l)) last = i;
  });
  if (last < 0) return markdown;
  return lines.map((l, i) => (i > last && !TODO.test(l) && LIST_ITEM.test(l) ? l.replace(LIST_ITEM, "$1- [ ] ") : l)).join("\n");
}

/** A mind map: only its list items, all bullets, nested two spaces per level, at most four levels. */
export function tidyMindMap(markdown: string): string {
  const items = markdown.split("\n").filter((l) => LIST_ITEM.test(l) && !TODO.test(l));
  if (!items.length) return markdown;
  const widths = [...new Set(items.map((l) => LIST_ITEM.exec(l)![1]!.replace(/\t/g, "  ").length))].sort((a, b) => a - b);
  return items
    .map((l) => {
      const depth = Math.min(3, widths.indexOf(LIST_ITEM.exec(l)![1]!.replace(/\t/g, "  ").length));
      return `${"  ".repeat(depth)}- ${l.replace(LIST_ITEM, "").trim()}`;
    })
    .join("\n");
}

/** At most MAX_TOOL_CHARS, cut at a line break. */
export function clampMarkdown(markdown: string, max = MAX_TOOL_CHARS): string {
  if (markdown.length <= max) return markdown;
  const cutAt = markdown.lastIndexOf("\n", max);
  return markdown.slice(0, cutAt > 0 ? cutAt : max).trimEnd();
}

/** What each milestone 8 task gives back, checked and tidied. `text` is the reply (fences already removed). */
export function finishTool(task: string, raw: string, text: string): string {
  switch (task) {
    case "meetingSummary": {
      const md = meetingMarkdown(parseJsonReply(raw));
      if (!md) fail("invalid_argument", "The AI couldn't find a meeting to summarize in that. Try again, or pick more text.");
      return clampMarkdown(md);
    }
    case "flashcards": {
      const md = flashcardsMarkdown(parseJsonReply(raw));
      if (!md) fail("invalid_argument", "The AI couldn't make flashcards from that. Try again, or pick more text.");
      return clampMarkdown(md);
    }
    case "quiz": {
      const md = quizMarkdown(parseJsonReply(raw));
      if (!md) fail("invalid_argument", "The AI couldn't make a quiz from that. Try again, or pick more text.");
      return clampMarkdown(md);
    }
    case "decisionMatrix":
      return clampMarkdown(addMatrixTotals(tidyTables(text)));
    case "risks":
      return clampMarkdown(tidyTables(text));
    case "premortem":
      return clampMarkdown(todosInLastSection(text));
    case "mindMap":
      return clampMarkdown(tidyMindMap(text));
    default:
      return clampMarkdown(text);
  }
}
