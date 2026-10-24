// Long notes for the agent (convex/aiAgent.ts): a note too long to send whole is read a page at a time
// (get_note fromBlock), has an outline of the lines that look like section titles (get_note_outline, and
// with the request when the conversation is about it), and can be reformatted block by block without the
// model writing each block out again (update_note "turn_into"). Pure functions, so they're testable alone.
import { inlineToMarkdown, plainText, type InlineNode, type WireBlock } from "@folevi/editor-schema";

/** One page of a note's block lines: blocks `first` to `last` (1-based) of `total`. */
export interface NotePage {
  text: string;
  first: number;
  last: number;
  total: number;
}

/**
 * The lines from block `fromBlock` (1-based) on, as many as fit in `max` characters (always at least one,
 * cut when it alone is longer). Past the end, an empty page at the end.
 */
export function pageOf(lines: string[], max: number, fromBlock = 1): NotePage {
  const total = lines.length;
  const start = Math.min(Math.max(1, Math.floor(fromBlock) || 1), total + 1) - 1;
  let text = "";
  let shown = 0;
  for (let i = start; i < total; i++) {
    const line = lines[i]!;
    if (text.length + line.length + 1 > max) {
      if (!shown) {
        text = `${line.slice(0, Math.max(0, max - 2))}…\n`;
        shown = 1;
      }
      break;
    }
    text += `${line}\n`;
    shown++;
  }
  return { text: text.trimEnd(), first: shown ? start + 1 : start, last: start + shown, total };
}

/** What a page says about the rest of the note (and how to read on), when it isn't the whole note. */
export function pageNote(p: NotePage): { truncated?: string; nextFromBlock?: number } {
  if (p.first <= 1 && p.last >= p.total) return {};
  const more = p.last < p.total;
  return {
    truncated: `Showing blocks ${p.first} to ${p.last} of ${p.total}.${more ? ` Read on with get_note fromBlock ${p.last + 1}.` : ""}`,
    ...(more ? { nextFromBlock: p.last + 1 } : {}),
  };
}

const TEXT_TYPES = new Set(["paragraph", "heading", "bulleted", "numbered", "todo", "toggle", "quote", "callout"]);

/** Whether a block's text is all bold (a heading written as a bold paragraph). */
export function allBold(b: Pick<WireBlock, "text" | "props">): boolean {
  if ((b.props as Record<string, unknown>).textStyle === "strong") return true;
  const runs = b.text.filter((n) => n.type !== "text" || n.text.trim());
  return runs.length > 0 && runs.every((n) => n.type === "text" && (n.marks ?? []).some((m) => m.type === "bold"));
}

/** A line that names a section: "Issue 12", "Part 3", "12.", "1.2 Scope"… */
const TITLE_START = /^(issue|section|part|chapter|step|phase|stage|module|lesson|unit|appendix|item|topic|question|problem|task|point|q)\s*#?\d+\b|^\d+(\.\d+)*[.)]?\s+\S/i;

/**
 * Whether a block looks like a section title: a heading, or a short text block that's all bold, starts like
 * a numbered title ("Issue 12", "3."), or ends in a colon.
 */
export function looksLikeTitle(b: Pick<WireBlock, "type" | "text" | "props">): boolean {
  if (b.type === "heading") return true;
  if (!TEXT_TYPES.has(b.type) || b.type === "todo") return false;
  const text = plainText(b.text).replace(/\s+/g, " ").trim();
  if (!text || text.length > 160) return false;
  if (allBold(b)) return true;
  if (text.length > 120 || /[.!?;,]$/.test(text)) return false;
  return TITLE_START.test(text) || text.endsWith(":");
}

/** A note's outline: its section-like blocks as "number. line", up to `max` characters, and how many more. */
export function outlineOf(entries: { block: WireBlock; line: string }[], max: number): { lines: string[]; sections: number; more: number } {
  const lines: string[] = [];
  let chars = 0;
  let sections = 0;
  entries.forEach((e, i) => {
    if (!looksLikeTitle(e.block)) return;
    sections++;
    const line = `${i + 1}. ${e.line.trim()}`;
    if (chars + line.length + 1 > max) return;
    lines.push(line);
    chars += line.length + 1;
  });
  return { lines, sections, more: sections - lines.length };
}

/** What a block can be turned into without rewriting it (update_note "turn_into"). */
export const TURN_INTO = ["heading", "paragraph", "bulleted", "numbered", "todo", "quote"] as const;
export type TurnInto = (typeof TURN_INTO)[number];

const withoutBold = (nodes: InlineNode[]): InlineNode[] => nodes.map((n) => (n.type === "text" && n.marks?.length ? { ...n, marks: n.marks.filter((m) => m.type !== "bold") } : n)).map((n) => (n.type === "text" && n.marks && !n.marks.length ? { type: "text", text: n.text } : n));

/**
 * The Markdown that turns a text block into another kind, keeping its text as it is (links, marks): a
 * heading drops bold that covered the whole line (a heading is bold already). Null for a block that isn't
 * text (a table, an image…).
 */
export function turnIntoMarkdown(b: Pick<WireBlock, "type" | "text" | "props">, to: TurnInto, level = 2): string | null {
  if (!TEXT_TYPES.has(b.type)) return null;
  const nodes = to === "heading" && allBold(b) ? withoutBold(b.text) : b.text;
  const text = inlineToMarkdown(nodes).replace(/\s*\n\s*/g, " ").trim();
  if (!text) return null;
  switch (to) {
    case "heading":
      return `${"#".repeat(Math.min(3, Math.max(1, Math.round(level) || 2)))} ${text}`;
    case "bulleted":
      return `- ${text}`;
    case "numbered":
      return `1. ${text}`;
    case "todo":
      return `- [ ] ${text}`;
    case "quote":
      return `> ${text}`;
    default:
      // A paragraph that starts like a list or a heading is escaped so it stays a paragraph.
      return text.replace(/^(\d+)([.)]\s)/, "$1\\$2").replace(/^(#{1,6}\s|[-*+>]\s)/, "\\$1");
  }
}
