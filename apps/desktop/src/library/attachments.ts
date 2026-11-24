// A library's attachments for app://folevi/_files/<sha256> (protocol.ts's LibraryFiles): `files/<aa>/<sha256>`,
// or in an encrypted library the HMAC name with STREAM chunks decrypted as they're read, so audio and video
// seek by Range without decrypting the whole file. Attachments are written once, so they're read directly
// (no coordination needed); a placeholder in iCloud Drive is asked for and waited on a little.
import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { HEADER_BYTES, hmacName, StreamReader } from "./crypto";
import { FILES_DIR } from "./paths";

export interface LibraryFileInfo {
  size: number;
  mime: string | null;
}

/** protocol.ts's `LibraryFiles` (bytes `start` to `end`, both inclusive). */
export interface LibraryFiles {
  stat(sha256: string): Promise<LibraryFileInfo | null>;
  read(sha256: string, start: number, end: number): Promise<Uint8Array | ReadableStream<Uint8Array>>;
}

export interface AttachmentSource {
  /** The library folder, or null when there's none (every request is a 404). */
  root(): string | null;
  /** The key when the library is encrypted and unlocked; "locked" when encrypted without it; null when plain. */
  key(): Uint8Array | "locked" | null;
  /** Asks a provider for a file that isn't here yet (folevi-files' startDownload). */
  startDownload?(absPaths: string[]): Promise<void>;
  /** Whether a file's contents are on this Mac (folevi-files' status); assumed when absent. */
  downloaded?(absPath: string): Promise<boolean>;
  /** How long to wait for a download (ms). */
  downloadWaitMs?: number;
  /** A library with no folder (Dropbox, Google Drive): a file's stored bytes by its on-disk path, or null. */
  readWhole?(relPath: string): Promise<Uint8Array | null>;
}

const SHA = /^[0-9a-f]{64}$/;
/** Plain files are streamed in pieces this big; encrypted ones a chunk (64 KiB) at a time. */
const PLAIN_PIECE = 256 * 1024;

export class LibraryAttachments implements LibraryFiles {
  constructor(private readonly src: AttachmentSource) {}

  private location(sha: string): { abs: string; pathId: string; key: Uint8Array | null } | null {
    const root = this.src.root();
    if (!root || !SHA.test(sha)) return null;
    const key = this.src.key();
    if (key === "locked") return null;
    const name = key ? hmacName(key, "file", sha) : sha;
    const rel = `${FILES_DIR}/${name.slice(0, 2)}/${name}`;
    return { abs: join(root, FILES_DIR, name.slice(0, 2), name), pathId: rel, key };
  }

  private async present(abs: string): Promise<{ size: number } | null> {
    const wait = this.src.downloadWaitMs ?? 15_000;
    const started = Date.now();
    let asked = false;
    for (;;) {
      let size: number | null = null;
      try {
        const s = await stat(abs);
        if (s.isFile()) size = s.size;
      } catch {
        size = null;
      }
      const placeholder = await stat(join(abs, "..", `.${abs.slice(abs.lastIndexOf("/") + 1)}.icloud`)).then(
        () => true,
        () => false,
      );
      if (size !== null && !placeholder && (!this.src.downloaded || (await this.src.downloaded(abs)))) return { size };
      if (size === null && !placeholder) return null;
      if (!asked) {
        asked = true;
        await this.src.startDownload?.([abs]).catch(() => undefined);
      }
      if (Date.now() - started >= wait) return null;
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  /** A library without a folder (Dropbox, Google Drive): the stored bytes through the provider, decrypted by range. */
  private async whole(sha: string): Promise<{ size: number; range(start: number, end: number): Promise<Uint8Array> } | null> {
    if (this.src.root() || !this.src.readWhole || !SHA.test(sha)) return null;
    const key = this.src.key();
    if (key === "locked") return null;
    const name = key ? hmacName(key, "file", sha) : sha;
    const rel = `${FILES_DIR}/${name.slice(0, 2)}/${name}`;
    const bytes = await this.src.readWhole(rel).catch(() => null);
    if (!bytes) return null;
    if (!key) return { size: bytes.length, range: async (a, b) => bytes.subarray(a, b) };
    try {
      const r = await StreamReader.open(key, rel, bytes.length, async (p, n) => bytes.subarray(p, p + n));
      await r.checkFinal();
      return { size: r.layout.plainLength, range: (a, b) => r.range(a, b) };
    } catch {
      return null;
    }
  }

  async stat(sha: string): Promise<LibraryFileInfo | null> {
    const w = await this.whole(sha);
    if (w) return { size: w.size, mime: null };
    const loc = this.location(sha);
    if (!loc) return null;
    const here = await this.present(loc.abs);
    if (!here) return null;
    if (!loc.key) return { size: here.size, mime: null };
    try {
      const reader = await this.reader(loc.abs, loc.key, loc.pathId, here.size);
      await reader.close();
      return { size: reader.r.layout.plainLength, mime: null };
    } catch {
      return null;
    }
  }

  private async reader(abs: string, key: Uint8Array, pathId: string, size: number) {
    const fh = await open(abs, constants.O_RDONLY | constants.O_NOFOLLOW);
    const readAt = async (position: number, length: number) => {
      const b = Buffer.alloc(length);
      let got = 0;
      while (got < length) {
        const { bytesRead } = await fh.read(b, got, length - got, position + got);
        if (bytesRead === 0) break;
        got += bytesRead;
      }
      return b.subarray(0, got);
    };
    try {
      if (size < HEADER_BYTES) throw new Error("Too short.");
      const r = await StreamReader.open(key, pathId, size, readAt);
      await r.checkFinal();
      return { r, close: () => fh.close() };
    } catch (e) {
      await fh.close();
      throw e;
    }
  }

  async read(sha: string, start: number, end: number): Promise<ReadableStream<Uint8Array>> {
    const w = await this.whole(sha);
    if (w) {
      const part = await w.range(start, end + 1);
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(part));
          controller.close();
        },
      });
    }
    const loc = this.location(sha);
    if (!loc) throw new Error("No such file.");
    const here = await this.present(loc.abs);
    if (!here) throw new Error("No such file.");
    if (!loc.key) {
      const node = Readable.from(
        (async function* () {
          const fh = await open(loc.abs, constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            let pos = start;
            while (pos <= end) {
              const n = Math.min(PLAIN_PIECE, end - pos + 1);
              const b = Buffer.alloc(n);
              const { bytesRead } = await fh.read(b, 0, n, pos);
              if (bytesRead === 0) break;
              yield new Uint8Array(b.buffer, b.byteOffset, bytesRead);
              pos += bytesRead;
            }
          } finally {
            await fh.close();
          }
        })(),
      );
      return Readable.toWeb(node) as unknown as ReadableStream<Uint8Array>;
    }
    const { r, close } = await this.reader(loc.abs, loc.key, loc.pathId, here.size);
    const chunkSize = r.layout.chunkSize;
    let pos = start;
    const last = end + 1;
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (pos >= last) {
            await close();
            controller.close();
            return;
          }
          const upTo = Math.min(last, (Math.floor(pos / chunkSize) + 1) * chunkSize);
          const part = await r.range(pos, upTo);
          pos = upTo;
          controller.enqueue(new Uint8Array(part.buffer, part.byteOffset, part.byteLength));
        } catch (e) {
          await close().catch(() => undefined);
          controller.error(e);
        }
      },
      async cancel() {
        await close().catch(() => undefined);
      },
    });
  }
}
