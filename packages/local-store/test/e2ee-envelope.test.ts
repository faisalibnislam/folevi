// Envelope robustness (docs/E2EE_DESIGN.md §11.1): every changed byte of FLV1 0x03, FLV1 0x04 and FLS1 fails
// to open; a wrong context fails; cut-short streams fail; a compression bomb is refused; random inputs round
// trip (fast-check) and random garbage only ever throws E2eeError. Each runs on both backends.
import { createCipheriv } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import { concatBytes, utf8 } from "../src/bytes";
import {
  E2eeError,
  MAX_INFLATED,
  ctx,
  envelopeKind,
  fileStreamPlainLength,
  forceBackend,
  generateX25519,
  importAead,
  openFileStream,
  openFileStreamRange,
  openRecord,
  openSealed,
  randomBytes,
  recordKeyVersion,
  sealFileStream,
  sealRecord,
  sealTo,
  type BackendName,
} from "../src/crypto/e2ee";
import { CONTEXT_SAMPLES, pattern } from "./e2ee-helpers";

const BACKENDS: BackendName[] = ["webcrypto", "noble"];
const C = ctx.block("01JDOC", "01JBLOCK");
const OTHER = ctx.block("01JDOC", "01JOTHER");

afterAll(() => forceBackend(null));

async function rejects(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected a rejection");
}

function flip(bytes: Uint8Array, i: number, mask = 0x01): Uint8Array {
  const out = bytes.slice();
  out[i]! ^= mask;
  return out;
}

for (const backend of BACKENDS) {
  describe(`${backend}`, () => {
    const use = () => forceBackend(backend);
    const key = async (raw = randomBytes(32)) => {
      use();
      return importAead(raw);
    };

    it("FLV1 0x03: every changed byte fails; a wrong context or key fails", async () => {
      const k = await key();
      for (const plain of [utf8("a sealed title"), pattern(3000)]) {
        const env = await sealRecord(k, 7, C, plain);
        expect(await openRecord(k, C, env)).toEqual(plain);
        for (let i = 0; i < env.length; i++) {
          for (const mask of [0x01, 0x80]) {
            const e = await rejects(openRecord(k, C, flip(env, i, mask)));
            expect(e, `byte ${i}`).toBeInstanceOf(E2eeError);
          }
        }
        expect(await rejects(openRecord(k, OTHER, env))).toBeInstanceOf(E2eeError);
        expect(await rejects(openRecord(await key(), C, env))).toBeInstanceOf(E2eeError);
        for (let n = 0; n < env.length; n += 7) expect(await rejects(openRecord(k, C, env.subarray(0, n)))).toBeInstanceOf(E2eeError);
        expect(await rejects(openRecord(k, C, concatBytes(env, new Uint8Array([0]))))).toBeInstanceOf(E2eeError);
      }
    });

    it("FLV1 0x03: unknown flags and other modes are refused before decrypting", async () => {
      const k = await key();
      const env = await sealRecord(k, 1, C, utf8("x"));
      const flagged = env.slice();
      flagged[5] = 0x02;
      expect(String(await rejects(openRecord(k, C, flagged)))).toMatch(/flags/);
      const mode = env.slice();
      mode[4] = 0x01;
      expect(String(await rejects(openRecord(k, C, mode)))).toMatch(/Not a sealed/);
      expect(() => recordKeyVersion(mode)).toThrow(E2eeError);
    });

    it("FLV1 0x03: a compression bomb is refused; 8 MiB exactly opens", async () => {
      const raw = randomBytes(32);
      const k = await key(raw.slice());
      // A record sealed by a hostile writer with the right key: 8 MiB + 1 of zeros, deflated.
      const forge = (plain: Uint8Array) => {
        const nonce = randomBytes(12);
        const header = concatBytes(utf8("FLV1"), new Uint8Array([0x03, 0x01, 0, 0, 0, 1]), nonce);
        const c = createCipheriv("aes-256-gcm", raw, nonce);
        c.setAAD(concatBytes(header, utf8(C)));
        const body = Buffer.concat([c.update(deflateRawSync(plain)), c.final(), c.getAuthTag()]);
        return concatBytes(header, body);
      };
      const bomb = forge(new Uint8Array(MAX_INFLATED + 1));
      expect(bomb.length).toBeLessThan(20_000);
      expect(String(await rejects(openRecord(k, C, bomb)))).toMatch(/too large/);
      const fine = forge(new Uint8Array(MAX_INFLATED));
      expect((await openRecord(k, C, fine)).length).toBe(MAX_INFLATED);
      // A damaged deflate stream inside a valid record is an E2eeError too.
      const nonce = randomBytes(12);
      const header = concatBytes(utf8("FLV1"), new Uint8Array([0x03, 0x01, 0, 0, 0, 1]), nonce);
      const c = createCipheriv("aes-256-gcm", raw, nonce);
      c.setAAD(concatBytes(header, utf8(C)));
      const junk = concatBytes(header, Buffer.concat([c.update(new Uint8Array([0xff, 0xff, 0xff])), c.final(), c.getAuthTag()]));
      expect(await rejects(openRecord(k, C, junk))).toBeInstanceOf(E2eeError);
      // The writer never compresses past the cap, and only compresses when it saves 10 %.
      const big = await sealRecord(k, 1, C, new Uint8Array(MAX_INFLATED + 1));
      expect(big[5]).toBe(0);
      expect((await sealRecord(k, 1, C, new Uint8Array(2048)))[5]).toBe(1);
      expect((await sealRecord(k, 1, C, new Uint8Array(1023)))[5]).toBe(0);
      expect((await sealRecord(k, 1, C, randomBytes(4096)))[5]).toBe(0);
    });

    it("FLV1 0x04: every changed byte fails; cut-short, extended and reordered streams fail", async () => {
      const k = await key();
      const plain = pattern(100);
      const env = await sealFileStream(k, ctx.file("F1"), plain, { chunkSize: 16 });
      expect(fileStreamPlainLength(env)).toBe(100);
      expect(await openFileStream(k, ctx.file("F1"), env)).toEqual(plain);
      for (let i = 0; i < env.length; i++) {
        expect(await rejects(openFileStream(k, ctx.file("F1"), flip(env, i))), `byte ${i}`).toBeInstanceOf(E2eeError);
      }
      // Every truncation, including at chunk boundaries (dropping whole final chunks).
      for (let n = 0; n < env.length; n++) {
        const cut = env.subarray(0, n);
        expect(await rejects(openFileStream(k, ctx.file("F1"), cut)), `length ${n}`).toBeInstanceOf(E2eeError);
        // A range read of a cut-short file also fails, even for bytes that are still there.
        if (n > 17 + 32) expect(await rejects(openFileStreamRange(k, ctx.file("F1"), cut, 0, 1))).toBeInstanceOf(E2eeError);
      }
      expect(await rejects(openFileStream(k, ctx.file("F1"), concatBytes(env, randomBytes(32))))).toBeInstanceOf(E2eeError);
      // Swap chunks 0 and 1.
      const full = 16 + 16;
      const swapped = concatBytes(env.subarray(0, 17), env.subarray(17 + full, 17 + 2 * full), env.subarray(17, 17 + full), env.subarray(17 + 2 * full));
      expect(await rejects(openFileStream(k, ctx.file("F1"), swapped))).toBeInstanceOf(E2eeError);
      expect(await rejects(openFileStream(k, ctx.file("F2"), env))).toBeInstanceOf(E2eeError);
      expect(await rejects(openFileStreamRange(k, ctx.file("F1"), env, 5, 101))).toBeInstanceOf(E2eeError);
      expect(await rejects(openFileStreamRange(k, ctx.file("F1"), env, 6, 5))).toBeInstanceOf(E2eeError);
      // An empty file is one empty last chunk, and can't be stretched.
      const empty = await sealFileStream(k, ctx.file("F1"), new Uint8Array(0));
      expect(empty.length).toBe(17 + 16);
      expect((await openFileStream(k, ctx.file("F1"), empty)).length).toBe(0);
    });

    it("FLV1 0x04: a hostile chunk size is refused", async () => {
      const k = await key();
      const env = await sealFileStream(k, ctx.file("F1"), pattern(10));
      const huge = env.slice();
      huge.set([0xff, 0xff, 0xff, 0xff], 5);
      expect(String(await rejects(openFileStream(k, ctx.file("F1"), huge)))).toMatch(/chunk size/);
      const zero = env.slice();
      zero.set([0, 0, 0, 0], 5);
      expect(String(await rejects(openFileStream(k, ctx.file("F1"), zero)))).toMatch(/chunk size/);
    });

    it("FLS1: every changed byte fails; a wrong context or recipient fails", async () => {
      use();
      const r = await generateX25519();
      const box = await sealTo(r.publicKey, ctx.amkDevice("P", "D"), pattern(32));
      expect(await openSealed(r.privateKey, r.publicKey, ctx.amkDevice("P", "D"), box)).toEqual(pattern(32));
      for (let i = 0; i < box.length; i++) {
        expect(await rejects(openSealed(r.privateKey, r.publicKey, ctx.amkDevice("P", "D"), flip(box, i))), `byte ${i}`).toBeInstanceOf(E2eeError);
      }
      expect(await rejects(openSealed(r.privateKey, r.publicKey, ctx.amkDevice("P", "D2"), box))).toBeInstanceOf(E2eeError);
      const other = await generateX25519();
      expect(await rejects(openSealed(other.privateKey, other.publicKey, ctx.amkDevice("P", "D"), box))).toBeInstanceOf(E2eeError);
      // The recipient public key is bound into the key derivation: the right private key with a wrong
      // claimed public key fails.
      expect(await rejects(openSealed(r.privateKey, other.publicKey, ctx.amkDevice("P", "D"), box))).toBeInstanceOf(E2eeError);
      for (let n = 0; n < box.length; n += 5) {
        expect(await rejects(openSealed(r.privateKey, r.publicKey, ctx.amkDevice("P", "D"), box.subarray(0, n)))).toBeInstanceOf(E2eeError);
      }
    });

    it("property: records, streams and boxes round trip", async () => {
      const k = await key();
      const r = await generateX25519();
      await fc.assert(
        fc.asyncProperty(
          fc.uint8Array({ maxLength: 5000 }),
          fc.integer({ min: 0, max: 0xffffffff }),
          fc.stringMatching(/^[A-Za-z0-9]{1,30}$/),
          fc.boolean(),
          async (plain, version, id, compress) => {
            const context = ctx.block("D", id);
            const env = await sealRecord(k, version, context, plain, { compress });
            expect(recordKeyVersion(env)).toBe(version);
            expect(envelopeKind(env)).toBe("record");
            expect(await openRecord(k, context, env)).toEqual(plain);
            const box = await sealTo(r.publicKey, context, plain);
            expect(envelopeKind(box)).toBe("sealedBox");
            expect(await openSealed(r.privateKey, r.publicKey, context, box)).toEqual(plain);
          },
        ),
        { numRuns: 60 },
      );
      await fc.assert(
        fc.asyncProperty(
          fc.uint8Array({ maxLength: 400 }),
          fc.integer({ min: 1, max: 64 }),
          fc.nat(),
          fc.nat(),
          async (plain, chunkSize, a, b) => {
            const env = await sealFileStream(k, ctx.file("F"), plain, { chunkSize });
            expect(envelopeKind(env)).toBe("keyedStream");
            expect(fileStreamPlainLength(env)).toBe(plain.length);
            const start = plain.length ? a % (plain.length + 1) : 0;
            const end = start + (plain.length - start ? b % (plain.length - start + 1) : 0);
            expect(await openFileStreamRange(k, ctx.file("F"), env, start, end)).toEqual(plain.slice(start, end));
            expect(await openFileStream(k, ctx.file("F"), env)).toEqual(plain);
          },
        ),
        { numRuns: 80 },
      );
    });

    it("property: garbage never opens and only ever throws E2eeError", async () => {
      const k = await key();
      const r = await generateX25519();
      const arb = fc.oneof(
        fc.uint8Array({ maxLength: 200 }),
        fc.uint8Array({ maxLength: 200 }).map((b) => concatBytes(utf8("FLV1"), new Uint8Array([0x03]), b)),
        fc.uint8Array({ maxLength: 200 }).map((b) => concatBytes(utf8("FLV1"), new Uint8Array([0x04]), b)),
        fc.uint8Array({ maxLength: 200 }).map((b) => concatBytes(utf8("FLS1"), new Uint8Array([0x01]), b)),
      );
      await fc.assert(
        fc.asyncProperty(arb, async (bytes) => {
          for (const p of [
            openRecord(k, C, bytes),
            openFileStream(k, ctx.file("F"), bytes),
            openFileStreamRange(k, ctx.file("F"), bytes, 0, 0),
            openSealed(r.privateKey, r.publicKey, C, bytes),
          ]) {
            expect(await rejects(p)).toBeInstanceOf(E2eeError);
          }
        }),
        { numRuns: 300 },
      );
    });
  });
}

describe("contexts", () => {
  it("every context starts with the prefix, and parts can't smuggle a separator", async () => {
    expect(Object.keys(CONTEXT_SAMPLES).sort()).toEqual(Object.keys(ctx).sort());
    const all = Object.values(CONTEXT_SAMPLES);
    for (const c of all) expect(c.startsWith("folevi/e2ee/v1/")).toBe(true);
    expect(new Set(all).size).toBe(all.length);
    expect(ctx.block("D", "B")).toBe("folevi/e2ee/v1/block/D/B");
    expect(ctx.noteKeySpace("D", 2, "workspace:W", 3)).toBe("folevi/e2ee/v1/note-key/D/2/space/workspace:W/3");
    expect(ctx.accountRecord("P", "aiChat", "R")).toBe("folevi/e2ee/v1/record/account/P/aiChat/R");
    expect(() => ctx.block("D/x", "B")).toThrow(E2eeError);
    expect(() => ctx.block("", "B")).toThrow(E2eeError);
    expect(() => ctx.spaceGrant("personal:P", 1.5, "P")).toThrow(E2eeError);
    const k = await importAead(randomBytes(32));
    expect(await rejects(sealRecord(k, 1, "block/D/B", utf8("x")))).toBeInstanceOf(E2eeError);
    expect(await rejects(sealRecord(k, -1, C, utf8("x")))).toBeInstanceOf(E2eeError);
  });
});
