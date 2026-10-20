// Every chart series colour reaches 3:1 (WCAG non-text contrast) against each surface it's drawn on in its
// theme: the page, raised panels (tooltips, the style panel's swatches) and the chart card's own tint
// (canvas.css mixes the sunken surface into the page). Light shades are checked on the light tokens, dark
// shades on the dark tokens and on the night page colour (chart.css gives it the dark shades in either theme).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { CHART_COLORS } from "@folevi/editor-schema";
import { PALETTE } from "@/components/editor/chart/palette";

const ROOT = join(__dirname, "../../..");
const tokens = JSON.parse(readFileSync(join(ROOT, "packages/design-tokens/src/tokens.json"), "utf8")) as {
  chrome: Record<"light" | "dark", { surface: string; surfaceRaised: string; surfaceSunken: string }>;
};
const editorCss = readFileSync(join(ROOT, "apps/web/src/components/editor/editor.css"), "utf8");
const canvasCss = readFileSync(join(ROOT, "apps/web/src/components/editor/canvas/canvas.css"), "utf8");

type Rgba = [number, number, number, number];

/** #rrggbb, rgb()/rgba() with commas or spaces, into 0..1 channels and alpha. */
function parse(color: string): Rgba {
  const c = color.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(c);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16) / 255).concat(1) as Rgba;
  const fn = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (fn) {
    const parts = fn[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
    return [parts[0]! / 255, parts[1]! / 255, parts[2]! / 255, parts[3] ?? 1];
  }
  throw new Error(`Unknown colour ${color}`);
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function oklab([r, g, b]: Rgba): [number, number, number] {
  const [lr, lg, lb] = [r, g, b].map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]: [number, number, number]): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return lin.map((c) => Math.min(1, Math.max(0, toSrgb(Math.max(0, c))))) as [number, number, number];
}

/** CSS color-mix(in oklab, a p%, b) (premultiplied alpha), then painted over `under`. */
function mixOver(a: string, p: number, b: string, under: string): Rgba {
  const A = parse(a), B = parse(b), U = parse(under);
  const la = oklab(A), lb = oklab(B);
  const alpha = A[3] * p + B[3] * (1 - p);
  const lab = [0, 1, 2].map((i) => (la[i]! * A[3] * p + lb[i]! * B[3] * (1 - p)) / alpha) as [number, number, number];
  const rgb = fromOklab(lab);
  return [0, 1, 2].map((i) => rgb[i]! * alpha + U[i]! * (1 - alpha)).concat(1) as Rgba;
}

/** Paints a (possibly translucent) colour over an opaque one. */
const over = (color: string, under: string): Rgba => {
  const c = parse(color), u = parse(under);
  return [0, 1, 2].map((i) => c[i]! * c[3] + u[i]! * (1 - c[3])).concat(1) as Rgba;
};

const luminance = ([r, g, b]: Rgba) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// The chart card's tint: canvas.css `--fb-canvas-bg: color-mix(in oklab, var(--color-surface-sunken) N%, var(--color-surface))`.
const tintShare = (() => {
  const m = /--fb-canvas-bg:\s*color-mix\(in oklab, var\(--color-surface-sunken\) (\d+(?:\.\d+)?)%, var\(--color-surface\)\)/.exec(canvasCss);
  if (!m) throw new Error("canvas.css no longer defines --fb-canvas-bg as a mix of the sunken surface into the page; update this test");
  return Number(m[1]) / 100;
})();

function surfacesOf(name: string, t: { surface: string; surfaceRaised: string; surfaceSunken: string }): [string, Rgba][] {
  return [
    [`${name} surface ${t.surface}`, parse(t.surface)],
    [`${name} raised ${t.surfaceRaised}`, over(t.surfaceRaised, t.surface)],
    [`${name} chart card tint`, mixOver(t.surfaceSunken, tintShare, t.surface, t.surface)],
  ];
}

const night = (() => {
  const block = /\.fb-sheet\[data-sheet="night"\]\s*\{([^}]+)\}/.exec(editorCss)?.[1] ?? "";
  const read = (v: string) => new RegExp(`--color-${v}:\\s*([^;]+);`).exec(block)?.[1]?.trim();
  const surface = read("surface"), surfaceRaised = read("surface-raised"), surfaceSunken = read("surface-sunken");
  if (!surface || !surfaceRaised || !surfaceSunken) throw new Error("editor.css night page colour not found; update this test");
  return { surface, surfaceRaised, surfaceSunken };
})();

const LIGHT = surfacesOf("light", tokens.chrome.light);
const DARK = [...surfacesOf("dark", tokens.chrome.dark), ...surfacesOf("night page", night)];
const MIN = 3;

describe("chart series colours reach 3:1 against their surfaces", () => {
  test("the colour maths matches known WCAG ratios", () => {
    expect(contrast(parse("#000000"), parse("#ffffff"))).toBeCloseTo(21, 5);
    expect(contrast(parse("#767676"), parse("#ffffff"))).toBeCloseTo(4.54, 2);
    // A translucent sunken surface mixed into white is a touch darker than white, never lighter.
    const tint = mixOver("rgba(0, 0, 0, 0.05)", 0.3, "#ffffff", "#ffffff");
    expect(luminance(tint)).toBeLessThan(1);
    expect(luminance(tint)).toBeGreaterThan(0.9);
  });

  for (const name of CHART_COLORS) {
    test(`${name}: light ${PALETTE[name].light} and dark ${PALETTE[name].dark}`, () => {
      const low: string[] = [];
      for (const [label, surface] of LIGHT) {
        const r = contrast(parse(PALETTE[name].light), surface);
        if (r < MIN) low.push(`${PALETTE[name].light} on ${label}: ${r.toFixed(2)}:1`);
      }
      for (const [label, surface] of DARK) {
        const r = contrast(parse(PALETTE[name].dark), surface);
        if (r < MIN) low.push(`${PALETTE[name].dark} on ${label}: ${r.toFixed(2)}:1`);
      }
      expect(low).toEqual([]);
    });
  }
});
