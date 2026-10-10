import { describe, expect, test } from "vitest";
import { contrast, paletteFromPixels, paletteFromSwatches, schemeFromKey } from "@/lib/palette";

/** An image made of solid rectangles: [r, g, b, share of the rows from the top]. */
function image(bands: [number, number, number, number][], w = 40, h = 50): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  let y = 0;
  for (const [r, g, b, share] of bands) {
    const rows = Math.round(share * h);
    for (let yy = y; yy < Math.min(h, y + rows); yy++)
      for (let x = 0; x < w; x++) data.set([r, g, b, 255], (yy * w + x) * 4);
    y += rows;
  }
  return data;
}

const lin = (hex: string) =>
  [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
const hue = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return { r: r!, g: g!, b: b! };
};

describe("note theme colours from an image", () => {
  test("a navy-and-coral image tints the page with its colour and keeps text readable", () => {
    const p = paletteFromPixels(image([[28, 44, 110, 0.6], [240, 128, 128, 0.25], [245, 245, 245, 0.15]]), 40, 50);
    // Text passes a high contrast on its page, in both themes.
    expect(contrast(lin(p.ink), lin(p.paper))).toBeGreaterThanOrEqual(10);
    expect(contrast(lin(p.inkDark), lin(p.paperDark))).toBeGreaterThanOrEqual(10);
    // The page is very light and tinted (not pure white); the text is dark and coloured (not pure black).
    expect(p.paper).not.toBe("#ffffff");
    expect(p.ink).not.toBe("#000000");
    const ink = hue(p.ink);
    expect(ink.b).toBeGreaterThan(ink.r); // navy wins: the largest colourful area
    expect(p.tone).toBe("deep");
  });

  test("a vivid accent can win over a large grey, a large colour field wins over a small accent", () => {
    const accent = paletteFromPixels(image([[128, 128, 128, 0.85], [230, 60, 60, 0.15]]), 40, 50);
    const redInk = hue(accent.ink);
    expect(redInk.r).toBeGreaterThan(redInk.b);
    const field = paletteFromPixels(image([[40, 140, 90, 0.8], [230, 60, 60, 0.2]]), 40, 50);
    const greenInk = hue(field.ink);
    expect(greenInk.g).toBeGreaterThan(greenInk.r);
  });

  test("a light image puts the title in ink; a grey one stays neutral", () => {
    const light = paletteFromPixels(image([[250, 240, 225, 1]]), 40, 50);
    expect(light.tone).toBe("light");
    const grey = paletteFromPixels(image([[120, 120, 120, 1]]), 40, 50);
    const g = hue(grey.ink);
    expect(Math.max(g.r, g.g, g.b) - Math.min(g.r, g.g, g.b)).toBeLessThanOrEqual(6);
  });

  test("the same image always gives the same colours", () => {
    const px = image([[90, 60, 140, 0.5], [200, 170, 90, 0.5]]);
    expect(paletteFromPixels(px, 40, 50)).toEqual(paletteFromPixels(px, 40, 50));
    expect(schemeFromKey({ C: 0.12, h: 250 })).toEqual(schemeFromKey({ C: 0.12, h: 250 }));
  });

  test("text colours and highlights: five and four, readable on the page and on their own tints, in both themes", () => {
    for (const p of [
      paletteFromPixels(image([[28, 44, 110, 0.6], [240, 128, 128, 0.25], [245, 245, 245, 0.15]]), 40, 50),
      paletteFromPixels(image([[120, 120, 120, 1]]), 40, 50),
      paletteFromSwatches([{ hex: "#3b2a4d", weight: 0.4 }, { hex: "#5a3f6e", weight: 0.3 }, { hex: "#2f4d5a", weight: 0.3 }], "deep"),
    ]) {
      expect(p.text).toHaveLength(5);
      expect(p.textDark).toHaveLength(5);
      expect(p.highlight).toHaveLength(4);
      expect(p.highlightDark).toHaveLength(4);
      expect(p.names).toHaveLength(5);
      expect(p.accent).toBe(p.text[0]);
      p.text.forEach((t, i) => {
        expect(contrast(lin(t), lin(p.paper))).toBeGreaterThanOrEqual(4.5);
        if (i < 4) expect(contrast(lin(t), lin(p.highlight[i]!))).toBeGreaterThanOrEqual(4.5);
      });
      p.textDark.forEach((t, i) => {
        expect(contrast(lin(t), lin(p.paperDark))).toBeGreaterThanOrEqual(4.5);
        if (i < 4) expect(contrast(lin(t), lin(p.highlightDark[i]!))).toBeGreaterThanOrEqual(4.5);
      });
      // The page's own text stays readable on every highlight.
      p.highlight.forEach((h) => expect(contrast(lin(p.ink), lin(h))).toBeGreaterThanOrEqual(7));
      p.highlightDark.forEach((h) => expect(contrast(lin(p.inkDark), lin(h))).toBeGreaterThanOrEqual(4.5));
    }
  });

  test("the image's own second colour becomes a text colour", () => {
    const p = paletteFromPixels(image([[28, 44, 110, 0.6], [240, 128, 128, 0.25], [245, 245, 245, 0.15]]), 40, 50);
    const second = hue(p.text[1]!);
    expect(second.r).toBeGreaterThan(second.b); // the coral, not a made-up harmony
  });
});
