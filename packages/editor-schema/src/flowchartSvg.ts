// A standalone SVG of a flowchart (HTML export, image exports, previews, read-only views): every shape with
// its rich label, icon, image and badges, frames, swimlanes, connectors with their line ends, dashes, hops
// and labels, in a light or a dark palette, with the app's font stack and the same geometry the editor
// draws with. All text is escaped; links are only ever the sanitised ones the data holds.
import type { Mark } from "./generated/schema";
import {
  FLOWCHART_FONT_SIZE,
  FLOWCHART_FRAME_TITLE,
  FLOWCHART_LABEL_FONT_SIZE,
  FLOWCHART_LINE_HEIGHT,
  FLOWCHART_POOL_TITLE,
  flowContainers,
  laneBoxes,
  nodeContentBoxes,
  nodeTextLayout,
  parseFlowchart,
  poolRect,
  type FlowchartData,
  type FlowColor,
  type FlowLineStyle,
  type FlowNode,
} from "./flowchart";
import { FLOWCHART_ICON_DEFS } from "./flowchartIcons";
import { flowchartBounds, routedEdge, type RoutedEdge } from "./flowchartGeometry";
import { routeFlowchart } from "./flowchartRouting";
import { isBareShape, shapeBackPaths, shapeDetailPath, shapePath, type Rect } from "./flowchartShapes";

export const FLOWCHART_FONT_STACK = "'Instrument Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const MONO_STACK = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

export type FlowTheme = "light" | "dark";

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

export const FLOWCHART_EXPORT_COLORS_DARK: Record<FlowColor, [string, string, string]> = {
  neutral: ["#1f1f23", "#4a4a52", "#ececf0"],
  accent: ["#2a2a30", "#76767f", "#ececf0"],
  blue: ["#1b2942", "#4a6aa8", "#cfe0ff"],
  green: ["#16301f", "#3f8a5a", "#c9efd6"],
  yellow: ["#38300f", "#a8902e", "#f6e7a8"],
  pink: ["#3a1b25", "#b0607a", "#ffd3e0"],
  purple: ["#2a2140", "#8a72c8", "#e2d8ff"],
};

interface Palette {
  nodes: Record<FlowColor, [string, string, string]>;
  /** Connector colours by palette name. */
  lines: Record<FlowColor, string>;
  edge: string;
  label: string;
  labelBg: string;
  background: string;
  frameTitle: string;
  laneHeader: string;
  poolTitle: string;
  placeholder: string;
  badge: string;
  badgeInk: string;
  text: Record<string, string>;
}

const PALETTES: Record<FlowTheme, Palette> = {
  light: {
    nodes: FLOWCHART_EXPORT_COLORS,
    lines: { neutral: "#8a8a93", accent: "#6b6b74", blue: "#3b6fd4", green: "#2f8f57", yellow: "#b38b0f", pink: "#c4466e", purple: "#7b5cd6" },
    edge: "#8a8a93",
    label: "#56565e",
    labelBg: "#ffffff",
    background: "#ffffff",
    frameTitle: "#3f3f46",
    laneHeader: "#f6f6f8",
    poolTitle: "#efeff2",
    placeholder: "#f1f1f3",
    badge: "#18181b",
    badgeInk: "#ffffff",
    text: { muted: "#71717a", accent: "#4f46e5", moss: "#4d7c0f", marigold: "#b45309", plum: "#86198f", coral: "#e11d48" },
  },
  dark: {
    nodes: FLOWCHART_EXPORT_COLORS_DARK,
    lines: { neutral: "#8e8e98", accent: "#a1a1aa", blue: "#7aa2f0", green: "#5fbf86", yellow: "#d9b84a", pink: "#e682a3", purple: "#a993ef" },
    edge: "#8e8e98",
    label: "#c4c4cc",
    labelBg: "#18181b",
    background: "#18181b",
    frameTitle: "#d4d4d8",
    laneHeader: "#202024",
    poolTitle: "#26262b",
    placeholder: "#2a2a30",
    badge: "#ececf0",
    badgeInk: "#18181b",
    text: { muted: "#a1a1aa", accent: "#a5b4fc", moss: "#a3e635", marigold: "#fbbf24", plum: "#f0abfc", coral: "#fb7185" },
  },
};

const HIGHLIGHT: Record<FlowTheme, Record<string, string>> = {
  light: { yellow: "#fde68a", green: "#bbf7d0", blue: "#bfdbfe", pink: "#fbcfe8" },
  dark: { yellow: "#5b4a12", green: "#14532d", blue: "#1e3a8a", pink: "#831843" },
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const r1 = (n: number) => Math.round(n * 10) / 10;
const HEX = /^#[0-9a-f]{6}$/i;

/** Dash pattern for a line style (dotted lines rely on round caps, which every stroked path here has). */
const dashFor = (style: FlowLineStyle | undefined, width: number) => (style === "dashed" ? ` stroke-dasharray="${r1(4 * width)} ${r1(3.4 * width)}"` : style === "dotted" ? ` stroke-dasharray="0.1 ${r1(2.6 * width + 1)}"` : "");


export interface FlowchartSvgOptions {
  title?: string;
  padding?: number;
  theme?: FlowTheme;
  /** Draw the page colour behind the chart (default true). */
  background?: boolean;
  /** Resolves an image's file id to an address the SVG may load (images show as placeholders without). */
  imageUrl?: (fileId: string) => string | null;
}

function spanAttrs(marks: readonly Mark[] | undefined, theme: FlowTheme): string {
  if (!marks?.length) return "";
  const p = PALETTES[theme];
  let a = "";
  const deco: string[] = [];
  for (const m of marks) {
    if (m.type === "bold") a += ' font-weight="600"';
    else if (m.type === "italic") a += ' font-style="italic"';
    else if (m.type === "underline") deco.push("underline");
    else if (m.type === "strike") deco.push("line-through");
    else if (m.type === "code") a += ` font-family="${MONO_STACK}" font-size="${FLOWCHART_FONT_SIZE * 0.92}"`;
    else if (m.type === "color" && p.text[m.value]) a += ` fill="${p.text[m.value]}"`;
    else if (m.type === "link") deco.push("underline");
  }
  if (deco.length) a += ` text-decoration="${deco.join(" ")}"`;
  return a;
}

function nodeSvg(n: FlowNode, theme: FlowTheme, uid: string, imageUrl?: (fileId: string) => string | null): string {
  const p = PALETTES[theme];
  const parts: string[] = [];
  // A neutral sticky note is yellow, like paper ones.
  const [fill0, stroke0, ink] = p.nodes[n.shape === "note" && n.color === "neutral" ? "yellow" : n.color];
  const fill = n.fill && (n.fill === "none" || HEX.test(n.fill)) ? n.fill : fill0;
  const stroke = n.stroke && (n.stroke === "none" || HEX.test(n.stroke)) ? n.stroke : n.shape === "note" ? (theme === "dark" ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)") : stroke0;
  const sw = n.strokeWidth ?? (n.shape === "note" ? 1 : 1.5);
  const dash = `${dashFor(n.strokeStyle, Math.max(1, sw))} stroke-linecap="round"`;
  const outline = shapePath(n);
  for (const back of shapeBackPaths(n)) parts.push(`<path d="${back}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash}/>`);
  if (!isBareShape(n.shape)) parts.push(`<path d="${outline}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"${dash}/>`);
  const details = shapeDetailPath(n);
  if (details) parts.push(`<path d="${details}" fill="none" stroke="${n.shape === "note" ? (theme === "dark" ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.12)") : stroke}" stroke-width="${n.shape === "note" ? 1 : sw}" stroke-linecap="round"/>`);
  const boxes = nodeContentBoxes(n);
  if (n.image && boxes.image) {
    const b = boxes.image;
    const url = imageUrl?.(n.image.fileId) ?? null;
    if (url && /^(https?:|data:image\/|blob:|\/)/i.test(url)) {
      const clip = `${uid}-clip-${n.id}`;
      parts.push(`<clipPath id="${clip}"><rect x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.w)}" height="${r1(b.h)}" rx="6"/></clipPath>`);
      parts.push(`<image href="${esc(url)}" x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.w)}" height="${r1(b.h)}" preserveAspectRatio="xMidYMid ${n.image.fit === "contain" ? "meet" : "slice"}" clip-path="url(#${clip})"/>`);
    } else {
      // A placeholder: a soft box with a small picture glyph.
      const s = Math.min(24, b.w / 2, b.h / 2);
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      parts.push(`<rect x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.w)}" height="${r1(b.h)}" rx="6" fill="${p.placeholder}"/>`);
      parts.push(`<path d="M${r1(cx - s / 2)} ${r1(cy + s / 3)}L${r1(cx - s / 8)} ${r1(cy - s / 8)}L${r1(cx + s / 8)} ${r1(cy + s / 8)}L${r1(cx + s / 4)} ${r1(cy)}L${r1(cx + s / 2)} ${r1(cy + s / 3)}Z" fill="${stroke0}"/>`);
    }
  }
  if (n.icon && boxes.icon) {
    const b = boxes.icon;
    const def = FLOWCHART_ICON_DEFS[n.icon.name];
    if (def) parts.push(`<path d="${def.d}" transform="translate(${r1(b.x)} ${r1(b.y)}) scale(${r1((b.w / 24) * 100) / 100})" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  const t = nodeTextLayout(n);
  if (t.rich.length) {
    const lines = t.rich
      .map((line, i) => {
        const y = r1(t.y + i * FLOWCHART_LINE_HEIGHT);
        const x = t.anchor === "start" ? t.x + line.indent : t.x;
        const marker = line.marker ? `<tspan>${esc(line.marker)} </tspan>` : "";
        const spans = line.spans
          .map((s) => {
            const span = `<tspan${spanAttrs(s.marks, theme)}>${esc(s.text)}</tspan>`;
            const link = s.marks?.find((m): m is Extract<Mark, { type: "link" }> => m.type === "link");
            return link ? `<a href="${esc(link.href)}">${span}</a>` : span;
          })
          .join("");
        return `<tspan x="${r1(t.anchor === "start" && line.marker ? t.x : x)}" y="${y}">${marker}${spans}</tspan>`;
      })
      .join("");
    parts.push(`<text text-anchor="${t.anchor}" font-size="${FLOWCHART_FONT_SIZE}" fill="${ink}">${lines}</text>`);
  }
  const highlightMarks = t.rich.some((l) => l.spans.some((s) => s.marks?.some((m) => m.type === "highlight")));
  if (highlightMarks) {
    // Drawn as a translucent underlay below the text line (exports can't measure fonts, so this stays subtle).
    t.rich.forEach((line, i) => {
      const y = t.y + i * FLOWCHART_LINE_HEIGHT;
      const start = t.anchor === "start" ? t.x + line.indent : t.anchor === "end" ? t.x - line.width : t.x - line.width / 2;
      let x = start;
      for (const s of line.spans) {
        const w = s.text.length ? (line.width - line.indent) * (s.text.length / Math.max(1, line.spans.reduce((k, q) => k + q.text.length, 0))) : 0;
        const hl = s.marks?.find((m): m is Extract<Mark, { type: "highlight" }> => m.type === "highlight");
        if (hl) parts.splice(parts.length - 1, 0, `<rect x="${r1(x)}" y="${r1(y - FLOWCHART_FONT_SIZE * 0.85)}" width="${r1(w)}" height="${r1(FLOWCHART_FONT_SIZE * 1.15)}" rx="2" fill="${HIGHLIGHT[theme][hl.value]}" opacity="0.8"/>`);
        x += w;
      }
    });
  }
  for (const b of boxes.badges) {
    const glyph = FLOWCHART_ICON_DEFS[b.kind === "note" ? "file" : "link"];
    const s = b.r * 1.2;
    parts.push(`<circle cx="${r1(b.cx)}" cy="${r1(b.cy)}" r="${b.r}" fill="${p.badge}"/>`);
    parts.push(`<path d="${glyph.d}" transform="translate(${r1(b.cx - s / 2)} ${r1(b.cy - s / 2)}) scale(${r1((s / 24) * 100) / 100})" fill="none" stroke="${p.badgeInk}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  return `<g>${parts.join("")}</g>`;
}

function edgeColor(color: string | undefined, theme: FlowTheme): string {
  const p = PALETTES[theme];
  if (!color) return p.edge;
  if (HEX.test(color)) return color;
  return p.lines[color as FlowColor] ?? p.edge;
}

function edgeSvg(r: RoutedEdge, theme: FlowTheme): string {
  const c = edgeColor(r.edge.color, theme);
  const w = r.edge.width ?? 1.5;
  const parts = [`<path d="${r.d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${dashFor(r.edge.style, w)}/>`];
  for (const m of r.markers) {
    parts.push(m.filled ? `<path d="${m.d}" fill="${c}" stroke="${c}" stroke-width="1" stroke-linejoin="round"/>` : `<path d="${m.d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  return parts.join("");
}

function labelSvg(r: RoutedEdge, theme: FlowTheme): string {
  const p = PALETTES[theme];
  return r.labels
    .map((l) => `<rect x="${r1(l.x)}" y="${r1(l.y)}" width="${r1(l.w)}" height="${r1(l.h)}" rx="6" fill="${p.labelBg}"/><text x="${r1(l.cx)}" y="${r1(l.cy + FLOWCHART_LABEL_FONT_SIZE * 0.35)}" text-anchor="middle" font-size="${FLOWCHART_LABEL_FONT_SIZE}" fill="${p.label}">${esc(l.text)}</text>`)
    .join("");
}

function containersSvg(fc: FlowchartData, theme: FlowTheme): string {
  const p = PALETTES[theme];
  const parts: string[] = [];
  for (const pool of fc.pools ?? []) {
    const pr = poolRect(pool);
    const [, stroke, ink] = p.nodes.neutral;
    parts.push(`<rect x="${pr.x}" y="${pr.y}" width="${pr.w}" height="${pr.h}" rx="10" fill="${p.background}" stroke="${stroke}" stroke-width="1.5"/>`);
    parts.push(`<path d="M${pr.x + 10} ${pr.y}H${pr.x + pr.w - 10}Q${pr.x + pr.w} ${pr.y} ${pr.x + pr.w} ${pr.y + 10}V${pr.y + FLOWCHART_POOL_TITLE}H${pr.x}V${pr.y + 10}Q${pr.x} ${pr.y} ${pr.x + 10} ${pr.y}Z" fill="${p.poolTitle}"/>`);
    if (pool.title) parts.push(`<text x="${pr.x + 14}" y="${pr.y + FLOWCHART_POOL_TITLE / 2 + 4.5}" font-size="13" font-weight="600" fill="${ink}">${esc(pool.title)}</text>`);
    for (const lb of laneBoxes(pool)) {
      const [lf] = p.nodes[lb.lane.color];
      if (lb.lane.color !== "neutral") parts.push(`<rect x="${lb.content.x}" y="${lb.content.y}" width="${lb.content.w}" height="${lb.content.h}" fill="${lf}" opacity="0.55"/>`);
      parts.push(`<rect x="${lb.header.x}" y="${lb.header.y}" width="${lb.header.w}" height="${lb.header.h}" fill="${p.laneHeader}"/>`);
      if (lb.index > 0) {
        const r = lb.rect;
        parts.push(pool.orient === "rows" ? `<path d="M${r.x} ${r.y}H${r.x + r.w}" stroke="${stroke}" stroke-width="1"/>` : `<path d="M${r.x} ${r.y}V${r.y + r.h}" stroke="${stroke}" stroke-width="1"/>`);
      }
      parts.push(pool.orient === "rows" ? `<path d="M${lb.header.x + lb.header.w} ${lb.rect.y}V${lb.rect.y + lb.rect.h}" stroke="${stroke}" stroke-width="1"/>` : `<path d="M${lb.rect.x} ${lb.header.y + lb.header.h}H${lb.rect.x + lb.rect.w}" stroke="${stroke}" stroke-width="1"/>`);
      if (lb.lane.title) {
        const h = lb.header;
        parts.push(`<text x="${r1(h.x + 12)}" y="${r1(pool.orient === "rows" ? h.y + 22 : h.y + h.h / 2 + 4.5)}" font-size="12.5" font-weight="600" fill="${ink}">${esc(lb.lane.title)}</text>`);
      }
    }
    parts.push(`<path d="M${pr.x} ${pr.y + FLOWCHART_POOL_TITLE}H${pr.x + pr.w}" stroke="${stroke}" stroke-width="1"/>`);
  }
  // Frames, outer ones first.
  const boxes = flowContainers(fc);
  const frames = [...(fc.frames ?? [])].sort((a, b) => (boxes.get(a.id)?.depth ?? 0) - (boxes.get(b.id)?.depth ?? 0));
  for (const f of frames) {
    const [fill, stroke] = p.nodes[f.color];
    parts.push(`<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="12" fill="${f.color === "neutral" ? (theme === "dark" ? "#1c1c20" : "#fafafb") : fill}" fill-opacity="${f.color === "neutral" ? 1 : 0.6}" stroke="${stroke}" stroke-width="1.25"/>`);
    if (f.title) parts.push(`<text x="${f.x + 14}" y="${f.y + FLOWCHART_FRAME_TITLE / 2 + 5}" font-size="13" font-weight="600" fill="${p.frameTitle}">${esc(f.title)}</text>`);
  }
  return parts.join("");
}

/** The chart as SVG markup (an empty chart gives a small empty picture). */
export function flowchartDataToSvg(fc: FlowchartData, opts: FlowchartSvgOptions = {}): string {
  const theme: FlowTheme = opts.theme === "dark" ? "dark" : "light";
  const p = PALETTES[theme];
  const title = esc((opts.title ?? "Flowchart").replace(/[<>&"]/g, ""));
  const routed = routeFlowchart(fc).routes.map(routedEdge);
  const b: Rect | null = flowchartBounds(fc, routed);
  if (!b) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" width="320" height="80" role="img" aria-label="${title} (empty)"></svg>`;
  const pad = opts.padding ?? 24;
  const vx = Math.floor(b.x - pad);
  const vy = Math.floor(b.y - pad);
  const vw = Math.ceil(b.w + pad * 2);
  const vh = Math.ceil(b.h + pad * 2);
  const uid = "fc";
  const parts: string[] = [];
  if (opts.background !== false) parts.push(`<rect x="${vx}" y="${vy}" width="100%" height="100%" fill="${p.background}"/>`);
  parts.push(containersSvg(fc, theme));
  for (const r of routed) parts.push(edgeSvg(r, theme));
  for (const n of fc.nodes) parts.push(nodeSvg(n, theme, uid, opts.imageUrl));
  for (const r of routed) if (r.labels.length) parts.push(labelSvg(r, theme));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${vw}" height="${vh}" role="img" aria-label="${title}" font-family="${FLOWCHART_FONT_STACK}">${parts.join("")}</svg>`;
}

/** A standalone SVG of stored flowchart data. */
export function flowchartToSvg(data: string, opts: FlowchartSvgOptions = {}): string {
  return flowchartDataToSvg(parseFlowchart(data), opts);
}
