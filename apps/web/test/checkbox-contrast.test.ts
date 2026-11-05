// A to-do's checkbox outline reaches 3:1 (WCAG 1.4.11, non-text contrast) against every note background in
// every theme the tokens define (Light, Dark, the neutral chrome, ...): unchecked (--fb-check-edge, editor.css)
// and checked (a darker edge of the fill). QA audit F10: in Dark mode the unchecked box was about 1.6:1.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = join(__dirname, "../../..");
const tokensCss = readFileSync(join(ROOT, "packages/design-tokens/generated/tokens.css"), "utf8");
const editorCss = readFileSync(join(ROOT, "apps/web/src/components/editor/editor.css"), "utf8");

type Rgb = [number, number, number];

function hex(c: string): Rgb | null {
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim());
  return m ? ([0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16) / 255) as Rgb) : null;
}
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]: Rgb) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a: Rgb, b: Rgb) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};
/** CSS `color-mix(in srgb, a p%, b)`: gamma-encoded channels, mixed linearly. */
const mix = (a: Rgb, p: number, b: Rgb): Rgb => [0, 1, 2].map((i) => a[i]! * p + b[i]! * (1 - p)) as Rgb;

/** Each block of the generated tokens that names the colours the checkbox and the page use. */
function themes(): { name: string; v: Record<string, Rgb> }[] {
  const out: { name: string; v: Record<string, Rgb> }[] = [];
  for (const m of tokensCss.matchAll(/([^{}]+)\{([^{}]+)\}/g)) {
    const v: Record<string, Rgb> = {};
    for (const d of m[2]!.matchAll(/--color-([a-z-]+):\s*([^;]+);/g)) {
      const c = hex(d[2]!);
      if (c) v[d[1]!] = c;
    }
    if (v["ink-muted"] && v["line-strong"] && v["surface"]) out.push({ name: m[1]!.trim().split("\n").pop()!.trim(), v });
  }
  return out;
}

const edgeRule = /--fb-check-edge:\s*color-mix\(in srgb, var\(--color-ink-muted\) (\d+)%, var\(--color-line-strong\)\)/.exec(editorCss);
const checkedRule = /\.fb-todo\[data-checked="true"\] \.fb-check::before \{\s*border-color: color-mix\(in srgb, var\(--color-moss\) (\d+)%, var\(--color-ink\)\)/.exec(editorCss);

describe("to-do checkbox outline contrast", () => {
  test("editor.css draws the box with the checked edge rules this test measures", () => {
    expect(edgeRule).not.toBeNull();
    expect(checkedRule).not.toBeNull();
    expect(editorCss).toMatch(/border: 1\.5px solid var\(--fb-check-edge\)/);
  });

  const all = themes();
  test("the tokens define several themes", () => expect(all.length).toBeGreaterThanOrEqual(2));

  for (const t of all) {
    const backgrounds = (["canvas", "surface", "surface-raised", "surface-sunken"] as const).filter((k) => t.v[k]);
    test(`unchecked is at least 3:1 in ${t.name}`, () => {
      const edge = mix(t.v["ink-muted"]!, Number(edgeRule![1]) / 100, t.v["line-strong"]!);
      for (const k of backgrounds) expect(contrast(edge, t.v[k]!), `${k}`).toBeGreaterThanOrEqual(3);
    });
    if (t.v["moss"] && t.v["ink"]) {
      test(`checked is at least 3:1 in ${t.name}`, () => {
        const edge = mix(t.v["moss"]!, Number(checkedRule![1]) / 100, t.v["ink"]!);
        for (const k of backgrounds) expect(contrast(edge, t.v[k]!), `${k}`).toBeGreaterThanOrEqual(3);
      });
    }
  }
});
