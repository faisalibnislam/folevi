// Picks a note's colours from its style — the person's own image, or a built-in style's swatches: the page
// and text colours, an accent (checkboxes, quotes, links, underlines, callouts, code), five text colours
// and four highlights, each for light and dark themes.
//
// 1. The image is sampled small and clustered in OKLab (a perceptual colour space) with a seeded k-means,
//    so the result is deterministic and reflects how the colours look, not how they're stored.
// 2. The key colour is the cluster that best balances "how much of the image it covers" with "how
//    colourful it is" (a small vivid accent can win over a large grey, but not over a large colour field),
//    skipping near-black and near-white clusters, which say little about the image's mood.
// 3. The page and text colours are built in OKLCH from the key hue: a very light tinted page and a dark text
//    in light mode, a deep page and light text in dark mode — each text colour pushed until it clears a
//    high contrast ratio against its page, so muted and faint text mixed from it still read.
// 4. The tone (deep or light) of the band where the title sits on the cover decides the title's colour.
// 5. Five hues for text colours and highlights: the image's own distinct colours first (clusters at least
//    40° apart on the colour wheel, most prominent first, the key colour always first), then — when the
//    image has fewer — harmonies of the key hue (complement, triad, …) that sit furthest from those already
//    chosen. Text colours clear 4.5:1 against the page; highlights are soft tints the text reads on.
//
// Pure functions: `paletteFromPixels` works on raw RGBA, `paletteFromSwatches` on weighted colours (the
// built-in styles), `paletteFromImage` does the browser decoding.

export interface StylePalette {
  paper: string;
  ink: string;
  paperDark: string;
  inkDark: string;
  /** How the cover reads behind the title: "deep" → white title, "light" → the ink colour. */
  tone: "deep" | "light";
  /** Checkboxes, quote bars, links, underlines, callouts and code: the key colour, readable as text. */
  accent: string;
  accentDark: string;
  /** Five text colours (the first is the accent's hue), and their names ("Blue", "Rose", …). */
  text: string[];
  textDark: string[];
  names: string[];
  /** Four highlight backgrounds, in the first four text colours' hues. */
  highlight: string[];
  highlightDark: string[];
}
/** @deprecated the old name; a note style image's palette is a StylePalette. */
export type ImagePalette = StylePalette;

type Lab = [number, number, number];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function linearToOklab(r: number, g: number, b: number): Lab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: number[]) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);

/** OKLCH → linear sRGB, reducing chroma until the colour fits in sRGB. */
function oklch(L: number, C: number, h: number): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  let lo = 0;
  let hi = C;
  let best = oklabToLinear([L, 0, 0]);
  const full = oklabToLinear([L, C * Math.cos(rad), C * Math.sin(rad)]);
  if (inGamut(full)) return full;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const rgb = oklabToLinear([L, mid * Math.cos(rad), mid * Math.sin(rad)]);
    if (inGamut(rgb)) {
      lo = mid;
      best = rgb;
    } else hi = mid;
  }
  return best;
}

const hex = (lin: [number, number, number]) =>
  `#${lin.map((v) => Math.round(Math.min(1, Math.max(0, fromLinear(Math.min(1, Math.max(0, v))))) * 255).toString(16).padStart(2, "0")).join("")}`;

const luminance = ([r, g, b]: [number, number, number]) => 0.2126 * Math.max(0, r) + 0.7152 * Math.max(0, g) + 0.0722 * Math.max(0, b);
/** WCAG contrast ratio between two linear-sRGB colours. */
export function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Cluster {
  lab: Lab;
  share: number;
  L: number;
  C: number;
  h: number;
}

const dist = (p: Lab, q: Lab) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;

/** Seeded k-means (k-means++ start) over OKLab points. */
function kmeans(points: Lab[], k: number): Cluster[] {
  const random = rng(7);
  const centers: Lab[] = [points[Math.floor(random() * points.length)]!];
  while (centers.length < Math.min(k, points.length)) {
    const d = points.map((p) => Math.min(...centers.map((c) => dist(p, c))));
    const total = d.reduce((s, v) => s + v, 0);
    if (total === 0) break;
    let pick = random() * total;
    let i = 0;
    while (pick > d[i]! && i < d.length - 1) pick -= d[i++]!;
    centers.push(points[i]!);
  }
  const assign = new Array<number>(points.length).fill(0);
  for (let iter = 0; iter < 12; iter++) {
    let moved = false;
    points.forEach((p, i) => {
      let best = 0;
      let bestD = Infinity;
      centers.forEach((c, j) => {
        const dd = dist(p, c);
        if (dd < bestD) {
          bestD = dd;
          best = j;
        }
      });
      if (assign[i] !== best) moved = true;
      assign[i] = best;
    });
    const sums = centers.map(() => [0, 0, 0, 0]);
    points.forEach((p, i) => {
      const s = sums[assign[i]!]!;
      s[0]! += p[0];
      s[1]! += p[1];
      s[2]! += p[2];
      s[3]! += 1;
    });
    sums.forEach((s, j) => {
      if (s[3]) centers[j] = [s[0]! / s[3], s[1]! / s[3], s[2]! / s[3]];
    });
    if (!moved && iter > 0) break;
  }
  const counts = centers.map(() => 0);
  assign.forEach((j) => counts[j]!++);
  return centers
    .map((lab, j) => ({
      lab,
      share: counts[j]! / points.length,
      L: lab[0],
      C: Math.hypot(lab[1], lab[2]),
      h: ((Math.atan2(lab[2], lab[1]) * 180) / Math.PI + 360) % 360,
    }))
    .filter((c) => c.share > 0);
}

/** The cluster that best stands for the image's colour. */
function keyColor(clusters: Cluster[]): Cluster {
  const score = (c: Cluster) => {
    // Near-black and near-white say little about the mood; mid tones say the most.
    const tonal = c.L < 0.12 || c.L > 0.97 ? 0.15 : 1 - Math.min(0.7, Math.abs(c.L - 0.62) * 0.9);
    return Math.sqrt(c.share) * (0.015 + Math.min(c.C, 0.25)) * tonal;
  };
  return [...clusters].sort((a, b) => score(b) - score(a))[0]!;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Page and text colours from the key colour, with each text colour pushed to a high contrast. */
export function schemeFromKey(key: { C: number; h: number }): Pick<StylePalette, "paper" | "ink" | "paperDark" | "inkDark"> {
  const s = scheme(key);
  return { paper: hex(s.paper), ink: hex(s.ink), paperDark: hex(s.paperDark), inkDark: hex(s.inkDark) };
}

function scheme(key: { C: number; h: number }) {
  const neutral = key.C < 0.03;
  const h = key.h;
  const c = (k: number, lo: number, hi: number) => (neutral ? Math.min(key.C * k, 0.006) : clamp(key.C * k, lo, hi));

  const paper = oklch(0.972, c(0.2, 0.008, 0.022), h);
  let inkL = 0.3;
  let ink = oklch(inkL, c(0.55, 0.02, 0.08), h);
  while (contrast(ink, paper) < 10 && inkL > 0.12) ink = oklch((inkL -= 0.01), c(0.55, 0.02, 0.08), h);

  const paperDark = oklch(0.215, c(0.25, 0.008, 0.03), h);
  let inkDarkL = 0.9;
  let inkDark = oklch(inkDarkL, c(0.3, 0.008, 0.04), h);
  while (contrast(inkDark, paperDark) < 10 && inkDarkL < 0.985) inkDark = oklch((inkDarkL += 0.01), c(0.3, 0.008, 0.04), h);
  return { paper, ink, paperDark, inkDark };
}

const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** Five hues: the image's own distinct colours (key first), then harmonies of the key hue. */
function slotHues(clusters: Cluster[], key: Cluster): number[] {
  const hues = [key.h];
  const colourful = clusters
    .filter((c) => c !== key && c.C >= 0.035 && c.L > 0.12 && c.L < 0.97)
    .sort((a, b) => Math.sqrt(b.share) * b.C - Math.sqrt(a.share) * a.C);
  for (const c of colourful) if (hues.length < 5 && hues.every((h) => hueGap(h, c.h) >= 40)) hues.push(c.h);
  const offsets = [180, 120, -120, 60, -60, 150, -150, 90, -90, 30, -30];
  while (hues.length < 5) {
    const candidates = offsets.map((o) => (key.h + o + 360) % 360);
    const best = candidates.sort((a, b) => Math.min(...hues.map((h) => hueGap(h, b))) - Math.min(...hues.map((h) => hueGap(h, a))))[0]!;
    hues.push(best);
  }
  return hues;
}

const HUE_NAMES: [number, string][] = [
  [0, "Rose"], [15, "Red"], [40, "Coral"], [60, "Orange"], [80, "Amber"], [100, "Gold"], [118, "Olive"], [135, "Lime"],
  [150, "Green"], [170, "Emerald"], [190, "Teal"], [215, "Cyan"], [240, "Sky"], [260, "Blue"], [280, "Indigo"],
  [300, "Violet"], [318, "Purple"], [335, "Magenta"], [350, "Pink"], [360, "Rose"],
];
/** A plain colour name for a hue (OKLCH degrees). */
export function hueName(h: number): string {
  const x = ((h % 360) + 360) % 360;
  let best = HUE_NAMES[0]!;
  for (const n of HUE_NAMES) if (hueGap(n[0], x) < hueGap(best[0], x)) best = n;
  return best[1];
}

/**
 * A text colour in hue `h` that reads at better than 4.5:1 on every background given — the page, and its
 * own highlight tint (callouts and highlighted text sit on those). Darker on light pages, lighter on dark.
 */
function textOn(backgrounds: [number, number, number][], h: number, chroma: number, dark: boolean): [number, number, number] {
  let L = dark ? 0.76 : 0.52;
  let rgb = oklch(L, chroma, h);
  const ok = (c: [number, number, number]) => backgrounds.every((b) => contrast(c, b) >= 4.8);
  while (!ok(rgb) && (dark ? L < 0.96 : L > 0.24)) rgb = oklch((L += dark ? 0.01 : -0.01), chroma, h);
  return rgb;
}

/** The whole style palette from colour clusters (and the lightness of the band behind the title). */
function paletteFromClusters(clusters: Cluster[], bandL: number): StylePalette {
  const key = keyColor(clusters);
  const base = scheme(key);
  const neutral = key.C < 0.03;
  const hues = slotHues(clusters, key);
  const tc = neutral ? 0.07 : 0.14;
  const highlight = hues.slice(0, 4).map((h) => oklch(0.91, neutral ? 0.04 : 0.075, h));
  const highlightDark = hues.slice(0, 4).map((h) => oklch(0.37, neutral ? 0.035 : 0.07, h));
  const text = hues.map((h, i) => textOn(highlight[i] ? [base.paper, highlight[i]!] : [base.paper], h, tc, false));
  const textDark = hues.map((h, i) => textOn(highlightDark[i] ? [base.paperDark, highlightDark[i]!] : [base.paperDark], h, tc * 0.85, true));
  return {
    paper: hex(base.paper),
    ink: hex(base.ink),
    paperDark: hex(base.paperDark),
    inkDark: hex(base.inkDark),
    // OKLab L 0.68 ≈ where white and near-black text have equal contrast.
    tone: bandL < 0.68 ? "deep" : "light",
    accent: hex(text[0]!),
    accentDark: hex(textDark[0]!),
    text: text.map(hex),
    textDark: textDark.map(hex),
    names: hues.map(hueName),
    highlight: highlight.map(hex),
    highlightDark: highlightDark.map(hex),
  };
}

/**
 * The palette for an image given as RGBA pixels (row-major, `width` × `height`). Sample small: a 64-pixel
 * wide image is plenty and keeps this fast.
 */
export function paletteFromPixels(data: Uint8ClampedArray | Uint8Array, width: number, height: number): StylePalette {
  const points: Lab[] = [];
  let bandL = 0;
  let bandN = 0;
  for (let y = 0; y < height; y++) {
    // The title sits low on the cover, which shows the middle of the image.
    const inBand = y >= height * 0.4 && y <= height * 0.78;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3]! < 128) continue;
      const lab = linearToOklab(toLinear(data[i]! / 255), toLinear(data[i + 1]! / 255), toLinear(data[i + 2]! / 255));
      points.push(lab);
      if (inBand) {
        bandL += lab[0];
        bandN++;
      }
    }
  }
  if (!points.length) points.push([0.95, 0, 0]);
  const meanBand = bandN ? bandL / bandN : points.reduce((s, p) => s + p[0], 0) / points.length;
  return paletteFromClusters(kmeans(points, 8), meanBand);
}

/**
 * The palette for a set of weighted colours (a built-in style's ground and pools), with the tone given —
 * the built-in styles know how their covers read.
 */
export function paletteFromSwatches(swatches: { hex: string; weight: number }[], tone: "deep" | "light"): StylePalette {
  const total = swatches.reduce((s, x) => s + x.weight, 0) || 1;
  const clusters = swatches.map(({ hex: h, weight }) => {
    const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(h.slice(i, i + 2), 16) / 255)) as [number, number, number];
    const lab = linearToOklab(r, g, b);
    return { lab, share: weight / total, L: lab[0], C: Math.hypot(lab[1], lab[2]), h: ((Math.atan2(lab[2], lab[1]) * 180) / Math.PI + 360) % 360 };
  });
  return paletteFromClusters(clusters, tone === "deep" ? 0.3 : 0.9);
}

/** Decodes an image (a File/Blob) in the browser and returns its palette. */
export async function paletteFromImage(source: Blob): Promise<StylePalette> {
  const bitmap = await createImageBitmap(source);
  const scale = Math.min(1, 64 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, w, h);
  return paletteFromPixels(data, w, h);
}

const HEX = /^#[0-9a-f]{6}$/i;
const hexList = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every((x) => typeof x === "string" && HEX.test(x));
/** True when a value is a complete palette this module produced (older, partial ones are picked again). */
export function isImagePalette(p: unknown): p is StylePalette {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return (
    ["paper", "ink", "paperDark", "inkDark", "accent", "accentDark"].every((k) => typeof o[k] === "string" && HEX.test(o[k] as string)) &&
    (o.tone === "deep" || o.tone === "light") &&
    hexList(o.text, 5) &&
    hexList(o.textDark, 5) &&
    hexList(o.highlight, 4) &&
    hexList(o.highlightDark, 4) &&
    Array.isArray(o.names) &&
    o.names.length === 5 &&
    o.names.every((n) => typeof n === "string" && n.length > 0 && n.length <= 20)
  );
}
