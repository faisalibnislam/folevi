// "Find to-dos" (docs/AI_ASSISTANT.md, notes that schedule themselves): Foli AI reads a note (or the selected
// text) and lists its action items as JSON: what to do, who owns it and when, each as the note wrote it.
// The model never works out a date: `when` is the phrase as written ("by Friday", "next Tuesday 3pm"), and
// the browser turns it into a due date relative to the person's today and time zone (apps/web
// lib/ai/actionItems.ts, chrono), so the person sees the date before any to-do is made. Owners are matched
// to people here (matchOwner, shared with the web), and nothing changes in the note until the person picks
// which to-dos to add. The action is aiTodos.find.
import type { GenerateRequest } from "./provider";
import { UNTRUSTED_RULE, untrusted } from "./writing";
import { oneLine, parseJsonReply } from "./studyTools";

/** At most this many action items come back. */
export const MAX_ACTION_ITEMS = 25;
export const FIND_TODOS_MAX_OUTPUT = 4096;

export const FIND_TODOS_SYSTEM = [
  "You are Foli AI, Folevi's writing assistant, inside a calm note-taking app.",
  "Reply with JSON only, shaped exactly as the task says. Plain text in the strings: no Markdown, no HTML.",
  UNTRUSTED_RULE,
].join(" ");

const JOB = [
  "Find the action items in the text: things someone agreed, was asked or plans to do.",
  'Reply with JSON {"items": [{"text": the task as a short to-do starting with a verb, without the owner\'s name or the date, "owner": the name of the person who will do it exactly as written, "me" when the writer says I or we means the writer, or null, "when": the words that say when it is due exactly as written (like "by Friday", "next Tuesday 3pm", "tomorrow"), or null, "quote": the sentence it came from, copied exactly}]}.',
  "Never work out, change or add dates: copy the words. Use only what the text says, one item per task, and an empty list when there are none.",
  "Write the to-dos in the language of the text.",
].join(" ");

/** The request for finding to-dos in a note (as Markdown) or in selected text. */
export function findTodosRequest(input: { note?: { title: string; text: string } | null; text?: string }): GenerateRequest {
  const parts = [
    input.note ? untrusted("note", input.note.text, ` title="${input.note.title.replace(/["<>]/g, "'").slice(0, 200)}"`) : "",
    input.text?.trim() ? untrusted("text", input.text) : "",
    `Task: ${JOB}`,
    "Reply with the JSON only.",
  ].filter(Boolean);
  return { system: FIND_TODOS_SYSTEM, prompt: parts.join("\n\n"), fast: false, json: true, temperature: 0.2, maxOutputTokens: FIND_TODOS_MAX_OUTPUT };
}

/** The largest prompt a request can send, for the credit hold. */
export function findTodosInputChars(sourceChars: number): number {
  return FIND_TODOS_SYSTEM.length + JOB.length + 200 + sourceChars;
}

/** One action item as the model gave it, checked: owner and when exactly as written, or null. */
export interface ActionItem {
  text: string;
  owner: string | null;
  when: string | null;
  /** The sentence it came from, only when it really is in the text. */
  quote: string | null;
}

/** Text compared loosely: no Markdown emphasis marks, quotes straightened, whitespace collapsed, lower case. */
const loose = (s: string) =>
  s
    .replace(/[*_`~]/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const nullish = (s: string) => (!s || /^(null|none|n\/a|-)$/i.test(s) ? null : s);

/**
 * The action items in a JSON reply, checked: each needs a to-do; owner and when are short strings or null;
 * a quote is kept only when it is in `source` (so "from: ..." never shows words the note doesn't have).
 * Duplicates are dropped, and at most MAX_ACTION_ITEMS are kept.
 */
export function parseActionItems(raw: string, source: string): ActionItem[] {
  const parsed = parseJsonReply(raw);
  const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).items : null;
  const haystack = loose(source);
  const seen = new Set<string>();
  const out: ActionItem[] = [];
  for (const x of Array.isArray(list) ? list : []) {
    const item = (x && typeof x === "object" ? x : { text: x }) as Record<string, unknown>;
    // A to-do mark the model wrote ("- [ ] Call the venue") goes: the text becomes a to-do anyway.
    const text = oneLine(item.text ?? item.task, 300).replace(/^\[[ xX]?\]\s*/, "").trim();
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    const quote = oneLine(item.quote, 400);
    out.push({
      text,
      owner: nullish(oneLine(item.owner, 60).replace(/^@+/, "").replace(/:+$/, "").trim()),
      when: nullish(oneLine(item.when ?? item.due, 80)),
      quote: quote && haystack.includes(loose(quote)) ? quote : null,
    });
    if (out.length >= MAX_ACTION_ITEMS) break;
  }
  return out;
}
