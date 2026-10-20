// Kept apart from insert.ts so the Ask AI chat can copy an answer without loading the editor.

/** Markdown → plain text for copying (keeps line breaks, drops markup). */
export function markdownToPlain(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|\W)[*_](.+?)[*_](?=\W|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/** A ```mindmap fence (Foli AI's mind map) → its nested list for copying, the ideas as written. */
export function mindmapCopyText(markdown: string): string {
  return markdown.replace(/^\s*```mindmap\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
}
