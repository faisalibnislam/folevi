// The encrypted sync folder (LOCAL_MODE_PLAN.md §3.9). This is the reference implementation: the Mac (Node
// crypto) and iOS (CryptoKit, CommonCrypto PBKDF2) must produce and accept the same bytes, checked against
// fixtures/crypto-vectors.json. WebCrypto only, so it runs in Node, browsers and web views.
//
// Key hierarchy
//   passphrase --PBKDF2-SHA256(salt, iterations)--> wrapping key (AES-256-GCM)
//   wrapping key seals a random 32-byte master key: wrappedKey = nonce(12) ‖ ciphertext ‖ tag, AAD "folevi-library-key/v1"
//   master key --HKDF-SHA256(salt "folevi/v1", info "file:" + path id)--> per-file AES-256-GCM key
//   master key --HKDF-SHA256(salt "folevi/v1", info "names")--> HMAC-SHA256 key for file names
//   master key --HKDF-SHA256(salt "folevi/v1", info "key-check")--> 32 bytes; keyCheck = first 16, base64
//
// File envelope, one shot (notes, index, history):
//   "FLV1" ‖ 0x01 ‖ nonce(12) ‖ AES-256-GCM(plaintext, AAD = the 17 header bytes)
// Stream envelope (attachments, readable by byte range):
//   "FLV1" ‖ 0x02 ‖ chunkSize(uint32 BE, 65536) ‖ noncePrefix(8)
//   then chunk i = AES-256-GCM(plaintext[i*chunk, (i+1)*chunk)), nonce = noncePrefix ‖ uint32 BE(i),
//   AAD = the 17 header bytes ‖ (0x01 for the last chunk, else 0x00). Empty plaintext is one empty last chunk.
import { concatBytes, fromBase64, own, toBase64, utf8 } from "../bytes";
import type { EncryptionHeader } from "../layout";

export const MAGIC = utf8("FLV1");
export const MODE_SINGLE = 0x01;
export const MODE_STREAM = 0x02;
export const STREAM_CHUNK = 64 * 1024;
export const TAG_BYTES = 16;
export const DEFAULT_ITERATIONS = 600_000;
const HKDF_SALT = utf8("folevi/v1");
const WRAP_AAD = utf8("folevi-library-key/v1");

export class EnvelopeError extends Error {
  override name = "EnvelopeError";
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new EnvelopeError("WebCrypto isn't available here.");
  return s;
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

async function hkdfBits(master: Uint8Array, info: string, bits: number): Promise<Uint8Array> {
  if (master.length !== 32) throw new EnvelopeError("The master key must be 32 bytes.");
  const base = await subtle().importKey("raw", own(master), "HKDF", false, ["deriveBits"]);
  const out = await subtle().deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: own(HKDF_SALT), info: own(utf8(info)) },
    base,
    bits,
  );
  return new Uint8Array(out);
}

async function aesKey(raw: Uint8Array): Promise<CryptoKey> {
  return subtle().importKey("raw", own(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** The raw 32-byte AES key for one file (exposed for test vectors; natives derive the same). */
export async function fileKeyBytes(master: Uint8Array, pathId: string): Promise<Uint8Array> {
  return hkdfBits(master, `file:${pathId}`, 256);
}

async function fileKey(master: Uint8Array, pathId: string): Promise<CryptoKey> {
  return aesKey(await fileKeyBytes(master, pathId));
}

async function gcmEncrypt(
  key: CryptoKey,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  return new Uint8Array(
    await subtle().encrypt(
      { name: "AES-GCM", iv: own(nonce), additionalData: own(aad), tagLength: 128 },
      key,
      own(plaintext),
    ),
  );
}

async function gcmDecrypt(
  key: CryptoKey,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  try {
    return new Uint8Array(
      await subtle().decrypt(
        { name: "AES-GCM", iv: own(nonce), additionalData: own(aad), tagLength: 128 },
        key,
        own(ciphertext),
      ),
    );
  } catch {
    throw new EnvelopeError(
      "The file failed its integrity check (damaged, incomplete, or a different key).",
    );
  }
}

// ---- Passphrase and master key ----

export async function deriveWrappingKeyBytes(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  if (!Number.isInteger(iterations) || iterations < 1)
    throw new EnvelopeError("Invalid iteration count.");
  const base = await subtle().importKey(
    "raw",
    own(utf8(passphrase.normalize("NFC"))),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return new Uint8Array(
    await subtle().deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: own(salt), iterations },
      base,
      256,
    ),
  );
}

export async function keyCheck(master: Uint8Array): Promise<string> {
  return toBase64((await hkdfBits(master, "key-check", 256)).slice(0, 16));
}

export interface CreateEncryptionOptions {
  iterations?: number;
  /** For test vectors only; otherwise random. */
  salt?: Uint8Array;
  masterKey?: Uint8Array;
  nonce?: Uint8Array;
}

/** A new library key, wrapped by the passphrase. The master key is returned for the native keychain. */
export async function createEncryption(
  passphrase: string,
  options: CreateEncryptionOptions = {},
): Promise<{ header: EncryptionHeader; masterKey: Uint8Array }> {
  const masterKey = options.masterKey ?? randomBytes(32);
  const header = await wrapMasterKey(masterKey, passphrase, options);
  return { header, masterKey };
}

export async function wrapMasterKey(
  masterKey: Uint8Array,
  passphrase: string,
  options: Omit<CreateEncryptionOptions, "masterKey"> = {},
): Promise<EncryptionHeader> {
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const salt = options.salt ?? randomBytes(16);
  const nonce = options.nonce ?? randomBytes(12);
  const wrapping = await aesKey(await deriveWrappingKeyBytes(passphrase, salt, iterations));
  const sealed = await gcmEncrypt(wrapping, nonce, masterKey, WRAP_AAD);
  return {
    alg: "A256GCM",
    kdf: { name: "PBKDF2-SHA256", iterations, salt: toBase64(salt) },
    wrappedKey: toBase64(concatBytes(nonce, sealed)),
    keyCheck: await keyCheck(masterKey),
  };
}

/** The master key, or null when the passphrase is wrong. */
export async function unlockMasterKey(
  header: EncryptionHeader,
  passphrase: string,
): Promise<Uint8Array | null> {
  if (header.alg !== "A256GCM" || header.kdf.name !== "PBKDF2-SHA256")
    throw new EnvelopeError("Unsupported library encryption.");
  const wrapped = fromBase64(header.wrappedKey);
  if (wrapped.length !== 12 + 32 + TAG_BYTES)
    throw new EnvelopeError("The wrapped key is damaged.");
  const wrapping = await aesKey(
    await deriveWrappingKeyBytes(passphrase, fromBase64(header.kdf.salt), header.kdf.iterations),
  );
  let master: Uint8Array;
  try {
    master = await gcmDecrypt(wrapping, wrapped.slice(0, 12), wrapped.slice(12), WRAP_AAD);
  } catch {
    return null;
  }
  if ((await keyCheck(master)) !== header.keyCheck) return null;
  return master;
}

/** Changing the passphrase rewraps the key only; no file is rewritten. Null when the old passphrase is wrong. */
export async function changePassphrase(
  header: EncryptionHeader,
  oldPassphrase: string,
  newPassphrase: string,
  options: Omit<CreateEncryptionOptions, "masterKey"> = {},
): Promise<EncryptionHeader | null> {
  const master = await unlockMasterKey(header, oldPassphrase);
  if (!master) return null;
  return wrapMasterKey(master, newPassphrase, {
    iterations: options.iterations ?? header.kdf.iterations,
    ...options,
  });
}

// ---- File names ----

const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * The on-disk name for an id: HMAC-SHA256(names key, "<kind>:<id>"), first 130 bits as 26 lowercase Crockford
 * characters (the same shape as a ULID, so conflict-copy parsing is unchanged). Kinds: "note", "file".
 */
export async function hmacName(
  master: Uint8Array,
  kind: "note" | "file",
  id: string,
): Promise<string> {
  const keyBytes = await hkdfBits(master, "names", 256);
  const key = await subtle().importKey(
    "raw",
    own(keyBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await subtle().sign("HMAC", key, own(utf8(`${kind}:${id}`))));
  let out = "";
  let acc = 0;
  let bits = 0;
  let i = 0;
  while (out.length < 26) {
    if (bits < 5) {
      acc = (acc << 8) | mac[i++]!;
      bits += 8;
    }
    bits -= 5;
    out += CROCKFORD[(acc >> bits) & 31];
    acc &= (1 << bits) - 1;
  }
  return out;
}

// ---- One-shot envelope ----

function header(mode: number, rest: Uint8Array): Uint8Array {
  return concatBytes(MAGIC, new Uint8Array([mode]), rest);
}

export function isEnvelope(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === MAGIC[0] &&
    bytes[1] === MAGIC[1] &&
    bytes[2] === MAGIC[2] &&
    bytes[3] === MAGIC[3]
  );
}

/** Encrypts a whole file. `pathId` is the file's canonical path in the library (its key depends on it). */
export async function sealFile(
  master: Uint8Array,
  pathId: string,
  plaintext: Uint8Array,
  nonce: Uint8Array = randomBytes(12),
): Promise<Uint8Array> {
  if (nonce.length !== 12) throw new EnvelopeError("The nonce must be 12 bytes.");
  const h = header(MODE_SINGLE, nonce);
  return concatBytes(h, await gcmEncrypt(await fileKey(master, pathId), nonce, plaintext, h));
}

/** Decrypts a whole file; throws EnvelopeError if it was changed, cut short or sealed for another path. */
export async function openFile(
  master: Uint8Array,
  pathId: string,
  envelope: Uint8Array,
): Promise<Uint8Array> {
  if (!isEnvelope(envelope)) throw new EnvelopeError("Not an encrypted Folevi file.");
  if (envelope[4] === MODE_STREAM) return openStream(master, pathId, envelope);
  if (envelope[4] !== MODE_SINGLE) throw new EnvelopeError("Unknown envelope mode.");
  if (envelope.length < 17 + TAG_BYTES) throw new EnvelopeError("The file is incomplete.");
  const h = envelope.slice(0, 17);
  return gcmDecrypt(await fileKey(master, pathId), h.slice(5), envelope.slice(17), h);
}

// ---- STREAM envelope ----

const STREAM_HEADER = 17;

function streamHeader(chunkSize: number, prefix: Uint8Array): Uint8Array {
  const size = new Uint8Array(4);
  new DataView(size.buffer).setUint32(0, chunkSize);
  return header(MODE_STREAM, concatBytes(size, prefix));
}

function chunkNonce(prefix: Uint8Array, index: number): Uint8Array {
  const n = new Uint8Array(12);
  n.set(prefix);
  new DataView(n.buffer).setUint32(8, index);
  return n;
}

function chunkAad(h: Uint8Array, last: boolean): Uint8Array {
  return concatBytes(h, new Uint8Array([last ? 1 : 0]));
}

export interface SealStreamOptions {
  noncePrefix?: Uint8Array;
  /** Plaintext bytes per chunk (64 KiB; other sizes are for tests). */
  chunkSize?: number;
}

/** Encrypts an attachment in chunks so it can be read by byte range. */
export async function sealStream(
  master: Uint8Array,
  pathId: string,
  plaintext: Uint8Array,
  options: SealStreamOptions = {},
): Promise<Uint8Array> {
  const chunkSize = options.chunkSize ?? STREAM_CHUNK;
  const prefix = options.noncePrefix ?? randomBytes(8);
  if (prefix.length !== 8) throw new EnvelopeError("The nonce prefix must be 8 bytes.");
  const count = Math.max(1, Math.ceil(plaintext.length / chunkSize));
  if (count > 0xffffffff) throw new EnvelopeError("The file is too large.");
  const h = streamHeader(chunkSize, prefix);
  const key = await fileKey(master, pathId);
  const parts: Uint8Array[] = [h];
  for (let i = 0; i < count; i++) {
    const chunk = plaintext.subarray(
      i * chunkSize,
      Math.min(plaintext.length, (i + 1) * chunkSize),
    );
    parts.push(await gcmEncrypt(key, chunkNonce(prefix, i), chunk, chunkAad(h, i === count - 1)));
  }
  return concatBytes(...parts);
}

interface StreamLayout {
  h: Uint8Array;
  prefix: Uint8Array;
  chunkSize: number;
  count: number;
  plainLength: number;
}

function streamLayout(envelope: Uint8Array): StreamLayout {
  if (!isEnvelope(envelope) || envelope[4] !== MODE_STREAM)
    throw new EnvelopeError("Not an encrypted Folevi stream.");
  if (envelope.length < STREAM_HEADER + TAG_BYTES)
    throw new EnvelopeError("The file is incomplete.");
  const h = envelope.slice(0, STREAM_HEADER);
  const chunkSize = new DataView(h.buffer, h.byteOffset).getUint32(5);
  if (chunkSize < 1) throw new EnvelopeError("Invalid chunk size.");
  const body = envelope.length - STREAM_HEADER;
  const full = chunkSize + TAG_BYTES;
  const count = Math.max(1, Math.ceil(body / full));
  const lastLength = body - (count - 1) * full;
  if (lastLength < TAG_BYTES) throw new EnvelopeError("The file is incomplete.");
  return {
    h,
    prefix: h.slice(9, 17),
    chunkSize,
    count,
    plainLength: (count - 1) * chunkSize + lastLength - TAG_BYTES,
  };
}

/** Plaintext length of a stream envelope, without decrypting. */
export function streamPlainLength(envelope: Uint8Array): number {
  return streamLayout(envelope).plainLength;
}

export async function openStream(
  master: Uint8Array,
  pathId: string,
  envelope: Uint8Array,
): Promise<Uint8Array> {
  const l = streamLayout(envelope);
  return openStreamRange(master, pathId, envelope, 0, l.plainLength);
}

/**
 * Decrypts bytes [start, end) of an attachment, touching only the chunks that hold them (for Range requests).
 * Every chunk read is authenticated; truncation is caught because the final chunk must carry the last flag.
 */
export async function openStreamRange(
  master: Uint8Array,
  pathId: string,
  envelope: Uint8Array,
  start: number,
  end: number,
): Promise<Uint8Array> {
  const l = streamLayout(envelope);
  if (start < 0 || end < start || end > l.plainLength)
    throw new EnvelopeError("Range out of bounds.");
  const key = await fileKey(master, pathId);
  const full = l.chunkSize + TAG_BYTES;
  const first = Math.floor(start / l.chunkSize);
  const lastIndex = l.count - 1;
  // Always authenticate the final chunk, so a cut-short file never reads as a shorter valid one.
  const finalChunk = envelope.subarray(STREAM_HEADER + lastIndex * full);
  const finalPlain = await gcmDecrypt(
    key,
    chunkNonce(l.prefix, lastIndex),
    finalChunk,
    chunkAad(l.h, true),
  );
  if (end === start) return new Uint8Array(0);
  const last = Math.floor((end - 1) / l.chunkSize);
  const parts: Uint8Array[] = [];
  for (let i = first; i <= last; i++) {
    const plain =
      i === lastIndex
        ? finalPlain
        : await gcmDecrypt(
            key,
            chunkNonce(l.prefix, i),
            envelope.subarray(STREAM_HEADER + i * full, STREAM_HEADER + (i + 1) * full),
            chunkAad(l.h, false),
          );
    parts.push(plain);
  }
  const joined = concatBytes(...parts);
  const offset = start - first * l.chunkSize;
  return joined.slice(offset, offset + (end - start));
}
