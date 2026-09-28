// Whiteboard block data: freehand strokes stored as a JSON string in `props.data`.
//
//   { "v": 1, "strokes": [{ "points": [[x, y], …], "color": "ink", "width": 3, "opacity": 0.35 }] }
//
// Coordinates live in a fixed logical space: x in 0…WHITEBOARD_WIDTH, y in 0…props.height, so a
// drawing looks the same at any sheet width (the canvas scales with a fixed aspect ratio). A stroke may
// carry an SVG path `d` instead of points (for clients that store paths); both render the same way.
import { LIMITS } from "./generated/schema";

export const WHITEBOARD_WIDTH = 1000;
export const WHITEBOARD_DEFAULT_HEIGHT = 420;
export const WHITEBOARD_MAX_STROKES = 4000;
export const WHITEBOARD_MAX_POINTS = 4000;

/** Named stroke colours (light-theme values; the editor maps names to theme-aware CSS variables). */
export const WHITEBOARD_COLORS: Record<string, string> = {
  ink: "#1f2328",
  blue: "#2563eb",
  red: "#dc2626",
  green: "#16a34a",
  orange: "#ea580c",
  purple: "#7c3aed",
  yellow: "#facc15",
};

export interface WhiteboardStroke {
  points?: [number, number][];
  d?: string;
  color: string;
  width: number;
  opacity?: number;
}

export interface WhiteboardData {
  v?: number;
  strokes: WhiteboardStroke[];
}

const COLOR_RE = /^(#[0-9a-fA-F]{6}|[a-z]{1,16})$/;
const PATH_RE = /^[MLQCTSZmlqctsz0-9.,\s-]*$/;
const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 100_000;

/** Why `data` isn't valid whiteboard JSON, or null when it is. */
export function whiteboardDataIssue(data: string): string | null {
  if (data.length > LIMITS.maxWhiteboardDataLength) return "drawing too large";
  if (data === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return "expected JSON";
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "expected an object";
  const obj = parsed as Record<string, unknown>;
  for (const k of Object.keys(obj)) if (k !== "v" && k !== "strokes") return `unexpected field ${k}`;
  if (obj.v !== undefined && obj.v !== 1) return "unsupported version";
  if (!Array.isArray(obj.strokes)) return "strokes must be an array";
  if (obj.strokes.length > WHITEBOARD_MAX_STROKES) return "too many strokes";
  for (const [i, s] of obj.strokes.entries()) {
    if (typeof s !== "object" || s === null || Array.isArray(s)) return `stroke ${i} must be an object`;
    const st = s as Record<string, unknown>;
    for (const k of Object.keys(st)) if (!["points", "d", "color", "width", "opacity"].includes(k)) return `stroke ${i}: unexpected field ${k}`;
    if (typeof st.color !== "string" || !COLOR_RE.test(st.color)) return `stroke ${i}: invalid color`;
    if (!isNum(st.width) || st.width <= 0 || st.width > 80) return `stroke ${i}: invalid width`;
    if (st.opacity !== undefined && (!isNum(st.opacity) || st.opacity < 0 || st.opacity > 1)) return `stroke ${i}: invalid opacity`;
    const hasPoints = st.points !== undefined;
    const hasD = st.d !== undefined;
    if (hasPoints === hasD) return `stroke ${i}: needs points or d`;
    if (hasPoints) {
      if (!Array.isArray(st.points) || st.points.length === 0 || st.points.length > WHITEBOARD_MAX_POINTS) return `stroke ${i}: invalid points`;
      for (const p of st.points) if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1])) return `stroke ${i}: invalid point`;
    } else if (typeof st.d !== "string" || !st.d.trim() || st.d.length > 50_000 || !PATH_RE.test(st.d)) {
      return `stroke ${i}: invalid path`;
    }
  }
  return null;
}

/** Parses whiteboard data; anything invalid reads as an empty drawing (never throws). */
export function parseWhiteboard(data: string | null | undefined): WhiteboardData {
  if (!data || whiteboardDataIssue(data)) return { v: 1, strokes: [] };
  return JSON.parse(data) as WhiteboardData;
}

export function serializeWhiteboard(wb: WhiteboardData): string {
  return JSON.stringify({ v: 1, strokes: wb.strokes });
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** A smooth SVG path through the points (quadratic curves between midpoints). */
export function strokePath(points: readonly (readonly [number, number])[]): string {
  if (!points.length) return "";
  const [x0, y0] = points[0]!;
  if (points.length === 1) return `M${r1(x0)} ${r1(y0)}L${r1(x0 + 0.1)} ${r1(y0)}`;
  if (points.length === 2) return `M${r1(x0)} ${r1(y0)}L${r1(points[1]![0])} ${r1(points[1]![1])}`;
  let d = `M${r1(x0)} ${r1(y0)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i]!;
    const [nx, ny] = points[i + 1]!;
    d += `Q${r1(x)} ${r1(y)} ${r1((x + nx) / 2)} ${r1((y + ny) / 2)}`;
  }
  const last = points[points.length - 1]!;
  return `${d}L${r1(last[0])} ${r1(last[1])}`;
}

export function strokeD(stroke: WhiteboardStroke): string {
  return stroke.points ? strokePath(stroke.points) : (stroke.d ?? "");
}

export function whiteboardColor(name: string): string {
  return name.startsWith("#") ? name : (WHITEBOARD_COLORS[name] ?? WHITEBOARD_COLORS.ink!);
}

/** A standalone SVG of the drawing (exports). */
export function whiteboardToSvg(data: string, height: number, opts: { title?: string } = {}): string {
  const wb = parseWhiteboard(data);
  const h = Math.max(LIMITS.minWhiteboardHeight, Math.min(LIMITS.maxWhiteboardHeight, Number(height) || WHITEBOARD_DEFAULT_HEIGHT));
  const paths = wb.strokes
    .map((s) => {
      const d = strokeD(s);
      if (!d) return "";
      const op = s.opacity !== undefined && s.opacity < 1 ? ` stroke-opacity="${s.opacity}"` : "";
      return `<path d="${d}" fill="none" stroke="${whiteboardColor(s.color)}" stroke-width="${s.width}" stroke-linecap="round" stroke-linejoin="round"${op}/>`;
    })
    .join("");
  const title = (opts.title ?? "Whiteboard").replace(/[<>&"]/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WHITEBOARD_WIDTH} ${h}" width="${WHITEBOARD_WIDTH}" height="${h}" role="img" aria-label="${title}"><rect width="100%" height="100%" fill="#ffffff"/>${paths}</svg>`;
}

/** Distance from point p to segment ab (for stroke-level erasing). */
export function distanceToSegment(p: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  const x = a[0] + t * dx - p[0];
  const y = a[1] + t * dy - p[1];
  return Math.sqrt(x * x + y * y);
}

/** Whether a point is within `radius` of a stroke's centre line. */
export function strokeHit(stroke: WhiteboardStroke, p: readonly [number, number], radius: number): boolean {
  const pts = stroke.points;
  if (!pts?.length) return false;
  const r = radius + stroke.width / 2;
  if (pts.length === 1) return distanceToSegment(p, pts[0]!, pts[0]!) <= r;
  for (let i = 1; i < pts.length; i++) if (distanceToSegment(p, pts[i - 1]!, pts[i]!) <= r) return true;
  return false;
}
