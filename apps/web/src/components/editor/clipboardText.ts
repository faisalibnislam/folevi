// The plain text Folevi puts on the clipboard (for apps that don't read its HTML): one line per block, with
// Markdown-style markers so lists, to-dos, headings, quotes and code still read as such, and paste back
// into Folevi as the same blocks.
import type { Node as PMNode, Slice } from "@tiptap/pm/model";

/** A line's text, with mentions, dates and page links written out and line breaks kept. */
function lineText(node: PMNode): string {
  let out = "";
  node.forEach((child) => {
    if (child.isText) out += child.text ?? "";
    else if (child.type.name === "hardBreak") out += "\n";
    else if (child.type.name === "mention") out += `@${child.attrs.label ?? ""}`;
    else if (child.type.name === "dateMention") out += String(child.attrs.date ?? "");
    else if (child.type.name === "pageLink") out += String(child.attrs.label ?? "Untitled");
  });
  return out;
}

/** A table cell on one line, its "|" escaped so it doesn't end the cell. */
const cellText = (cell: unknown): string =>
  Array.isArray(cell)
    ? cell
        .map((n: { type?: string; text?: string; label?: string; date?: string }) => (n.type === "mention" ? `@${n.label ?? ""}` : (n.text ?? n.label ?? n.date ?? "")))
        .join("")
        .replace(/\s*\n\s*/g, " ")
        .replace(/\|/g, "\\|")
    : "";

export function sliceToText(slice: Slice): string {
  const content = slice.content;
  // Part of one line (a word, a sentence): just that text.
  if (content.childCount === 1 && content.firstChild!.isTextblock && slice.openStart > 0) {
    const only = content.firstChild!;
    return only.type.name === "codeBlock" ? only.textContent : lineText(only);
  }
  let minDepth = Infinity;
  content.forEach((n) => {
    if (n.attrs.depth !== undefined) minDepth = Math.min(minDepth, Number(n.attrs.depth ?? 0));
  });
  if (!Number.isFinite(minDepth)) minDepth = 0;
  const lines: string[] = [];
  const numbers: number[] = [];
  content.forEach((node) => {
    const depth = Math.max(0, Number(node.attrs.depth ?? 0) - minDepth);
    const indent = "  ".repeat(depth);
    const type = node.type.name;
    if (type === "numbered") {
      numbers.length = depth + 1;
      numbers[depth] = (numbers[depth] ?? 0) + 1;
    } else numbers.length = depth;
    switch (type) {
      case "heading":
        lines.push(`${indent}${"#".repeat(Number(node.attrs.level ?? 1))} ${lineText(node)}`);
        break;
      case "bulleted":
      case "toggle":
        lines.push(`${indent}- ${lineText(node)}`);
        break;
      case "numbered":
        lines.push(`${indent}${numbers[depth]}. ${lineText(node)}`);
        break;
      case "todo":
        lines.push(`${indent}- [${node.attrs.checked ? "x" : " "}] ${lineText(node)}`);
        break;
      case "quote":
      case "callout":
        // Every line of a quote keeps its "> ", so a line break doesn't end the quote.
        lines.push(`${indent}> ${lineText(node).split("\n").join(`\n${indent}> `)}`);
        break;
      case "codeBlock": {
        // Indented with its depth too, so code under a list item pastes back nested under it.
        const code = node.textContent.split("\n").map((l) => (l ? indent + l : l));
        lines.push(`${indent}\`\`\`${node.attrs.language && node.attrs.language !== "plaintext" ? node.attrs.language : ""}`, ...code, `${indent}\`\`\``);
        break;
      }
      case "divider":
        lines.push("---");
        break;
      case "image":
        lines.push(String(node.attrs.alt || node.attrs.caption || node.attrs.url || ""));
        break;
      case "bookmark":
        lines.push(String(node.attrs.url ?? ""));
        break;
      case "table": {
        const rows = (node.attrs.rows as unknown[][] | null) ?? [];
        // The "| --- |" row after the first makes it a Markdown table, so it pastes back as a table.
        rows.forEach((row, i) => {
          lines.push(`| ${row.map(cellText).join(" | ")} |`);
          if (i === 0) lines.push(`|${row.map(() => " --- ").join("|")}|`);
        });
        break;
      }
      case "formula":
        lines.push(String(node.attrs.latex ?? ""));
        break;
      default:
        if (node.isTextblock) lines.push(depth ? `${indent}${lineText(node)}` : lineText(node));
    }
  });
  return lines.join("\n");
}
