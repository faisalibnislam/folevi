// A standalone SVG of the sticky notes board for export (PNG, SVG, PDF, Copy as image; canvas/exportImage.ts)
// and for note exports and pasting into other apps. Light colours (the sticky palette's light tokens), the
// app's font stack, everything escaped. Null while there's nothing to draw (the export items are then
// unavailable).
import { parseStickies, stickyVoteCount, type StickyColor } from "@folevi/editor-schema";
import { boardBounds, noteFontSize } from "./ops";

const FONT = "'Instrument Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

/** Paper colours, light theme (stickies.css draws the same from the design tokens). */
export const STICKY_EXPORT_FILL: Record<StickyColor, string> = {
  yellow: "#fcefb4",
  orange: "#fce2c3",
  pink: "#fbdde0",
  purple: "#ecd7e7",
  blue: "#dce7fb",
  green: "#d9f2e0",
  gray: "#eeeeef",
};
const INK = "#18181b";
const MUTED = "#56565e";
const GROUP_FILL = "#f6f6f7";
const GROUP_LINE = "#dcdce0";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** About how wide a run of text is in Instrument Sans (no font metrics in an export). */
const textWidth = (s: string, size: number) => [...s].reduce((w, ch) => w + (/[ilj.,:;'|!]/.test(ch) ? 0.3 : /[mwMW@]/.test(ch) ? 0.85 : /[A-Z0-9]/.test(ch) ? 0.64 : ch === " " ? 0.28 : 0.54), 0) * size;

/** Text wrapped to a width, at most `max` lines (the last one shortened with an ellipsis). */
export function wrapText(text: string, width: number, size: number, max: number): string[] {
  const lines: string[] = [];
  for (const para of text.replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size) <= width || !line) {
        // A single word wider than the note is cut to fit.
        line = textWidth(next, size) <= width ? next : cut(next, width, size);
      } else {
        lines.push(line);
        line = textWidth(word, size) <= width ? word : cut(word, width, size);
      }
    }
    lines.push(line);
  }
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, Math.max(1, max));
  kept[kept.length - 1] = `${cut(kept[kept.length - 1]!, width - size, size)}…`;
  return kept;
}

function cut(s: string, width: number, size: number): string {
  let out = "";
  for (const ch of s) {
    if (textWidth(out + ch, size) > width) break;
    out += ch;
  }
  return out;
}

export function stickiesSvg(data: string, height: number): string | null {
  void height;
  const board = parseStickies(data);
  const b = boardBounds(board);
  if (!b) return null;
  const pad = 32;
  const vx = Math.floor(b.x - pad);
  const vy = Math.floor(b.y - pad);
  const vw = Math.ceil(b.w + pad * 2);
  const vh = Math.ceil(b.h + pad * 2);
  const parts: string[] = [];
  for (const g of board.groups) {
    parts.push(`<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="14" fill="${GROUP_FILL}" stroke="${GROUP_LINE}" stroke-width="1.5"/>`);
    if (g.label.trim()) parts.push(`<text x="${g.x + 16}" y="${g.y + 28}" font-size="15" font-weight="600" fill="${INK}">${esc(wrapText(g.label, g.w - 32, 15, 1)[0] ?? "")}</text>`);
  }
  for (const n of board.notes) {
    const size = noteFontSize(n);
    const line = Math.round(size * 1.3);
    const votes = stickyVoteCount(n);
    const foot = n.tags.length || votes ? 22 : 0;
    const max = Math.max(1, Math.floor((n.h - 24 - foot) / line));
    parts.push(`<g><rect x="${n.x}" y="${n.y + 2}" width="${n.w}" height="${n.h}" rx="4" fill="#000" opacity="0.06"/><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="4" fill="${STICKY_EXPORT_FILL[n.color]}"/>`);
    const lines = wrapText(n.text.trim(), n.w - 24, size, max);
    if (lines.length) parts.push(`<text x="${n.x + 12}" y="${n.y + 12 + size}" font-size="${size}" font-weight="500" fill="${INK}">${lines.map((l, i) => `<tspan x="${n.x + 12}" dy="${i ? line : 0}">${esc(l)}</tspan>`).join("")}</text>`);
    if (n.tags.length) parts.push(`<text x="${n.x + 12}" y="${n.y + n.h - 12}" font-size="11.5" fill="${MUTED}">${esc(wrapText(n.tags.map((t) => `#${t}`).join(" "), n.w - 24 - (votes ? 40 : 0), 11.5, 1)[0] ?? "")}</text>`);
    if (votes) {
      const label = String(votes);
      const w = 24 + label.length * 7;
      const x = n.x + n.w - 10 - w;
      const y = n.y + n.h - 28;
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="20" rx="6" fill="${INK}" opacity="0.1"/><circle cx="${x + 10}" cy="${y + 10}" r="3.5" fill="${INK}"/><text x="${x + 18}" y="${y + 14.5}" font-size="12" font-weight="600" fill="${INK}">${label}</text>`);
    }
    parts.push("</g>");
  }
  const count = board.notes.length;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${vw}" height="${vh}" role="img" aria-label="Sticky notes, ${count} ${count === 1 ? "note" : "notes"}" font-family="${esc(FONT)}"><rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="#ffffff"/>${parts.join("")}</svg>`;
}
