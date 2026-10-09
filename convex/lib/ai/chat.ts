// Pure helpers for AI conversations (convex/aiChat.ts): what a conversation is about, titles, finding
// the block a citation points at, and the Markdown export.
import { v, type Infer } from "convex/values";

/**
 * What a conversation is about: some notes (read in full), one folder (its notes are searched), or the
 * whole scope (Personal or a workspace). Ids are public ids.
 */
export const vAiContext = v.object({
  kind: v.union(v.literal("note"), v.literal("notes"), v.literal("folder"), v.literal("workspace"), v.literal("selection")),
  ids: v.array(v.string()),
});
export type AiContext = Infer<typeof vAiContext>;

export const MAX_CONTEXT_NOTES = 5;
export const WHOLE_SCOPE: AiContext = { kind: "workspace", ids: [] };

/** A context as stored: known kinds, a few unique ids, and none for the whole scope. */
export function normalizeContext(c: AiContext | undefined): AiContext {
  if (!c) return WHOLE_SCOPE;
  const ids = [...new Set(c.ids.map((id) => id.trim()).filter((id) => /^[0-9A-Za-z_-]{1,64}$/.test(id)))];
  if (c.kind === "workspace" || c.kind === "selection" || !ids.length) return WHOLE_SCOPE;
  if (c.kind === "folder") return { kind: "folder", ids: ids.slice(0, 1) };
  const notes = ids.slice(0, MAX_CONTEXT_NOTES);
  return { kind: notes.length === 1 ? "note" : "notes", ids: notes };
}

export const NEW_CHAT_TITLE = "New chat";

/** A model's title, tidied: one line, no heading marks or quotes, no full stop, at most 80 characters. */
export function cleanTitle(raw: string): string {
  const line = (raw.split("\n").find((l) => l.trim()) ?? "")
    .replace(/^#+\s*/, "")
    .replace(/^["'“”‘’*_]+|["'“”‘’*_.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return line.slice(0, 80);
}

/** A title from the first question, when the model's isn't there: its first words. */
export function titleFromQuestion(question: string): string {
  const q = question.replace(/\s+/g, " ").trim();
  if (q.length <= 60) return q || NEW_CHAT_TITLE;
  const cut = q.slice(0, 60);
  const space = cut.lastIndexOf(" ");
  return `${space > 30 ? cut.slice(0, space) : cut}…`;
}

/** The sentences of an answer that cite note [n] (without the citation marks). */
export function citingSentences(answer: string, n: number): string {
  const mark = `[${n}]`;
  return answer
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((s) => s.includes(mark))
    .map((s) => s.replace(/\[\d{1,2}\]/g, " "))
    .join(" ")
    .slice(0, 2000);
}

const words = (text: string) => new Set((text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).slice(0, 400));

/**
 * The block of a note that best matches what the answer said about it (most words in common), with a
 * short quote of it. Nothing when no block shares at least two words.
 */
export function bestBlock(blocks: { id: string; text: string }[], said: string): { blockId: string; quote: string } | null {
  const want = words(said);
  if (!want.size) return null;
  let best: { id: string; text: string } | null = null;
  let bestScore = 1;
  for (const b of blocks) {
    if (!b.text.trim()) continue;
    let score = 0;
    for (const w of words(b.text)) if (want.has(w)) score++;
    if (score > bestScore) {
      best = b;
      bestScore = score;
    }
  }
  return best ? quoteOf(best) : null;
}

/** A block and a short quote of it. */
function quoteOf(block: { id: string; text: string }): { blockId: string; quote: string } {
  const quote = block.text.replace(/\s+/g, " ").trim();
  return { blockId: block.id, quote: quote.length > 160 ? `${quote.slice(0, 159)}…` : quote };
}

/**
 * The block a citation points at when the note's source was passages (semantic search's chunks, their
 * blocks best first): the one of those blocks that best matches what the answer said, else the first of
 * them. Never a block outside the passages. Nothing when none of them is still there.
 */
export function passageBlock(blocks: { id: string; text: string }[], blockIds: string[], said: string): { blockId: string; quote: string } | null {
  const order = new Map(blockIds.map((id, i) => [id, i]));
  const candidates = blocks.filter((b) => order.has(b.id) && b.text.trim()).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  if (!candidates.length) return null;
  return bestBlock(candidates, said) ?? quoteOf(candidates[0]!);
}

/** What became of an agent's proposed change, in the export. */
const CHANGE_STATES: Record<string, string> = { proposed: "proposed", applied: "done", failed: "couldn't be done", skipped: "skipped" };

/** A message as the Markdown export writes it (an agent's answer also lists its changes). */
export interface MarkdownMessage {
  role: string;
  text: string;
  citations?: { n: number; title: string; noteId?: string }[];
  webCitations?: { n: number; title: string; url: string }[];
  changes?: { summary: string; status: string }[];
}

/**
 * A conversation as Markdown: its title, then each message (answers with their sources, an agent's answer
 * with its changes). `noteLine` writes a cited note's source line (a note export makes it a page link).
 * Without a title, just the messages (one answer copied on its own).
 */
export function conversationMarkdown(title: string | null, messages: MarkdownMessage[], when: number, noteLine?: (c: { n: number; title: string; noteId?: string }) => string): string {
  const out = title === null ? [] : [`# ${title}`, "", `_Exported from Folevi AI on ${new Date(when).toISOString().slice(0, 10)}._`, ""];
  for (const m of messages) {
    if (m.role === "user") out.push("## You", "", m.text.trim(), "");
    else if (m.role === "assistant") {
      out.push("## Folevi AI", "", m.text.trim() || "_(no answer)_", "");
      if (m.changes?.length) out.push("Changes:", ...m.changes.map((c) => `- ${c.summary} (${CHANGE_STATES[c.status] ?? c.status})`), "");
      const sources = [...(m.citations ?? []).map((c) => ({ n: c.n, line: noteLine ? noteLine(c) : `- [${c.n}] ${c.title}` })), ...(m.webCitations ?? []).map((c) => ({ n: c.n, line: `- [${c.n}] [${c.title.replace(/[[\]]/g, "")}](${c.url})` }))];
      if (sources.length) out.push("Sources:", ...sources.sort((a, b) => a.n - b.n).map((s) => s.line), "");
    }
  }
  return `${out.join("\n").trim()}\n`;
}

/** A conversation's title as a file name (no path or reserved characters). */
export function conversationFilename(title: string): string {
  return title.replace(/[\\/:*?"<>|\u0000-\u001F]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Conversation";
}
