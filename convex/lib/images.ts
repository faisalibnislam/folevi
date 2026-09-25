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

function jpegSize(b: Uint8Array): { width: number; height: number } | undefined {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return undefined;
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
    return { kind: "image", mime: "image/webp" };
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
