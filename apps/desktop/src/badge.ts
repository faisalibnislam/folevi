// The unread count on Folevi's taskbar button: Windows has no badge API for desktop apps, so the count is an
// overlay icon (BrowserWindow.setOverlayIcon), drawn here as a small PNG: a red circle with the number in white,
// "9+" past nine (the overlay is 16 px at 100% scaling, so more digits wouldn't read). Drawn in plain code (no
// native modules, no canvas) at 32 px, which Windows scales down.
import { deflateSync } from "node:zlib";

const SIZE = 32;
const RED: [number, number, number] = [0xd9, 0x30, 0x25];

/** 5 by 7 dots for each glyph the badge uses. */
const GLYPHS: Record<string, string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
};

/** What the badge says for a count: "" for none, the number up to 9, then "9+". */
export function badgeText(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "";
  return count > 9 ? "9+" : String(Math.floor(count));
}

/** The accessible description Windows reads for the overlay ("3 unread"). */
export function badgeDescription(count: number): string {
  const text = badgeText(count);
  return text ? `${text === "9+" ? "More than 9" : text} unread` : "";
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** A PNG of `size` by `size` RGBA pixels. */
export function encodePng(rgba: Uint8Array, size: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0; // no filter
    Buffer.from(rgba.subarray(y * size * 4, (y + 1) * size * 4)).copy(rows, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", new Uint8Array())]);
}

/** The badge's pixels for `text` (RGBA, SIZE by SIZE): an antialiased red circle, white dots for the glyphs. */
export function badgePixels(text: string): Uint8Array {
  const px = new Uint8Array(SIZE * SIZE * 4);
  const r = SIZE / 2;
  // The circle, 4 by 4 samples a pixel for a smooth edge.
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let inside = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const dx = x + (sx + 0.5) / 4 - r;
        const dy = y + (sy + 0.5) / 4 - r;
        if (dx * dx + dy * dy <= r * r) inside++;
      }
      const i = (y * SIZE + x) * 4;
      px[i] = RED[0];
      px[i + 1] = RED[1];
      px[i + 2] = RED[2];
      px[i + 3] = Math.round((inside / 16) * 255);
    }
  }
  const glyphs = [...text].map((c) => GLYPHS[c]).filter((g): g is string[] => !!g);
  if (!glyphs.length) return px;
  // One glyph at 3x, two at 2x, centred.
  const scale = glyphs.length === 1 ? 3 : 2;
  const gap = scale;
  const width = glyphs.length * 5 * scale + (glyphs.length - 1) * gap;
  const height = 7 * scale;
  const left = Math.round((SIZE - width) / 2);
  const top = Math.round((SIZE - height) / 2);
  glyphs.forEach((g, n) => {
    const gx = left + n * (5 * scale + gap);
    g.forEach((row, ry) => {
      [...row].forEach((bit, rx) => {
        if (bit !== "1") return;
        for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
          const x = gx + rx * scale + sx;
          const y = top + ry * scale + sy;
          if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
          const i = (y * SIZE + x) * 4;
          px[i] = 255;
          px[i + 1] = 255;
          px[i + 2] = 255;
          px[i + 3] = 255;
        }
      });
    });
  });
  return px;
}

/** The overlay icon for a count as PNG bytes, or null for none (the overlay is cleared). */
export function badgePng(count: number): Buffer | null {
  const text = badgeText(count);
  return text ? encodePng(badgePixels(text), SIZE) : null;
}
