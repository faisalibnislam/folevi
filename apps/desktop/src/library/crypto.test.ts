// The Mac's node:crypto envelope reproduces packages/local-store/fixtures/crypto-vectors.json exactly, refuses
// every reject vector, and reads and writes bytes the reference (WebCrypto) implementation accepts.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import * as ref from "../../../../packages/local-store/src/crypto/envelope";
import { LOCAL_STORE } from "../../test/library-kit";
import {
  deriveWrappingKey,
  fileKey,
  hmacName,
  keyCheck,
  openFile,
  openStream,
  openStreamRange,
  sealFile,
  sealStream,
  StreamReader,
  streamPlainLength,
  unlockMasterKey,
  wrapMasterKey,
  type EncryptionHeader,
} from "./crypto";

const V = JSON.parse(readFileSync(`${LOCAL_STORE}/fixtures/crypto-vectors.json`, "utf8")) as {
  kdf: { passphrase: string; saltHex: string; iterations: number; wrappingKeyHex: string }[];
  wrap: { passphrase: string; masterKeyHex: string; saltHex: string; nonceHex: string; iterations: number; header: EncryptionHeader }[];
  fileKeys: { masterKeyHex: string; pathId: string; keyHex: string }[];
  names: { masterKeyHex: string; kind: "note" | "file"; id: string; name: string }[];
  single: { masterKeyHex: string; pathId: string; nonceHex: string; plaintextUtf8: string; envelopeHex: string }[];
  stream: { masterKeyHex: string; pathId: string; noncePrefixHex: string; chunkSize: number; plaintextLength: number; envelopeLength: number; envelopeSha256: string; envelopeHex?: string }[];
  rejects: { name: string; pathId: string; envelopeHex: string }[];
};
const hex = (s: string) => Buffer.from(s, "hex");
const pattern = (n: number) => {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = i % 251;
  return b;
};
const MASTER = hex(V.wrap[0]!.masterKeyHex);

describe("crypto vectors", () => {
  test("PBKDF2 wrapping keys", async () => {
    for (const k of V.kdf) expect((await deriveWrappingKey(k.passphrase, hex(k.saltHex), k.iterations)).toString("hex")).toBe(k.wrappingKeyHex);
  });

  test("wrapping the master key gives the same header, and it unlocks", async () => {
    for (const w of V.wrap) {
      const header = await wrapMasterKey(hex(w.masterKeyHex), w.passphrase, { iterations: w.iterations, salt: hex(w.saltHex), nonce: hex(w.nonceHex) });
      expect(header).toEqual(w.header);
      expect((await unlockMasterKey(w.header, w.passphrase))?.toString("hex")).toBe(w.masterKeyHex);
      expect(await unlockMasterKey(w.header, "wrong")).toBeNull();
      expect(keyCheck(hex(w.masterKeyHex))).toBe(w.header.keyCheck);
    }
  });

  test("file keys and names", () => {
    for (const f of V.fileKeys) expect(fileKey(hex(f.masterKeyHex), f.pathId).toString("hex")).toBe(f.keyHex);
    for (const n of V.names) expect(hmacName(hex(n.masterKeyHex), n.kind, n.id)).toBe(n.name);
  });

  test("single-shot envelopes", () => {
    for (const s of V.single) {
      const env = sealFile(hex(s.masterKeyHex), s.pathId, Buffer.from(s.plaintextUtf8, "utf8"), hex(s.nonceHex));
      expect(env.toString("hex")).toBe(s.envelopeHex);
      expect(openFile(hex(s.masterKeyHex), s.pathId, hex(s.envelopeHex)).toString("utf8")).toBe(s.plaintextUtf8);
    }
  });

  test("stream envelopes, whole and by range", async () => {
    for (const s of V.stream) {
      const plain = pattern(s.plaintextLength);
      const env = sealStream(hex(s.masterKeyHex), s.pathId, plain, { noncePrefix: hex(s.noncePrefixHex), chunkSize: s.chunkSize });
      expect(env.length).toBe(s.envelopeLength);
      expect(createHash("sha256").update(env).digest("hex")).toBe(s.envelopeSha256);
      if (s.envelopeHex) expect(env.toString("hex")).toBe(s.envelopeHex);
      expect(streamPlainLength(env)).toBe(s.plaintextLength);
      expect(openStream(hex(s.masterKeyHex), s.pathId, env).equals(plain)).toBe(true);
      const ranges: [number, number][] = [
        [0, 0],
        [0, Math.min(1, plain.length)],
        [Math.floor(plain.length / 3), Math.floor((2 * plain.length) / 3)],
        [Math.max(0, plain.length - 5), plain.length],
      ];
      for (const [a, b] of ranges) expect((await openStreamRange(hex(s.masterKeyHex), s.pathId, env, a, b)).equals(plain.subarray(a, b))).toBe(true);
    }
  });

  test("every reject vector is refused", () => {
    for (const r of V.rejects) expect(() => openFile(MASTER, r.pathId, hex(r.envelopeHex)), r.name).toThrow();
  });

  test("a cut-short stream never reads as a shorter valid one, even by range", async () => {
    const plain = pattern(3 * 1000 + 7);
    const env = sealStream(MASTER, "files/ab/x", plain, { chunkSize: 1000 });
    const cut = env.subarray(0, env.length - 1016);
    await expect(openStreamRange(MASTER, "files/ab/x", cut, 0, 10)).rejects.toThrow();
    const reader = await StreamReader.open(MASTER, "files/ab/x", env.length, async (p, n) => env.subarray(p, p + n));
    expect((await reader.range(990, 2010)).equals(plain.subarray(990, 2010))).toBe(true);
  });
});

describe("interoperating with the reference implementation", () => {
  test("ours open theirs and theirs open ours", async () => {
    const key = new Uint8Array(32).fill(9);
    const body = pattern(200_000);
    const theirs = await ref.sealFile(key, "notes/X.fnote", body.subarray(0, 5000));
    expect(openFile(key, "notes/X.fnote", theirs).equals(body.subarray(0, 5000))).toBe(true);
    const ours = sealFile(key, "notes/X.fnote", body.subarray(0, 5000));
    expect(Buffer.from(await ref.openFile(key, "notes/X.fnote", ours)).equals(body.subarray(0, 5000))).toBe(true);
    const theirStream = await ref.sealStream(key, "files/aa/b", body);
    expect(openStream(key, "files/aa/b", theirStream).equals(body)).toBe(true);
    const ourStream = sealStream(key, "files/aa/b", body);
    expect(Buffer.from(await ref.openStreamRange(key, "files/aa/b", ourStream, 70_000, 140_000)).equals(body.subarray(70_000, 140_000))).toBe(true);
    expect(hmacName(key, "note", "01J9ZDOC000000000000000001")).toBe(await ref.hmacName(key, "note", "01J9ZDOC000000000000000001"));
    const header = await wrapMasterKey(key, "pass", { iterations: 1000 });
    expect(Buffer.from((await ref.unlockMasterKey(header, "pass"))!).equals(Buffer.from(key))).toBe(true);
  });
});
