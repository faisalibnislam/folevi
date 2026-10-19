// How a wireframe looks: every interface part, the phone, tablet and browser frames, and the arrows between
// screens, drawn as SVG markup in a clean greyscale low-fidelity look or a hand-drawn Sketch look. One
// drawing for the editor (./WireframeView.tsx), the read-only view (./render.tsx) and export (./svg.ts).
//
// Colours are classes (`f-*` fills, `s-*` strokes, `t-*` text), so the editor and share pages theme them
// with CSS variables (wireframe.css, light and dark) and an exported file carries a small stylesheet in
// light colours (WIREFRAME_EXPORT_STYLE). Pure: no DOM, no React. Everything a person wrote is escaped.
//
// Sketch: wobbly lines that overshoot their corners, drawn twice like a pen stroke, and the Mali typeface
// (already one of the app's fonts, a handwriting-like face). The wobble comes from a random sequence
// seeded by each part's id, so a part looks the same every time it's drawn.
import {
  WIREFRAME_OPTION_DEFAULTS,
  WIREFRAME_TOP_INSET,
  type WireItem,
  type WireLink,
  type WireScreen,
  type WireframeData,
  type WireframeFrame,
  type WireframeStyle,
} from "@folevi/editor-schema";

export interface Pt {
  x: number;
  y: number;
}
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ------------------------------------------------------------------------------------------ text helpers

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const n1 = (v: number) => Math.round(v * 10) / 10;

/** Roughly how wide a character is at `size` (the drawing never measures; the estimate errs wide). */
const charWidth = (size: number, sketch: boolean, bold = false) => size * (sketch ? 0.58 : 0.54) * (bold ? 1.06 : 1);

/** The text shortened with an ellipsis so it fits `maxW`. */
export function fitText(s: string, maxW: number, size: number, sketch: boolean, bold = false): string {
  const cw = charWidth(size, sketch, bold);
  if (s.length * cw <= maxW) return s;
  const keep = Math.max(0, Math.floor(maxW / cw) - 1);
  return keep ? `${s.slice(0, keep).trimEnd()}…` : "";
}

/** The text in lines of at most `maxW`, at most `maxLines` of them (the last one ellipsised). */
export function wrapText(s: string, maxW: number, size: number, sketch: boolean, maxLines: number, bold = false): string[] {
  const cw = charWidth(size, sketch, bold);
  const per = Math.max(1, Math.floor(maxW / cw));
  const out: string[] = [];
  for (const para of s.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (w.length > per) {
        if (line) {
          out.push(line);
          line = "";
        }
        out.push(w.slice(0, per));
        w = w.slice(per);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= per) line += ` ${w}`;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  while (out.length > 1 && !out[out.length - 1]) out.pop();
  if (out.length > maxLines) {
    const cut = out.slice(0, Math.max(1, maxLines));
    cut[cut.length - 1] = fitText(`${cut[cut.length - 1]} …`.replace(/ …$/, "…"), maxW, size, sketch, bold) || "…";
    return cut;
  }
  return out;
}

/** A part's labels, one per line of its text. */
export const labelLines = (it: Pick<WireItem, "text">) =>
  it.text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

// ------------------------------------------------------------------------------------------ the pen

function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A smooth path through points (Catmull-Rom as cubic Béziers). */
function smoothPath(p: Pt[]): string {
  if (p.length < 2) return "";
  let d = `M${n1(p[0]!.x)} ${n1(p[0]!.y)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i]!;
    const p1 = p[i]!;
    const p2 = p[i + 1]!;
    const p3 = p[i + 2] ?? p2;
    d += `C${n1(p1.x + (p2.x - p0.x) / 6)} ${n1(p1.y + (p2.y - p0.y) / 6)} ${n1(p2.x - (p3.x - p1.x) / 6)} ${n1(p2.y - (p3.y - p1.y) / 6)} ${n1(p2.x)} ${n1(p2.y)}`;
  }
  return d;
}

/** Points round a rounded rectangle, clockwise from the top-left corner's end, about `step` apart. */
function roundRectPoints(x: number, y: number, w: number, h: number, r: number, step: number): Pt[] {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const pts: Pt[] = [];
  const edge = (ax: number, ay: number, bx: number, by: number) => {
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
    for (let i = 0; i < n; i++) pts.push({ x: ax + ((bx - ax) * i) / n, y: ay + ((by - ay) * i) / n });
  };
  const arc = (cx: number, cy: number, from: number) => {
    if (r < 1) return;
    const n = Math.max(2, Math.round((r * Math.PI) / 2 / step) + 1);
    for (let i = 0; i < n; i++) {
      const a = from + ((Math.PI / 2) * i) / n;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
  };
  edge(x + r, y, x + w - r, y);
  arc(x + w - r, y + r, -Math.PI / 2);
  edge(x + w, y + r, x + w, y + h - r);
  arc(x + w - r, y + h - r, 0);
  edge(x + w - r, y + h, x + r, y + h);
  arc(x + r, y + h - r, Math.PI / 2);
  edge(x, y + h - r, x, y + r);
  arc(x + r, y + r, Math.PI);
  return pts;
}

interface Paint {
  /** Fill class (f-*). Default f-none. */
  f?: string;
  /** Stroke class (s-*); none when left out. */
  s?: string;
  sw?: number;
  dash?: boolean;
}

interface TextOpts {
  size?: number;
  weight?: number;
  cls?: string;
  anchor?: "start" | "middle" | "end";
  /** Shortened with an ellipsis to fit. */
  maxW?: number;
}

/** Writes SVG markup for one part (or frame), in its own coordinates. */
export class Pen {
  readonly parts: string[] = [];
  readonly sketch: boolean;
  private rnd: () => number;
  constructor(style: WireframeStyle, seed: string) {
    this.sketch = style === "sketch";
    this.rnd = random(seedOf(seed));
  }
  private j(amount: number) {
    return (this.rnd() - 0.5) * 2 * amount;
  }
  private cls(p: Paint) {
    return `${p.f ?? "f-none"}${p.s ? ` ${p.s}` : ""}`;
  }
  private strokeAttrs(p: Paint) {
    return p.s ? ` stroke-width="${n1((p.sw ?? 1.25) * (this.sketch ? 1.15 : 1))}"${p.dash ? ' stroke-dasharray="4 4"' : ""}` : "";
  }
  raw(svg: string) {
    this.parts.push(svg);
    return this;
  }

  /** One wobbly stroke from a to b (sketch). */
  private wobble(ax: number, ay: number, bx: number, by: number, over = 1.5): string {
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    const bow = Math.min(len * 0.022 + 0.6, 4.2);
    const s0 = { x: ax - ux * this.j(over) + this.j(1), y: ay - uy * this.j(over) + this.j(1) };
    const s1 = { x: bx + ux * this.j(over) + this.j(1), y: by + uy * this.j(over) + this.j(1) };
    const t = 0.35 + this.rnd() * 0.3;
    const c = { x: ax + (bx - ax) * t - uy * this.j(bow), y: ay + (by - ay) * t + ux * this.j(bow) };
    return `M${n1(s0.x)} ${n1(s0.y)}Q${n1(c.x)} ${n1(c.y)} ${n1(s1.x)} ${n1(s1.y)}`;
  }

  line(ax: number, ay: number, bx: number, by: number, p: Paint = { s: "s-line" }) {
    if (!this.sketch) return this.raw(`<path class="${this.cls({ ...p, f: "f-none" })}"${this.strokeAttrs(p)} stroke-linecap="round" d="M${n1(ax)} ${n1(ay)}L${n1(bx)} ${n1(by)}"/>`);
    const twice = Math.hypot(bx - ax, by - ay) > 16 && !p.dash;
    const d = this.wobble(ax, ay, bx, by) + (twice ? this.wobble(ax, ay, bx, by) : "");
    return this.raw(`<path class="${this.cls({ ...p, f: "f-none" })}"${this.strokeAttrs(p)} stroke-linecap="round" d="${d}"/>`);
  }

  rect(x: number, y: number, w: number, h: number, r: number, p: Paint) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    if (!this.sketch) return this.raw(`<rect class="${this.cls(p)}"${this.strokeAttrs(p)} x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${n1(h)}"${r ? ` rx="${n1(r)}"` : ""}/>`);
    // Sketch: the fill a little off the outline, then the outline drawn with the pen.
    if (p.f && p.f !== "f-none") {
      const ox = this.j(1.2);
      const oy = this.j(1.2);
      this.raw(`<rect class="${p.f}" x="${n1(x + ox)}" y="${n1(y + oy)}" width="${n1(w)}" height="${n1(h)}"${r ? ` rx="${n1(r)}"` : ""}/>`);
    }
    if (!p.s) return this;
    let d: string;
    if (r >= 6 || (w < 14 && h < 14)) {
      const pts = roundRectPoints(x, y, w, h, r, 22);
      d = this.loop(pts, 1.1);
      if (w > 30 && h > 30) d += this.loop(pts, 1.1);
    } else {
      const edges: [number, number, number, number][] = [
        [x, y, x + w, y],
        [x + w, y, x + w, y + h],
        [x + w, y + h, x, y + h],
        [x, y + h, x, y],
      ];
      d = edges.map((e) => this.wobble(...e, 2.5)).join("");
      if (w > 30 && h > 30) d += edges.map((e) => this.wobble(...e, 2.5)).join("");
    }
    return this.raw(`<path class="${this.cls({ ...p, f: "f-none" })}"${this.strokeAttrs(p)} stroke-linecap="round" stroke-linejoin="round" d="${d}"/>`);
  }

  /** A closed outline drawn like a pen loop: starting anywhere, a little past where it began (sketch). */
  private loop(pts: Pt[], amp: number): string {
    if (pts.length < 3) return "";
    const start = Math.floor(this.rnd() * pts.length);
    const extra = Math.max(1, Math.round(pts.length * 0.08));
    const seq: Pt[] = [];
    for (let i = 0; i <= pts.length + extra; i++) {
      const q = pts[(start + i) % pts.length]!;
      seq.push({ x: q.x + this.j(amp), y: q.y + this.j(amp) });
    }
    return smoothPath(seq);
  }

  circle(cx: number, cy: number, r: number, p: Paint) {
    if (!this.sketch) return this.raw(`<circle class="${this.cls(p)}"${this.strokeAttrs(p)} cx="${n1(cx)}" cy="${n1(cy)}" r="${n1(Math.max(0.5, r))}"/>`);
    if (p.f && p.f !== "f-none") this.raw(`<circle class="${p.f}" cx="${n1(cx + this.j(0.8))}" cy="${n1(cy + this.j(0.8))}" r="${n1(Math.max(0.5, r))}"/>`);
    if (!p.s) return this;
    const n = Math.max(8, Math.round((2 * Math.PI * r) / 7));
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    return this.raw(`<path class="${this.cls({ ...p, f: "f-none" })}"${this.strokeAttrs(p)} stroke-linecap="round" d="${this.loop(pts, Math.min(0.9, r * 0.08 + 0.3))}"/>`);
  }

  /** A filled or stroked path, as given (icons and small marks keep their shape in both looks). */
  path(d: string, p: Paint, extra = "") {
    return this.raw(`<path class="${this.cls(p)}"${this.strokeAttrs(p)} stroke-linecap="round" stroke-linejoin="round"${extra} d="${d}"/>`);
  }

  /** A placeholder line of text: a soft bar (clean) or a thick wavy stroke (sketch). */
  bar(x: number, y: number, w: number, h: number, cls = "f-soft") {
    if (w < 2) return this;
    if (!this.sketch) return this.rect(x, y, w, h, h / 2, { f: cls });
    const s = cls.replace("f-", "s-");
    return this.raw(`<path class="f-none ${s}" stroke-width="${n1(h * 0.9)}" stroke-linecap="round" d="${this.wobble(x + h / 2, y + h / 2, x + w - h / 2, y + h / 2, 0.5)}"/>`);
  }

  text(x: number, y: number, s: string, o: TextOpts = {}) {
    const size = o.size ?? 14;
    const weight = o.weight ?? 400;
    const str = o.maxW !== undefined ? fitText(s, o.maxW, size, this.sketch, weight >= 600) : s;
    if (!str) return this;
    return this.raw(
      `<text class="${o.cls ?? "t-ink"}" x="${n1(x)}" y="${n1(y)}" font-size="${n1(size)}"${weight !== 400 ? ` font-weight="${weight}"` : ""}${o.anchor && o.anchor !== "start" ? ` text-anchor="${o.anchor}"` : ""} dominant-baseline="central">${esc(str)}</text>`,
    );
  }

  /** Lines of text from the top (`y` is the first line's centre). Returns where the text ended. */
  lines(x: number, y: number, lines: string[], o: TextOpts & { lh?: number } = {}) {
    const lh = o.lh ?? (o.size ?? 14) * 1.4;
    lines.forEach((l, i) => this.text(x, y + i * lh, l, o));
    return y + lines.length * lh;
  }

  icon(name: string, x: number, y: number, size: number, cls = "s-ink") {
    const glyph = ICONS[ICON_ALIAS[name] ?? name] ?? ICONS.generic!;
    const k = size / 24;
    const fill = glyph.fill ? ` ${cls.replace("s-", "f-")}` : "";
    return this.raw(`<g transform="translate(${n1(x)} ${n1(y)}) scale(${n1(k * 1000) / 1000})"><path class="${fill ? fill.trim() : "f-none"} ${cls}" stroke-width="${n1(1.7 / Math.max(0.4, k))}" stroke-linecap="round" stroke-linejoin="round" d="${glyph.d}"/></g>`);
  }

  toString() {
    return this.parts.join("");
  }
}

// ------------------------------------------------------------------------------------------ icons

/** Small line icons on a 24 grid, for the icon part (its text names one) and inside other parts. */
const ICONS: Record<string, { d: string; fill?: boolean }> = {
  generic: { d: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM9.2 9.2h5.6v5.6H9.2z" },
  menu: { d: "M4 7h16M4 12h16M4 17h16" },
  search: { d: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.8-4.8" },
  close: { d: "M6 6l12 12M18 6L6 18" },
  plus: { d: "M12 5v14M5 12h14" },
  back: { d: "M15 5l-7 7 7 7" },
  forward: { d: "M9 5l7 7-7 7" },
  down: { d: "M6 9l6 6 6-6" },
  more: { d: "M5 12h.01M12 12h.01M19 12h.01" },
  star: { d: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8-4.3-4.1 5.9-.9z" },
  heart: { d: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" },
  home: { d: "M4 11l8-7 8 7M6 9.5V20h12V9.5" },
  user: { d: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0" },
  bell: { d: "M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" },
  settings: { d: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" },
  check: { d: "M5 12.5l4.5 4.5L19 7.5" },
  cart: { d: "M3 4h2.5l2.2 10.5h10.3L20 7H7M9 19.5h.01M17 19.5h.01" },
  mail: { d: "M3.5 6.5h17v11h-17zM3.5 7l8.5 6.5L20.5 7" },
  calendar: { d: "M4.5 6h15v14h-15zM4.5 10h15M8.5 3.5v4M15.5 3.5v4" },
  camera: { d: "M4 8h3.5L9 5.5h6L16.5 8H20v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" },
  share: { d: "M12 15V4M8 8l4-4 4 4M5 12v8h14v-8" },
  edit: { d: "M5 19h4L19 9l-4-4L5 15zM13.5 6.5l4 4" },
  trash: { d: "M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" },
  image: { d: "M4.5 5.5h15v13h-15zM4.5 15.5l4.5-4.5 4 4 2.5-2.5 4 4M15 9.5h.01" },
  play: { d: "M8.5 5.8v12.4l10-6.2z", fill: true },
  pin: { d: "M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" },
  lock: { d: "M6.5 11h11v9h-11zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" },
  chat: { d: "M4.5 5.5h15v10h-9l-4 3.5v-3.5h-2z" },
  filter: { d: "M4 5h16l-6 7.5V19l-4-2v-4.5z" },
  download: { d: "M12 4v11M8 11l4 4 4-4M5 19.5h14" },
  wifi: { d: "M4 9.5a12 12 0 0 1 16 0M7 12.8a7.5 7.5 0 0 1 10 0M10 16a3 3 0 0 1 4 0M12 19h.01" },
};
const ICON_ALIAS: Record<string, string> = {
  hamburger: "menu",
  x: "close",
  cancel: "close",
  add: "plus",
  new: "plus",
  left: "back",
  "arrow-left": "back",
  previous: "back",
  right: "forward",
  next: "forward",
  chevron: "forward",
  dots: "more",
  ellipsis: "more",
  favorite: "heart",
  like: "heart",
  profile: "user",
  account: "user",
  person: "user",
  notifications: "bell",
  notification: "bell",
  gear: "settings",
  cog: "settings",
  done: "check",
  bag: "cart",
  basket: "cart",
  shop: "cart",
  email: "mail",
  envelope: "mail",
  date: "calendar",
  photo: "camera",
  pencil: "edit",
  delete: "trash",
  bin: "trash",
  picture: "image",
  video: "play",
  location: "pin",
  map: "pin",
  message: "chat",
  comment: "chat",
};
export const ICON_NAMES = Object.keys(ICONS).filter((k) => k !== "generic");

// ------------------------------------------------------------------------------------------ parts

/** A part's option, or what it shows while it's left out. */
const opt = (it: WireItem, k: "count" | "cols" | "value") => it[k] ?? WIREFRAME_OPTION_DEFAULTS[it.kind]?.[k] ?? 1;

/**
 * How many tabs, rows or items a part shows: its count, else one per line of its text (a nav bar's and a
 * sidebar's first line is their title, a table's its header), else the part's default.
 */
export function countOf(it: WireItem): number {
  if (it.count !== undefined) return it.count;
  const L = labelLines(it);
  const fallback = WIREFRAME_OPTION_DEFAULTS[it.kind]?.count ?? 3;
  if (it.kind === "table" || it.kind === "navBar" || it.kind === "sidebar") return L.length > 1 ? L.length - 1 : fallback;
  if (it.kind === "pagination") return fallback;
  return L.length || fallback;
}

/** A table's columns: its own, else the most cells in a line, else the default. */
export function colsOf(it: WireItem): number {
  if (it.cols !== undefined) return it.cols;
  const cells = labelLines(it).map((l) => l.split(/\s*[|\t]\s*/).length);
  return cells.length ? Math.max(...cells) : (WIREFRAME_OPTION_DEFAULTS.table?.cols ?? 3);
}

const clampN = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** The size for a part's text from its height. */
const sizeFor = (h: number, k: number, lo: number, hi: number) => clampN(Math.round(h * k), lo, hi);

/**
 * One part, in its own coordinates (0, 0 is its top-left corner). `screen` is the screen it's on (a nav
 * bar low on a phone is a tab bar).
 */
export function drawItem(it: WireItem, style: WireframeStyle, screen?: Pick<WireScreen, "w" | "h" | "frame">): string {
  const p = new Pen(style, it.id);
  const { w, h } = it;
  const L = labelLines(it);
  const first = L[0] ?? "";
  const sk = p.sketch;
  switch (it.kind) {
    case "text": {
      const size = sizeFor(h, 0.6, 11, 18);
      const lh = size * 1.4;
      const lines = wrapText(it.text.trim() || "Text", w, size, sk, Math.max(1, Math.floor(h / lh)));
      p.lines(0, Math.min(h / 2, lh / 2), lines, { size, lh });
      break;
    }
    case "heading": {
      const size = sizeFor(h, 0.66, 14, 44);
      const lh = size * 1.2;
      const lines = wrapText(it.text.trim() || "Heading", w, size, sk, Math.max(1, Math.floor(h / lh)), true);
      p.lines(0, Math.min(h / 2, lh / 2), lines, { size, lh, weight: 700 });
      break;
    }
    case "paragraph": {
      if (it.text.trim()) {
        p.lines(0, 10, wrapText(it.text.trim(), w, 14, sk, Math.max(1, Math.floor(h / 20))), { size: 14, lh: 20, cls: "t-muted" });
      } else {
        const rows = Math.max(1, Math.floor((h + 8) / 20));
        for (let i = 0; i < rows; i++) p.bar(0, i * 20 + 6, w * (i === rows - 1 && rows > 1 ? 0.62 : [1, 0.94, 0.97, 0.9][i % 4]!), 8);
      }
      break;
    }
    case "button": {
      const primary = it.variant !== "secondary";
      p.rect(0, 0, w, h, Math.min(10, h / 2), primary ? { f: "f-strong" } : { f: "f-fill", s: "s-ink", sw: 1.4 });
      const size = sizeFor(h, 0.32, 11, 17);
      p.text(w / 2, h / 2, it.text.trim() || "Button", { size, weight: 600, anchor: "middle", cls: primary ? "t-onstrong" : "t-ink", maxW: w - 16 });
      break;
    }
    case "input":
    case "dropdown":
    case "datePicker": {
      if (it.kind === "datePicker" && h >= 150 && w >= 160) {
        drawCalendar(p, it, w, h);
        break;
      }
      p.rect(0, 0, w, h, Math.min(8, h / 2), { f: "f-fill", s: "s-line" });
      const size = sizeFor(h, 0.3, 11, 16);
      const icon = it.kind === "dropdown" ? "down" : it.kind === "datePicker" ? "calendar" : null;
      const room = icon ? Math.min(20, h * 0.5) + 16 : 0;
      const fallback = it.kind === "dropdown" ? "Select an option" : it.kind === "datePicker" ? "Pick a date" : "Placeholder";
      p.text(12, h / 2, first || fallback, { size, cls: it.kind === "dropdown" && first ? "t-ink" : "t-muted", maxW: w - 24 - room });
      if (icon) {
        const s = Math.min(18, h * 0.5);
        p.icon(icon, w - 12 - s, h / 2 - s / 2, s, "s-muted");
      }
      break;
    }
    case "search": {
      p.rect(0, 0, w, h, Math.min(h / 2, 22), { f: "f-fill", s: "s-line" });
      const s = Math.min(18, h * 0.46);
      p.icon("search", 12, h / 2 - s / 2, s, "s-muted");
      p.text(12 + s + 8, h / 2, first || "Search", { size: sizeFor(h, 0.32, 11, 16), cls: "t-muted", maxW: w - s - 32 });
      break;
    }
    case "textarea": {
      p.rect(0, 0, w, h, Math.min(8, h / 2), { f: "f-fill", s: "s-line" });
      const lines = wrapText(it.text.trim() || "Write something here", w - 24, 14, sk, Math.max(1, Math.floor((h - 16) / 20)));
      p.lines(12, 18, lines, { size: 14, lh: 20, cls: "t-muted" });
      if (w > 30 && h > 30) {
        p.line(w - 12, h - 5, w - 5, h - 12, { s: "s-line" });
        p.line(w - 8, h - 5, w - 5, h - 8, { s: "s-line" });
      }
      break;
    }
    case "checkbox": {
      const s = Math.min(18, h);
      const y = h / 2 - s / 2;
      p.rect(0, y, s, s, 4, it.checked ? { f: "f-strong" } : { f: "f-fill", s: "s-ink", sw: 1.4 });
      if (it.checked) p.path(`M${n1(s * 0.24)} ${n1(y + s * 0.52)}l${n1(s * 0.2)} ${n1(s * 0.2)} ${n1(s * 0.33)}-${n1(s * 0.4)}`, { s: "s-onstrong", sw: 2 });
      p.text(s + 10, h / 2, first || "Checkbox", { size: sizeFor(h, 0.5, 11, 15), maxW: w - s - 10 });
      break;
    }
    case "radio": {
      const r = Math.min(9, h / 2);
      p.circle(r, h / 2, r, { f: "f-fill", s: "s-ink", sw: 1.4 });
      if (it.checked) p.circle(r, h / 2, r * 0.5, { f: "f-strong" });
      p.text(r * 2 + 10, h / 2, first || "Option", { size: sizeFor(h, 0.5, 11, 15), maxW: w - r * 2 - 10 });
      break;
    }
    case "toggle": {
      const th = Math.min(26, h);
      const tw = th * 1.75;
      const label = first || (w >= 140 ? "Setting" : "");
      const tx = label ? w - tw : 0;
      const ty = h / 2 - th / 2;
      p.rect(tx, ty, tw, th, th / 2, it.checked ? { f: "f-strong" } : { f: "f-soft", s: "s-line" });
      const kr = th / 2 - 3;
      p.circle(it.checked ? tx + tw - th / 2 : tx + th / 2, h / 2, kr, { f: "f-screen", s: it.checked ? undefined : "s-line" });
      if (label) p.text(0, h / 2, label, { size: sizeFor(h, 0.48, 11, 15), maxW: w - tw - 12 });
      break;
    }
    case "slider": {
      const v = clampN(opt(it, "value"), 0, 100) / 100;
      const r = Math.min(9, h / 2);
      const x0 = r;
      const x1 = w - r;
      const at = x0 + (x1 - x0) * v;
      p.line(x0, h / 2, x1, h / 2, { s: "s-soft", sw: 4 });
      if (at > x0) p.line(x0, h / 2, at, h / 2, { s: "s-strong", sw: 4 });
      p.circle(at, h / 2, r, { f: "f-screen", s: "s-strong", sw: 2 });
      break;
    }
    case "progress": {
      const v = clampN(opt(it, "value"), 0, 100) / 100;
      p.rect(0, 0, w, h, h / 2, { f: "f-soft" });
      if (v > 0) p.rect(0, 0, Math.max(h, w * v), h, h / 2, { f: "f-strong" });
      break;
    }
    case "tabs": {
      const n = clampN(Math.round(countOf(it)), 1, 50);
      const tw = w / n;
      const size = sizeFor(h, 0.34, 11, 15);
      p.line(0, h - 0.5, w, h - 0.5, { s: "s-line" });
      for (let i = 0; i < n; i++) {
        p.text(tw * i + tw / 2, h / 2, L[i] ?? `Tab ${i + 1}`, { size, weight: i === 0 ? 600 : 500, anchor: "middle", cls: i === 0 ? "t-ink" : "t-muted", maxW: tw - 8 });
      }
      p.rect(Math.min(8, tw * 0.1), h - 3, tw - Math.min(16, tw * 0.2), 3, 1.5, { f: "f-strong" });
      break;
    }
    case "navBar":
      drawNavBar(p, it, L, screen);
      break;
    case "sidebar": {
      p.rect(0, 0, w, h, 0, { f: "f-soft" });
      p.line(w - 0.5, 0, w - 0.5, h, { s: "s-line" });
      p.text(16, 28, first || "Menu", { size: 15, weight: 700, maxW: w - 32 });
      const n = clampN(Math.round(countOf(it)), 1, 50);
      const rowH = 40;
      for (let i = 0; i < n && 56 + i * rowH + rowH <= h; i++) {
        const y = 56 + i * rowH;
        if (i === 0) p.rect(8, y + 2, w - 16, rowH - 4, 8, { f: "f-fill" });
        p.rect(18, y + rowH / 2 - 8, 16, 16, 4, { s: i === 0 ? "s-ink" : "s-muted" });
        const label = L[i + 1];
        if (label) p.text(44, y + rowH / 2, label, { size: 14, weight: i === 0 ? 600 : 400, cls: i === 0 ? "t-ink" : "t-muted", maxW: w - 56 });
        else p.bar(44, y + rowH / 2 - 4, Math.min(w - 64, 70 + ((i * 37) % 50)), 8, i === 0 ? "f-shade" : "f-line");
      }
      break;
    }
    case "menu": {
      const n = clampN(Math.round(countOf(it)), 1, 50);
      p.rect(3, 4, w - 3, h - 4, 10, { f: "f-shadow" });
      p.rect(0, 0, w - 3, h - 4, 10, { f: "f-screen", s: "s-line" });
      const rowH = (h - 16) / n;
      for (let i = 0; i < n; i++) {
        const y = 6 + i * rowH;
        if (i === 0) p.rect(5, y, w - 13, rowH, 6, { f: "f-soft" });
        p.text(16, y + rowH / 2, L[i] ?? `Menu item ${i + 1}`, { size: sizeFor(rowH, 0.36, 10, 14), maxW: w - 32 });
      }
      break;
    }
    case "breadcrumbs": {
      const n = clampN(Math.round(countOf(it)), 1, 50);
      const names = Array.from({ length: n }, (_, i) => L[i] ?? (["Home", "Section", "Page"][i] ?? `Level ${i + 1}`));
      const size = sizeFor(h, 0.56, 11, 15);
      let x = 0;
      names.forEach((name, i) => {
        const last = i === n - 1;
        const room = w - x;
        if (room < 12) return;
        const str = fitText(name, Math.min(room, 160), size, sk, last);
        p.text(x, h / 2, str, { size, weight: last ? 600 : 400, cls: last ? "t-ink" : "t-muted" });
        x += str.length * charWidth(size, sk, last) + 8;
        if (!last && x + 16 < w) {
          p.icon("forward", x - 2, h / 2 - 6, 12, "s-muted");
          x += 16;
        }
      });
      break;
    }
    case "pagination": {
      const pages = clampN(Math.round(countOf(it)), 1, 50);
      const s = Math.min(h, 36);
      const gap = 6;
      const fit = Math.max(1, Math.floor((w + gap) / (s + gap)) - 2);
      const shown: (number | "…")[] = pages <= fit ? Array.from({ length: pages }, (_, i) => i + 1) : [...Array.from({ length: Math.max(1, fit - 2) }, (_, i) => i + 1), "…", pages];
      const cells: (string | number)[] = ["‹", ...shown, "›"];
      const total = cells.length * s + (cells.length - 1) * gap;
      let x = Math.max(0, (w - total) / 2);
      for (const c of cells) {
        const active = c === 1;
        if (c !== "…") p.rect(x, h / 2 - s / 2, s, s, 8, active ? { f: "f-strong" } : { f: "f-fill", s: "s-line" });
        p.text(x + s / 2, h / 2, String(c), { size: sizeFor(s, 0.38, 10, 14), weight: active ? 600 : 400, anchor: "middle", cls: active ? "t-onstrong" : "t-ink" });
        x += s + gap;
      }
      break;
    }
    case "card": {
      p.rect(0, 0, w, h, 12, { f: "f-fill", s: "s-line" });
      let y = 16;
      if (h >= 150) {
        const ih = Math.round(h * 0.45);
        p.rect(0, 0, w, ih, 12, { f: "f-soft" });
        if (!sk) p.rect(0, ih - 12, w, 12, 0, { f: "f-soft" });
        const s = Math.min(36, ih * 0.4);
        p.icon("image", w / 2 - s / 2, ih / 2 - s / 2, s, "s-muted");
        y = ih + 16;
      }
      p.text(16, y + 8, first || "Card title", { size: 16, weight: 600, maxW: w - 32 });
      y += 30;
      const rest = L.slice(1).join(" ");
      if (rest) p.lines(16, y + 6, wrapText(rest, w - 32, 13, sk, Math.max(1, Math.floor((h - y - 8) / 18))), { size: 13, lh: 18, cls: "t-muted" });
      else for (let i = 0; i < 2 && y + i * 18 + 10 < h - 8; i++) p.bar(16, y + i * 18 + 2, (w - 32) * (i ? 0.6 : 0.9), 7);
      break;
    }
    case "table":
      drawTable(p, it, L, w, h);
      break;
    case "list": {
      const n = clampN(Math.round(countOf(it)), 1, 50);
      const rowH = h / n;
      const r = Math.min(14, rowH * 0.28);
      for (let i = 0; i < n; i++) {
        const y = i * rowH;
        const cy = y + rowH / 2;
        p.circle(r + 2, cy, r, { f: "f-soft", s: "s-line" });
        const tx = r * 2 + 14;
        if (L[i]) p.text(tx, cy, L[i]!, { size: sizeFor(rowH, 0.26, 11, 15), maxW: w - tx - 28 });
        else {
          p.bar(tx, cy - 9, Math.max(10, (w - tx - 40) * (0.6 + ((i * 13) % 30) / 100)), 7, "f-shade");
          p.bar(tx, cy + 4, Math.max(10, (w - tx - 40) * 0.4), 6);
        }
        if (w > 120) p.icon("forward", w - 18, cy - 7, 14, "s-muted");
        if (i < n - 1) p.line(tx, y + rowH, w, y + rowH, { s: "s-soft" });
      }
      break;
    }
    case "avatar": {
      const r = Math.min(w, h) / 2;
      const cx = w / 2;
      const cy = h / 2;
      p.circle(cx, cy, r, { f: "f-soft", s: "s-line" });
      if (first) {
        const initials = first
          .split(/\s+/)
          .slice(0, 2)
          .map((x) => x[0]!.toUpperCase())
          .join("");
        p.text(cx, cy, initials, { size: Math.max(8, r * 0.75), weight: 600, anchor: "middle" });
      } else {
        p.circle(cx, cy - r * 0.2, r * 0.32, { f: "f-shade" });
        p.path(`M${n1(cx - r * 0.58)} ${n1(cy + r * 0.62)}a${n1(r * 0.58)} ${n1(r * 0.5)} 0 0 1 ${n1(r * 1.16)} 0z`, { f: "f-shade" });
      }
      break;
    }
    case "badge": {
      p.rect(0, 0, w, h, h / 2, { f: "f-strong" });
      p.text(w / 2, h / 2, first || "New", { size: sizeFor(h, 0.5, 9, 13), weight: 600, anchor: "middle", cls: "t-onstrong", maxW: w - 10 });
      break;
    }
    case "tooltip": {
      const bh = Math.max(8, h - 7);
      p.rect(0, 0, w, bh, Math.min(8, bh / 2), { f: "f-tip" });
      p.path(`M${n1(w / 2 - 7)} ${n1(bh - 0.5)}L${n1(w / 2)} ${n1(h)}L${n1(w / 2 + 7)} ${n1(bh - 0.5)}z`, { f: "f-tip" });
      p.text(w / 2, bh / 2, first || "Tooltip", { size: sizeFor(bh, 0.42, 10, 14), anchor: "middle", cls: "t-ontip", maxW: w - 16 });
      break;
    }
    case "modal": {
      p.rect(4, 6, w - 4, h - 6, 14, { f: "f-shadow" });
      p.rect(0, 0, w - 4, h - 6, 14, { f: "f-screen", s: "s-line" });
      const iw = w - 4;
      const ih = h - 6;
      p.text(20, 30, first || "Dialog title", { size: 17, weight: 700, maxW: iw - 64 });
      p.icon("close", iw - 34, 20, 16, "s-muted");
      const rest = L.slice(1).join(" ");
      const bodyTop = 58;
      const bodyRoom = ih - bodyTop - 64;
      if (rest) p.lines(20, bodyTop, wrapText(rest, iw - 40, 14, sk, Math.max(1, Math.floor(bodyRoom / 20))), { size: 14, lh: 20, cls: "t-muted" });
      else for (let i = 0; i < 3 && i * 18 < bodyRoom; i++) p.bar(20, bodyTop - 4 + i * 18, (iw - 40) * [1, 0.92, 0.55][i]!, 8);
      if (ih >= 120 && iw >= 200) {
        const bw = 92;
        const by = ih - 52;
        p.rect(iw - 20 - bw, by, bw, 36, 10, { f: "f-strong" });
        p.text(iw - 20 - bw / 2, by + 18, "Confirm", { size: 13, weight: 600, anchor: "middle", cls: "t-onstrong" });
        p.rect(iw - 28 - bw * 2, by, bw, 36, 10, { f: "f-fill", s: "s-ink", sw: 1.4 });
        p.text(iw - 28 - bw * 1.5, by + 18, "Cancel", { size: 13, weight: 600, anchor: "middle" });
      }
      break;
    }
    case "alert": {
      p.rect(0, 0, w, h, 10, { f: "f-soft", s: "s-line" });
      p.rect(0, 0, 5, h, 2.5, { f: "f-strong" });
      const r = Math.min(10, h / 2 - 4);
      p.circle(22, h / 2, r, { s: "s-ink", sw: 1.5 });
      p.line(22, h / 2 - r * 0.45, 22, h / 2 + r * 0.1, { s: "s-ink", sw: 1.8 });
      p.circle(22, h / 2 + r * 0.45, 1.1, { f: "f-ink" });
      const closing = w > 220;
      const lines = wrapText(it.text.trim() || "Something needs your attention", w - 44 - (closing ? 36 : 12), 14, sk, Math.max(1, Math.floor((h - 8) / 19)));
      p.lines(40, h / 2 - ((lines.length - 1) * 19) / 2, lines, { size: 14, lh: 19 });
      if (closing) p.icon("close", w - 28, h / 2 - 7, 14, "s-muted");
      break;
    }
    case "image": {
      p.rect(0, 0, w, h, Math.min(8, w / 4, h / 4), { f: "f-soft", s: "s-line" });
      const s = Math.min(48, w * 0.4, h * 0.4);
      if (s >= 10) p.icon("image", w / 2 - s / 2, h / 2 - s / 2 - (first ? 8 : 0), s, "s-muted");
      if (first && h > 60) p.text(w / 2, h / 2 + s / 2 + 6, first, { size: 12, anchor: "middle", cls: "t-muted", maxW: w - 16 });
      break;
    }
    case "icon": {
      const s = Math.min(w, h);
      p.icon(first.toLowerCase().replace(/\s+/g, "-") || "generic", w / 2 - s / 2, h / 2 - s / 2, s, "s-ink");
      break;
    }
    case "video": {
      p.rect(0, 0, w, h, Math.min(8, w / 4, h / 4), { f: "f-shade", s: "s-line" });
      const r = Math.min(28, w * 0.14, h * 0.18);
      p.circle(w / 2, h / 2 - (h > 80 ? 6 : 0), r, { f: "f-strong" });
      p.icon("play", w / 2 - r * 0.62, h / 2 - (h > 80 ? 6 : 0) - r * 0.62, r * 1.3, "s-onstrong");
      if (h > 80) {
        p.line(14, h - 16, w - 14, h - 16, { s: "s-line", sw: 3 });
        p.line(14, h - 16, 14 + (w - 28) * 0.35, h - 16, { s: "s-strong", sw: 3 });
      }
      break;
    }
    case "map": {
      p.rect(0, 0, w, h, Math.min(8, w / 4, h / 4), { f: "f-soft", s: "s-line" });
      const road = { s: "s-screen", sw: Math.max(3, Math.min(8, Math.min(w, h) * 0.04)) };
      p.line(w * 0.05, h * 0.7, w * 0.95, h * 0.45, road);
      p.line(w * 0.35, h * 0.05, w * 0.42, h * 0.95, road);
      p.line(w * 0.7, h * 0.08, w * 0.62, h * 0.92, { ...road, sw: road.sw * 0.6 });
      const s = Math.min(36, w * 0.25, h * 0.3);
      p.path(`M${n1(w / 2)} ${n1(h / 2 + s * 0.5)}c${n1(-s * 0.35)} ${n1(-s * 0.4)} ${n1(-s * 0.45)} ${n1(-s * 0.62)} ${n1(-s * 0.45)} ${n1(-s * 0.85)}a${n1(s * 0.45)} ${n1(s * 0.45)} 0 0 1 ${n1(s * 0.9)} 0c0 ${n1(s * 0.23)} ${n1(-s * 0.1)} ${n1(s * 0.45)} ${n1(-s * 0.45)} ${n1(s * 0.85)}z`, { f: "f-strong" });
      p.circle(w / 2, h / 2 - s * 0.36, s * 0.16, { f: "f-screen" });
      break;
    }
    case "divider": {
      if (w >= h) p.line(0, h / 2, w, h / 2, { s: "s-line", sw: 1.25 });
      else p.line(w / 2, 0, w / 2, h, { s: "s-line", sw: 1.25 });
      break;
    }
  }
  return p.toString();
}

function drawCalendar(p: Pen, it: WireItem, w: number, h: number) {
  p.rect(0, 0, w, h, 12, { f: "f-fill", s: "s-line" });
  p.text(16, 24, labelLines(it)[0] || "October 2026", { size: 15, weight: 600, maxW: w - 80 });
  p.icon("back", w - 60, 16, 16, "s-muted");
  p.icon("forward", w - 32, 16, 16, "s-muted");
  const cw = (w - 16) / 7;
  const top = 48;
  const ch = (h - top - 8) / 7;
  const size = Math.max(8, Math.min(13, ch * 0.42, cw * 0.42));
  ["M", "T", "W", "T", "F", "S", "S"].forEach((d, i) => p.text(8 + cw * i + cw / 2, top + ch / 2, d, { size, anchor: "middle", cls: "t-muted" }));
  for (let day = 1; day <= 31; day++) {
    const cell = day + 2;
    const row = Math.floor(cell / 7) + 1;
    const col = cell % 7;
    if (row > 6) break;
    const cx = 8 + cw * col + cw / 2;
    const cy = top + ch * row + ch / 2;
    const picked = day === 15;
    if (picked) p.circle(cx, cy, Math.min(cw, ch) * 0.42, { f: "f-strong" });
    p.text(cx, cy, String(day), { size, anchor: "middle", weight: picked ? 600 : 400, cls: picked ? "t-onstrong" : "t-ink" });
  }
}

function drawNavBar(p: Pen, it: WireItem, L: string[], screen?: Pick<WireScreen, "w" | "h" | "frame">) {
  const { w, h } = it;
  // Low on a phone or tablet: a tab bar, icons over labels (every line a tab).
  const tabBar = screen && screen.frame !== "browser" && w < 900 && it.y + h / 2 > screen.h * 0.6;
  const n = clampN(Math.round(tabBar ? (it.count ?? (L.length || 4)) : countOf(it)), 1, 50);
  p.rect(0, 0, w, h, 0, { f: "f-fill" });
  if (tabBar) {
    p.line(0, 0.5, w, 0.5, { s: "s-line" });
    const tw = w / n;
    const s = Math.min(24, h * 0.4);
    const icons = ["home", "search", "plus", "bell", "user", "settings"];
    for (let i = 0; i < n; i++) {
      const cx = tw * i + tw / 2;
      const label = L[i];
      const cls = i === 0 ? "s-ink" : "s-muted";
      p.icon(icons[i % icons.length]!, cx - s / 2, label && h >= 48 ? h * 0.18 : h / 2 - s / 2, s, cls);
      if (label && h >= 48) p.text(cx, h * 0.72, label, { size: 11, weight: i === 0 ? 600 : 400, anchor: "middle", cls: i === 0 ? "t-ink" : "t-muted", maxW: tw - 6 });
    }
    return;
  }
  p.line(0, h - 0.5, w, h - 0.5, { s: "s-line" });
  const title = L[0] ?? "";
  if (w >= 560) {
    // A website header: a mark and a name, then links, then a button.
    p.rect(20, h / 2 - 12, 24, 24, 6, { f: "f-strong" });
    p.text(54, h / 2, title || "Brand", { size: 16, weight: 700, maxW: w * 0.3 });
    let x = w - 20;
    x -= 96;
    p.rect(x, h / 2 - 17, 96, 34, 10, { f: "f-strong" });
    p.text(x + 48, h / 2, "Sign up", { size: 13, weight: 600, anchor: "middle", cls: "t-onstrong" });
    for (let i = n - 1; i >= 0; i--) {
      const label = L[i + 1] ?? `Link ${i + 1}`;
      const lw = Math.min(140, label.length * charWidth(14, p.sketch) + 4);
      x -= lw + 24;
      if (x < 54 + Math.min(w * 0.3, 160)) break;
      p.text(x, h / 2, fitText(label, lw, 14, p.sketch), { size: 14, cls: "t-muted" });
    }
    return;
  }
  // An app bar: back, a centred title, an action.
  const s = Math.min(22, h * 0.42);
  p.icon(n > 1 ? "back" : "menu", 14, h / 2 - s / 2, s, "s-ink");
  p.text(w / 2, h / 2, title || "Title", { size: sizeFor(h, 0.3, 12, 17), weight: 600, anchor: "middle", maxW: w - 2 * (s + 28) });
  if (n > 2) p.icon("more", w - 14 - s, h / 2 - s / 2, s, "s-ink");
  if (n > 1 && w > 200) p.icon(L[n - 1]?.toLowerCase() ?? "search", w - (n > 2 ? 2 * (s + 14) : 14 + s), h / 2 - s / 2, s, "s-ink");
}

function drawTable(p: Pen, it: WireItem, L: string[], w: number, h: number) {
  const cellsOf = (line: string) => line.split(/\s*[|\t]\s*/).map((c) => c.trim());
  const parsed = L.map(cellsOf);
  const cols = clampN(Math.round(colsOf(it)), 1, 12);
  const rows = clampN(Math.round(countOf(it)), 1, 50);
  const rh = Math.max(16, Math.min(40, h / (rows + 1)));
  const shown = Math.min(rows, Math.floor(h / rh) - 1);
  const cw = w / cols;
  const size = Math.max(9, Math.min(13, rh * 0.36));
  p.rect(0, 0, w, h, 8, { f: "f-fill", s: "s-line" });
  p.rect(0, 0, w, rh, 8, { f: "f-soft" });
  if (!p.sketch) p.rect(0, rh - 8, w, 8, 0, { f: "f-soft" });
  for (let r = 0; r <= shown; r++) {
    const y = r * rh;
    if (r > 0) p.line(0, y, w, y, { s: r === 1 ? "s-line" : "s-soft" });
    for (let c = 0; c < cols; c++) {
      const cell = parsed[r]?.[c];
      const x = c * cw + 12;
      if (cell) p.text(x, y + rh / 2, cell, { size, weight: r === 0 ? 600 : 400, cls: r === 0 ? "t-ink" : "t-muted", maxW: cw - 18 });
      else if (!parsed.length || r >= parsed.length) p.bar(x, y + rh / 2 - 3.5, (cw - 24) * (r === 0 ? 0.55 : 0.4 + (((r + 1) * (c + 2) * 17) % 45) / 100), 7, r === 0 ? "f-shade" : "f-soft");
    }
  }
}

// ------------------------------------------------------------------------------------------ frames

/** How far each frame's chrome reaches past its screen (the device's bezel, the browser's top bar). */
export const FRAME_INSET: Record<WireframeFrame, { top: number; right: number; bottom: number; left: number }> = {
  phone: { top: 12, right: 12, bottom: 12, left: 12 },
  tablet: { top: 18, right: 18, bottom: 18, left: 18 },
  browser: { top: 40, right: 0, bottom: 0, left: 0 },
  plain: { top: 0, right: 0, bottom: 0, left: 0 },
};
/** Room above a frame for the screen's name. */
export const NAME_ROOM = 30;

/** A screen's frame and its name, on the canvas. */
export function frameBox(s: WireScreen): Box {
  const i = FRAME_INSET[s.frame];
  return { x: s.x - i.left, y: s.y - i.top, w: s.w + i.left + i.right, h: s.h + i.top + i.bottom };
}
export function screenBox(s: WireScreen): Box {
  const f = frameBox(s);
  return { x: f.x, y: f.y - NAME_ROOM, w: f.w, h: f.h + NAME_ROOM };
}

/** The frame under a screen's parts, in screen coordinates: the device or window and the screen itself. */
export function drawFrameBack(s: WireScreen, style: WireframeStyle): string {
  const p = new Pen(style, `${s.id}:frame`);
  const { w, h } = s;
  const i = FRAME_INSET[s.frame];
  if (s.frame === "phone" || s.frame === "tablet") {
    const outer = s.frame === "phone" ? 52 : 34;
    p.rect(-i.left, -i.top, w + i.left + i.right, h + i.top + i.bottom, outer, { f: "f-bezel", s: "s-frame", sw: 1.75 });
    p.rect(0, 0, w, h, screenRadius(s.frame), { f: "f-screen", s: "s-line" });
    const top = WIREFRAME_TOP_INSET[s.frame];
    if (s.frame === "phone") {
      p.text(36, top / 2 + 2, "9:41", { size: 14, weight: 600 });
      p.rect(w / 2 - 50, 10, 100, 28, 14, { f: "f-island" });
    } else {
      p.text(24, top / 2 + 1, "9:41", { size: 12, weight: 600 });
    }
    // Signal, wifi and battery.
    const right = s.frame === "phone" ? w - 34 : w - 22;
    p.rect(right - 22, top / 2 - 4.5 + 2, 22, 11, 3, { s: "s-ink", sw: 1 });
    p.rect(right - 20, top / 2 - 2.5 + 2, 15, 7, 1.5, { f: "f-ink" });
    p.icon("wifi", right - 44, top / 2 - 7 + 2, 15, "s-ink");
  } else if (s.frame === "browser") {
    p.rect(0, -i.top, w, h + i.top, 12, { f: "f-soft", s: "s-frame", sw: 1.5 });
    p.rect(0, 0, w, h, 0, { f: "f-screen" });
    p.line(0, 0, w, 0, { s: "s-line" });
    for (let k = 0; k < 3; k++) p.circle(18 + k * 16, -20, 5, { f: "f-shade" });
    const aw = Math.min(560, w - 180);
    if (aw > 60) {
      const ax = Math.max(84, w / 2 - aw / 2);
      p.rect(ax, -31, aw, 22, 11, { f: "f-screen", s: "s-line" });
      const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      p.text(ax + 14, -20, `example.com${slug ? `/${slug}` : ""}`, { size: 11, cls: "t-muted", maxW: aw - 28 });
    }
  } else {
    p.rect(0, 0, w, h, 4, { f: "f-screen", s: "s-frame", sw: 1.25 });
  }
  return p.toString();
}

/** What a frame draws over the parts: the phone's home indicator. */
export function drawFrameFront(s: WireScreen, style: WireframeStyle): string {
  if (s.frame !== "phone" && s.frame !== "tablet") return "";
  const p = new Pen(style, `${s.id}:front`);
  const iw = s.frame === "phone" ? 134 : 180;
  p.rect(s.w / 2 - iw / 2, s.h - 12, iw, 5, 2.5, { f: "f-ink" });
  return p.toString();
}

// ------------------------------------------------------------------------------------------ links

export interface LinkPath {
  link: WireLink;
  /** The SVG path, start and end points, and the arrowhead. */
  d: string;
  start: Pt;
  end: Pt;
  head: string;
}

/** Where a screen or part sits on the canvas. */
export function rectOf(wf: WireframeData, id: string): Box | null {
  const s = wf.screens.find((x) => x.id === id);
  if (s) return frameBox(s);
  const it = wf.items.find((x) => x.id === id);
  const on = it && wf.screens.find((x) => x.id === it.screen);
  return it && on ? { x: on.x + it.x, y: on.y + it.y, w: it.w, h: it.h } : null;
}

/**
 * An arrow from a box to a screen: out of the side facing it, into the screen's near side, as a soft curve
 * with an arrowhead. `style` sketch makes it wobble.
 */
export function arrowBetween(from: Box, to: Box, style: WireframeStyle = "clean", seed = ""): { d: string; start: Pt; end: Pt; head: string } {
  const fc = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const tc = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const horizontal = to.x >= from.x + from.w + 24 || to.x + to.w <= from.x - 24;
  let start: Pt;
  let end: Pt;
  let dir: Pt;
  if (horizontal) {
    const right = tc.x > fc.x;
    start = { x: right ? from.x + from.w : from.x, y: fc.y };
    end = { x: right ? to.x : to.x + to.w, y: clampN(fc.y, to.y + 24, to.y + to.h - 24) };
    dir = { x: right ? 1 : -1, y: 0 };
  } else {
    const down = tc.y > fc.y;
    start = { x: fc.x, y: down ? from.y + from.h : from.y };
    end = { x: clampN(fc.x, to.x + 24, to.x + to.w - 24), y: down ? to.y : to.y + to.h };
    dir = { x: 0, y: down ? 1 : -1 };
  }
  const dist = Math.max(40, (horizontal ? Math.abs(end.x - start.x) : Math.abs(end.y - start.y)) / 2);
  const c1 = { x: start.x + dir.x * dist, y: start.y + dir.y * dist };
  const c2 = { x: end.x - dir.x * dist, y: end.y - dir.y * dist };
  // The line stops at the arrowhead's base.
  const tip = end;
  const base = { x: end.x - dir.x * 10, y: end.y - dir.y * 10 };
  let d: string;
  if (style === "sketch") {
    const rnd = random(seedOf(seed || "link"));
    const pts: Pt[] = [];
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      const x = mt * mt * mt * start.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * base.x;
      const y = mt * mt * mt * start.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * base.y;
      const k = i === 0 || i === steps ? 0 : 1.6;
      pts.push({ x: x + (rnd() - 0.5) * k, y: y + (rnd() - 0.5) * k });
    }
    d = smoothPath(pts);
  } else {
    d = `M${n1(start.x)} ${n1(start.y)}C${n1(c1.x)} ${n1(c1.y)} ${n1(c2.x)} ${n1(c2.y)} ${n1(base.x)} ${n1(base.y)}`;
  }
  const px = -dir.y;
  const py = dir.x;
  const head = `M${n1(tip.x)} ${n1(tip.y)}L${n1(base.x + px * 5.5)} ${n1(base.y + py * 5.5)}L${n1(base.x - px * 5.5)} ${n1(base.y - py * 5.5)}Z`;
  return { d, start, end, head };
}

/** Every link's arrow (links whose ends are gone are skipped). */
export function linkPaths(wf: WireframeData): LinkPath[] {
  const out: LinkPath[] = [];
  for (const link of wf.links) {
    const from = rectOf(wf, link.from);
    const to = wf.screens.find((s) => s.id === link.to);
    if (!from || !to) continue;
    out.push({ link, ...arrowBetween(from, frameBox(to), wf.style, link.id) });
  }
  return out;
}

export function drawLink(l: Pick<LinkPath, "d" | "start" | "head">): string {
  return `<path class="f-none s-link" stroke-width="1.75" stroke-linecap="round" d="${l.d}"/><path class="f-link" d="${l.head}"/><circle class="f-link" cx="${n1(l.start.x)}" cy="${n1(l.start.y)}" r="3.5"/>`;
}

// ------------------------------------------------------------------------------------------ whole drawing

/** Where everything is on the canvas (frames, names and arrows), or null when there's nothing. */
export function wireframeBounds(wf: WireframeData, only?: ReadonlySet<string>): Box | null {
  const screens = only ? wf.screens.filter((s) => only.has(s.id)) : wf.screens;
  if (!screens.length) return null;
  const boxes = screens.map(screenBox);
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The corner radius of a screen's own area (parts are clipped to it). */
export const screenRadius = (frame: WireframeFrame) => (frame === "phone" ? 40 : frame === "tablet" ? 16 : 0);

/**
 * One screen with its parts, at its place on the canvas (its name above it, when `name`). `clipId`, unique
 * in the document, keeps the parts inside the screen's rounded corners.
 */
export function drawScreen(wf: WireframeData, s: WireScreen, opts: { name?: boolean; items?: WireItem[]; clipId?: string } = {}): string {
  const items = opts.items ?? wf.items.filter((i) => i.screen === s.id);
  const clip = opts.clipId ? `<clipPath id="${esc(opts.clipId)}"><rect width="${n1(s.w)}" height="${n1(s.h)}" rx="${screenRadius(s.frame)}"/></clipPath>` : "";
  const parts = clip + `<g${opts.clipId ? ` clip-path="url(#${esc(opts.clipId)})"` : ""}>` + items.map((it) => `<g transform="translate(${n1(it.x)} ${n1(it.y)})">${drawItem(it, wf.style, s)}</g>`).join("") + "</g>";
  const name = opts.name ? `<text class="t-name" x="${n1(frameBox(s).x - s.x)}" y="${n1(-FRAME_INSET[s.frame].top - 14)}" font-size="14" font-weight="600" dominant-baseline="central">${esc(fitText(s.name || "Untitled screen", frameBox(s).w, 14, wf.style === "sketch", true))}</text>` : "";
  return `<g transform="translate(${n1(s.x)} ${n1(s.y)})">${name}${drawFrameBack(s, wf.style)}${parts}${drawFrameFront(s, wf.style)}</g>`;
}

/** The colours an exported file uses (light), keyed by the drawing's classes. */
export const EXPORT_COLORS = {
  screen: "#ffffff",
  fill: "#ffffff",
  soft: "#ececef",
  shade: "#d9d9de",
  line: "#b4b4bb",
  ink: "#2b2b30",
  muted: "#7c7c85",
  strong: "#3f3f45",
  onstrong: "#ffffff",
  bezel: "#f6f6f8",
  frame: "#45454c",
  island: "#2b2b30",
  tip: "#2b2b30",
  ontip: "#ffffff",
  shadow: "rgba(0,0,0,0.08)",
  link: "#6e6e76",
  name: "#56565e",
};

const SANS = `"Instrument Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif`;
/** The sketch typeface's name inside exported files (exportImage.ts embeds the face under it). */
export const SKETCH_FONT = "Mali";

/** The stylesheet inside an exported file: the drawing's classes in light colours, and its font. */
export function exportStyle(style: WireframeStyle): string {
  const c = EXPORT_COLORS;
  const keys = Object.keys(c) as (keyof typeof c)[];
  const rules = [
    ".f-none{fill:none}",
    ...keys.map((k) => `.f-${k}{fill:${c[k]}}.s-${k}{stroke:${c[k]}}`),
    `.t-ink{fill:${c.ink}}.t-muted{fill:${c.muted}}.t-onstrong{fill:${c.onstrong}}.t-ontip{fill:${c.ontip}}.t-name{fill:${c.name}}`,
    `text{font-family:${style === "sketch" ? `"${SKETCH_FONT}",${SANS}` : SANS}}`,
  ];
  return rules.join("");
}

/**
 * The wireframe as a standalone SVG (light colours, everything escaped): every screen with its name, and
 * the arrows between them, or only the screens in `only` (and the arrows among them).
 */
export function wireframeToSvg(wf: WireframeData, only?: ReadonlySet<string>): string | null {
  const b = wireframeBounds(wf, only);
  if (!b) return null;
  const screens = only ? wf.screens.filter((s) => only.has(s.id)) : wf.screens;
  const ids = new Set(screens.map((s) => s.id));
  const items = new Map<string, WireItem[]>(screens.map((s) => [s.id, []]));
  for (const it of wf.items) items.get(it.screen)?.push(it);
  const itemScreen = new Map(wf.items.map((i) => [i.id, i.screen]));
  const links = linkPaths(wf).filter((l) => ids.has(l.link.to) && ids.has(itemScreen.get(l.link.from) ?? l.link.from));
  const pad = 32;
  const vb = { x: Math.floor(b.x - pad), y: Math.floor(b.y - pad), w: Math.ceil(b.w + pad * 2), h: Math.ceil(b.h + pad * 2) };
  const body = screens.map((s, i) => drawScreen(wf, s, { name: true, items: items.get(s.id), clipId: `wf-screen-${i}` })).join("") + links.map(drawLink).join("");
  const title = screens.map((s) => s.name || "Untitled screen").join(", ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${vb.w}" height="${vb.h}" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" role="img"><title>${esc(`Wireframe: ${title}`)}</title><style>${exportStyle(wf.style)}</style><rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="#ffffff"/>${body}</svg>`;
}
