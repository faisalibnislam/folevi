// Keys (docs/E2EE_DESIGN.md §11.1): derivations, wraps for all four ways in, recovery key parse and check,
// approval commit and code, statements sign/verify, X25519 all-zero refusal, wire (de)serializers. Each runs
// on both backends; keys made on one backend work with the other.
import { afterAll, describe, expect, it } from "vitest";
import { canonicalJson } from "@folevi/editor-schema";
import { fromHex, toHex, utf8 } from "../src/bytes";
import {
  ARGON2ID_TEST,
  E2eeError,
  approvalCode,
  approvalCommit,
  blockFromPlaintext,
  blockPlaintext,
  checkApprovalCommit,
  constantTimeEqual,
  ctx,
  deriveAccountKeys,
  deriveNoteKeys,
  deriveSpaceKeys,
  ed25519FromSeed,
  ed25519Sign,
  envelopeKind,
  formatCode,
  formatRecoveryKey,
  forceBackend,
  fromBase64Url,
  fromWireBytes,
  generateEd25519,
  generateX25519,
  hkdf,
  importAead,
  linkWrapKey,
  macEquals,
  macOf,
  memberSecurityCode,
  newPassphraseKdf,
  newRecoveryKey,
  openRecord,
  openSealed,
  openStatement,
  parseRecoveryKey,
  passphraseWrapKey,
  prfWrapKey,
  randomBytes,
  recoveryKeyGroup,
  recoveryWrapKey,
  sealRecord,
  sealTo,
  signStatement,
  tagNameMac,
  toBase64Url,
  toWireBytes,
  verifyStatement,
  x25519FromSeed,
  x25519Shared,
  type ApprovalCodeInput,
  type BackendName,
} from "../src/crypto/e2ee";
import { AMK, SAMPLE_BLOCK, range } from "./e2ee-helpers";

const BACKENDS: BackendName[] = ["webcrypto", "noble"];
afterAll(() => forceBackend(null));

async function rejects(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected a rejection");
}

// Low-order X25519 points (RFC 7748 §6.1 notes; the usual blocklist): each makes the shared secret zero.
const LOW_ORDER = [
  "0000000000000000000000000000000000000000000000000000000000000000",
  "0100000000000000000000000000000000000000000000000000000000000000",
  "e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800",
  "5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157",
  "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
];

for (const backend of BACKENDS) {
  describe(backend, () => {
    const use = () => forceBackend(backend);

    it("derives the same account, space and note keys every time, and they work", async () => {
      use();
      const a = await deriveAccountKeys(AMK.slice());
      const b = await deriveAccountKeys(AMK.slice());
      expect(a.x25519.publicKey).toEqual(b.x25519.publicKey);
      expect(a.ed25519.publicKey).toEqual(b.ed25519.publicKey);
      expect(a.check).toEqual(b.check);
      expect(a.check.length).toBe(16);
      expect(a.check).toEqual((await hkdf(AMK, "account/check")).slice(0, 16));
      // The records key opens what the other derivation sealed.
      const env = await sealRecord(a.records, 1, ctx.accountRecord("P", "prefs", "R"), utf8("{}"));
      expect(await openRecord(b.records, ctx.accountRecord("P", "prefs", "R"), env)).toEqual(utf8("{}"));
      const s = await deriveSpaceKeys(range(0x20, 32));
      expect(s.check.length).toBe(16);
      const n = await deriveNoteKeys(range(0x40, 32));
      const m1 = await macOf(n.mac, ctx.block("D", "B"), utf8("x"));
      const m2 = await macOf(n.mac, ctx.block("D", "B2"), utf8("x"));
      expect(m1).not.toBe(m2); // equal content in two blocks has different MACs
      expect(fromBase64Url(m1).length).toBe(16);
      expect(macEquals(m1, m1)).toBe(true);
      expect(macEquals(m1, m2)).toBe(false);
      // Different keys give different checks; derivation refuses keys of the wrong size.
      expect(toHex((await deriveSpaceKeys(range(0x21, 32))).check)).not.toBe(toHex(s.check));
      expect(await rejects(deriveNoteKeys(new Uint8Array(31)))).toBeInstanceOf(E2eeError);
      expect(await rejects(deriveAccountKeys(new Uint8Array(33)))).toBeInstanceOf(E2eeError);
    });

    it("tag name MACs ignore case, accents' encoding and spacing", async () => {
      use();
      const s = await deriveSpaceKeys(range(0x20, 32));
      const a = await tagNameMac(s.mac, "Café Ideas");
      expect(await tagNameMac(s.mac, "  café   IDEAS ")).toBe(await tagNameMac(s.mac, "cafe ideas"));
      expect(a).toBe(await tagNameMac(s.mac, "cafe ideas"));
      expect(a).not.toBe(await tagNameMac((await deriveSpaceKeys(range(0x21, 32))).mac, "Café Ideas"));
    });

    it("wraps the AMK for all four ways in and opens it again", async () => {
      use();
      const amk = randomBytes(32);
      const account = await deriveAccountKeys(amk.slice());
      // device: FLS1 to the device's X25519 key
      const device = await generateX25519();
      const devCtx = ctx.amkDevice("P", "D");
      const deviceWrap = await sealTo(device.publicKey, devCtx, amk);
      expect(envelopeKind(deviceWrap)).toBe("sealedBox");
      expect(await openSealed(device.privateKey, device.publicKey, devCtx, deviceWrap)).toEqual(amk);
      // recovery key
      const rk = newRecoveryKey();
      const recCtx = ctx.amkRecovery("P", "W1");
      const recWrap = await sealRecord(await recoveryWrapKey(rk.bytes), 3, recCtx, amk);
      const parsed = parseRecoveryKey(rk.text.toLowerCase())!;
      const opened = await openRecord(await recoveryWrapKey(parsed), recCtx, recWrap);
      expect(opened).toEqual(amk);
      expect(constantTimeEqual((await deriveAccountKeys(opened)).check, account.check)).toBe(true);
      // passkey PRF
      const prf = randomBytes(32);
      const pkCtx = ctx.amkPasskey("P", toBase64Url(randomBytes(16)));
      const pkWrap = await sealRecord(await prfWrapKey(prf.slice()), 3, pkCtx, amk);
      expect(await openRecord(await prfWrapKey(prf.slice()), pkCtx, pkWrap)).toEqual(amk);
      expect(await rejects(openRecord(await prfWrapKey(randomBytes(32)), pkCtx, pkWrap))).toBeInstanceOf(E2eeError);
      // passphrase (fast parameters; the production ones are pinned in the vectors)
      const kdf = { ...newPassphraseKdf(randomBytes(16)), ...ARGON2ID_TEST };
      const ppCtx = ctx.amkPassphrase("P", "W2");
      const progress: number[] = [];
      const ppWrap = await sealRecord(await passphraseWrapKey("a long passphrase here", kdf, (f) => progress.push(f)), 3, ppCtx, amk);
      expect(progress.length).toBeGreaterThan(0);
      expect(await openRecord(await passphraseWrapKey("a long passphrase here", kdf), ppCtx, ppWrap)).toEqual(amk);
      expect(await rejects(openRecord(await passphraseWrapKey("a long passphrase hera", kdf), ppCtx, ppWrap))).toBeInstanceOf(E2eeError);
      // A wrap moved to another person or wrap id fails.
      expect(await rejects(openRecord(await recoveryWrapKey(parsed), ctx.amkRecovery("P2", "W1"), recWrap))).toBeInstanceOf(E2eeError);
      // links
      const secret = randomBytes(32);
      const linkCtx = ctx.noteKeyLink("D", 1, "L");
      const nk = randomBytes(32);
      expect(await openRecord(await linkWrapKey(secret.slice()), linkCtx, await sealRecord(await linkWrapKey(secret.slice()), 1, linkCtx, nk))).toEqual(nk);
    });

    it("passphrase KDF: NFC normalization, PBKDF2 readers, and bounds on stored parameters", async () => {
      use();
      const salt = randomBytes(16);
      const kdf = { name: "argon2id" as const, ...ARGON2ID_TEST, salt };
      const c = ctx.amkPassphrase("P", "W");
      const env = await sealRecord(await passphraseWrapKey("Café au lait 12", kdf), 1, c, utf8("k"));
      expect(await openRecord(await passphraseWrapKey("Café au lait 12", kdf), c, env)).toEqual(utf8("k"));
      const pb = { name: "pbkdf2-sha256" as const, iterations: 600_000, salt };
      const env2 = await sealRecord(await passphraseWrapKey("pbkdf2 phrase", pb), 1, c, utf8("k"));
      expect(await openRecord(await passphraseWrapKey("pbkdf2 phrase", pb), c, env2)).toEqual(utf8("k"));
      expect(await rejects(passphraseWrapKey("x", { ...pb, iterations: 1000 }))).toBeInstanceOf(E2eeError);
      expect(await rejects(passphraseWrapKey("x", { ...kdf, m: 1 << 22 }))).toBeInstanceOf(E2eeError);
      expect(await rejects(passphraseWrapKey("x", { ...kdf, t: 0 }))).toBeInstanceOf(E2eeError);
      expect(await rejects(passphraseWrapKey("x", { ...kdf, salt: new Uint8Array(8) }))).toBeInstanceOf(E2eeError);
      expect(await rejects(passphraseWrapKey("x", { ...kdf, name: "scrypt" } as never))).toBeInstanceOf(E2eeError);
      expect(newPassphraseKdf(salt)).toEqual({ name: "argon2id", m: 65536, t: 3, p: 1, salt });
    });

    it("statements: sign, verify, and refuse any change", async () => {
      use();
      const signer = await generateEd25519();
      const body = { profileId: "P", epoch: 1, x25519Pub: "abc", ed25519Pub: "def", createdAt: 5 };
      const s = await signStatement(signer.privateKey, "account-key", body);
      expect(s.kind).toBe("account-key");
      expect(s.body).toBe(canonicalJson(body));
      expect(fromBase64Url(s.sig).length).toBe(64);
      expect(await verifyStatement(signer.publicKey, s)).toBe(true);
      expect(await openStatement(signer.publicKey, s)).toEqual(body);
      expect(await verifyStatement(signer.publicKey, { ...s, kind: "device" })).toBe(false);
      expect(await verifyStatement(signer.publicKey, { ...s, body: s.body.replace("1", "2") })).toBe(false);
      expect(await verifyStatement((await generateEd25519()).publicKey, s)).toBe(false);
      expect(await verifyStatement(signer.publicKey, { ...s, sig: "!!" })).toBe(false);
      expect(await verifyStatement(signer.publicKey, { ...s, sig: s.sig.slice(0, -2) })).toBe(false);
      expect(await verifyStatement(new Uint8Array(32), s)).toBe(false);
      expect(await verifyStatement(signer.publicKey, { ...s, kind: "other" as never })).toBe(false);
      // A non-canonical spelling of the same body, signed, still verifies but doesn't open as a body.
      const spacedBody = JSON.stringify(body, null, 1);
      const sig = await ed25519Sign(signer.privateKey, utf8(`folevi/e2ee/v1/statement\naccount-key\n${spacedBody}`));
      const spaced = { kind: "account-key" as const, body: spacedBody, sig: toBase64Url(sig) };
      expect(await verifyStatement(signer.publicKey, spaced)).toBe(true);
      expect(await openStatement(signer.publicKey, spaced)).toBeNull();
      await expect(signStatement(signer.privateKey, "nope" as never, {})).rejects.toBeInstanceOf(E2eeError);
    });

    it("statements and boxes made on one backend work on the other", async () => {
      use();
      const seed = randomBytes(32);
      const ed = await ed25519FromSeed(seed.slice());
      const x = await x25519FromSeed(seed.slice());
      const s = await signStatement(ed.privateKey, "device", { a: 1 });
      const box = await sealTo(x.publicKey, ctx.inbox("personal:P", "I"), utf8("mail"));
      forceBackend(backend === "webcrypto" ? "noble" : "webcrypto");
      const ed2 = await ed25519FromSeed(seed.slice());
      const x2 = await x25519FromSeed(seed.slice());
      expect(ed2.publicKey).toEqual(ed.publicKey);
      expect(x2.publicKey).toEqual(x.publicKey);
      expect(await verifyStatement(ed.publicKey, s)).toBe(true);
      expect(await signStatement(ed2.privateKey, "device", { a: 1 })).toEqual(s); // Ed25519 is deterministic
      expect(await openSealed(x2.privateKey, x2.publicKey, ctx.inbox("personal:P", "I"), box)).toEqual(utf8("mail"));
    });

    it("X25519 refuses an all-zero shared secret (low-order public keys)", async () => {
      use();
      const me = await generateX25519();
      for (const h of LOW_ORDER) {
        const bad = fromHex(h);
        expect(await rejects(x25519Shared(me.privateKey, bad)), h).toBeInstanceOf(E2eeError);
        expect(await rejects(sealTo(bad, ctx.amkDevice("P", "D"), utf8("x")))).toBeInstanceOf(E2eeError);
        // A box whose ephemeral key is low order.
        const box = await sealTo(me.publicKey, ctx.amkDevice("P", "D"), utf8("x"));
        box.set(bad, 5);
        expect(await rejects(openSealed(me.privateKey, me.publicKey, ctx.amkDevice("P", "D"), box))).toBeInstanceOf(E2eeError);
      }
      expect(await rejects(x25519Shared(me.privateKey, new Uint8Array(31)))).toBeInstanceOf(E2eeError);
    });

    it("new keys are non-extractable on WebCrypto unless asked", async () => {
      use();
      const x = await generateX25519();
      const ed = await generateEd25519();
      expect(x.publicKey.length).toBe(32);
      expect(ed.publicKey.length).toBe(32);
      if (backend === "webcrypto") {
        expect((x.privateKey as CryptoKey).extractable).toBe(false);
        expect((ed.privateKey as CryptoKey).extractable).toBe(false);
        expect(((await generateX25519({ extractable: true })).privateKey as CryptoKey).extractable).toBe(true);
        const a = await deriveAccountKeys(AMK.slice());
        expect((a.x25519.privateKey as CryptoKey).extractable).toBe(false);
        expect((a.ed25519.privateKey as CryptoKey).extractable).toBe(false);
        expect((a.records as CryptoKey).extractable).toBe(false);
      } else {
        expect(x.privateKey).toBeInstanceOf(Uint8Array);
      }
      // importAead zeroes what it was given.
      const raw = randomBytes(32);
      await importAead(raw);
      expect(raw.every((b) => b === 0)).toBe(true);
      expect(await rejects(importAead(new Uint8Array(16)))).toBeInstanceOf(E2eeError);
    });

    it("approval commit and code", async () => {
      use();
      const newX = await generateX25519();
      const newEd = await generateEd25519();
      const nN = randomBytes(32);
      const commit = await approvalCommit(nN, newX.publicKey, newEd.publicKey);
      expect(commit.length).toBe(32);
      expect(await checkApprovalCommit(commit, nN, newX.publicKey, newEd.publicKey)).toBe(true);
      expect(await checkApprovalCommit(commit, randomBytes(32), newX.publicKey, newEd.publicKey)).toBe(false);
      expect(await checkApprovalCommit(commit, nN, (await generateX25519()).publicKey, newEd.publicKey)).toBe(false);
      const input: ApprovalCodeInput = {
        newX: newX.publicKey,
        newEd: newEd.publicKey,
        approverEd: (await generateEd25519()).publicKey,
        accountX: (await generateX25519()).publicKey,
        accountEd: (await generateEd25519()).publicKey,
        approverNonce: randomBytes(32),
        newNonce: nN,
      };
      const code = await approvalCode(input);
      expect(code).toMatch(/^\d{6}$/);
      expect(await approvalCode({ ...input })).toBe(code);
      // A server that substitutes the new device's key (or anything else) makes the codes differ.
      let differ = 0;
      for (const field of Object.keys(input) as (keyof ApprovalCodeInput)[]) {
        if ((await approvalCode({ ...input, [field]: randomBytes(32) })) !== code) differ++;
      }
      expect(differ).toBeGreaterThanOrEqual(6); // a 1-in-a-million collision is allowed once
      await expect(approvalCode({ ...input, newNonce: new Uint8Array(16) })).rejects.toBeInstanceOf(E2eeError);
      expect(formatCode(code)).toMatch(/^\d{3} \d{3}$/);
    });

    it("member security code", async () => {
      use();
      const ed = await generateEd25519();
      const code = await memberSecurityCode(ed.publicKey);
      expect(code).toMatch(/^\d{12}$/);
      expect(await memberSecurityCode(ed.publicKey)).toBe(code);
      expect(formatCode(code)).toMatch(/^\d{3} \d{3} \d{3} \d{3}$/);
      expect(await memberSecurityCode((await generateEd25519()).publicKey)).not.toBe(code);
    });
  });
}

describe("recovery key", () => {
  it("round trips, reads O/I/L, ignores spaces and dashes, and refuses a bad check value", () => {
    for (let i = 0; i < 200; i++) {
      const k = newRecoveryKey();
      expect(k.bytes.length).toBe(20);
      expect(k.text).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){8}[0-9A-HJKMNP-TV-Z]{4}$/);
      expect(parseRecoveryKey(k.text)).toEqual(k.bytes);
      expect(parseRecoveryKey(` ${k.text.toLowerCase().replace(/-/g, " ")} `)).toEqual(k.bytes);
      expect(parseRecoveryKey(k.text.replace(/0/g, "O").replace(/1/g, "l"))).toEqual(k.bytes);
      // Every single-character change is caught (key bits change: the 20-bit check catches it but for
      // about one in a million; check bits change: always caught).
      const pos = (i * 7) % 44;
      if (k.text[pos] !== "-") {
        const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
        const other = alphabet[(alphabet.indexOf(k.text[pos]!) + 1 + (i % 31)) % 32]!;
        expect(parseRecoveryKey(k.text.slice(0, pos) + other + k.text.slice(pos + 1))).toBeNull();
      }
    }
    expect(parseRecoveryKey("")).toBeNull();
    expect(parseRecoveryKey("too short")).toBeNull();
    expect(parseRecoveryKey(formatRecoveryKey(new Uint8Array(20)) + "0")).toBeNull();
    expect(recoveryKeyGroup("AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH-JJJJ", 3)).toBe("CCCC");
    expect(recoveryKeyGroup("AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH-JJJJ", 7)).toBe("GGGG");
    expect(() => formatRecoveryKey(new Uint8Array(19))).toThrow(E2eeError);
  });
});

describe("wire", () => {
  it("block plaintext leaves collapsed out and rebuilds the block from its shell", () => {
    const bytes = blockPlaintext(SAMPLE_BLOCK);
    const json = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    expect(Object.keys(json)).toEqual(["props", "schemaVersion", "text", "type"]);
    expect(json.props).toEqual({ textColor: "blue" });
    const shell = { id: SAMPLE_BLOCK.id, parentId: null, rank: "a0", revision: 4 };
    expect(blockFromPlaintext(bytes, shell, true)).toEqual({ ...SAMPLE_BLOCK, revision: 4 });
    expect(blockFromPlaintext(bytes, shell).props).toEqual({ textColor: "blue" });
    expect(blockFromPlaintext(bytes, { ...shell, revision: undefined })).not.toHaveProperty("revision");
    // Same content, same bytes (canonical), whatever the key order.
    expect(blockPlaintext({ props: { textColor: "blue" }, text: SAMPLE_BLOCK.text, schemaVersion: 1, type: "paragraph" })).toEqual(bytes);
    for (const bad of ["[]", "{}", '{"type":"sealed","schemaVersion":0,"text":[],"props":{}}', '{"type":"p","schemaVersion":1,"text":{},"props":{}}', "not json"]) {
      expect(() => blockFromPlaintext(utf8(bad), shell)).toThrow();
    }
  });

  it("wire bytes", () => {
    const b = randomBytes(10);
    const w = toWireBytes(b.subarray(2, 6));
    expect(w).toBeInstanceOf(ArrayBuffer);
    expect(w.byteLength).toBe(4);
    expect(fromWireBytes(w)).toEqual(b.subarray(2, 6));
    expect(fromWireBytes(b.subarray(2, 6))).toEqual(b.subarray(2, 6));
  });

  it("base64url is canonical", () => {
    for (let n = 0; n < 40; n++) {
      const b = randomBytes(n);
      const s = toBase64Url(b);
      expect(s).toBe(Buffer.from(b).toString("base64url"));
      expect(fromBase64Url(s)).toEqual(b);
    }
    expect(() => fromBase64Url("AB")).toThrow(E2eeError); // non-zero trailing bits ("AA" is canonical)
    expect(() => fromBase64Url("A")).toThrow(E2eeError);
    expect(() => fromBase64Url("a+b/")).toThrow(E2eeError);
  });
});
