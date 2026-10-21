// Primitives for end-to-end encryption (docs/E2EE_DESIGN.md §4.2): AES-256-GCM, HKDF-SHA256, HMAC-SHA256,
// X25519, Ed25519 and SHA-256, each on WebCrypto where the runtime has it and on @noble where it doesn't
// (the Convex runtime has no dependable X25519, older engines lack Ed25519).
//
// Keys say which implementation made them: a CryptoKey always runs on WebCrypto and raw bytes always run on
// noble, whatever the current backend, so keys made before a backend switch keep working. The backend only
// decides what new keys look like (`importAead`, key generation, derivation).
import { gcm } from "@noble/ciphers/aes.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { hkdf as nobleHkdf } from "@noble/hashes/hkdf.js";
import { hmac as nobleHmac } from "@noble/hashes/hmac.js";
import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";
import { concatBytes, own, utf8 } from "../../bytes";
import { EnvelopeError } from "../envelope";

/** An AES-256-GCM key: a non-extractable CryptoKey on WebCrypto, 32 raw bytes on noble. */
export type AeadKey = CryptoKey | Uint8Array;
/** An HMAC-SHA256 key, same convention. */
export type MacKey = CryptoKey | Uint8Array;
export interface X25519KeyPair {
  privateKey: CryptoKey | Uint8Array;
  publicKey: Uint8Array;
}
export interface Ed25519KeyPair {
  privateKey: CryptoKey | Uint8Array;
  publicKey: Uint8Array;
}
export type BackendName = "webcrypto" | "noble";
export interface CryptoBackend {
  x25519: BackendName;
  ed25519: BackendName;
  aes: BackendName;
}

/** Every failure from this module: a damaged or foreign envelope, a wrong key, a bad argument. */
export class E2eeError extends EnvelopeError {
  override name = "E2eeError";
}

export const CONTEXT_PREFIX = "folevi/e2ee/v1/";
export const HKDF_SALT = utf8("folevi/e2ee/v1");
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;

// ---- Backend selection ----

let forced: BackendName | null = null;
let detected: Promise<CryptoBackend> | null = null;
let current: CryptoBackend | null = null;

function subtleOrNull(): SubtleCrypto | null {
  return globalThis.crypto?.subtle ?? null;
}

function subtle(): SubtleCrypto {
  const s = subtleOrNull();
  if (!s) throw new E2eeError("WebCrypto isn't available here.");
  return s;
}

async function probe(run: (s: SubtleCrypto) => Promise<unknown>): Promise<boolean> {
  const s = subtleOrNull();
  if (!s) return false;
  try {
    await run(s);
    return true;
  } catch {
    return false;
  }
}

async function detect(): Promise<CryptoBackend> {
  const [x, ed, aes] = await Promise.all([
    probe((s) => s.generateKey({ name: "X25519" }, false, ["deriveBits"])),
    probe((s) => s.generateKey({ name: "Ed25519" }, false, ["sign", "verify"])),
    probe(async (s) => {
      const k = await s.importKey("raw", new Uint8Array(32), { name: "AES-GCM" }, false, ["encrypt"]);
      await s.encrypt({ name: "AES-GCM", iv: new Uint8Array(12) }, k, new Uint8Array(0));
      const h = await s.importKey("raw", new Uint8Array(32), "HKDF", false, ["deriveBits"]);
      await s.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new Uint8Array(0) }, h, 256);
    }),
  ]);
  const name = (ok: boolean): BackendName => (ok ? "webcrypto" : "noble");
  return { x25519: name(x), ed25519: name(ed), aes: name(aes) };
}

/** Which implementation each primitive uses in this process (detected once). */
export async function cryptoBackend(): Promise<CryptoBackend> {
  if (forced) return { x25519: forced, ed25519: forced, aes: forced };
  detected ??= detect();
  current = await detected;
  return current;
}

/** Tests: run everything on one backend (null returns to detection). */
export function forceBackend(b: BackendName | null): void {
  forced = b;
}

async function backendFor(p: keyof CryptoBackend): Promise<BackendName> {
  if (forced) return forced;
  return (current ?? (await cryptoBackend()))[p];
}

// ---- Bytes ----

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  // getRandomValues takes at most 65536 bytes per call.
  for (let i = 0; i < n; i += 65536) globalThis.crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65536)));
  return out;
}

export function isBytes(v: unknown): v is Uint8Array {
  return ArrayBuffer.isView(v) && (v as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT === 1;
}

/** Constant-time equality for MACs, checks and codes (length is not secret). */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Constant-time equality of two strings of the same alphabet (base64url MACs, decimal codes). */
export function constantTimeEqualString(a: string, b: string): boolean {
  return constantTimeEqual(utf8(a), utf8(b));
}

const B64U = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** base64url without padding. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64U[a >> 2]!;
    out += B64U[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    if (b !== undefined) out += B64U[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    if (c !== undefined) out += B64U[c & 63]!;
  }
  return out;
}

export function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new E2eeError("Invalid base64url string.");
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const ch of text) {
    value = ((value << 6) | B64U.indexOf(ch)) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (value >> bits) & 255;
    }
  }
  // Reject non-canonical trailing bits, so one byte string has one spelling.
  if (bits > 0 && (value & ((1 << bits) - 1)) !== 0) throw new E2eeError("Invalid base64url string.");
  return out;
}

export function u32be(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new E2eeError("Value out of uint32 range.");
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n);
  return out;
}

export function readU32be(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
}

/** Runs `f` on a fresh ArrayBuffer copy of secret bytes and zeroes the copy afterwards. */
async function withCopy<T>(secret: Uint8Array, f: (copy: Uint8Array<ArrayBuffer>) => Promise<T>): Promise<T> {
  const copy = own(secret);
  try {
    return await f(copy);
  } finally {
    copy.fill(0);
  }
}

export function checkContext(context: string): void {
  if (typeof context !== "string" || !context.startsWith(CONTEXT_PREFIX) || context.length <= CONTEXT_PREFIX.length)
    throw new E2eeError(`An encryption context must start with "${CONTEXT_PREFIX}".`);
}

// ---- Hashes ----

/** SHA-256 (synchronous, noble; the standard digest on every backend). */
export function sha256(data: Uint8Array): Uint8Array {
  return nobleSha256(data);
}

export function sha256Concat(label: string, ...parts: Uint8Array[]): Uint8Array {
  return sha256(concatBytes(utf8(label), ...parts));
}

// ---- HKDF ----

/** HKDF-SHA256 with an explicit salt (FLS1 uses E ‖ R). */
export async function hkdfSalted(
  ikm: Uint8Array | CryptoKey,
  salt: Uint8Array,
  info: string,
  bytes = 32,
): Promise<Uint8Array> {
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > 255 * 32) throw new E2eeError("Invalid HKDF length.");
  if (!isBytes(ikm)) {
    const out = await subtle().deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: own(salt), info: own(utf8(info)) },
      ikm,
      bytes * 8,
    );
    return new Uint8Array(out);
  }
  if ((await backendFor("aes")) === "webcrypto") {
    const base = await withCopy(ikm, (c) => subtle().importKey("raw", c, "HKDF", false, ["deriveBits"]));
    const out = await subtle().deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: own(salt), info: own(utf8(info)) },
      base,
      bytes * 8,
    );
    return new Uint8Array(out);
  }
  return nobleHkdf(nobleSha256, ikm, salt, utf8(info), bytes);
}

/** HKDF-SHA256 with the design's salt utf8("folevi/e2ee/v1") (§4.3). A CryptoKey ikm must be an HKDF key. */
export function hkdf(ikm: Uint8Array | CryptoKey, info: string, bytes = 32): Promise<Uint8Array> {
  return hkdfSalted(ikm, HKDF_SALT, info, bytes);
}

// ---- AES-256-GCM ----

/** Turns 32 raw bytes into an AEAD key for the current backend (non-extractable on WebCrypto). Zeroes `raw`. */
export async function importAead(raw: Uint8Array): Promise<AeadKey> {
  if (!isBytes(raw) || raw.length !== 32) throw new E2eeError("An AES-256 key must be 32 bytes.");
  try {
    if ((await backendFor("aes")) === "webcrypto")
      return await withCopy(raw, (c) =>
        subtle().importKey("raw", c, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]),
      );
    return raw.slice();
  } finally {
    raw.fill(0);
  }
}

export async function aeadEncrypt(
  key: AeadKey,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  if (nonce.length !== NONCE_BYTES) throw new E2eeError("The nonce must be 12 bytes.");
  if (isBytes(key)) {
    if (key.length !== 32) throw new E2eeError("An AES-256 key must be 32 bytes.");
    return gcm(key, nonce, aad).encrypt(plaintext);
  }
  return new Uint8Array(
    await subtle().encrypt(
      { name: "AES-GCM", iv: own(nonce), additionalData: own(aad), tagLength: 128 },
      key,
      own(plaintext),
    ),
  );
}

export async function aeadDecrypt(
  key: AeadKey,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  if (nonce.length !== NONCE_BYTES) throw new E2eeError("The nonce must be 12 bytes.");
  if (ciphertext.length < TAG_BYTES) throw new E2eeError("The ciphertext is incomplete.");
  try {
    if (isBytes(key)) {
      if (key.length !== 32) throw new E2eeError("An AES-256 key must be 32 bytes.");
      return gcm(key, nonce, aad).decrypt(ciphertext);
    }
    return new Uint8Array(
      await subtle().decrypt(
        { name: "AES-GCM", iv: own(nonce), additionalData: own(aad), tagLength: 128 },
        key,
        own(ciphertext),
      ),
    );
  } catch {
    throw new E2eeError("The data failed its integrity check (damaged, moved, or a different key).");
  }
}

// ---- HMAC-SHA256 ----

/** Turns raw bytes into an HMAC key for the current backend. Zeroes `raw`. */
export async function importMac(raw: Uint8Array): Promise<MacKey> {
  if (!isBytes(raw) || raw.length < 16) throw new E2eeError("An HMAC key must be at least 16 bytes.");
  try {
    if ((await backendFor("aes")) === "webcrypto")
      return await withCopy(raw, (c) =>
        subtle().importKey("raw", c, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
      );
    return raw.slice();
  } finally {
    raw.fill(0);
  }
}

export async function hmacSha256(key: MacKey, data: Uint8Array): Promise<Uint8Array> {
  if (isBytes(key)) return nobleHmac(nobleSha256, key, data);
  return new Uint8Array(await subtle().sign("HMAC", key, own(data)));
}

/**
 * The keyed content MAC (§4.5): base64url(HMAC-SHA256(key, utf8(context) ‖ 0x00 ‖ plaintext)[0..16)).
 * Raw-byte keys are accepted on every backend.
 */
export async function macOf(key: MacKey, context: string, plaintext: Uint8Array): Promise<string> {
  checkContext(context);
  const mac = await hmacSha256(key, concatBytes(utf8(context), new Uint8Array([0]), plaintext));
  return toBase64Url(mac.subarray(0, 16));
}

/** Constant-time comparison of two MAC strings. */
export function macEquals(a: string, b: string): boolean {
  return constantTimeEqualString(a, b);
}

// ---- X25519 ----

// PKCS#8 prefixes for a 32-byte X25519 / Ed25519 private key (RFC 8410).
const X25519_PKCS8 = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
]);
const ED25519_PKCS8 = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

async function importOkpPrivate(
  name: "X25519" | "Ed25519",
  seed: Uint8Array,
  extractable: boolean,
): Promise<{ privateKey: CryptoKey; publicKey: Uint8Array }> {
  const prefix = name === "X25519" ? X25519_PKCS8 : ED25519_PKCS8;
  const usages: KeyUsage[] = name === "X25519" ? ["deriveBits"] : ["sign"];
  const pkcs8 = new Uint8Array(new ArrayBuffer(prefix.length + 32));
  pkcs8.set(prefix);
  pkcs8.set(seed, prefix.length);
  try {
    // WebCrypto can't compute a public key from a private one directly; a JWK export of an extractable
    // import carries it (`x`). The key handed back is a second, non-extractable import unless asked otherwise.
    const temp = await subtle().importKey("pkcs8", pkcs8, { name }, true, usages);
    const jwk = await subtle().exportKey("jwk", temp);
    if (typeof jwk.x !== "string") throw new E2eeError("The runtime didn't return a public key.");
    const publicKey = fromBase64Url(jwk.x);
    if (jwk.d) jwk.d = "";
    const privateKey = extractable ? temp : await subtle().importKey("pkcs8", pkcs8, { name }, false, usages);
    return { privateKey, publicKey };
  } finally {
    pkcs8.fill(0);
  }
}

function checkPub(pub: Uint8Array, what: string): void {
  if (!isBytes(pub) || pub.length !== 32) throw new E2eeError(`${what} public key must be 32 bytes.`);
}

/** An X25519 key pair from a 32-byte private scalar (clamped by the implementation, RFC 7748). */
export async function x25519FromSeed(seed: Uint8Array): Promise<X25519KeyPair> {
  if (!isBytes(seed) || seed.length !== 32) throw new E2eeError("An X25519 private key must be 32 bytes.");
  if ((await backendFor("x25519")) === "webcrypto") return importOkpPrivate("X25519", seed, false);
  const privateKey = seed.slice();
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

/** A new random X25519 key pair; non-extractable on WebCrypto unless `extractable`. */
export async function generateX25519(o: { extractable?: boolean } = {}): Promise<X25519KeyPair> {
  if ((await backendFor("x25519")) === "webcrypto") {
    const pair = (await subtle().generateKey({ name: "X25519" }, o.extractable ?? false, [
      "deriveBits",
    ])) as CryptoKeyPair;
    const publicKey = new Uint8Array(await subtle().exportKey("raw", pair.publicKey));
    return { privateKey: pair.privateKey, publicKey };
  }
  const privateKey = randomBytes(32);
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

/** X25519(private, peer). Refuses an all-zero shared secret (a low-order peer key). */
export async function x25519Shared(privateKey: CryptoKey | Uint8Array, peerPub: Uint8Array): Promise<Uint8Array> {
  checkPub(peerPub, "An X25519");
  let shared: Uint8Array;
  try {
    if (isBytes(privateKey)) {
      shared = x25519.getSharedSecret(privateKey, peerPub);
    } else {
      const pub = await subtle().importKey("raw", own(peerPub), { name: "X25519" }, true, []);
      shared = new Uint8Array(
        await subtle().deriveBits({ name: "X25519", public: pub } as unknown as EcdhKeyDeriveParams, privateKey, 256),
      );
    }
  } catch {
    throw new E2eeError("The key agreement failed (an invalid or low-order public key).");
  }
  let any = 0;
  for (const b of shared) any |= b;
  if (any === 0) throw new E2eeError("The key agreement failed (an invalid or low-order public key).");
  return shared;
}

// ---- Ed25519 ----

/** An Ed25519 key pair from a 32-byte seed (RFC 8032). */
export async function ed25519FromSeed(seed: Uint8Array): Promise<Ed25519KeyPair> {
  if (!isBytes(seed) || seed.length !== 32) throw new E2eeError("An Ed25519 seed must be 32 bytes.");
  if ((await backendFor("ed25519")) === "webcrypto") return importOkpPrivate("Ed25519", seed, false);
  const privateKey = seed.slice();
  return { privateKey, publicKey: ed25519.getPublicKey(privateKey) };
}

/** A new random Ed25519 key pair; non-extractable on WebCrypto unless `extractable`. */
export async function generateEd25519(o: { extractable?: boolean } = {}): Promise<Ed25519KeyPair> {
  if ((await backendFor("ed25519")) === "webcrypto") {
    const pair = (await subtle().generateKey({ name: "Ed25519" }, o.extractable ?? false, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const publicKey = new Uint8Array(await subtle().exportKey("raw", pair.publicKey));
    return { privateKey: pair.privateKey, publicKey };
  }
  const privateKey = randomBytes(32);
  return { privateKey, publicKey: ed25519.getPublicKey(privateKey) };
}

export async function ed25519Sign(privateKey: CryptoKey | Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  if (isBytes(privateKey)) return ed25519.sign(message, privateKey);
  return new Uint8Array(await subtle().sign({ name: "Ed25519" }, privateKey, own(message)));
}

/** Strict RFC 8032 verification; false (never a throw) for a bad key or signature. */
export async function ed25519Verify(pub: Uint8Array, message: Uint8Array, sig: Uint8Array): Promise<boolean> {
  if (!isBytes(pub) || pub.length !== 32 || !isBytes(sig) || sig.length !== 64) return false;
  try {
    if ((await backendFor("ed25519")) === "webcrypto") {
      const key = await subtle().importKey("raw", own(pub), { name: "Ed25519" }, true, ["verify"]);
      return await subtle().verify({ name: "Ed25519" }, key, own(sig), own(message));
    }
    return ed25519.verify(sig, message, pub, { zip215: false });
  } catch {
    return false;
  }
}
