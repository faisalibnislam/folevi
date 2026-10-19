"use client";

// Export for the visual blocks: a block's standalone SVG (light colours, drawn by the block's own svg.ts)
// saved as a PNG, SVG or PDF file, or copied to the clipboard as an image. Everything happens on the device;
// nothing is rendered on a server.
//
// Saving follows the rest of the app (doc/export.ts): a download in the browser and in the Mac app (Electron
// asks where to save it). In the iPhone and iPad app the file goes to iOS's share sheet instead (Save to
// Files, Save Image, AirDrop, Mail), which Capacitor's web view can't do with a download.
import { inIosApp } from "@/lib/nativeApp";
import { appFontFamily, embeddedFontFace, svgDataUrl } from "../richRender";

export type ImageFormat = "png" | "svg" | "pdf";

export const IMAGE_FORMAT_LABEL: Record<ImageFormat, string> = { png: "PNG", svg: "SVG", pdf: "PDF" };

const MIME: Record<ImageFormat, string> = { png: "image/png", svg: "image/svg+xml", pdf: "application/pdf" };

/** Pixels per SVG unit in raster exports (sharp on high-density screens), reduced for very large drawings. */
const SCALE = 2;
/** iOS refuses canvases much past 16 million pixels, and no side may pass 8192. */
const MAX_PIXELS = 16_000_000;
const MAX_SIDE = 8192;

/** A file name for the export: the block's name, safe on every system. */
export function exportFileName(name: string, format: ImageFormat): string {
  const base = (name || "Image").replace(/[\u0000-\u001F\u007F/\\:*?"<>|]+/g, "-").trim().slice(0, 120) || "Image";
  return `${base}.${format}`;
}

/** The drawing's size in SVG units, from its width and height (or its viewBox). */
export function svgSize(svg: string): { w: number; h: number } {
  const open = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
  const attr = (n: string) => Number(new RegExp(`\\s${n}="([\\d.]+)(px)?"`).exec(open)?.[1]);
  const box = /viewBox="[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)"/.exec(open);
  const w = attr("width") || Number(box?.[1]) || 800;
  const h = attr("height") || Number(box?.[2]) || 600;
  return { w, h };
}

/**
 * The SVG with the app's font inside it (an SVG image can't load fonts from the page), so a saved file and
 * a picture of it look like the block. The drawing names "Instrument Sans" first in its font stack.
 */
async function withAppFont(svg: string): Promise<string> {
  const family = appFontFamily();
  const face = family ? await embeddedFontFace(family) : null;
  const rules = face ? [face.replace(/font-family:"[^"]*"/, 'font-family:"Instrument Sans"')] : [];
  // A drawing in a handwriting look (the wireframe's Sketch) names "Mali", another of the app's fonts.
  if (/font-family:"Mali"/.test(svg)) {
    const mali = appFontFamily("--font-mali");
    const maliFace = mali ? await embeddedFontFace(mali) : null;
    if (maliFace) rules.push(maliFace.replace(/font-family:"[^"]*"/, 'font-family:"Mali"'));
  }
  if (!rules.length) return svg;
  return svg.replace(/<svg\b[^>]*>/i, (open) => `${open}<defs><style>${rules.join("")}</style></defs>`);
}

/** Draws the SVG on a canvas with a white page behind it (PDF and JPEG have no transparency). */
async function rasterize(svg: string): Promise<HTMLCanvasElement> {
  const { w, h } = svgSize(svg);
  const scale = Math.min(SCALE, Math.sqrt(MAX_PIXELS / Math.max(1, w * h)), MAX_SIDE / Math.max(w, h));
  const img = new Image();
  img.decoding = "async";
  img.src = svgDataUrl(svg);
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This device can't draw the image.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("This device can't make the image."))), type, quality));

/** The SVG as a PNG. */
export async function svgToPng(svg: string): Promise<Blob> {
  return toBlob(await rasterize(await withAppFont(svg)), "image/png");
}

/** The SVG as a one-page PDF the size of the drawing (see jpegPdf). */
export async function svgToPdf(svg: string, title: string): Promise<Blob> {
  const canvas = await rasterize(await withAppFont(svg));
  const jpeg = new Uint8Array(await (await toBlob(canvas, "image/jpeg", 0.92)).arrayBuffer());
  return new Blob([jpegPdf(jpeg, { width: canvas.width, height: canvas.height }, svgSize(svg), title) as BlobPart], { type: MIME.pdf });
}

/**
 * A one-page PDF showing a JPEG (`pixels` its size) at `size` CSS pixels, with the title in the document's
 * details. Written by hand, so no PDF library loads for it.
 */
export function jpegPdf(jpeg: Uint8Array, pixels: { width: number; height: number }, size: { w: number; h: number }, title: string): Uint8Array {
  // CSS pixels to PDF points.
  const pw = Math.round(size.w * 0.75 * 100) / 100;
  const ph = Math.round(size.h * 0.75 * 100) / 100;
  const pdfText = (s: string) => `(${s.replace(/[^\x20-\x7E]/g, "").replace(/([\\()])/g, "\\$1")})`;
  const draw = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === "string" ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, body: (string | Uint8Array)[]) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    for (const p of body) push(p);
    push("\nendobj\n");
  };
  push("%PDF-1.4\n");
  object(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  object(2, ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"]);
  object(3, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`]);
  object(4, [`<< /Type /XObject /Subtype /Image /Width ${pixels.width} /Height ${pixels.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, "\nendstream"]);
  object(5, [`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`]);
  object(6, [`<< /Title ${pdfText(title)} /Producer (Folevi) >>`]);
  const xref = length;
  push(`xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`);
  push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * Saves a file the way this device does: the share sheet in the iPhone and iPad app, a download elsewhere
 * (the Mac app asks where to put it). Resolves false when the person closed the share sheet.
 */
export async function saveFile(blob: Blob, filename: string): Promise<boolean> {
  if (inIosApp() && typeof navigator.share === "function") {
    const file = new File([blob], filename, { type: blob.type });
    if (!navigator.canShare || navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return true;
      } catch (e) {
        if ((e as Error).name === "AbortError") return false;
        // Not allowed here (the tap was too long ago): fall back to a download.
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

/** Exports a block's SVG as a file in the chosen format. `name` names the file (without an extension). */
export async function exportImage(svg: string, name: string, format: ImageFormat): Promise<boolean> {
  const filename = exportFileName(name, format);
  const blob = format === "svg" ? new Blob([await withAppFont(svg)], { type: MIME.svg }) : format === "png" ? await svgToPng(svg) : await svgToPdf(svg, name);
  return saveFile(blob, filename);
}

/**
 * Copies a block's picture to the clipboard as a PNG. The image is handed over as a promise so the copy
 * still counts as the person's own click while it's being drawn (Safari needs that).
 */
export async function copyImage(svg: string): Promise<void> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) throw new Error("Copying images isn't supported here.");
  await navigator.clipboard.write([new ClipboardItem({ "image/png": svgToPng(svg) })]);
}
