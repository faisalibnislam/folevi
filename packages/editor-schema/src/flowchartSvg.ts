// A standalone SVG of a flowchart (HTML export, previews). Light-theme colours, the app's font stack, and
// the same geometry the editor draws with (flowchartGeometry.ts). All text is escaped.
import {
  FLOWCHART_FONT_SIZE,
  FLOWCHART_LABEL_FONT_SIZE,
  FLOWCHART_LINE_HEIGHT,
  nodeLines,
  parseFlowchart,
  type FlowColor,
  type FlowNode,
} from "./flowchart";
import { flowchartBounds, routeEdges, shapePath } from "./flowchartGeometry";

export const FLOWCHART_FONT_STACK = "'Instrument Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

/** Exported colours: [fill, stroke, text]. */
export const FLOWCHART_EXPORT_COLORS: Record<FlowColor, [string, string, string]> = {
  neutral: ["#ffffff", "#cfcfd5", "#18181b"],
  accent: ["#f1f1f3", "#8e8e96", "#18181b"],
  blue: ["#e8f0fe", "#8fb0ea", "#1e3a6e"],
  green: ["#e5f5ea", "#86c79c", "#1d4d2e"],
  yellow: ["#fdf3d0", "#e3c35e", "#5a4608"],
  pink: ["#fce8ee", "#eba3b8", "#6e2338"],
  purple: ["#efe9fb", "#b6a1e6", "#3f2a6e"],
};
const EDGE = "#8a8a93";
const LABEL = "#56565e";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The label's tspans, centred on the node (sticky notes and text read from the top). */
export function nodeTextLayout(n: FlowNode): { x: number; y: number; lines: string[]; anchor: "middle" } {
  const lines = nodeLines(n);
  const block = lines.length * FLOWCHART_LINE_HEIGHT;
  const cy = n.shape === "note" ? n.y + Math.min(n.h / 2, 14 + block / 2) : n.y + n.h / 2;
  // First baseline: centre the block, then drop by ~0.72em (cap height) within the first line.
  const y = cy - block / 2 + FLOWCHART_LINE_HEIGHT / 2 + FLOWCHART_FONT_SIZE * 0.36;
  return { x: n.x + n.w / 2, y, lines, anchor: "middle" };
}

export function flowchartToSvg(data: string, opts: { title?: string; padding?: number } = {}): string {
  const fc = parseFlowchart(data);
  const title = esc((opts.title ?? "Flowchart").replace(/[<>&"]/g, ""));
  const routed = routeEdges(fc);
  const b = flowchartBounds(fc, routed);
  if (!b) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" width="320" height="80" role="img" aria-label="${title} (empty)"></svg>`;
  const pad = opts.padding ?? 24;
  const vx = Math.floor(b.x - pad);
  const vy = Math.floor(b.y - pad);
  const vw = Math.ceil(b.w + pad * 2);
  const vh = Math.ceil(b.h + pad * 2);
  const parts: string[] = [];
  for (const r of routed) {
    const dash = r.edge.style === "dashed" ? ' stroke-dasharray="6 5"' : "";
    parts.push(`<path d="${r.d}" fill="none" stroke="${EDGE}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"${dash}/>`);
    for (const h of r.heads) parts.push(`<path d="${h}" fill="${EDGE}" stroke="${EDGE}" stroke-width="1" stroke-linejoin="round"/>`);
  }
  for (const n of fc.nodes) {
    // A neutral sticky note is yellow, like paper ones.
    const [fill, stroke, ink] = FLOWCHART_EXPORT_COLORS[n.shape === "note" && n.color === "neutral" ? "yellow" : n.color];
    if (n.shape === "note") parts.push(`<path d="${shapePath(n)}" fill="${fill}" stroke="rgba(0,0,0,0.08)" stroke-width="1"/>`);
    else if (n.shape !== "text") parts.push(`<path d="${shapePath(n)}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`);
    const t = nodeTextLayout(n);
    if (t.lines.length) {
      const textInk = ink;
      const spans = t.lines.map((l, i) => `<tspan x="${t.x}" y="${Math.round((t.y + i * FLOWCHART_LINE_HEIGHT) * 10) / 10}">${esc(l)}</tspan>`).join("");
      parts.push(`<text text-anchor="middle" font-size="${FLOWCHART_FONT_SIZE}" fill="${textInk}">${spans}</text>`);
    }
  }
  for (const r of routed) {
    if (!r.label) continue;
    const l = r.label;
    parts.push(`<rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" rx="6" fill="#ffffff"/>`);
    parts.push(`<text x="${l.cx}" y="${l.cy + FLOWCHART_LABEL_FONT_SIZE * 0.35}" text-anchor="middle" font-size="${FLOWCHART_LABEL_FONT_SIZE}" fill="${LABEL}">${esc(r.edge.label)}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${vw}" height="${vh}" role="img" aria-label="${title}" font-family="${FLOWCHART_FONT_STACK}"><rect x="${vx}" y="${vy}" width="100%" height="100%" fill="#ffffff"/>${parts.join("")}</svg>`;
}
