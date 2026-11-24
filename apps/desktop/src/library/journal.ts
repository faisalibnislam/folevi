// The native journal (docs/LOCAL_MODE_PLAN.md §3.6, `shell.library.journal`): every local edit is appended
// here, fsync'd, before the page calls it saved, so an edit survives the app dying before the note file is
// flushed. It lives in Application Support, never in the library (a sync provider must not see it).
//
// The file: "FLVJ" 0x01, then frames of u32 BE length ‖ u32 BE CRC-32 ‖ the record (local-store's
// encodeJournalRecord bytes, which carry their own checksum too). A torn last frame (the app died mid-append)
// fails its length or CRC: reading stops there, and the next append first cuts the file back to the last
// whole frame, so nothing after a tear is ever lost behind it.
import { constants } from "node:fs";
import { mkdir, open, rename, rm, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { LibraryError } from "./types";

const MAGIC = Buffer.from([0x46, 0x4c, 0x56, 0x4a, 0x01]); // "FLVJ" v1
const FRAME_HEADER = 8;
/** The largest record the journal takes (a note delta with a pasted image's text is well under this). */
export const MAX_RECORD = 16 * 1024 * 1024;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function frame(record: Uint8Array): Buffer {
  const h = Buffer.alloc(FRAME_HEADER);
  h.writeUInt32BE(record.length, 0);
  h.writeUInt32BE(crc32(record), 4);
  return Buffer.concat([h, Buffer.from(record.buffer, record.byteOffset, record.byteLength)]);
}

/** The whole frames in a journal file's bytes, and where the last one ends. */
export function parseJournal(bytes: Uint8Array): { records: Uint8Array[]; validLength: number; torn: boolean } {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length === 0) return { records: [], validLength: 0, torn: false };
  if (b.length < MAGIC.length || !b.subarray(0, MAGIC.length).equals(MAGIC)) return { records: [], validLength: 0, torn: true };
  const records: Uint8Array[] = [];
  let off = MAGIC.length;
  while (off < b.length) {
    if (b.length - off < FRAME_HEADER) break;
    const len = b.readUInt32BE(off);
    const crc = b.readUInt32BE(off + 4);
    if (len > MAX_RECORD || off + FRAME_HEADER + len > b.length) break;
    const rec = b.subarray(off + FRAME_HEADER, off + FRAME_HEADER + len);
    if (crc32(rec) !== crc) break;
    records.push(new Uint8Array(rec));
    off += FRAME_HEADER + len;
  }
  return { records, validLength: off, torn: off < b.length };
}

async function readAllBytes(path: string): Promise<Buffer> {
  try {
    const fh = await open(path, constants.O_RDONLY);
    try {
      return await fh.readFile();
    } finally {
      await fh.close();
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return Buffer.alloc(0);
    throw e;
  }
}

async function fsyncDir(dir: string) {
  try {
    const fh = await open(dir, constants.O_RDONLY);
    await fh.sync().finally(() => fh.close());
  } catch {
    // Best effort.
  }
}

/** local-store's `JournalStore`, on disk. One per library; operations run one at a time, in order. */
export class FileJournal {
  private queue: Promise<unknown> = Promise.resolve();
  private fh: FileHandle | null = null;
  /** Where appends go: the end of the last whole frame. */
  private end = -1;

  constructor(readonly path: string) {}

  private run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async handle(): Promise<FileHandle> {
    if (this.fh && this.end >= 0) return this.fh;
    await mkdir(dirname(this.path), { recursive: true });
    const parsed = parseJournal(await readAllBytes(this.path));
    const fh = await open(this.path, constants.O_RDWR | constants.O_CREAT, 0o600);
    if (parsed.validLength === 0) {
      await fh.truncate(0);
      await fh.write(MAGIC, 0, MAGIC.length, 0);
      await fh.sync();
      await fsyncDir(dirname(this.path));
      this.end = MAGIC.length;
    } else {
      // Cut a torn tail off before anything is appended after it.
      if (parsed.torn) {
        await fh.truncate(parsed.validLength);
        await fh.sync();
      }
      this.end = parsed.validLength;
    }
    this.fh = fh;
    return fh;
  }

  /** Appends one record and returns once it is on disk (F_FULLFSYNC). */
  append(record: Uint8Array): Promise<void> {
    if (!(record instanceof Uint8Array) || record.length > MAX_RECORD) return Promise.reject(new LibraryError("invalid_argument", "A journal record is bytes, at most 16 MB."));
    return this.run(async () => {
      const fh = await this.handle();
      const f = frame(record);
      let off = 0;
      while (off < f.length) {
        const { bytesWritten } = await fh.write(f, off, f.length - off, this.end + off);
        off += bytesWritten;
      }
      await fh.sync();
      this.end += f.length;
    });
  }

  /** Every whole record, oldest first (a torn last append is left out). */
  readAll(): Promise<Uint8Array[]> {
    return this.run(async () => parseJournal(await readAllBytes(this.path)).records);
  }

  /** Drops the first `n` records (the library files hold them now): the rest are rewritten atomically. */
  truncate(n: number): Promise<void> {
    if (!Number.isInteger(n) || n < 0) return Promise.reject(new LibraryError("invalid_argument", "truncate takes a whole number."));
    return this.run(async () => {
      if (n === 0) return;
      const { records } = parseJournal(await readAllBytes(this.path));
      const keep = records.slice(Math.min(n, records.length));
      const tmp = `${this.path}.tmp`;
      const out = await open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, 0o600);
      try {
        const body = Buffer.concat([MAGIC, ...keep.map(frame)]);
        await out.write(body, 0, body.length, 0);
        await out.sync();
      } finally {
        await out.close();
      }
      await this.fh?.close().catch(() => undefined);
      this.fh = null;
      this.end = -1;
      await rename(tmp, this.path);
      await fsyncDir(dirname(this.path));
    });
  }

  /** Removes the journal (the library was moved off this device or its local copy reset). */
  destroy(): Promise<void> {
    return this.run(async () => {
      await this.fh?.close().catch(() => undefined);
      this.fh = null;
      this.end = -1;
      await rm(this.path, { force: true });
    });
  }

  close(): Promise<void> {
    return this.run(async () => {
      await this.fh?.close().catch(() => undefined);
      this.fh = null;
      this.end = -1;
    });
  }
}
