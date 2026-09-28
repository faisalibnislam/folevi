// Content sniffing and metadata stripping for uploads. Never trusts extensions or client MIME types.

export type Sniffed =
  | { kind: "image"; mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; width?: number; height?: number }
  | { kind: "file"; mime: string; risky: boolean };

const startsWith = (b: Uint8Array, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);

function be16(b: Uint8Array, o: number) {
  return (b[o]! << 8) | b[o + 1]!;
}
function be32(b: Uint8Array, o: number) {
  return ((b[o]! << 24) >>> 0) + ((b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!);
}
function le16(b: Uint8Array, o: number) {
  return b[o]! | (b[o + 1]! << 8);
}
function le24(b: Uint8Array, o: number) {
  return b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);
}
function le32(b: Uint8Array, o: number) {
  return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
}
function fourcc(b: Uint8Array, o: number) {
  return String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
}

/** Canvas size of a WebP (VP8X extended, VP8 lossy or VP8L lossless first chunk). */
function webpSize(b: Uint8Array): { width: number; height: number } | undefined {
  if (b.length < 25) return undefined;
  const chunk = fourcc(b, 12);
  const p = 20; // first chunk payload
  if ((chunk === "VP8X" || chunk === "VP8 ") && b.length < p + 10) return undefined;
  if (chunk === "VP8X") return { width: le24(b, p + 4) + 1, height: le24(b, p + 7) + 1 };
  if (chunk === "VP8 " && b[p + 3] === 0x9d && b[p + 4] === 0x01 && b[p + 5] === 0x2a) {
    return { width: le16(b, p + 6) & 0x3fff, height: le16(b, p + 8) & 0x3fff };
  }
  if (chunk === "VP8L" && b[p] === 0x2f) {
    const bits = le32(b, p + 1);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return undefined;
}

function jpegSize(b: Uint8Array): { width: number; height: number } | undefined {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return undefined;
    // Fill bytes (0xFF padding) may precede any marker.
    while (b[i + 1] === 0xff && i + 10 < b.length) i++;
    const marker = b[i + 1]!;
    const len = be16(b, i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: be16(b, i + 5), width: be16(b, i + 7) };
    }
    i += 2 + len;
  }
  return undefined;
}

const TEXTUAL_RISKY = /^\s*(<!doctype html|<html|<script|<svg|<\?xml)/i;

export function sniff(bytes: Uint8Array): Sniffed {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: "image", mime: "image/png", width: be32(bytes, 16), height: be32(bytes, 20) };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: "image", mime: "image/jpeg", ...jpegSize(bytes) };
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return { kind: "image", mime: "image/gif", width: le16(bytes, 6), height: le16(bytes, 8) };
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { kind: "image", mime: "image/webp", ...webpSize(bytes) };
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return { kind: "file", mime: "application/pdf", risky: false };
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return { kind: "file", mime: "application/zip", risky: false };
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 512));
  // Anything that could be rendered as active content by a browser is forced to download as octet-stream.
  if (TEXTUAL_RISKY.test(head)) return { kind: "file", mime: "application/octet-stream", risky: true };
  const printable = bytes.slice(0, 512).every((c) => c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127) || c >= 128);
  if (printable) return { kind: "file", mime: "text/plain", risky: false };
  return { kind: "file", mime: "application/octet-stream", risky: false };
}

/** Removes EXIF/XMP/comment segments from JPEG (keeps JFIF, ICC profile and image data). */
export function stripJpeg(b: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [b.slice(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) break;
    // Fill bytes (0xFF padding) may precede any marker; they carry nothing and are dropped.
    while (b[i + 1] === 0xff && i + 4 < b.length) i++;
    const marker = b[i + 1]!;
    if (marker === 0xda) {
      out.push(b.slice(i));
      return concat(out);
    }
    const len = be16(b, i + 2);
    const segment = b.slice(i, i + 2 + len);
    const isApp = marker >= 0xe1 && marker <= 0xef;
    const isIcc = marker === 0xe2 && startsWith(b, [0x49, 0x43, 0x43, 0x5f], i + 4);
    const isComment = marker === 0xfe;
    if ((!isApp || isIcc) && !isComment) out.push(segment);
    i += 2 + len;
  }
  return b;
}

/** Removes textual and EXIF chunks from PNG. */
export function stripPng(b: Uint8Array): Uint8Array {
  const drop = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);
  const out: Uint8Array[] = [b.slice(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = be32(b, i);
    const type = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!);
    const end = i + 12 + len;
    if (end > b.length) return b;
    if (!drop.has(type)) out.push(b.slice(i, end));
    i = end;
    if (type === "IEND") break;
  }
  return concat(out);
}

/**
 * Removes EXIF and XMP chunks from WebP and clears the matching VP8X flags. Keeps ICC profiles,
 * alpha and animation. Malformed containers are returned unchanged.
 */
export function stripWebp(b: Uint8Array): Uint8Array {
  if (b.length < 12 || fourcc(b, 0) !== "RIFF" || fourcc(b, 8) !== "WEBP") return b;
  const end = Math.min(b.length, 8 + le32(b, 4));
  const out: Uint8Array[] = [b.slice(0, 12)];
  let vp8x: Uint8Array | null = null;
  let dropped = false;
  let i = 12;
  while (i + 8 <= end) {
    const type = fourcc(b, i);
    const size = le32(b, i + 4);
    const next = i + 8 + size + (size & 1);
    if (i + 8 + size > end) return b;
    if (type === "EXIF" || type === "XMP ") dropped = true;
    else {
      const chunk = b.slice(i, Math.min(next, end));
      if (type === "VP8X" && size >= 10) vp8x = chunk;
      out.push(chunk);
    }
    i = next;
  }
  if (!dropped && !(vp8x && vp8x[8]! & 0x0c)) return b;
  if (vp8x) vp8x[8] = vp8x[8]! & ~0x0c; // EXIF (0x08) and XMP (0x04) flags
  const joined = concat(out);
  const riffSize = joined.length - 8;
  joined[4] = riffSize & 0xff;
  joined[5] = (riffSize >>> 8) & 0xff;
  joined[6] = (riffSize >>> 16) & 0xff;
  joined[7] = (riffSize >>> 24) & 0xff;
  return joined;
}

/** Application extensions a GIF needs to render as intended (looping, ICC colour). Everything else is dropped. */
const GIF_KEEP_APPS = new Set(["NETSCAPE2.0", "ANIMEXTS1.0", "ICCRGBG1012"]);

/** Skips a run of GIF data sub-blocks starting at `i`; returns the index after the terminator, or -1. */
function gifSubBlocksEnd(b: Uint8Array, i: number): number {
  while (i < b.length) {
    const n = b[i]!;
    if (n === 0) return i + 1;
    i += 1 + n;
  }
  return -1;
}

/**
 * Removes comment extensions and non-rendering application extensions (e.g. XMP) from GIF, and any
 * bytes after the trailer. Malformed files are returned unchanged.
 */
export function stripGif(b: Uint8Array): Uint8Array {
  if (b.length < 13 || !startsWith(b, [0x47, 0x49, 0x46, 0x38])) return b;
  let i = 13;
  const packed = b[10]!;
  if (packed & 0x80) i += 3 * (1 << ((packed & 0x07) + 1));
  const out: Uint8Array[] = [b.slice(0, i)];
  let changed = false;
  while (i < b.length) {
    const intro = b[i]!;
    if (intro === 0x3b) {
      out.push(b.slice(i, i + 1));
      if (i + 1 !== b.length) changed = true;
      return changed ? concat(out) : b;
    }
    if (intro === 0x21) {
      const label = b[i + 1];
      const end = gifSubBlocksEnd(b, i + 2);
      if (label === undefined || end < 0) return b;
      let keep = true;
      if (label === 0xfe) keep = false;
      else if (label === 0xff) {
        const n = b[i + 2]!;
        const app = n >= 11 ? String.fromCharCode(...b.slice(i + 3, i + 14)) : "";
        keep = GIF_KEEP_APPS.has(app);
      }
      if (keep) out.push(b.slice(i, end));
      else changed = true;
      i = end;
      continue;
    }
    if (intro === 0x2c) {
      if (i + 10 > b.length) return b;
      let j = i + 10;
      const local = b[i + 9]!;
      if (local & 0x80) j += 3 * (1 << ((local & 0x07) + 1));
      j += 1; // LZW minimum code size
      const end = gifSubBlocksEnd(b, j);
      if (end < 0) return b;
      out.push(b.slice(i, end));
      i = end;
      continue;
    }
    return b;
  }
  // No trailer: leave untouched rather than guess.
  return b;
}

/** Strips metadata for any sniffed image type (a no-op when there is nothing to remove). */
export function stripImageMetadata(mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp", bytes: Uint8Array): Uint8Array {
  switch (mime) {
    case "image/jpeg":
      return stripJpeg(bytes);
    case "image/png":
      return stripPng(bytes);
    case "image/gif":
      return stripGif(bytes);
    case "image/webp":
      return stripWebp(bytes);
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function safeFilename(name: string): string {
  const cleaned = name
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F/\\:*?"<>|]+/g, "-")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180);
  return cleaned || "file";
}

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 50_000_000;
