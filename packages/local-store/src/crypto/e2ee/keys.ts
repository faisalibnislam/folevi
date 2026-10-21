// Key derivation (docs/E2EE_DESIGN.md §4.1, §4.3) and the wrap keys for the AMK's ways in (§4.7).
// Every intermediate byte array is zeroed once it has been imported.
import { argon2idAsync } from "@noble/hashes/argon2.js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";
import { normalizeForSearch } from "@folevi/editor-schema";
import { concatBytes, utf8 } from "../../bytes";
import {
  E2eeError,
  ed25519FromSeed,
  hkdf,
  hmacSha256,
  importAead,
  importMac,
  isBytes,
  toBase64Url,
  x25519FromSeed,
  type AeadKey,
  type Ed25519KeyPair,
  type MacKey,
  type X25519KeyPair,
} from "./primitives";

async function take<T>(bytes: Uint8Array, f: (b: Uint8Array) => Promise<T>): Promise<T> {
  try {
    return await f(bytes);
  } finally {
    bytes.fill(0);
  }
}

async function check16(ikm: Uint8Array, info: string): Promise<Uint8Array> {
  const full = await hkdf(ikm, info);
  const out = full.slice(0, 16);
  full.fill(0);
  return out;
}

function need32(key: Uint8Array, what: string): void {
  if (!isBytes(key) || key.length !== 32) throw new E2eeError(`${what} must be 32 bytes.`);
}

// ---- Account ----

export interface AccountKeys {
  x25519: X25519KeyPair;
  ed25519: Ed25519KeyPair;
  /** AES key for the person's own sealed records (scope "account"). */
  records: AeadKey;
  /** amkCheck: stored with every wrap, compared after unwrapping. */
  check: Uint8Array;
}

export async function deriveAccountKeys(amk: Uint8Array): Promise<AccountKeys> {
  need32(amk, "The account master key");
  const [x, ed, records, check] = await Promise.all([
    hkdf(amk, "account/x25519").then((b) => take(b, x25519FromSeed)),
    hkdf(amk, "account/ed25519").then((b) => take(b, ed25519FromSeed)),
    hkdf(amk, "account/records").then(importAead),
    check16(amk, "account/check"),
  ]);
  return { x25519: x, ed25519: ed, records, check };
}

// ---- Space ----

export interface SpaceKeys {
  /** Wraps note keys. */
  wrap: AeadKey;
  /** Folder names, tag names, space records. */
  meta: AeadKey;
  /** Blind uniqueness (tag names). */
  mac: MacKey;
  /** The space inbox key pair (the server seals email, clips and app writes to its public half). */
  inbox: X25519KeyPair;
  /** skCheck */
  check: Uint8Array;
}

export async function deriveSpaceKeys(sk: Uint8Array): Promise<SpaceKeys> {
  need32(sk, "A space key");
  const [wrap, meta, mac, inbox, check] = await Promise.all([
    hkdf(sk, "space/wrap").then(importAead),
    hkdf(sk, "space/meta").then(importAead),
    hkdf(sk, "space/mac").then(importMac),
    hkdf(sk, "space/x25519").then((b) => take(b, x25519FromSeed)),
    check16(sk, "space/check"),
  ]);
  return { wrap, meta, mac, inbox, check };
}

/**
 * Blind uniqueness for tag names (§4.5): base64url(HMAC(SK "space/mac", utf8("tag-name\n") ‖
 * utf8(normalizeForSearch(name)))[0..16)).
 */
export async function tagNameMac(spaceMac: MacKey, name: string): Promise<string> {
  const mac = await hmacSha256(spaceMac, concatBytes(utf8("tag-name\n"), utf8(normalizeForSearch(name))));
  return toBase64Url(mac.subarray(0, 16));
}

// ---- Note ----

export interface NoteKeys {
  /** Title, appearance, meta, blocks, comments, found text, version names, records under the note. */
  content: AeadKey;
  /** Block and title content MACs. */
  mac: MacKey;
  /** Wraps file keys. */
  files: AeadKey;
}

export async function deriveNoteKeys(nk: Uint8Array): Promise<NoteKeys> {
  need32(nk, "A note key");
  const [content, mac, files] = await Promise.all([
    hkdf(nk, "note/content").then(importAead),
    hkdf(nk, "note/mac").then(importMac),
    hkdf(nk, "note/files").then(importAead),
  ]);
  return { content, mac, files };
}

// ---- Wrap keys for the ways in ----

/** HKDF(recovery key bytes, "recovery/wrap"). */
export async function recoveryWrapKey(bytes: Uint8Array): Promise<AeadKey> {
  if (!isBytes(bytes) || bytes.length !== 20) throw new E2eeError("A recovery key is 20 bytes.");
  return importAead(await hkdf(bytes, "recovery/wrap"));
}

/** HKDF(passkey PRF output, "passkey/wrap"). */
export async function prfWrapKey(prfOutput: Uint8Array): Promise<AeadKey> {
  need32(prfOutput, "A passkey PRF output");
  return importAead(await hkdf(prfOutput, "passkey/wrap"));
}

/** HKDF(link secret from the URL fragment, "link/wrap"). */
export async function linkWrapKey(secret: Uint8Array): Promise<AeadKey> {
  need32(secret, "A link secret");
  return importAead(await hkdf(secret, "link/wrap"));
}

export const ARGON2ID_DEFAULTS = { m: 65536, t: 3, p: 1 } as const;
/** Fast parameters for tests only; nothing writes them. */
export const ARGON2ID_TEST = { m: 1024, t: 3, p: 1 } as const;
export const PBKDF2_MIN_ITERATIONS = 600_000;

export interface Argon2idParams {
  name: "argon2id";
  m: number;
  t: number;
  p: number;
  salt: Uint8Array;
}
/** Accepted on read for a future native client (§4.7.3); nothing writes it now. */
export interface Pbkdf2Params {
  name: "pbkdf2-sha256";
  iterations: number;
  salt: Uint8Array;
}
export type PassphraseKdf = Argon2idParams | Pbkdf2Params;

/** New passphrase KDF parameters (production costs, 16 random salt bytes). */
export function newPassphraseKdf(salt: Uint8Array): Argon2idParams {
  if (salt.length !== 16) throw new E2eeError("The passphrase salt must be 16 bytes.");
  return { name: "argon2id", ...ARGON2ID_DEFAULTS, salt };
}

/** The raw 32 bytes before "passphrase/wrap" (Argon2id or PBKDF2 output). Exposed for vectors. */
export async function passphraseKdfBytes(
  passphrase: string,
  kdf: PassphraseKdf,
  onProgress?: (f: number) => void,
): Promise<Uint8Array> {
  const password = utf8(passphrase.normalize("NFC"));
  try {
    if (!isBytes(kdf.salt) || kdf.salt.length < 16)
      throw new E2eeError("The passphrase salt must be at least 16 bytes.");
    if (kdf.name === "argon2id") {
      const { m, t, p } = kdf;
      // Bounds keep a hostile stored record from asking for absurd memory or time.
      if (!Number.isInteger(m) || m < 8 * p || m > 1 << 20) throw new E2eeError("Invalid Argon2id memory cost.");
      if (!Number.isInteger(t) || t < 1 || t > 64) throw new E2eeError("Invalid Argon2id time cost.");
      if (!Number.isInteger(p) || p < 1 || p > 16) throw new E2eeError("Invalid Argon2id parallelism.");
      return await argon2idAsync(password, kdf.salt, {
        m,
        t,
        p,
        dkLen: 32,
        asyncTick: 10,
        maxmem: 2 ** 31,
        onProgress,
      });
    }
    if (kdf.name === "pbkdf2-sha256") {
      const n = kdf.iterations;
      if (!Number.isInteger(n) || n < PBKDF2_MIN_ITERATIONS || n > 10_000_000)
        throw new E2eeError("Invalid PBKDF2 iteration count.");
      return await pbkdf2Async(nobleSha256, password, kdf.salt, { c: n, dkLen: 32, asyncTick: 10 });
    }
    throw new E2eeError("Unknown passphrase KDF.");
  } finally {
    password.fill(0);
  }
}

/** Argon2id(passphrase NFC) then HKDF(…, "passphrase/wrap"). Takes about 0.5 s in Node, 1 to 2 s in browsers. */
export async function passphraseWrapKey(
  passphrase: string,
  kdf: PassphraseKdf,
  onProgress?: (f: number) => void,
): Promise<AeadKey> {
  const raw = await passphraseKdfBytes(passphrase, kdf, onProgress);
  try {
    return await importAead(await hkdf(raw, "passphrase/wrap"));
  } finally {
    raw.fill(0);
  }
}
