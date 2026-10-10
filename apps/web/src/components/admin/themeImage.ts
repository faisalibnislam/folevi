"use client";

// A theme image as the Theme manager uploads it: made in the admin's browser into the three WebP versions
// the app draws (3200 px for Retina, 1600 px, and a 640 px square thumbnail, as
// packages/design-tokens/scripts/covers.mjs makes them for the built-ins), with its palette picked by the
// same engine that colours the built-ins and people's own images.
import { paletteFromImage, type StylePalette } from "@/lib/palette";

const FULL = 3200;
const HALF = 1600;
const THUMB = 640;
export const THEME_IMAGE_MIN = { width: 800, height: 500 };
export const THEME_IMAGE_HINT = "A landscape image, best at 2400 × 1500 px or larger. JPEG, PNG or WebP, up to 25 MB.";
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

export interface ThemeImageFiles {
  full: Blob;
  half: Blob;
  thumb: Blob;
  width: number;
  height: number;
  palette: StylePalette;
  /** A local preview URL (revoke when done). */
  preview: string;
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("This browser can't prepare images.");
  ctx.imageSmoothingQuality = "high";
  return { c, ctx };
}

function toWebp(c: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b && b.type === "image/webp" ? resolve(b) : reject(new Error("This browser can't save WebP images. Use Chrome, Edge or the Mac app."))), "image/webp", quality),
  );
}

/** Fits inside `max` on its longer side (never enlarges). */
function fit(bitmap: ImageBitmap, max: number) {
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  return { w: Math.round(bitmap.width * scale), h: Math.round(bitmap.height * scale) };
}

/** Checks and prepares a picked file; throws an Error with a message for the admin. */
export async function prepareThemeImage(file: File): Promise<ThemeImageFiles> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Use a JPEG, PNG or WebP image.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("That image is over 25 MB. Use a smaller one.");
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    if (bitmap.width < THEME_IMAGE_MIN.width || bitmap.height < THEME_IMAGE_MIN.height) {
      throw new Error(`That image is ${bitmap.width} × ${bitmap.height} px. Use one at least ${THEME_IMAGE_MIN.width} × ${THEME_IMAGE_MIN.height} px.`);
    }
    const sized = async (max: number, quality: number) => {
      const { w, h } = fit(bitmap, max);
      const { c, ctx } = canvas(w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);
      return toWebp(c, quality);
    };
    const full = await sized(FULL, 0.8);
    const half = await sized(HALF, 0.8);
    // The thumbnail is a centred square, like the built-ins' picker tiles.
    const side = Math.min(bitmap.width, bitmap.height);
    const { c, ctx } = canvas(THUMB, THUMB);
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, THUMB, THUMB);
    const thumb = await toWebp(c, 0.78);
    const palette = await paletteFromImage(half);
    const { w, h } = fit(bitmap, FULL);
    return { full, half, thumb, width: w, height: h, palette, preview: URL.createObjectURL(half) };
  } finally {
    bitmap.close();
  }
}

// ---------------------------------------------------------------- contrast (WCAG)

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
/** The WCAG contrast ratio between two #rrggbb colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return 21;
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
