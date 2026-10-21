// Keyed record, FLV1 mode 0x03 (docs/E2EE_DESIGN.md §4.4): every sealed field and every key wrap made with a
// symmetric key.
//
//   offset  size  field
//   0       4     "FLV1"
//   4       1     0x03
//   5       1     flags: bit 0 = plaintext was deflate-raw compressed (fflate), other bits 0
//   6       4     keyVersion, uint32 BE (0 when the key has no versions)
//   10      12    nonce (random)
//   22      n+16  AES-256-GCM(key, nonce, plaintext', AAD = bytes[0..22) ‖ utf8(context))
//
// plaintext' is deflateRaw(plaintext) when the plaintext is 1024 bytes or more and compression saves at least
// 10 %, else the plaintext. Readers refuse a decompressed size over 8 MiB.
import { Inflate, deflateSync } from "fflate";
import { concatBytes, utf8 } from "../../bytes";
import { MAGIC } from "../envelope";
import {
  E2eeError,
  NONCE_BYTES,
  TAG_BYTES,
  aeadDecrypt,
  aeadEncrypt,
  checkContext,
  randomBytes,
  readU32be,
  u32be,
  type AeadKey,
} from "./primitives";

export const MODE_RECORD = 0x03;
export const RECORD_HEADER = 22;
export const FLAG_DEFLATE = 0x01;
export const COMPRESS_MIN = 1024;
export const MAX_INFLATED = 8 * 1024 * 1024;

function hasMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === MAGIC[0] && bytes[1] === MAGIC[1] && bytes[2] === MAGIC[2] && bytes[3] === MAGIC[3];
}

export interface RecordHeader {
  flags: number;
  keyVersion: number;
  nonce: Uint8Array;
}

/** Parses and checks the 22-byte header; throws E2eeError for anything that isn't a keyed record. */
export function recordHeader(envelope: Uint8Array): RecordHeader {
  if (!hasMagic(envelope) || envelope[4] !== MODE_RECORD) throw new E2eeError("Not a sealed Folevi record.");
  if (envelope.length < RECORD_HEADER + TAG_BYTES) throw new E2eeError("The sealed record is incomplete.");
  const flags = envelope[5]!;
  if ((flags & ~FLAG_DEFLATE) !== 0) throw new E2eeError("Unknown sealed record flags.");
  return { flags, keyVersion: readU32be(envelope, 6), nonce: envelope.slice(10, 22) };
}

/** The version of the key that sealed a record, read from its header without decrypting. */
export function recordKeyVersion(envelope: Uint8Array): number {
  return recordHeader(envelope).keyVersion;
}

export interface SealRecordOptions {
  /** Test vectors only; otherwise random. */
  nonce?: Uint8Array;
  /** false never compresses; otherwise compression is used when the rule above says so. */
  compress?: boolean;
}

export async function sealRecord(
  key: AeadKey,
  keyVersion: number,
  context: string,
  plaintext: Uint8Array,
  o: SealRecordOptions = {},
): Promise<Uint8Array> {
  checkContext(context);
  const nonce = o.nonce ?? randomBytes(NONCE_BYTES);
  if (nonce.length !== NONCE_BYTES) throw new E2eeError("The nonce must be 12 bytes.");
  let flags = 0;
  let body = plaintext;
  if (o.compress !== false && plaintext.length >= COMPRESS_MIN && plaintext.length <= MAX_INFLATED) {
    const z = deflateSync(plaintext, { level: 6 });
    if (z.length * 10 <= plaintext.length * 9) {
      body = z;
      flags = FLAG_DEFLATE;
    }
  }
  const header = concatBytes(MAGIC, new Uint8Array([MODE_RECORD, flags]), u32be(keyVersion), nonce);
  const sealed = await aeadEncrypt(key, nonce, body, concatBytes(header, utf8(context)));
  if (body !== plaintext) body.fill(0);
  return concatBytes(header, sealed);
}

/** Inflates deflate-raw data, refusing output over `max` bytes (a compression bomb) without producing it. */
export function inflateBounded(data: Uint8Array, max = MAX_INFLATED): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  let done = false;
  const inflater = new Inflate((chunk, final) => {
    total += chunk.length;
    if (total > max) throw new E2eeError("The sealed record is too large when decompressed.");
    parts.push(chunk);
    if (final) done = true;
  });
  // Small input slices bound the output of one push (deflate expands at most about 1032:1).
  const step = 1024;
  try {
    if (data.length === 0) inflater.push(data, true);
    for (let i = 0; i < data.length; i += step) inflater.push(data.subarray(i, i + step), i + step >= data.length);
  } catch (e) {
    if (e instanceof E2eeError) throw e;
    throw new E2eeError("The sealed record's compressed data is damaged.");
  }
  if (!done) throw new E2eeError("The sealed record's compressed data is incomplete.");
  return concatBytes(...parts);
}

/**
 * Opens a keyed record. `key` may be a function that picks the key by the version in the header (key
 * rotation: readers pick the version from the envelope). Throws E2eeError for a wrong key, a wrong context,
 * any changed byte or a decompression bomb.
 */
export async function openRecord(
  key: AeadKey | ((keyVersion: number) => Promise<AeadKey>),
  context: string,
  envelope: Uint8Array,
): Promise<Uint8Array> {
  checkContext(context);
  const h = recordHeader(envelope);
  const k = typeof key === "function" ? await key(h.keyVersion) : key;
  const header = envelope.subarray(0, RECORD_HEADER);
  const body = await aeadDecrypt(k, h.nonce, envelope.subarray(RECORD_HEADER), concatBytes(header, utf8(context)));
  if ((h.flags & FLAG_DEFLATE) === 0) return body;
  try {
    return inflateBounded(body);
  } finally {
    body.fill(0);
  }
}
