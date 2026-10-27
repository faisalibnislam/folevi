// Vault test vectors (docs/VAULT_PLAN.md §3, fixtures/vault-vectors.json): fixed inputs through every Vault derivation
// and wrap, recomputed on the WebCrypto and noble backends and matched byte for byte against the fixture, so a change
// to a context string, an HKDF label or a layer's order can't slip through. The HKDF, HMAC and AES-256-GCM layers are
// checked once more against node:crypto. UPDATE_GOLDEN=1 regenerates the fixture.
import { createDecipheriv, createHmac, hkdfSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fromHex, toHex, utf8 } from "../src/bytes";
import {
  deriveVaultKeys,
  forceBackend,
  innerOfGrant,
  LIBRARY_VAULT_PERSON,
  linkWrapKey,
  openLibraryVaultKey,
  openRecord,
  openSealed,
  openVaultGrant,
  sealRecord,
  sealTo,
  sealVaultKeyTo,
  vaultCtx,
  vaultPasscodeKey,
  vaultPasswordMac,
  vaultRecoveryKey,
  wrapLibraryVaultKey,
  wrapWithPasscode,
  wrapWithRecovery,
  x25519FromSeed,
  type BackendName,
} from "../src/crypto/e2ee";

const fixturePath = resolve(__dirname, "../fixtures/vault-vectors.json");
const update = process.env.UPDATE_GOLDEN === "1";
const BACKENDS: BackendName[] = ["webcrypto", "noble"];
const SALT = utf8("folevi/e2ee/v1");
const PREFIX = "folevi/e2ee/v1/";

const fill = (n: number, start: number) => Uint8Array.from({ length: n }, (_, i) => (start + i) & 0xff);
const IN = {
  vaultId: "VAULT01",
  profileId: "PROFILE01",
  itemId: "01JABCDEFGHJKMNPQRSTVWXYZ0",
  linkId: "LINK0123456789abcdefgh",
  keyVersion: 3,
  vk: fill(32, 0x10),
  itemKey: fill(32, 0x40),
  linkSecret: fill(32, 0x70),
  recovery: fill(20, 0xa0),
  accountSeed: fill(32, 0xc0),
  ephemeralSeed: fill(32, 0xe0),
  nonce: fill(12, 0x01),
  passcode: "correct horse vault",
  kdf: { name: "argon2id" as const, m: 64, t: 1, p: 1, salt: fill(16, 0x30) },
  password: "Correct-Horse-9-Battery",
  folderName: "Servers",
};

type Vectors = Record<string, string>;

afterAll(() => forceBackend(null));

async function compute(): Promise<Vectors> {
  const g = { vaultId: IN.vaultId, keyVersion: IN.keyVersion, profileId: IN.profileId };
  const keys = await deriveVaultKeys(IN.vk);
  const account = await x25519FromSeed(IN.accountSeed);
  const eph = await x25519FromSeed(IN.ephemeralSeed);
  const opts = { nonce: IN.nonce, compress: false as const };
  const inner = await sealTo(account.publicKey, vaultCtx.grant(g.vaultId, g.keyVersion, g.profileId), IN.vk, { ephemeral: eph, nonce: IN.nonce });
  const passcodeKey = await vaultPasscodeKey(IN.passcode, IN.kdf);
  return {
    check: toHex(keys.check),
    passwordMac: await vaultPasswordMac(keys.mac, IN.password),
    itemKeyWrap: toHex(await sealRecord(keys.wrap, IN.keyVersion, vaultCtx.itemKey(IN.vaultId, IN.itemId, IN.keyVersion), IN.itemKey, opts)),
    folderName: toHex(await sealRecord(keys.meta, IN.keyVersion, vaultCtx.folder(IN.vaultId, "FOLDER01"), utf8(IN.folderName), opts)),
    grantInner: toHex(inner),
    // The outer layers as wrapWithPasscode and wrapWithRecovery make them, with a fixed nonce.
    grantPasscode: toHex(await sealRecord(passcodeKey, g.keyVersion, vaultCtx.passcode(g.vaultId, g.keyVersion, g.profileId), inner, opts)),
    grantRecovery: toHex(await sealRecord(await vaultRecoveryKey(IN.recovery), g.keyVersion, vaultCtx.recovery(g.vaultId, g.keyVersion, g.profileId), inner, opts)),
    // A library's Vault (no account): the passcode and recovery layers straight around the vault key, for "library".
    libraryGrantPasscode: toHex(await sealRecord(passcodeKey, g.keyVersion, vaultCtx.passcode(g.vaultId, g.keyVersion, LIBRARY_VAULT_PERSON), IN.vk, opts)),
    libraryGrantRecovery: toHex(await sealRecord(await vaultRecoveryKey(IN.recovery), g.keyVersion, vaultCtx.recovery(g.vaultId, g.keyVersion, LIBRARY_VAULT_PERSON), IN.vk, opts)),
    linkWrap: toHex(await sealRecord(await linkWrapKey(IN.linkSecret), 1, vaultCtx.linkKey(IN.vaultId, IN.itemId, IN.linkId), IN.itemKey, opts)),
    contexts: JSON.stringify({
      grant: vaultCtx.grant(g.vaultId, g.keyVersion, g.profileId),
      passcode: vaultCtx.passcode(g.vaultId, g.keyVersion, g.profileId),
      recovery: vaultCtx.recovery(g.vaultId, g.keyVersion, g.profileId),
      libraryPasscode: vaultCtx.passcode(g.vaultId, g.keyVersion, LIBRARY_VAULT_PERSON),
      libraryRecovery: vaultCtx.recovery(g.vaultId, g.keyVersion, LIBRARY_VAULT_PERSON),
      itemKey: vaultCtx.itemKey(IN.vaultId, IN.itemId, IN.keyVersion),
      item: vaultCtx.item(IN.vaultId, IN.itemId),
      itemSummary: vaultCtx.itemSummary(IN.vaultId, IN.itemId),
      shareKey: vaultCtx.shareKey(IN.vaultId, IN.itemId, IN.profileId),
      linkKey: vaultCtx.linkKey(IN.vaultId, IN.itemId, IN.linkId),
      fileBytes: vaultCtx.fileBytes(IN.vaultId, IN.itemId),
      folder: vaultCtx.folder(IN.vaultId, "FOLDER01"),
      log: vaultCtx.log(IN.vaultId),
    }),
  };
}

/** Opens an FLV1 record with node:crypto: AES-256-GCM over bytes[22..), AAD = bytes[0..22) ‖ utf8(context). */
function nodeOpenRecord(key: Uint8Array, context: string, record: Uint8Array): Uint8Array {
  const d = createDecipheriv("aes-256-gcm", key, record.subarray(10, 22));
  d.setAAD(Buffer.concat([record.subarray(0, 22), Buffer.from(context, "utf8")]));
  d.setAuthTag(record.subarray(record.length - 16));
  return new Uint8Array(Buffer.concat([d.update(record.subarray(22, record.length - 16)), d.final()]));
}

const nodeHkdf = (ikm: Uint8Array, info: string, n = 32) => new Uint8Array(hkdfSync("sha256", ikm, SALT, utf8(info), n));

describe("vault vectors", () => {
  for (const backend of BACKENDS) {
    it(`${backend}: recomputes every vector`, async () => {
      forceBackend(backend);
      const computed = await compute();
      if (update && backend === "webcrypto") writeFileSync(fixturePath, JSON.stringify({ $description: "Vault derivations and wraps for fixed inputs (packages/local-store/test/vault-vectors.test.ts).", ...computed }, null, 2) + "\n");
      const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Vectors;
      for (const [k, v] of Object.entries(computed)) expect(v, k).toBe(fixture[k]);
    });
  }

  it("the fixture is plain HKDF-SHA256, HMAC-SHA256 and AES-256-GCM (node:crypto opens it)", () => {
    const f = JSON.parse(readFileSync(fixturePath, "utf8")) as Vectors;
    const ctx = JSON.parse(f.contexts!) as Record<string, string>;
    for (const c of Object.values(ctx)) expect(c.startsWith(`${PREFIX}vault/`)).toBe(true);
    expect(f.check).toBe(toHex(nodeHkdf(IN.vk, "vault/check").subarray(0, 16)));
    const mac = createHmac("sha256", nodeHkdf(IN.vk, "vault/mac")).update(`password\n${IN.password}`).digest().subarray(0, 16);
    expect(f.passwordMac).toBe(Buffer.from(mac).toString("base64url"));
    expect(toHex(nodeOpenRecord(nodeHkdf(IN.vk, "vault/wrap"), ctx.itemKey!, fromHex(f.itemKeyWrap!)))).toBe(toHex(IN.itemKey));
    expect(Buffer.from(nodeOpenRecord(nodeHkdf(IN.vk, "vault/meta"), ctx.folder!, fromHex(f.folderName!))).toString("utf8")).toBe(IN.folderName);
    expect(toHex(nodeOpenRecord(nodeHkdf(IN.linkSecret, "link/wrap"), ctx.linkKey!, fromHex(f.linkWrap!)))).toBe(toHex(IN.itemKey));
    // The recovery layer: HKDF "vault/recovery" of the 20 key bytes, around the inner (account) layer.
    expect(toHex(nodeOpenRecord(nodeHkdf(IN.recovery, "vault/recovery"), ctx.recovery!, fromHex(f.grantRecovery!)))).toBe(f.grantInner);
  });

  it("the fixture's grants open to the vault key, by passcode and by recovery key, and nowhere else", async () => {
    forceBackend(null);
    const f = JSON.parse(readFileSync(fixturePath, "utf8")) as Vectors;
    const g = { vaultId: IN.vaultId, keyVersion: IN.keyVersion, profileId: IN.profileId };
    const account = await x25519FromSeed(IN.accountSeed);
    const check = fromHex(f.check!);
    const viaPasscode = await openVaultGrant(fromHex(f.grantPasscode!), { kind: "passcode", key: await vaultPasscodeKey(IN.passcode, IN.kdf) }, account, g, check);
    expect(toHex(viaPasscode)).toBe(toHex(IN.vk));
    const viaRecovery = await openVaultGrant(fromHex(f.grantRecovery!), { kind: "recovery", key: await vaultRecoveryKey(IN.recovery) }, account, g, check);
    expect(toHex(viaRecovery)).toBe(toHex(IN.vk));
    expect(toHex(await innerOfGrant(fromHex(f.grantPasscode!), { kind: "passcode", key: await vaultPasscodeKey(IN.passcode, IN.kdf) }, g))).toBe(f.grantInner);
    expect(toHex(await openSealed(account.privateKey, account.publicKey, vaultCtx.grant(g.vaultId, g.keyVersion, g.profileId), fromHex(f.grantInner!)))).toBe(toHex(IN.vk));
    // Another person, version or Vault: the same bytes don't open.
    await expect(openVaultGrant(fromHex(f.grantPasscode!), { kind: "passcode", key: await vaultPasscodeKey(IN.passcode, IN.kdf) }, account, { ...g, profileId: "PROFILE02" }, check)).rejects.toThrow();
    await expect(openVaultGrant(fromHex(f.grantPasscode!), { kind: "passcode", key: await vaultPasscodeKey(IN.passcode, IN.kdf) }, account, { ...g, keyVersion: 4 }, check)).rejects.toThrow();
    await expect(openVaultGrant(fromHex(f.grantPasscode!), { kind: "passcode", key: await vaultPasscodeKey("wrong passcode!", IN.kdf) }, account, g, check)).rejects.toThrow();
    // What the app's own wraps make (random nonces) opens the same way.
    const inner = await sealVaultKeyTo(IN.vk, account.publicKey, g);
    const made = await wrapWithPasscode(inner, await vaultPasscodeKey(IN.passcode, IN.kdf), g);
    expect(toHex(await openVaultGrant(made, { kind: "passcode", key: await vaultPasscodeKey(IN.passcode, IN.kdf) }, account, g, check))).toBe(toHex(IN.vk));
    const viaRec = await wrapWithRecovery(inner, await vaultRecoveryKey(IN.recovery), g);
    expect(toHex(await openVaultGrant(viaRec, { kind: "recovery", key: await vaultRecoveryKey(IN.recovery) }, account, g, check))).toBe(toHex(IN.vk));
    const keys = await deriveVaultKeys(IN.vk);
    await expect(openRecord(keys.wrap, vaultCtx.itemKey("VAULT02", IN.itemId, IN.keyVersion), fromHex(f.itemKeyWrap!))).rejects.toThrow();
  });

  it("a library's Vault grants open to the vault key by passcode and by recovery key, and nowhere else", async () => {
    forceBackend(null);
    const f = JSON.parse(readFileSync(fixturePath, "utf8")) as Vectors;
    const ctx = JSON.parse(f.contexts!) as Record<string, string>;
    const check = fromHex(f.check!);
    const passcodeKey = await vaultPasscodeKey(IN.passcode, IN.kdf);
    const recoveryKey = await vaultRecoveryKey(IN.recovery);
    expect(toHex(await openLibraryVaultKey(fromHex(f.libraryGrantPasscode!), { kind: "passcode", key: passcodeKey }, IN.vaultId, IN.keyVersion, check))).toBe(toHex(IN.vk));
    expect(toHex(await openLibraryVaultKey(fromHex(f.libraryGrantRecovery!), { kind: "recovery", key: recoveryKey }, IN.vaultId, IN.keyVersion, check))).toBe(toHex(IN.vk));
    // node:crypto opens the recovery layer: HKDF "vault/recovery" of the key's 20 bytes, straight around the vault key.
    expect(toHex(nodeOpenRecord(nodeHkdf(IN.recovery, "vault/recovery"), ctx.libraryRecovery!, fromHex(f.libraryGrantRecovery!)))).toBe(toHex(IN.vk));
    await expect(openLibraryVaultKey(fromHex(f.libraryGrantPasscode!), { kind: "passcode", key: await vaultPasscodeKey("000000", IN.kdf) }, IN.vaultId, IN.keyVersion, check)).rejects.toThrow();
    await expect(openLibraryVaultKey(fromHex(f.libraryGrantPasscode!), { kind: "passcode", key: passcodeKey }, "VAULT02", IN.keyVersion, check)).rejects.toThrow();
    await expect(openLibraryVaultKey(fromHex(f.libraryGrantPasscode!), { kind: "passcode", key: passcodeKey }, IN.vaultId, IN.keyVersion, fromHex("00".repeat(16)))).rejects.toThrow();
    // An account grant is not a library grant (another person in the context).
    await expect(openLibraryVaultKey(fromHex(f.grantPasscode!), { kind: "passcode", key: passcodeKey }, IN.vaultId, IN.keyVersion, check)).rejects.toThrow();
    // The app's own wraps (random nonces) open the same way.
    const made = await wrapLibraryVaultKey(IN.vk, { kind: "passcode", key: passcodeKey }, IN.vaultId, IN.keyVersion);
    expect(toHex(await openLibraryVaultKey(made, { kind: "passcode", key: passcodeKey }, IN.vaultId, IN.keyVersion, check))).toBe(toHex(IN.vk));
  });
});
