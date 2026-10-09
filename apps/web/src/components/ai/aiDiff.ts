// What an AI rewrite would change in the selected text, before anything is applied: the words removed and
// added, compared the way the note holds them (block by block, one line each, without Markdown marks).
import { markdownToBlocks, plainText, type InlineNode } from "@folevi/editor-schema";
import { diffWords, type TextPart } from "@/lib/history/diff";

/** Markdown as the note's text would read once inserted: each block's words on its own line. */
export function blocksPlain(markdown: string): string {
  const { blocks } = markdownToBlocks(markdown.trim(), { titleFromHeading: false });
  return blocks
    .map((b) => {
      const p = b.props as { code?: string; latex?: string; rows?: InlineNode[][][] };
      if (b.type === "code") return String(p.code ?? "");
      if (b.type === "formula") return String(p.latex ?? "");
      if (b.type === "table") return (p.rows ?? []).map((row) => row.map((cell) => plainText(cell ?? [])).join(" | ")).join("\n");
      return plainText(b.text);
    })
    .join("\n");
}

export interface AiDiff {
  parts: TextPart[];
  /** How much of the text stays (0 to 1): a translation or a table keeps little, so its result reads better on its own. */
  kept: number;
  /** Nothing would change. */
  same: boolean;
}

/** The changes between the selected text and the AI's Markdown. */
export function aiDiff(original: string, markdown: string): AiDiff {
  const before = original.replace(/\r\n?/g, "\n").trim();
  const after = blocksPlain(markdown);
  const parts = diffWords(before, after);
  const kept = parts.filter((p) => p.kind === "same").reduce((n, p) => n + p.text.replace(/\s+/g, "").length, 0);
  const longest = Math.max(before.replace(/\s+/g, "").length, after.replace(/\s+/g, "").length, 1);
  return { parts, kept: kept / longest, same: before === after };
}
