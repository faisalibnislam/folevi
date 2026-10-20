// The encrypted library's FLV1 envelope on the Mac (docs/LOCAL_MODE_PLAN.md §3.9, §3.10) with node:crypto, in
// the main process only: the page never holds a key. packages/local-store/src/crypto/envelope.ts is the
// reference; crypto.test.ts checks these bytes against fixtures/crypto-vectors.json and against it.
//
//   passphrase --PBKDF2-SHA256--> wrapping key; AES-256-GCM(wrapping key, AAD "folevi-library-key/v1") seals the master key
//   master --HKDF-SHA256(salt "folevi/v1", info "file:" + path)--> per-file key; info "names" --> HMAC key; "key-check"
//   single:  "FLV1" 0x01 nonce(12) | ciphertext | tag, AAD = the 17 header bytes
//   stream:  "FLV1" 0x02 chunkSize(u32 BE) noncePrefix(8) | chunks: nonce prefix‖u32 BE(i), AAD header‖lastFlag
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, pbkdf2, randomBytes as nodeRandom } from "node:crypto";

export const MODE_SINGLE = 0x01;
export const MODE_STREAM = 0x02;
export const STREAM_CHUNK = 64 * 1024;
export const TAG_BYTES = 16;
export const HEADER_BYTES = 17;
export const DEFAULT_ITERATIONS = 600_000;
const MAGIC = Buffer.from("FLV1", "utf8");
const HKDF_SALT = Buffer.from("folevi/v1", "utf8");
const WRAP_AAD = Buffer.from("folevi-library-key/v1", "utf8");
const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";

export class EnvelopeError extends Error {
  override name = "EnvelopeError";
}

/** local-store's `EncryptionHeader` (folevi-library.json `encryption`). */
export interface EncryptionHeader {
  alg: "A256GCM";
  kdf: { name: "PBKDF2-SHA256"; iterations: number; salt: string };
  wrappedKey: string;
  keyCheck: string;
}

const buf = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength);

export function randomBytes(n: number): Buffer {
  return nodeRandom(n);
}

function hkdf(master: Uint8Array, info: string, length: number): Buffer {
  if (master.length !== 32) throw new EnvelopeError("The master key must be 32 bytes.");
  return Buffer.from(hkdfSync("sha256", buf(master), HKDF_SALT, Buffer.from(info, "utf8"), length));
}

export function fileKey(master: Uint8Array, pathId: string): Buffer {
  return hkdf(master, `file:${pathId}`, 32);
}

function gcmSeal(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Buffer {
  const c = createCipheriv("aes-256-gcm", buf(key), buf(nonce), { authTagLength: TAG_BYTES });
  c.setAAD(buf(aad));
  return Buffer.concat([c.update(buf(plaintext)), c.final(), c.getAuthTag()]);
}

function gcmOpen(key: Uint8Array, nonce: Uint8Array, sealed: Uint8Array, aad: Uint8Array): Buffer {
  if (sealed.length < TAG_BYTES) throw new EnvelopeError("The file is incomplete.");
  try {
    const d = createDecipheriv("aes-256-gcm", buf(key), buf(nonce), { authTagLength: TAG_BYTES });
    d.setAAD(buf(aad));
    d.setAuthTag(buf(sealed.subarray(sealed.length - TAG_BYTES)));
    return Buffer.concat([d.update(buf(sealed.subarray(0, sealed.length - TAG_BYTES))), d.final()]);
  } catch {
    throw new EnvelopeError("The file failed its integrity check (damaged, incomplete, or a different key).");
  }
}

// ---------------------------------------------------------------- passphrase and master key

export function deriveWrappingKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<Buffer> {
  if (!Number.isInteger(iterations) || iterations < 1) return Promise.reject(new EnvelopeError("Invalid iteration count."));
  return new Promise((resolve, reject) =>
    pbkdf2(Buffer.from(passphrase.normalize("NFC"), "utf8"), buf(salt), iterations, 32, "sha256", (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export function keyCheck(master: Uint8Array): string {
  return hkdf(master, "key-check", 32).subarray(0, 16).toString("base64");
}

export async function wrapMasterKey(
  master: Uint8Array,
  passphrase: string,
  o: { iterations?: number; salt?: Uint8Array; nonce?: Uint8Array } = {},
): Promise<EncryptionHeader> {
  const iterations = o.iterations ?? DEFAULT_ITERATIONS;
  const salt = o.salt ?? randomBytes(16);
  const nonce = o.nonce ?? randomBytes(12);
  const wrapping = await deriveWrappingKey(passphrase, salt, iterations);
  const sealed = gcmSeal(wrapping, nonce, master, WRAP_AAD);
  return {
    alg: "A256GCM",
    kdf: { name: "PBKDF2-SHA256", iterations, salt: buf(salt).toString("base64") },
    wrappedKey: Buffer.concat([buf(nonce), sealed]).toString("base64"),
    keyCheck: keyCheck(master),
  };
}

export async function createEncryption(passphrase: string, o: { iterations?: number } = {}): Promise<{ header: EncryptionHeader; masterKey: Buffer }> {
  const masterKey = randomBytes(32);
  return { header: await wrapMasterKey(masterKey, passphrase, o), masterKey };
}

/** The master key, or null when the passphrase is wrong. */
export async function unlockMasterKey(header: EncryptionHeader, passphrase: string): Promise<Buffer | null> {
  if (header?.alg !== "A256GCM" || header.kdf?.name !== "PBKDF2-SHA256") throw new EnvelopeError("Unsupported library encryption.");
  const wrapped = Buffer.from(header.wrappedKey, "base64");
  if (wrapped.length !== 12 + 32 + TAG_BYTES) throw new EnvelopeError("The wrapped key is damaged.");
  const wrapping = await deriveWrappingKey(passphrase, Buffer.from(header.kdf.salt, "base64"), header.kdf.iterations);
  let master: Buffer;
  try {
    master = gcmOpen(wrapping, wrapped.subarray(0, 12), wrapped.subarray(12), WRAP_AAD);
  } catch {
    return null;
  }
  return keyCheck(master) === header.keyCheck ? master : null;
}

/** Whether a key belongs to a library (its keyCheck), without the passphrase. */
export function keyMatches(header: EncryptionHeader, master: Uint8Array): boolean {
  return master.length === 32 && keyCheck(master) === header.keyCheck;
}

// ---------------------------------------------------------------- names

/** HMAC-SHA256(names key, "<kind>:<id>"), first 130 bits as 26 lowercase Crockford characters. */
export function hmacName(master: Uint8Array, kind: "note" | "file", id: string): string {
  const mac = createHmac("sha256", hkdf(master, "names", 32)).update(`${kind}:${id}`, "utf8").digest();
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

// ---------------------------------------------------------------- one-shot envelope

export function isEnvelope(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === MAGIC[0] && bytes[1] === MAGIC[1] && bytes[2] === MAGIC[2] && bytes[3] === MAGIC[3];
}

export function sealFile(master: Uint8Array, pathId: string, plaintext: Uint8Array, nonce: Uint8Array = randomBytes(12)): Buffer {
  if (nonce.length !== 12) throw new EnvelopeError("The nonce must be 12 bytes.");
  const h = Buffer.concat([MAGIC, Buffer.from([MODE_SINGLE]), buf(nonce)]);
  return Buffer.concat([h, gcmSeal(fileKey(master, pathId), nonce, plaintext, h)]);
}

export function openFile(master: Uint8Array, pathId: string, envelope: Uint8Array): Buffer {
  if (!isEnvelope(envelope)) throw new EnvelopeError("Not an encrypted Folevi file.");
  if (envelope[4] === MODE_STREAM) return openStream(master, pathId, envelope);
  if (envelope[4] !== MODE_SINGLE) throw new EnvelopeError("Unknown envelope mode.");
  if (envelope.length < HEADER_BYTES + TAG_BYTES) throw new EnvelopeError("The file is incomplete.");
  const h = envelope.subarray(0, HEADER_BYTES);
  return gcmOpen(fileKey(master, pathId), h.subarray(5), envelope.subarray(HEADER_BYTES), h);
}

// ---------------------------------------------------------------- STREAM envelope

function chunkNonce(prefix: Uint8Array, index: number): Buffer {
  const n = Buffer.alloc(12);
  n.set(prefix);
  n.writeUInt32BE(index, 8);
  return n;
}

const chunkAad = (h: Uint8Array, last: boolean) => Buffer.concat([buf(h), Buffer.from([last ? 1 : 0])]);

export function sealStream(master: Uint8Array, pathId: string, plaintext: Uint8Array, o: { noncePrefix?: Uint8Array; chunkSize?: number } = {}): Buffer {
  const chunkSize = o.chunkSize ?? STREAM_CHUNK;
  const prefix = o.noncePrefix ?? randomBytes(8);
  if (prefix.length !== 8) throw new EnvelopeError("The nonce prefix must be 8 bytes.");
  const count = Math.max(1, Math.ceil(plaintext.length / chunkSize));
  if (count > 0xffffffff) throw new EnvelopeError("The file is too large.");
  const size = Buffer.alloc(4);
  size.writeUInt32BE(chunkSize);
  const h = Buffer.concat([MAGIC, Buffer.from([MODE_STREAM]), size, buf(prefix)]);
  const key = fileKey(master, pathId);
  const parts: Buffer[] = [h];
  for (let i = 0; i < count; i++) {
    const chunk = plaintext.subarray(i * chunkSize, Math.min(plaintext.length, (i + 1) * chunkSize));
    parts.push(gcmSeal(key, chunkNonce(prefix, i), chunk, chunkAad(h, i === count - 1)));
  }
  return Buffer.concat(parts);
}

export interface StreamLayout {
  header: Buffer;
  prefix: Buffer;
  chunkSize: number;
  count: number;
  plainLength: number;
  envelopeLength: number;
}

/** A stream envelope's shape from its 17 header bytes and its total length (nothing else is read). */
export function streamLayout(header: Uint8Array, envelopeLength: number): StreamLayout {
  if (header.length < HEADER_BYTES || !isEnvelope(header) || header[4] !== MODE_STREAM) throw new EnvelopeError("Not an encrypted Folevi stream.");
  if (envelopeLength < HEADER_BYTES + TAG_BYTES) throw new EnvelopeError("The file is incomplete.");
  const h = Buffer.from(header.subarray(0, HEADER_BYTES));
  const chunkSize = h.readUInt32BE(5);
  if (chunkSize < 1) throw new EnvelopeError("Invalid chunk size.");
  const body = envelopeLength - HEADER_BYTES;
  const full = chunkSize + TAG_BYTES;
  const count = Math.max(1, Math.ceil(body / full));
  const lastLength = body - (count - 1) * full;
  if (lastLength < TAG_BYTES) throw new EnvelopeError("The file is incomplete.");
  return { header: h, prefix: h.subarray(9, 17), chunkSize, count, plainLength: (count - 1) * chunkSize + lastLength - TAG_BYTES, envelopeLength };
}

/** Reads `length` bytes of the envelope at `position` (a file descriptor, or an in-memory envelope). */
export type ReadAt = (position: number, length: number) => Promise<Uint8Array>;

/** A stream envelope opened for range reads: chunks are read, authenticated and decrypted only as needed. */
export class StreamReader {
  private readonly key: Buffer;
  private finalChecked = false;
  private constructor(
    readonly layout: StreamLayout,
    private readonly readAt: ReadAt,
    master: Uint8Array,
    pathId: string,
  ) {
    this.key = fileKey(master, pathId);
  }

  static async open(master: Uint8Array, pathId: string, envelopeLength: number, readAt: ReadAt): Promise<StreamReader> {
    const layout = streamLayout(await readAt(0, HEADER_BYTES), envelopeLength);
    return new StreamReader(layout, readAt, master, pathId);
  }

  /** Decrypts chunk i (authenticated). */
  async chunk(i: number): Promise<Buffer> {
    const l = this.layout;
    if (i < 0 || i >= l.count) throw new EnvelopeError("Range out of bounds.");
    const full = l.chunkSize + TAG_BYTES;
    const start = HEADER_BYTES + i * full;
    const length = Math.min(full, l.envelopeLength - start);
    const sealed = await this.readAt(start, length);
    if (sealed.length !== length) throw new EnvelopeError("The file is incomplete.");
    return gcmOpen(this.key, chunkNonce(l.prefix, i), sealed, chunkAad(l.header, i === l.count - 1));
  }

  /** The final chunk must carry the last flag, so a cut-short file never reads as a shorter valid one. */
  async checkFinal(): Promise<void> {
    if (this.finalChecked) return;
    await this.chunk(this.layout.count - 1);
    this.finalChecked = true;
  }

  /** Plaintext bytes [start, end). */
  async range(start: number, end: number): Promise<Buffer> {
    const l = this.layout;
    if (start < 0 || end < start || end > l.plainLength) throw new EnvelopeError("Range out of bounds.");
    await this.checkFinal();
    if (end === start) return Buffer.alloc(0);
    const first = Math.floor(start / l.chunkSize);
    const last = Math.floor((end - 1) / l.chunkSize);
    const parts: Buffer[] = [];
    for (let i = first; i <= last; i++) parts.push(await this.chunk(i));
    const joined = Buffer.concat(parts);
    const offset = start - first * l.chunkSize;
    return joined.subarray(offset, offset + (end - start));
  }
}

const memoryReadAt =
  (envelope: Uint8Array): ReadAt =>
  async (position, length) =>
    envelope.subarray(position, position + length);

export function streamPlainLength(envelope: Uint8Array): number {
  return streamLayout(envelope.subarray(0, HEADER_BYTES), envelope.length).plainLength;
}

/** Decrypts a whole stream envelope held in memory. */
export function openStream(master: Uint8Array, pathId: string, envelope: Uint8Array): Buffer {
  const l = streamLayout(envelope.subarray(0, HEADER_BYTES), envelope.length);
  const key = fileKey(master, pathId);
  const full = l.chunkSize + TAG_BYTES;
  const parts: Buffer[] = [];
  for (let i = 0; i < l.count; i++) {
    const start = HEADER_BYTES + i * full;
    parts.push(gcmOpen(key, chunkNonce(l.prefix, i), envelope.subarray(start, Math.min(envelope.length, start + full)), chunkAad(l.header, i === l.count - 1)));
  }
  return Buffer.concat(parts);
}

/** Decrypts bytes [start, end) of an in-memory stream envelope. */
export async function openStreamRange(master: Uint8Array, pathId: string, envelope: Uint8Array, start: number, end: number): Promise<Buffer> {
  const reader = await StreamReader.open(master, pathId, envelope.length, memoryReadAt(envelope));
  return reader.range(start, end);
}
