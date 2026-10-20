// Crypto test vectors (fixtures/crypto-vectors.json): the Mac (Node crypto) and iOS (CryptoKit) layers must
// produce and accept exactly these bytes. Each vector is also recomputed here with node:crypto, so the
// fixture is plain standard PBKDF2 / HKDF / HMAC / AES-256-GCM. UPDATE_GOLDEN=1 regenerates the fixture.
import { createCipheriv, createHmac, hkdfSync, pbkdf2Sync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ITERATIONS,
  STREAM_CHUNK,
  changePassphrase,
  createEncryption,
  deriveWrappingKeyBytes,
  fileKeyBytes,
  fromBase64,
  fromHex,
  hmacName,
  openFile,
  openStream,
  openStreamRange,
  sealFile,
  sealStream,
  sha256Hex,
  streamPlainLength,
  toHex,
  unlockMasterKey,
  utf8,
  type EncryptionHeader,
} from "../src";

const fixturePath = resolve(__dirname, "../fixtures/crypto-vectors.json");
const update = process.env.UPDATE_GOLDEN === "1";

const MASTER = fromHex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
const NONCE = fromHex("a0a1a2a3a4a5a6a7a8a9aaab");
const PREFIX = fromHex("b0b1b2b3b4b5b6b7");

function pattern(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = i % 251;
  return out;
}

interface Vectors {
  $description: string;
  kdf: { passphrase: string; saltHex: string; iterations: number; wrappingKeyHex: string }[];
  wrap: {
    passphrase: string;
    masterKeyHex: string;
    saltHex: string;
    nonceHex: string;
    iterations: number;
    header: EncryptionHeader;
  }[];
  fileKeys: { masterKeyHex: string; pathId: string; keyHex: string }[];
  names: { masterKeyHex: string; kind: "note" | "file"; id: string; name: string }[];
  single: {
    masterKeyHex: string;
    pathId: string;
    nonceHex: string;
    plaintextUtf8: string;
    envelopeHex: string;
  }[];
  stream: {
    masterKeyHex: string;
    pathId: string;
    noncePrefixHex: string;
    chunkSize: number;
    plaintextLength: number;
    plaintext: "i % 251";
    envelopeLength: number;
    envelopeSha256: string;
    envelopeHex?: string;
  }[];
  rejects: { name: string; pathId: string; envelopeHex: string }[];
}

async function generate(): Promise<Vectors> {
  const kdf: Vectors["kdf"] = [];
  for (const [passphrase, iterations] of [
    ["correct horse battery staple", 1000],
    ["pässwörd with ünïcode", 1000],
    ["correct horse battery staple", DEFAULT_ITERATIONS],
  ] as const) {
    const salt = fromHex("c0c1c2c3c4c5c6c7c8c9cacbcccdcecf");
    kdf.push({
      passphrase,
      saltHex: toHex(salt),
      iterations,
      wrappingKeyHex: toHex(await deriveWrappingKeyBytes(passphrase, salt, iterations)),
    });
  }
  const wrapSalt = fromHex("d0d1d2d3d4d5d6d7d8d9dadbdcdddedf");
  const { header } = await createEncryption("correct horse battery staple", {
    iterations: 1000,
    salt: wrapSalt,
    masterKey: MASTER,
    nonce: NONCE,
  });
  const wrap = [
    {
      passphrase: "correct horse battery staple",
      masterKeyHex: toHex(MASTER),
      saltHex: toHex(wrapSalt),
      nonceHex: toHex(NONCE),
      iterations: 1000,
      header,
    },
  ];
  const paths = [
    "notes/01J9ZDOC000000000000000001.fnote",
    "index/library.findex",
    "history/7k2m9q4r1t8v3w6x0y5z2a7b4c/00000lid5-0000-D0-D0-auto.fver",
    "files/9f/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  ];
  const fileKeys = [];
  for (const pathId of paths)
    fileKeys.push({
      masterKeyHex: toHex(MASTER),
      pathId,
      keyHex: toHex(await fileKeyBytes(MASTER, pathId)),
    });
  const names: Vectors["names"] = [];
  for (const [kind, id] of [
    ["note", "01J9ZDOC000000000000000001"],
    ["note", "inbox-0123456789abcdef"],
    ["file", "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"],
  ] as const) {
    names.push({ masterKeyHex: toHex(MASTER), kind, id, name: await hmacName(MASTER, kind, id) });
  }
  const single: Vectors["single"] = [];
  for (const [pathId, text] of [
    [paths[0]!, '{"format":"folevi-note","id":"01J9ZDOC000000000000000001"}'],
    [paths[1]!, ""],
    [paths[2]!, "Changed on another device"],
  ] as const) {
    single.push({
      masterKeyHex: toHex(MASTER),
      pathId,
      nonceHex: toHex(NONCE),
      plaintextUtf8: text,
      envelopeHex: toHex(await sealFile(MASTER, pathId, utf8(text), NONCE)),
    });
  }
  const stream: Vectors["stream"] = [];
  const cases: [number, number][] = [
    [STREAM_CHUNK, 0],
    [STREAM_CHUNK, 1],
    [STREAM_CHUNK, STREAM_CHUNK - 1],
    [STREAM_CHUNK, STREAM_CHUNK],
    [STREAM_CHUNK, STREAM_CHUNK + 1],
    [STREAM_CHUNK, 2 * STREAM_CHUNK],
    [STREAM_CHUNK, 200_000],
    [16, 0],
    [16, 16],
    [16, 40],
  ];
  for (const [chunkSize, length] of cases) {
    const env = await sealStream(MASTER, paths[3]!, pattern(length), {
      noncePrefix: PREFIX,
      chunkSize,
    });
    const v: Vectors["stream"][number] = {
      masterKeyHex: toHex(MASTER),
      pathId: paths[3]!,
      noncePrefixHex: toHex(PREFIX),
      chunkSize,
      plaintextLength: length,
      plaintext: "i % 251",
      envelopeLength: env.length,
      envelopeSha256: sha256Hex(env),
    };
    if (env.length <= 256) v.envelopeHex = toHex(env);
    stream.push(v);
  }
  const small = fromHex(
    stream.find((s) => s.chunkSize === 16 && s.plaintextLength === 40)!.envelopeHex!,
  );
  const flip = small.slice();
  flip[30] = flip[30]! ^ 1;
  const chunk = 16 + 16;
  const swapped = small.slice();
  swapped.set(small.slice(17 + chunk, 17 + 2 * chunk), 17);
  swapped.set(small.slice(17, 17 + chunk), 17 + chunk);
  const singleEnv = fromHex(single[0]!.envelopeHex);
  const rejects = [
    { name: "stream: one bit flipped", pathId: paths[3]!, envelopeHex: toHex(flip) },
    {
      name: "stream: cut at a chunk boundary (last flag missing)",
      pathId: paths[3]!,
      envelopeHex: toHex(small.slice(0, 17 + 2 * chunk)),
    },
    {
      name: "stream: cut inside a chunk",
      pathId: paths[3]!,
      envelopeHex: toHex(small.slice(0, small.length - 5)),
    },
    { name: "stream: two chunks swapped", pathId: paths[3]!, envelopeHex: toHex(swapped) },
    { name: "stream: sealed for another path", pathId: paths[0]!, envelopeHex: toHex(small) },
    {
      name: "single: tag changed",
      pathId: paths[0]!,
      envelopeHex: toHex(singleEnv.map((b, i) => (i === singleEnv.length - 1 ? b ^ 0x80 : b))),
    },
    {
      name: "single: header nonce changed",
      pathId: paths[0]!,
      envelopeHex: toHex(singleEnv.map((b, i) => (i === 6 ? b ^ 1 : b))),
    },
    {
      name: "single: truncated",
      pathId: paths[0]!,
      envelopeHex: toHex(singleEnv.slice(0, singleEnv.length - 1)),
    },
    { name: "single: sealed for another path", pathId: paths[1]!, envelopeHex: toHex(singleEnv) },
    {
      name: "not an envelope",
      pathId: paths[0]!,
      envelopeHex: toHex(utf8('{"format":"folevi-note"}')),
    },
  ];
  return {
    $description:
      "Reference vectors for the FLV1 envelope (docs/LOCAL_MODE_PLAN.md §3.9, packages/local-store/src/crypto/envelope.ts). Natives must reproduce kdf, wrap.header (given the nonce), fileKeys, names, single and stream exactly, and must reject every entry of rejects. Stream plaintext byte i is i % 251.",
    kdf,
    wrap,
    fileKeys,
    names,
    single,
    stream,
    rejects,
  };
}

let vectors: Vectors;
if (update) {
  vectors = await generate();
  writeFileSync(fixturePath, `${JSON.stringify(vectors, null, 2)}\n`);
} else {
  vectors = JSON.parse(readFileSync(fixturePath, "utf8")) as Vectors;
}

describe("crypto vectors", () => {
  it("the implementation still produces every vector", async () => {
    expect(await generate()).toEqual(vectors);
  });

  it("vectors are standard primitives (recomputed with node:crypto)", () => {
    for (const v of vectors.kdf) {
      if (v.iterations > 10_000) continue; // the 600k vector is checked by the implementation test above
      expect(
        pbkdf2Sync(
          Buffer.from(v.passphrase.normalize("NFC"), "utf8"),
          fromHex(v.saltHex),
          v.iterations,
          32,
          "sha256",
        ).toString("hex"),
      ).toBe(v.wrappingKeyHex);
    }
    for (const v of vectors.fileKeys) {
      const key = Buffer.from(
        hkdfSync(
          "sha256",
          fromHex(v.masterKeyHex),
          Buffer.from("folevi/v1"),
          Buffer.from(`file:${v.pathId}`),
          32,
        ),
      );
      expect(key.toString("hex")).toBe(v.keyHex);
    }
    for (const v of vectors.names) {
      const key = Buffer.from(
        hkdfSync(
          "sha256",
          fromHex(v.masterKeyHex),
          Buffer.from("folevi/v1"),
          Buffer.from("names"),
          32,
        ),
      );
      const mac = createHmac("sha256", key).update(`${v.kind}:${v.id}`).digest();
      const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
      let bits = "";
      for (const b of mac) bits += b.toString(2).padStart(8, "0");
      let name = "";
      for (let i = 0; i < 26; i++) name += alphabet[parseInt(bits.slice(i * 5, i * 5 + 5), 2)];
      expect(name).toBe(v.name);
    }
    for (const v of vectors.single) {
      const key = Buffer.from(
        hkdfSync(
          "sha256",
          fromHex(v.masterKeyHex),
          Buffer.from("folevi/v1"),
          Buffer.from(`file:${v.pathId}`),
          32,
        ),
      );
      const header = Buffer.concat([Buffer.from("FLV1"), Buffer.from([1]), fromHex(v.nonceHex)]);
      const cipher = createCipheriv("aes-256-gcm", key, fromHex(v.nonceHex));
      cipher.setAAD(header);
      const ct = Buffer.concat([
        cipher.update(Buffer.from(v.plaintextUtf8, "utf8")),
        cipher.final(),
        cipher.getAuthTag(),
      ]);
      expect(Buffer.concat([header, ct]).toString("hex")).toBe(v.envelopeHex);
    }
    for (const v of vectors.stream) {
      const key = Buffer.from(
        hkdfSync(
          "sha256",
          fromHex(v.masterKeyHex),
          Buffer.from("folevi/v1"),
          Buffer.from(`file:${v.pathId}`),
          32,
        ),
      );
      const size = Buffer.alloc(4);
      size.writeUInt32BE(v.chunkSize);
      const header = Buffer.concat([
        Buffer.from("FLV1"),
        Buffer.from([2]),
        size,
        fromHex(v.noncePrefixHex),
      ]);
      const plain = pattern(v.plaintextLength);
      const count = Math.max(1, Math.ceil(plain.length / v.chunkSize));
      const parts: Buffer[] = [header];
      for (let i = 0; i < count; i++) {
        const nonce = Buffer.concat([
          fromHex(v.noncePrefixHex),
          Buffer.from([(i >>> 24) & 255, (i >>> 16) & 255, (i >>> 8) & 255, i & 255]),
        ]);
        const cipher = createCipheriv("aes-256-gcm", key, nonce);
        cipher.setAAD(Buffer.concat([header, Buffer.from([i === count - 1 ? 1 : 0])]));
        parts.push(
          cipher.update(plain.subarray(i * v.chunkSize, (i + 1) * v.chunkSize)),
          cipher.final(),
          cipher.getAuthTag(),
        );
      }
      const env = Buffer.concat(parts);
      expect(env.length).toBe(v.envelopeLength);
      expect(sha256Hex(env)).toBe(v.envelopeSha256);
    }
  });

  it("round trips every single-shot and stream vector", async () => {
    for (const v of vectors.single)
      expect(
        new TextDecoder().decode(
          await openFile(fromHex(v.masterKeyHex), v.pathId, fromHex(v.envelopeHex)),
        ),
      ).toBe(v.plaintextUtf8);
    for (const v of vectors.stream) {
      const env = await sealStream(fromHex(v.masterKeyHex), v.pathId, pattern(v.plaintextLength), {
        noncePrefix: fromHex(v.noncePrefixHex),
        chunkSize: v.chunkSize,
      });
      expect(streamPlainLength(env)).toBe(v.plaintextLength);
      expect(toHex(await openStream(MASTER, v.pathId, env))).toBe(
        toHex(pattern(v.plaintextLength)),
      );
      expect(toHex(await openFile(MASTER, v.pathId, env))).toBe(toHex(pattern(v.plaintextLength)));
    }
  });

  it("rejects every tampered envelope", async () => {
    for (const r of vectors.rejects)
      await expect(openFile(MASTER, r.pathId, fromHex(r.envelopeHex)), r.name).rejects.toThrow();
  });

  it("reads byte ranges across chunk boundaries", async () => {
    const plain = pattern(200_000);
    const env = await sealStream(MASTER, "files/aa/x", plain, { noncePrefix: PREFIX });
    for (const [start, end] of [
      [0, 0],
      [0, 1],
      [65_535, 65_537],
      [65_536, 65_536 * 2],
      [100, 199_999],
      [199_999, 200_000],
      [131_072, 200_000],
    ] as const) {
      expect(toHex(await openStreamRange(MASTER, "files/aa/x", env, start, end))).toBe(
        toHex(plain.slice(start, end)),
      );
    }
    await expect(openStreamRange(MASTER, "files/aa/x", env, 0, 200_001)).rejects.toThrow();
    // A cut-short file never reads as a shorter valid one, even for an early range.
    await expect(
      openStreamRange(MASTER, "files/aa/x", env.slice(0, 17 + (65_536 + 16) * 2), 0, 10),
    ).rejects.toThrow();
  });

  it("unlocks with the passphrase, refuses a wrong one, and rewraps on change", async () => {
    const w = vectors.wrap[0]!;
    expect(toHex((await unlockMasterKey(w.header, w.passphrase))!)).toBe(w.masterKeyHex);
    expect(await unlockMasterKey(w.header, "wrong passphrase")).toBeNull();
    expect(await unlockMasterKey(w.header, `${w.passphrase} `)).toBeNull();
    const changed = (await changePassphrase(w.header, w.passphrase, "new passphrase", {
      iterations: 1000,
    }))!;
    expect(changed.keyCheck).toBe(w.header.keyCheck);
    expect(changed.wrappedKey).not.toBe(w.header.wrappedKey);
    expect(toHex((await unlockMasterKey(changed, "new passphrase"))!)).toBe(w.masterKeyHex);
    expect(await unlockMasterKey(changed, w.passphrase)).toBeNull();
    expect(await changePassphrase(w.header, "wrong", "x", { iterations: 1000 })).toBeNull();
    // A damaged wrapped key is refused, not misread.
    const bad = {
      ...w.header,
      wrappedKey: w.header.wrappedKey.replace(/^./, (c) => (c === "A" ? "B" : "A")),
    };
    expect(await unlockMasterKey(bad, w.passphrase)).toBeNull();
    expect(fromBase64(w.header.wrappedKey).length).toBe(12 + 32 + 16);
  });

  it("random keys and nonces each time", async () => {
    const a = await createEncryption("p", { iterations: 1000 });
    const b = await createEncryption("p", { iterations: 1000 });
    expect(toHex(a.masterKey)).not.toBe(toHex(b.masterKey));
    expect(a.header.kdf.salt).not.toBe(b.header.kdf.salt);
    const x = await sealFile(a.masterKey, "notes/a.fnote", utf8("same"));
    const y = await sealFile(a.masterKey, "notes/a.fnote", utf8("same"));
    expect(toHex(x)).not.toBe(toHex(y));
  });
});
