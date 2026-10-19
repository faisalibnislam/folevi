// A standalone SVG of the mind map for export (PNG, SVG, PDF, Copy as image; canvas/exportImage.ts) and
// for pasting into other apps. The same layout as the editor (layoutMindmap), light colours from the design
// tokens, the app's font stack, everything escaped. Null while there's nothing to draw (the export items are
// then unavailable). Collapsed branches stay collapsed, with their count, as in the block.
import { FLOWCHART_FONT_STACK, layoutMindmap, mindOuterPoint, mindTextLayout, parseMindmap, type MindmapColor } from "@folevi/editor-schema";
import { badgeOf, linkWidth, mindRadius, rootSide } from "./geometry";

/** Light colours: [line, fill, text], from the design tokens (moss, marigold, coral, plum, ember). */
export const MINDMAP_EXPORT_COLORS: Record<MindmapColor, [string, string, string]> = {
  neutral: ["#8a8a93", "#f1f1f3", "#18181b"],
  accent: ["#f46036", "#fde9df", "#b0401b"],
  blue: ["#3b82f6", "#dce7fb", "#1e4aa8"],
  green: ["#3fae6e", "#e2f4e8", "#23683f"],
  yellow: ["#f08a1c", "#feebd3", "#8a4a07"],
  pink: ["#f2716f", "#fde3e1", "#a8312f"],
  purple: ["#b67dab", "#f5e6f1", "#7a3f6f"],
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const PAD = 32;

export function mindmapSvg(data: string, height: number): string | null {
  void height;
  const map = parseMindmap(data);
  const l = layoutMindmap(map);
  const b = l.bounds;
  if (!b) return null;
  const vx = Math.floor(b.x - PAD);
  const vy = Math.floor(b.y - PAD);
  const vw = Math.ceil(b.w + PAD * 2);
  const vh = Math.ceil(b.h + PAD * 2);
  const parts: string[] = [];
  for (const link of l.links) {
    const [line] = MINDMAP_EXPORT_COLORS[link.color];
    parts.push(`<path d="${link.d}" fill="none" stroke="${line}" stroke-opacity="0.75" stroke-width="${linkWidth(link.depth)}" stroke-linecap="round"/>`);
  }
  const side = rootSide(l);
  for (const box of l.boxes) {
    const [line, fill, ink] = MINDMAP_EXPORT_COLORS[box.color];
    const rx = mindRadius(box.depth);
    if (box.depth === 0 && box.color === "neutral") parts.push(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${rx}" fill="#18181b"/>`);
    else if (box.depth <= 1) parts.push(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${rx}" fill="${fill}" stroke="${line}" stroke-width="1.5"/>`);
    else parts.push(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${rx}" fill="#ffffff" stroke="${line}" stroke-opacity="0.55" stroke-width="1"/>`);
    const t = mindTextLayout(box);
    const color = box.depth === 0 && box.color === "neutral" ? "#ffffff" : box.depth <= 1 ? ink : "#18181b";
    const spans = box.lines.map((ln, i) => `<tspan x="${t.x}" y="${Math.round((t.y + i * t.dy) * 10) / 10}">${esc(ln)}</tspan>`).join("");
    parts.push(`<text text-anchor="middle" font-size="${box.font}" font-weight="${box.weight}" fill="${color}"${box.empty ? ' fill-opacity="0.5"' : ""}>${spans}</text>`);
    if (box.hidden) {
      const { label, w } = badgeOf(box.hidden);
      const p = mindOuterPoint(box, 6 + (box.side === "down" ? 10 : w / 2), side);
      parts.push(`<rect x="${p.x - w / 2}" y="${p.y - 10}" width="${w}" height="20" rx="6" fill="${fill}" stroke="${line}" stroke-width="1"/>`);
      parts.push(`<text x="${p.x}" y="${p.y + 4}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${ink}">${label}</text>`);
    }
  }
  const root = l.boxes.find((x) => x.depth === 0);
  const title = esc(`Mind map${root && !root.empty ? `: ${root.lines.join(" ")}` : ""}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${vw}" height="${vh}" role="img" aria-label="${title}" font-family="${FLOWCHART_FONT_STACK}"><rect x="${vx}" y="${vy}" width="100%" height="100%" fill="#ffffff"/>${parts.join("")}</svg>`;
}
