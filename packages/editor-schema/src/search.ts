import type { WireBlock } from "./types";
import { plainText } from "./richtext";
import type { InlineNode } from "./generated/schema";
import { flowchartText, parseFlowchart } from "./flowchart";
import { mindmapText, parseMindmap } from "./mindmap";
import { parseStickies, stickiesText } from "./stickies";
import { chartText, parseChart } from "./chart";
import { parseWireframe, wireframeText } from "./wireframe";
import { evaluateTable, tableOptionsFromProps } from "./tableFormulas";

/** Lowercase, strip diacritics, collapse whitespace. Used on both indexing and query sides. */
export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Searchable text for a block: its inline text plus text-bearing props (code, captions, table cells…). */
export function blockSearchText(block: Pick<WireBlock, "type" | "text" | "props">): string {
  const p = block.props as Record<string, unknown>;
  const parts = [plainText(block.text)];
  switch (block.type) {
    case "code":
      parts.push(String(p.code ?? ""));
      break;
    case "image":
      parts.push(String(p.alt ?? ""), String(p.caption ?? ""));
      break;
    case "file":
    case "audio":
      parts.push(String(p.name ?? ""));
      break;
    case "table": {
      // What cells say and what they show (a formula's result, a formatted number), so both are found.
      const rows = (p.rows as InlineNode[][][]) ?? [];
      const shown = rows.some((r) => r.some((c) => c.some((n) => n.type === "text" && n.text.trimStart().startsWith("=")))) || Array.isArray(p.columns) ? evaluateTable(rows, tableOptionsFromProps(p)).cells : null;
      rows.forEach((row, r) =>
        row.forEach((cell, c) => {
          parts.push(plainText(cell));
          const e = shown?.[r]?.[c];
          if (e?.changed && e.kind !== "error") parts.push(e.display);
        }),
      );
      break;
    }
    case "embed":
      parts.push(String(p.url ?? ""));
      break;
    case "bookmark":
      parts.push(String(p.title ?? ""), String(p.description ?? ""), String(p.url ?? ""));
      break;
    case "page":
      parts.push(String(p.titleCache ?? ""));
      break;
    case "formula":
      parts.push(String(p.latex ?? ""));
      break;
    case "flowchart":
      parts.push(flowchartText(parseFlowchart(String(p.data ?? ""))));
      break;
    case "mindmap":
      parts.push(mindmapText(parseMindmap(String(p.data ?? ""))));
      break;
    case "stickies":
      parts.push(stickiesText(parseStickies(String(p.data ?? ""))));
      break;
    case "chart":
      parts.push(chartText(parseChart(String(p.data ?? ""))));
      break;
    case "wireframe":
      parts.push(wireframeText(parseWireframe(String(p.data ?? ""))));
      break;
  }
  return parts.filter(Boolean).join(" ");
}

/** Bounded search document for a whole document (Convex search index field size is limited). */
export function documentSearchText(title: string, blocks: readonly Pick<WireBlock, "type" | "text" | "props">[], maxLength = 32_000): string {
  let out = title;
  for (const b of blocks) {
    const t = blockSearchText(b);
    if (!t) continue;
    if (out.length + t.length + 1 > maxLength) break;
    out += `\n${t}`;
  }
  return out;
}

export interface HighlightRange {
  start: number;
  end: number;
}

/** Case/diacritic-insensitive match ranges of each query term inside `text` (for result highlighting). */
export function highlightRanges(text: string, query: string): HighlightRange[] {
  const terms = normalizeForSearch(query).split(" ").filter((t) => t.length > 0);
  if (!terms.length) return [];
  // Map normalized positions back to original positions character by character.
  const normChars: string[] = [];
  const origIndex: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const n = text[i]!
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"');
    for (const ch of n) {
      normChars.push(ch);
      origIndex.push(i);
    }
  }
  const norm = normChars.join("");
  const ranges: HighlightRange[] = [];
  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = norm.indexOf(term, from);
      if (at === -1) break;
      ranges.push({ start: origIndex[at]!, end: origIndex[at + term.length - 1]! + 1 });
      from = at + term.length;
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  const merged: HighlightRange[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

/** A short excerpt around the first match. */
export function searchSnippet(text: string, query: string, radius = 60): string {
  const ranges = highlightRanges(text, query);
  if (!ranges.length) return text.slice(0, radius * 2);
  const first = ranges[0]!;
  const start = Math.max(0, first.start - radius);
  const end = Math.min(text.length, first.end + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}
