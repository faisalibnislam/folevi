// The Vault's keys (docs/VAULT_PLAN.md §3), on the same primitives as the rest of end-to-end encryption.
//
//   Vault key VK (32 random bytes, versioned)
//    ├─ HKDF "vault/wrap"  → wraps item keys and vault notes' keys
//    ├─ HKDF "vault/meta"  → folder names, log details
//    ├─ HKDF "vault/mac"   → blind index for password reuse
//    └─ "vault/check"      → 16-byte check the server keeps
//   reaches a person as a double wrap: sealed to their account X25519 key (FLS1), then sealed again (FLV1 0x03)
//   with a key from their passcode (Argon2id → HKDF "vault/passcode") or from their vault recovery key
//   (HKDF "vault/recovery"). A custodian's grant is only the inner layer until the person adds their passcode.
//
// Every context is built here so ciphertext moved to another Vault, version, person or item fails to open.
import { utf8 } from "../../bytes";
import { E2eeError, hkdf, hmacSha256, importAead, importMac, isBytes, randomBytes, toBase64Url, type AeadKey, type MacKey } from "./primitives";
import { passphraseKdfBytes, type Argon2idParams } from "./keys";
import { CONTEXT_PREFIX, constantTimeEqual, type X25519KeyPair } from "./primitives";
import { openRecord, sealRecord } from "./record";
import { openSealed, sealTo } from "./seal";

export interface VaultKeys {
  wrap: AeadKey;
  meta: AeadKey;
  mac: MacKey;
  check: Uint8Array;
}

function need32(key: Uint8Array, what: string): void {
  if (!isBytes(key) || key.length !== 32) throw new E2eeError(`${what} must be 32 bytes.`);
}

function part(value: string | number, what: string): string {
  const s = String(value);
  if (s === "" || s.includes("/") || s.includes("\n")) throw new E2eeError(`Invalid ${what} in an encryption context.`);
  return s;
}

function version(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 0xffffffff) throw new E2eeError("Invalid vault key version in an encryption context.");
  return String(value);
}

const c = (...parts: string[]) => CONTEXT_PREFIX + "vault/" + parts.join("/");

/** One builder per kind of vault ciphertext. Ids are public ids. */
export const vaultCtx = {
  /** VK sealed to a person's account X25519 key (FLS1): the inner layer of every grant. */
  grant: (vaultId: string, keyVersion: number, profileId: string) => c("grant", part(vaultId, "vault id"), version(keyVersion), part(profileId, "profile id")),
  /** The inner layer sealed again with the person's passcode key (FLV1 0x03). */
  passcode: (vaultId: string, keyVersion: number, profileId: string) => c("passcode", part(vaultId, "vault id"), version(keyVersion), part(profileId, "profile id")),
  /** The inner layer sealed again with the person's vault recovery key (FLV1 0x03). */
  recovery: (vaultId: string, keyVersion: number, profileId: string) => c("recovery", part(vaultId, "vault id"), version(keyVersion), part(profileId, "profile id")),
  /** An item key wrapped by VK "vault/wrap". */
  itemKey: (vaultId: string, itemId: string, keyVersion: number) => c("item-key", part(vaultId, "vault id"), part(itemId, "item id"), version(keyVersion)),
  /** An item's secrets (passwords, keys, hidden fields), sealed with its item key. */
  item: (vaultId: string, itemId: string) => c("item", part(vaultId, "vault id"), part(itemId, "item id")),
  /** An item's summary (title, username, website: what lists show), sealed with its item key. */
  itemSummary: (vaultId: string, itemId: string) => c("item-summary", part(vaultId, "vault id"), part(itemId, "item id")),
  /** An export file, sealed with a key from the passphrase the exporter chose. */
  exportFile: (vaultId: string, exportId: string) => c("export", part(vaultId, "vault id"), part(exportId, "export id")),
  /** An item key sealed to one person it's shared with (FLS1, their account X25519 key). */
  shareKey: (vaultId: string, itemId: string, profileId: string) => c("share", part(vaultId, "vault id"), part(itemId, "item id"), part(profileId, "profile id")),
  /** An item key wrapped by a one-time link's key (from the link's fragment). */
  linkKey: (vaultId: string, itemId: string, linkId: string) => c("link", part(vaultId, "vault id"), part(itemId, "item id"), part(linkId, "link id")),
  /** A vault note's key wrapped by VK "vault/wrap". */
  noteKey: (vaultId: string, docId: string, noteVersion: number, keyVersion: number) => c("note-key", part(vaultId, "vault id"), part(docId, "document id"), version(noteVersion), version(keyVersion)),
  /** A vault file's bytes (FLV1 0x04 with the file's own key). */
  fileBytes: (vaultId: string, itemId: string) => c("file", part(vaultId, "vault id"), part(itemId, "item id")),
  /** A folder's name (VK "vault/meta"). */
  folder: (vaultId: string, folderId: string) => c("folder", part(vaultId, "vault id"), part(folderId, "folder id")),
  /** A log entry's names and paths (VK "vault/meta"). */
  log: (vaultId: string) => c("log", part(vaultId, "vault id")),
};

/** The keys a vault key opens. */
export async function deriveVaultKeys(vk: Uint8Array): Promise<VaultKeys> {
  need32(vk, "A vault key");
  const [wrap, meta, mac, full] = await Promise.all([hkdf(vk, "vault/wrap").then(importAead), hkdf(vk, "vault/meta").then(importAead), hkdf(vk, "vault/mac").then(importMac), hkdf(vk, "vault/check")]);
  const check = full.slice(0, 16);
  full.fill(0);
  return { wrap, meta, mac, check };
}

/** A new vault key (32 random bytes). */
export const newVaultKey = (): Uint8Array => randomBytes(32);

/** Passcodes: a PIN of 6, 8 or 12 digits, the owner's choice (docs/VAULT_PLAN.md §11.2). */
export const VAULT_PASSCODE_LENGTHS = [6, 8, 12] as const;

export function checkVaultPasscode(passcode: string): string | null {
  const p = passcode.normalize("NFC");
  if (!/^\d*$/.test(p)) return "Use numbers only.";
  if (!(VAULT_PASSCODE_LENGTHS as readonly number[]).includes(p.length)) return "Use 6, 8 or 12 digits.";
  return null;
}

/** Argon2id(passcode) then HKDF "vault/passcode": the passcode layer's key (1 to 2 s in a browser). */
export async function vaultPasscodeKey(passcode: string, kdf: Argon2idParams, onProgress?: (f: number) => void): Promise<AeadKey> {
  const raw = await passphraseKdfBytes(passcode, kdf, onProgress);
  try {
    return await importAead(await hkdf(raw, "vault/passcode"));
  } finally {
    raw.fill(0);
  }
}

/** HKDF(vault recovery key bytes, "vault/recovery"): the recovery layer's key. */
export async function vaultRecoveryKey(bytes: Uint8Array): Promise<AeadKey> {
  if (!isBytes(bytes) || bytes.length !== 20) throw new E2eeError("A recovery key is 20 bytes.");
  return importAead(await hkdf(bytes, "vault/recovery"));
}

/**
 * Blind index of a password for reuse checks: base64url(HMAC(VK "vault/mac", "password\n" ‖ password)[0..16)).
 * Equal passwords in one Vault give equal values; nothing else can be learnt from it without the vault key.
 */
export async function vaultPasswordMac(mac: MacKey, password: string): Promise<string> {
  const out = await hmacSha256(mac, utf8(`password\n${password.normalize("NFC")}`));
  return toBase64Url(out.subarray(0, 16));
}

// ---- Grants: making them and opening them (the device's half of convex/vaultKeys.ts) ----

/** Who a grant is for: the Vault, the key version and the person (public ids). */
export interface VaultGrantFor {
  vaultId: string;
  keyVersion: number;
  profileId: string;
}

/** The inner layer: VK sealed to the person's account X25519 key (what a custodian's device sends). */
export async function sealVaultKeyTo(vk: Uint8Array, accountPub: Uint8Array, g: VaultGrantFor): Promise<Uint8Array> {
  need32(vk, "A vault key");
  return await sealTo(accountPub, vaultCtx.grant(g.vaultId, g.keyVersion, g.profileId), vk);
}

/** The passcode layer over an inner layer. */
export async function wrapWithPasscode(inner: Uint8Array, passcodeKey: AeadKey, g: VaultGrantFor): Promise<Uint8Array> {
  return await sealRecord(passcodeKey, g.keyVersion, vaultCtx.passcode(g.vaultId, g.keyVersion, g.profileId), inner);
}

/** The recovery layer over an inner layer. */
export async function wrapWithRecovery(inner: Uint8Array, recoveryKey: AeadKey, g: VaultGrantFor): Promise<Uint8Array> {
  return await sealRecord(recoveryKey, g.keyVersion, vaultCtx.recovery(g.vaultId, g.keyVersion, g.profileId), inner);
}

/**
 * Opens a grant to the vault key: the outer layer with the passcode or recovery key (a wrong one throws), then the
 * inner layer with the person's account key; checks the key against the server's check value.
 */
export async function openVaultGrant(
  wrapped: Uint8Array,
  outer: { kind: "passcode"; key: AeadKey } | { kind: "recovery"; key: AeadKey } | { kind: "custodian" },
  account: X25519KeyPair,
  g: VaultGrantFor,
  check: Uint8Array,
): Promise<Uint8Array> {
  const inner =
    outer.kind === "custodian"
      ? wrapped
      : await openRecord(outer.key, outer.kind === "passcode" ? vaultCtx.passcode(g.vaultId, g.keyVersion, g.profileId) : vaultCtx.recovery(g.vaultId, g.keyVersion, g.profileId), wrapped);
  const vk = await openSealed(account.privateKey, account.publicKey, vaultCtx.grant(g.vaultId, g.keyVersion, g.profileId), inner);
  const keys = await deriveVaultKeys(vk);
  if (!constantTimeEqual(keys.check, check)) {
    vk.fill(0);
    throw new E2eeError("This vault key doesn't match the Vault.");
  }
  return vk;
}

/** Re-opens just the inner layer from a passcode or recovery grant (to wrap it again with a new passcode). */
export async function innerOfGrant(wrapped: Uint8Array, outer: { kind: "passcode" | "recovery"; key: AeadKey }, g: VaultGrantFor): Promise<Uint8Array> {
  return await openRecord(outer.key, outer.kind === "passcode" ? vaultCtx.passcode(g.vaultId, g.keyVersion, g.profileId) : vaultCtx.recovery(g.vaultId, g.keyVersion, g.profileId), wrapped);
}
