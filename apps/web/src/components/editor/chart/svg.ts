// A standalone SVG of the chart for export (PNG, SVG, PDF, Copy as image; canvas/exportImage.ts) and for
// pasting into other apps: the same scene as on screen (draw.ts), with its title above and takeaway below,
// in light colours on white, in the app's font stack, everything escaped. Null while there's nothing to draw
// (the export items are then unavailable).
import { parseChart, type ChartData } from "@folevi/editor-schema";
import { drawChart } from "./draw";
import { paintHex } from "./palette";
import type { Mark, Scene } from "./scene";

/** How wide exports are drawn (a page's width; PNGs are made at twice this). */
export const EXPORT_WIDTH = 880;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n: number) => String(Math.round(n * 10) / 10);

function markSvg(m: Mark): string {
  const op = "opacity" in m && m.opacity !== undefined ? ` opacity="${num(m.opacity)}"` : "";
  const stroke = (p?: string, sw?: number) => (p ? ` stroke="${p}" stroke-width="${num(sw ?? 1)}"` : "");
  switch (m.t) {
    case "rect":
      return `<rect x="${num(m.x)}" y="${num(m.y)}" width="${num(Math.max(0, m.w))}" height="${num(Math.max(0, m.h))}"${m.r ? ` rx="${num(m.r[0])}"` : ""} fill="${paintHex(m.fill)}"${m.stroke ? stroke(paintHex(m.stroke), m.sw) : ""}${op}/>`;
    case "path":
      return `<path d="${m.d}" fill="${m.fill ? paintHex(m.fill) : "none"}"${m.stroke ? stroke(paintHex(m.stroke), m.sw) : ""} stroke-linejoin="round" stroke-linecap="round"${op}/>`;
    case "circle":
      return `<circle cx="${num(m.cx)}" cy="${num(m.cy)}" r="${num(m.r)}" fill="${paintHex(m.fill)}"${m.stroke ? stroke(paintHex(m.stroke), m.sw) : ""}${op}/>`;
    case "line":
      return `<line x1="${num(m.x1)}" y1="${num(m.y1)}" x2="${num(m.x2)}" y2="${num(m.y2)}" stroke="${paintHex(m.stroke)}" stroke-width="${num(m.sw ?? 1)}" shape-rendering="crispEdges"/>`;
    case "text":
      return `<text x="${num(m.x)}" y="${num(m.y)}" font-size="${num(m.size)}"${m.weight ? ` font-weight="${m.weight}"` : ""}${m.anchor && m.anchor !== "start" ? ` text-anchor="${m.anchor}"` : ""}${m.rotate ? ` transform="rotate(${m.rotate} ${num(m.x)} ${num(m.y)})"` : ""} fill="${paintHex(m.fill)}">${esc(m.text)}</text>`;
  }
}

/** A scene as a standalone SVG document on a white page. */
export function sceneSvg(scene: Scene): string {
  const [x, y, w, h] = scene.viewBox;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}" font-family="Instrument Sans, system-ui, -apple-system, Segoe UI, sans-serif" role="img" aria-label="${esc(scene.summary)}">`,
    `<title>${esc(scene.summary)}</title>`,
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>`,
    ...scene.marks.map(markSvg),
    "</svg>",
  ].join("");
}

/** The chart as it's exported: the export width, the block's height plus room for its title and takeaway. */
export function exportScene(chart: ChartData, height: number): Scene {
  const extra = (chart.title ? 30 : 0) + (chart.takeaway ? 18 * Math.min(4, Math.ceil(chart.takeaway.length / 90)) + 10 : 0);
  return drawChart(chart, { width: EXPORT_WIDTH, height: Math.max(320, Math.min(1200, height || 360)) + extra + 8, titled: true });
}

export function chartSvg(data: string, height: number): string | null {
  const chart = parseChart(data);
  const scene = exportScene(chart, height);
  return scene.empty ? null : sceneSvg(scene);
}
