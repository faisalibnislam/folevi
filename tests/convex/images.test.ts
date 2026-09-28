// Upload content sniffing and metadata stripping (convex/lib/images.ts).
import { describe, expect, test } from "vitest";
import { safeFilename, sameBytes, sniff, stripGif, stripImageMetadata, stripJpeg, stripPng, stripWebp } from "../../convex/lib/images";

const enc = (s: string) => Array.from(new TextEncoder().encode(s));
const bytes = (...parts: (number[] | string)[]) => new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? enc(p) : p)));
const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u24le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const has = (hay: Uint8Array, needle: string) => new TextDecoder("latin1").decode(hay).includes(needle);

function jpeg() {
  const seg = (marker: number, payload: number[]) => [0xff, marker, ...u16be(payload.length + 2), ...payload];
  return bytes(
    [0xff, 0xd8],
    seg(0xe0, enc("JFIF\0\x01\x01\0\0\x01\0\x01\0\0")),
    seg(0xe1, enc("Exif\0\0GPS 38.7N 9.1W")),
    seg(0xe2, enc("ICC_PROFILE\0keep-me")),
    seg(0xfe, enc("comment: secret camera owner")),
    [0xff, 0xff], // fill byte before the next marker
    seg(0xc0, [8, ...u16be(480), ...u16be(640), 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]),
    seg(0xda, [1, 1, 0, 0, 0x3f, 0]),
    [0x12, 0x34, 0xff, 0xd9],
  );
}

function png() {
  const chunk = (type: string, data: number[]) => [...u32be(data.length), ...enc(type), ...data, 0, 0, 0, 0];
  return bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    chunk("IHDR", [...u32be(64), ...u32be(32), 8, 6, 0, 0, 0]),
    chunk("tEXt", enc("Author\0Secret Person")),
    chunk("eXIf", enc("MM\0*gps")),
    chunk("IDAT", [1, 2, 3]),
    chunk("IEND", []),
  );
}

function gif() {
  return bytes(
    "GIF89a",
    [...u16le(10), ...u16le(20), 0x80, 0, 0], // global colour table, 2 entries
    [0, 0, 0, 255, 255, 255],
    [0x21, 0xff, 11], "NETSCAPE2.0", [3, 1, 0, 0, 0], // looping: keep
    [0x21, 0xff, 11], "XMP DataXMP", [5], "<xmp>", [0], // XMP: drop
    [0x21, 0xfe, 7], "secret!", [0], // comment: drop
    [0x21, 0xf9, 4, 0, 0, 0, 0, 0], // graphic control: keep
    [0x2c, ...u16le(0), ...u16le(0), ...u16le(10), ...u16le(20), 0], // image descriptor
    [2, 2, 0x4c, 0x01, 0], // LZW min size + data
    [0x3b],
    "trailing junk after trailer",
  );
}

function webp(kind: "VP8X" | "VP8L" | "VP8 ") {
  const chunk = (type: string, data: number[]) => [...enc(type), ...u32le(data.length), ...data, ...(data.length & 1 ? [0] : [])];
  let body: number[];
  if (kind === "VP8X") {
    body = [
      ...chunk("VP8X", [0x08 | 0x04 | 0x10, 0, 0, 0, ...u24le(799), ...u24le(599)]),
      ...chunk("ICCP", enc("icc")),
      ...chunk("VP8L", [0x2f, 0, 0, 0, 0]),
      ...chunk("EXIF", enc("Exif GPS")),
      ...chunk("XMP ", enc("<x:xmpmeta/>")),
    ];
  } else if (kind === "VP8L") {
    const bits = (300 - 1) | ((200 - 1) << 14);
    body = chunk("VP8L", [0x2f, ...u32le(bits), 0]);
  } else {
    body = chunk("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(320), ...u16le(240), 0, 0]);
  }
  return bytes("RIFF", u32le(body.length + 4), "WEBP", body);
}

describe("sniff", () => {
  test("recognises images by content and reads their dimensions", () => {
    expect(sniff(jpeg())).toEqual({ kind: "image", mime: "image/jpeg", width: 640, height: 480 });
    expect(sniff(png())).toEqual({ kind: "image", mime: "image/png", width: 64, height: 32 });
    expect(sniff(gif())).toEqual({ kind: "image", mime: "image/gif", width: 10, height: 20 });
    expect(sniff(webp("VP8X"))).toEqual({ kind: "image", mime: "image/webp", width: 800, height: 600 });
    expect(sniff(webp("VP8L"))).toEqual({ kind: "image", mime: "image/webp", width: 300, height: 200 });
    expect(sniff(webp("VP8 "))).toEqual({ kind: "image", mime: "image/webp", width: 320, height: 240 });
  });

  test("never trusts names: active content downloads as octet-stream", () => {
    for (const s of ["<!doctype html><script>x</script>", "  <svg onload=alert(1)>", "<?xml version='1.0'?>", "<html>"]) {
      expect(sniff(bytes(s))).toEqual({ kind: "file", mime: "application/octet-stream", risky: true });
    }
    expect(sniff(bytes("%PDF-1.7"))).toEqual({ kind: "file", mime: "application/pdf", risky: false });
    expect(sniff(bytes([0x50, 0x4b, 0x03, 0x04]))).toMatchObject({ mime: "application/zip" });
    expect(sniff(bytes("plain notes\n"))).toEqual({ kind: "file", mime: "text/plain", risky: false });
    expect(sniff(bytes([0, 1, 2, 0xff, 0]))).toEqual({ kind: "file", mime: "application/octet-stream", risky: false });
  });
});

describe("metadata stripping", () => {
  test("JPEG loses EXIF and comments but keeps JFIF, ICC and image data", () => {
    const out = stripJpeg(jpeg());
    expect(has(out, "GPS")).toBe(false);
    expect(has(out, "secret camera owner")).toBe(false);
    expect(has(out, "JFIF")).toBe(true);
    expect(has(out, "keep-me")).toBe(true);
    expect(Array.from(out.slice(-4))).toEqual([0x12, 0x34, 0xff, 0xd9]);
    expect(sniff(out)).toMatchObject({ width: 640, height: 480 });
  });

  test("PNG loses text and EXIF chunks", () => {
    const out = stripPng(png());
    expect(has(out, "Secret Person")).toBe(false);
    expect(has(out, "eXIf")).toBe(false);
    expect(has(out, "IDAT")).toBe(true);
    expect(has(out, "IEND")).toBe(true);
  });

  test("GIF loses comments, XMP and trailing bytes but keeps looping and frames", () => {
    const out = stripGif(gif());
    expect(has(out, "secret!")).toBe(false);
    expect(has(out, "XMP DataXMP")).toBe(false);
    expect(has(out, "trailing junk")).toBe(false);
    expect(has(out, "NETSCAPE2.0")).toBe(true);
    expect(out[out.length - 1]).toBe(0x3b);
    expect(sniff(out)).toMatchObject({ mime: "image/gif", width: 10, height: 20 });
  });

  test("WebP loses EXIF/XMP chunks and flags; RIFF size stays consistent", () => {
    const out = stripWebp(webp("VP8X"));
    expect(has(out, "Exif GPS")).toBe(false);
    expect(has(out, "xmpmeta")).toBe(false);
    expect(has(out, "ICCP")).toBe(true);
    expect(out[20]! & 0x0c).toBe(0); // EXIF/XMP flags cleared
    expect(out[20]! & 0x10).toBe(0x10); // alpha kept
    const riff = out[4]! | (out[5]! << 8) | (out[6]! << 16) | (out[7]! << 24);
    expect(riff).toBe(out.length - 8);
    expect(sniff(out)).toMatchObject({ width: 800, height: 600 });
  });

  test("clean or malformed files are returned untouched", () => {
    const clean = webp("VP8L");
    expect(stripWebp(clean)).toBe(clean);
    const truncatedGif = gif().slice(0, 40);
    expect(stripGif(truncatedGif)).toBe(truncatedGif);
    const badRiff = bytes("RIFF", u32le(400), "WEBP", "EXIF", u32le(9999));
    expect(stripWebp(badRiff)).toBe(badRiff);
    const stripped = stripImageMetadata("image/png", png());
    expect(sameBytes(stripImageMetadata("image/png", stripped), stripped)).toBe(true);
  });
});

describe("safeFilename", () => {
  test("removes path separators, control characters and leading dots", () => {
    expect(safeFilename("../../etc/passwd")).toBe("-..-etc-passwd");
    expect(safeFilename(".hidden\u0000name?.txt")).toBe("hidden-name-.txt");
    expect(safeFilename("   ")).toBe("file");
  });
});

describe("file delivery headers", () => {
  test("Content-Disposition keeps names with apostrophes and non-ASCII characters", async () => {
    const { contentDisposition } = await import("../../convex/http");
    const h = contentDisposition("attachment", "Maya's Folio (draft)*-folevi-export.zip");
    expect(h).toBe(`attachment; filename="Maya's Folio (draft)*-folevi-export.zip"; filename*=UTF-8''Maya%27s%20Folio%20%28draft%29%2A-folevi-export.zip`);
    expect(contentDisposition("inline", "résumé \"final\";.pdf")).toBe(`inline; filename="r_sum_ _final__.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%22final%22%3B.pdf`);
  });
});
