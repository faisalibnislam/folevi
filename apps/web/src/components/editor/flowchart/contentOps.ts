// Pure edits for what a shape holds: its kind, label formatting and colour, alignment, auto-height and
// fit-to-text, icon, image, note, page link, and custom fill and outline. Each takes a node and returns
// the changed node (or a chart for edits across a selection); the editor applies them as one undo step.
// Kept free of React so it can be tested on its own (test/flowchart-content.test.ts).
import {
  FLOWCHART_GRID,
  FLOWCHART_LIMITS,
  FLOWCHART_SHAPE_INFO,
  FLOWCHART_SHAPE_SIZE,
  fitNodeToText,
  neededHeight,
  nodeParagraphs,
  normalizeMarks,
  richPlainText,
  sanitizeHref,
  type FlowchartData,
  type FlowColor,
  type FlowIconName,
  type FlowIconPlace,
  type FlowImageFit,
  type FlowNode,
  type FlowParagraph,
  type FlowRun,
  type FlowShape,
  type FlowTextAlign,
  type TextColor,
} from "./schema";

type Mark = NonNullable<FlowRun["marks"]>[number];

const snap = (n: number) => Math.round(n / FLOWCHART_GRID) * FLOWCHART_GRID;
const snapUp = (n: number) => Math.ceil(n / FLOWCHART_GRID) * FLOWCHART_GRID;
const HEX = /^#[0-9a-f]{6}$/i;

/** Applies `patch` to the nodes named in `ids`. */
export function patchNodes(fc: FlowchartData, ids: readonly string[], patch: (n: FlowNode) => FlowNode): FlowchartData {
  const set = new Set(ids);
  let changed = false;
  const nodes = fc.nodes.map((n) => {
    if (!set.has(n.id)) return n;
    const next = patch(n);
    if (next !== n) changed = true;
    return next;
  });
  return changed ? { ...fc, nodes } : fc;
}

/** Drops keys whose value is undefined (so serialised nodes stay small and comparisons stay simple). */
function tidy(n: FlowNode): FlowNode {
  const out = { ...n } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as unknown as FlowNode;
}

// ------------------------------------------------------------------------------------------ kind

/**
 * Changes a shape's kind, keeping its centre. A shape still at its kind's default size takes the new
 * kind's default size; one that was resized keeps its size (square kinds stay square). The label is then
 * fitted again.
 */
export function changeShape(n: FlowNode, shape: FlowShape): FlowNode {
  if (n.shape === shape) return n;
  const was = FLOWCHART_SHAPE_SIZE[n.shape];
  const next = FLOWCHART_SHAPE_SIZE[shape];
  const untouched = n.w === was.w && n.h === was.h;
  let w = untouched ? next.w : n.w;
  let h = untouched ? next.h : n.h;
  if (FLOWCHART_SHAPE_INFO[shape].square) w = h = Math.max(w, h);
  const out = fitNodeToText({ ...n, shape, w, h, x: snap(n.x + n.w / 2 - w / 2), y: snap(n.y + n.h / 2 - h / 2) });
  return out;
}

// ------------------------------------------------------------------------------------------ label

/** Whether paragraphs need more than plain text (a list or any mark). */
export function isFormatted(paragraphs: readonly FlowParagraph[]): boolean {
  return paragraphs.some((p) => p.list || p.text.some((r) => r.marks?.length));
}

/**
 * Sets a node's label from paragraphs, keeping `text` and `rich` in step: `text` is always the plain text,
 * `rich` is kept only when there is formatting. Paragraphs past the limits are left out.
 */
export function withParagraphs(n: FlowNode, paragraphs: readonly FlowParagraph[]): FlowNode {
  const kept: FlowParagraph[] = [];
  let left = FLOWCHART_LIMITS.maxText;
  let runs = 0;
  for (const p of paragraphs.slice(0, FLOWCHART_LIMITS.maxParagraphs)) {
    if (left < 0) break;
    const text: FlowRun[] = [];
    for (const r of p.text) {
      if (runs >= FLOWCHART_LIMITS.maxRuns || left <= 0) break;
      const t = r.text.replace(/\n/g, " ").slice(0, left);
      if (!t) continue;
      left -= t.length;
      runs++;
      const marks = normalizeMarks(r.marks);
      text.push(marks ? { type: "text", text: t, marks } : { type: "text", text: t });
    }
    kept.push(p.list ? { text, list: p.list } : { text });
    left -= 1;
  }
  const text = richPlainText(kept);
  const out = { ...n, text, rich: isFormatted(kept) && text ? kept : undefined };
  return tidy(out);
}

/** The label's text colour when every run shares one (null: the shape's own colour; "mixed" otherwise). */
export function labelColor(n: FlowNode): TextColor | null | "mixed" {
  const runs = nodeParagraphs(n).flatMap((p) => p.text);
  if (!runs.length) return null;
  const of = (r: FlowRun) => (r.marks?.find((m) => m.type === "color") as Extract<Mark, { type: "color" }> | undefined)?.value ?? null;
  const first = of(runs[0]!);
  return runs.every((r) => of(r) === first) ? first : "mixed";
}

/** Colours the whole label with a text colour (null: back to the shape's own text colour). */
export function setLabelColor(n: FlowNode, value: TextColor | null): FlowNode {
  if (!n.text) return n;
  const paragraphs = nodeParagraphs(n).map((p) => ({
    ...p,
    text: p.text.map((r): FlowRun => {
      const marks: Mark[] = (r.marks ?? []).filter((m) => m.type !== "color");
      if (value) marks.push({ type: "color", value });
      const norm = normalizeMarks(marks);
      return norm ? { type: "text", text: r.text, marks: norm } : { type: "text", text: r.text };
    }),
  }));
  return withParagraphs(n, paragraphs);
}

/** Toggles a simple mark (bold, italic, underline, strike) on the whole label: on unless every run has it. */
export function toggleLabelMark(n: FlowNode, type: "bold" | "italic" | "underline" | "strike"): FlowNode {
  if (!n.text) return n;
  const runs = nodeParagraphs(n).flatMap((p) => p.text);
  const on = !runs.every((r) => r.marks?.some((m) => m.type === type));
  const paragraphs = nodeParagraphs(n).map((p) => ({
    ...p,
    text: p.text.map((r): FlowRun => {
      const marks: Mark[] = (r.marks ?? []).filter((m) => m.type !== type);
      if (on) marks.push({ type });
      const norm = normalizeMarks(marks);
      return norm ? { type: "text", text: r.text, marks: norm } : { type: "text", text: r.text };
    }),
  }));
  return withParagraphs(n, paragraphs);
}

export function setAlign(n: FlowNode, align: FlowTextAlign): FlowNode {
  return tidy({ ...n, align: align === "center" ? undefined : align });
}

// ------------------------------------------------------------------------------------------ size

/** Turns auto-height on (the shape takes exactly its text's height from now on) or off. */
export function setAutoHeight(n: FlowNode, on: boolean): FlowNode {
  if (!on) return tidy({ ...n, autoHeight: undefined });
  return fitNodeToText({ ...n, autoHeight: true });
}

/**
 * Sizes the shape to its content once: the height its label needs (shrinking as well as growing; the
 * shape's smallest size without text), square kinds staying square. The centre stays put.
 */
export function fitToText(n: FlowNode): FlowNode {
  const info = FLOWCHART_SHAPE_INFO[n.shape];
  let h = n.text || n.icon || n.image ? neededHeight(n) : snapUp(Math.max(FLOWCHART_LIMITS.minSize, info.h * (info.square ? 0.5 : 0.75)));
  if (n.image && !n.text) h = Math.max(h, n.h);
  let w = n.w;
  if (info.square) w = h = Math.max(w, h);
  h = Math.min(FLOWCHART_LIMITS.maxHeight, h);
  return { ...n, w, h, y: snap(n.y + n.h / 2 - h / 2) };
}

// ------------------------------------------------------------------------------------------ icon, image, note, link

export function setIcon(n: FlowNode, icon: { name: FlowIconName; place?: FlowIconPlace } | null): FlowNode {
  const next = tidy({ ...n, icon: icon ? (icon.place && icon.place !== "left" ? { name: icon.name, place: icon.place } : { name: icon.name }) : undefined });
  return n.text ? fitNodeToText(next) : next;
}

export function setImage(n: FlowNode, image: { fileId: string; fit?: FlowImageFit } | null): FlowNode {
  const next = tidy({ ...n, image: image ? (image.fit && image.fit !== "cover" ? { fileId: image.fileId, fit: image.fit } : { fileId: image.fileId }) : undefined });
  // A shape with text gains room for its picture above the words.
  if (image && !n.image && n.text) return { ...next, h: Math.min(FLOWCHART_LIMITS.maxHeight, Math.max(next.h, snapUp(neededHeight(next) + 72))) };
  return next;
}

/** The note's text, cleaned (control characters out, the limit kept); an empty note removes it. */
export function setNote(n: FlowNode, note: string): FlowNode {
  const clean = note.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/\s+$/, "").slice(0, FLOWCHART_LIMITS.maxNote);
  return tidy({ ...n, note: clean.trim() ? clean : undefined });
}

export function setLink(n: FlowNode, link: { documentId: string; title?: string } | null): FlowNode {
  if (!link) return tidy({ ...n, link: undefined });
  const title = link.title?.trim().slice(0, FLOWCHART_LIMITS.maxTitle);
  return tidy({ ...n, link: title ? { documentId: link.documentId, title } : { documentId: link.documentId } });
}

/** A label link's address made safe (null when it can't be used). */
export function safeHref(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  return sanitizeHref(/^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith("/") || t.startsWith("#") ? t : `https://${t}`);
}

/** Size for a new shape showing an image of `width` × `height` pixels: up to 240 × 200, on the grid. */
export function imageNodeSize(width: number, height: number): { w: number; h: number } {
  const ratio = width > 0 && height > 0 ? width / height : 4 / 3;
  let w = 240;
  let h = w / ratio;
  if (h > 200) {
    h = 200;
    w = h * ratio;
  }
  return { w: Math.max(64, snap(w)), h: Math.max(48, snap(h)) };
}

// ------------------------------------------------------------------------------------------ colours

export interface Paint {
  /** A palette tint for the shape (clears a custom fill). */
  color?: FlowColor;
  /** "#rrggbb", "none", or null to go back to the tint's fill. */
  fill?: string | null;
  stroke?: string | null;
  strokeWidth?: number | null;
  strokeStyle?: FlowNode["strokeStyle"] | null;
}

const paintOk = (v: string) => v === "none" || HEX.test(v);

/** Applies fill and outline choices; null removes a custom value, an invalid colour is ignored. */
export function setPaint(n: FlowNode, p: Paint): FlowNode {
  const out: FlowNode = { ...n };
  if (p.color) {
    out.color = p.color;
    out.fill = undefined;
  }
  if (p.fill !== undefined) out.fill = p.fill === null ? undefined : paintOk(p.fill) ? p.fill.toLowerCase() : n.fill;
  if (p.stroke !== undefined) out.stroke = p.stroke === null ? undefined : paintOk(p.stroke) ? p.stroke.toLowerCase() : n.stroke;
  if (p.strokeWidth !== undefined) out.strokeWidth = p.strokeWidth === null ? undefined : Math.max(0, Math.min(FLOWCHART_LIMITS.maxStrokeWidth, p.strokeWidth));
  if (p.strokeStyle !== undefined) out.strokeStyle = p.strokeStyle === null || p.strokeStyle === "solid" ? undefined : p.strokeStyle;
  return tidy(out);
}

/** A colour typed by hand ("#abc", "abcdef", "#AABBCC") as "#rrggbb", or null. */
export function parseHex(raw: string): string | null {
  const t = raw.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(t)) return `#${[...t].map((c) => c + c).join("")}`;
  if (/^[0-9a-f]{6}$/.test(t)) return `#${t}`;
  return null;
}

/**
 * The centre nearest to `at` where a `w` × `h` shape overlaps no other shape (a little gap kept), searched
 * in widening rings; `at` itself when the canvas is that full.
 */
export function freeSpot(fc: FlowchartData, at: { x: number; y: number }, w: number, h: number, gap = 24): { x: number; y: number } {
  const clear = (c: { x: number; y: number }) => {
    const r = { x: c.x - w / 2 - gap, y: c.y - h / 2 - gap, w: w + gap * 2, h: h + gap * 2 };
    return !fc.nodes.some((n) => n.x < r.x + r.w && n.x + n.w > r.x && n.y < r.y + r.h && n.y + n.h > r.y);
  };
  if (clear(at)) return at;
  const step = FLOWCHART_GRID * 5;
  for (let ring = 1; ring <= 30; ring++) {
    const d = ring * step;
    const tries: { x: number; y: number }[] = [];
    for (let i = -ring; i <= ring; i++) tries.push({ x: at.x + i * step, y: at.y - d }, { x: at.x + i * step, y: at.y + d }, { x: at.x - d, y: at.y + i * step }, { x: at.x + d, y: at.y + i * step });
    tries.sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y));
    const hit = tries.find(clear);
    if (hit) return hit;
  }
  return at;
}
