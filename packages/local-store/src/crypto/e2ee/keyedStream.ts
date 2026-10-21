// Keyed stream, FLV1 mode 0x04 (docs/E2EE_DESIGN.md §4.4): attachment bytes, readable by byte range.
//
//   0   4   "FLV1"
//   4   1   0x04
//   5   4   chunkSize, uint32 BE (65536)
//   9   8   noncePrefix (random)
//   17  ... chunk i = AES-256-GCM(FK, noncePrefix ‖ uint32 BE(i), chunk plaintext,
//                                 AAD = bytes[0..17) ‖ utf8(context) ‖ (0x01 if last chunk else 0x00))
//
// Mode 0x02 (crypto/envelope.ts) with an explicit key and a context in the AAD. Empty plaintext is one empty
// last chunk. A range read always authenticates the final chunk, so a cut-short file never reads as a
// shorter valid one.
import { concatBytes, utf8 } from "../../bytes";
import { MAGIC, STREAM_CHUNK } from "../envelope";
import {
  E2eeError,
  TAG_BYTES,
  aeadDecrypt,
  aeadEncrypt,
  checkContext,
  randomBytes,
  readU32be,
  u32be,
  type AeadKey,
} from "./primitives";

export const MODE_KEYED_STREAM = 0x04;
export const KEYED_STREAM_HEADER = 17;
/** Readers refuse larger chunks (a hostile header must not make one read allocate gigabytes). */
export const MAX_CHUNK = 16 * 1024 * 1024;

function chunkNonce(prefix: Uint8Array, index: number): Uint8Array {
  return concatBytes(prefix, u32be(index));
}

function chunkAad(h: Uint8Array, context: Uint8Array, last: boolean): Uint8Array {
  return concatBytes(h, context, new Uint8Array([last ? 1 : 0]));
}

export interface SealFileStreamOptions {
  /** Plaintext bytes per chunk (64 KiB; other sizes are for tests). */
  chunkSize?: number;
  /** Test vectors only; otherwise random. */
  noncePrefix?: Uint8Array;
}

export async function sealFileStream(
  fileKey: AeadKey,
  context: string,
  plaintext: Uint8Array,
  o: SealFileStreamOptions = {},
): Promise<Uint8Array> {
  checkContext(context);
  const chunkSize = o.chunkSize ?? STREAM_CHUNK;
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_CHUNK) throw new E2eeError("Invalid chunk size.");
  const prefix = o.noncePrefix ?? randomBytes(8);
  if (prefix.length !== 8) throw new E2eeError("The nonce prefix must be 8 bytes.");
  const count = Math.max(1, Math.ceil(plaintext.length / chunkSize));
  if (count > 0xffffffff) throw new E2eeError("The file is too large.");
  const h = concatBytes(MAGIC, new Uint8Array([MODE_KEYED_STREAM]), u32be(chunkSize), prefix);
  const c = utf8(context);
  const parts: Uint8Array[] = [h];
  for (let i = 0; i < count; i++) {
    const chunk = plaintext.subarray(i * chunkSize, Math.min(plaintext.length, (i + 1) * chunkSize));
    parts.push(await aeadEncrypt(fileKey, chunkNonce(prefix, i), chunk, chunkAad(h, c, i === count - 1)));
  }
  return concatBytes(...parts);
}

interface Layout {
  h: Uint8Array;
  prefix: Uint8Array;
  chunkSize: number;
  count: number;
  plainLength: number;
}

function layout(envelope: Uint8Array): Layout {
  if (
    envelope.length < 5 ||
    envelope[0] !== MAGIC[0] ||
    envelope[1] !== MAGIC[1] ||
    envelope[2] !== MAGIC[2] ||
    envelope[3] !== MAGIC[3] ||
    envelope[4] !== MODE_KEYED_STREAM
  )
    throw new E2eeError("Not an encrypted Folevi file.");
  if (envelope.length < KEYED_STREAM_HEADER + TAG_BYTES) throw new E2eeError("The file is incomplete.");
  const h = envelope.slice(0, KEYED_STREAM_HEADER);
  const chunkSize = readU32be(h, 5);
  if (chunkSize < 1 || chunkSize > MAX_CHUNK) throw new E2eeError("Invalid chunk size.");
  const body = envelope.length - KEYED_STREAM_HEADER;
  const full = chunkSize + TAG_BYTES;
  const count = Math.max(1, Math.ceil(body / full));
  const lastLength = body - (count - 1) * full;
  if (lastLength < TAG_BYTES) throw new E2eeError("The file is incomplete.");
  return { h, prefix: h.slice(9, 17), chunkSize, count, plainLength: (count - 1) * chunkSize + lastLength - TAG_BYTES };
}

/** Plaintext length of a keyed stream, without decrypting. */
export function fileStreamPlainLength(envelope: Uint8Array): number {
  return layout(envelope).plainLength;
}

export async function openFileStream(fileKey: AeadKey, context: string, envelope: Uint8Array): Promise<Uint8Array> {
  return openFileStreamRange(fileKey, context, envelope, 0, layout(envelope).plainLength);
}

/** Decrypts bytes [start, end), touching only the chunks that hold them plus the final chunk. */
export async function openFileStreamRange(
  fileKey: AeadKey,
  context: string,
  envelope: Uint8Array,
  start: number,
  end: number,
): Promise<Uint8Array> {
  checkContext(context);
  const l = layout(envelope);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > l.plainLength)
    throw new E2eeError("Range out of bounds.");
  const c = utf8(context);
  const full = l.chunkSize + TAG_BYTES;
  const lastIndex = l.count - 1;
  const finalPlain = await aeadDecrypt(
    fileKey,
    chunkNonce(l.prefix, lastIndex),
    envelope.subarray(KEYED_STREAM_HEADER + lastIndex * full),
    chunkAad(l.h, c, true),
  );
  if (end === start) return new Uint8Array(0);
  const first = Math.floor(start / l.chunkSize);
  const last = Math.floor((end - 1) / l.chunkSize);
  const parts: Uint8Array[] = [];
  for (let i = first; i <= last; i++) {
    parts.push(
      i === lastIndex
        ? finalPlain
        : await aeadDecrypt(
            fileKey,
            chunkNonce(l.prefix, i),
            envelope.subarray(KEYED_STREAM_HEADER + i * full, KEYED_STREAM_HEADER + (i + 1) * full),
            chunkAad(l.h, c, false),
          ),
    );
  }
  const joined = concatBytes(...parts);
  const offset = start - first * l.chunkSize;
  return joined.slice(offset, offset + (end - start));
}
