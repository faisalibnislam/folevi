// The device copy of a Dropbox or Google Drive library on the Mac (mirror.ts): an ordinary library folder
// (the same layout as the cloud folder, so signing out of the provider leaves a library Folevi can keep using
// on this Mac), plus `.folevi-cloud/` with the provider index and the etag of each copied file. Writes are
// atomic (a temporary file, then rename). Node only.
import { mkdir, readFile, rename, rm, writeFile, readdir } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import type { MirrorFile, MirrorStore } from "./mirror";
import { checkPath, isValidLibraryPath } from "./types";

const META = ".folevi-cloud";

async function atomicWrite(file: string, data: Uint8Array | string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmp, data, { mode: 0o600 });
  await rename(tmp, file);
}

export class NodeMirror implements MirrorStore {
  private etags: Map<string, string> | null = null;
  private saving: Promise<void> = Promise.resolve();

  constructor(readonly root: string) {}

  private file(path: string): string {
    return join(this.root, ...checkPath(path).split("/"));
  }

  private async loadEtags(): Promise<Map<string, string>> {
    if (this.etags) return this.etags;
    try {
      const raw = JSON.parse(await readFile(join(this.root, META, "etags.json"), "utf8")) as Record<string, unknown>;
      this.etags = new Map(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === "string" && isValidLibraryPath(e[0])));
    } catch {
      this.etags = new Map();
    }
    return this.etags;
  }

  private persistEtags(): Promise<void> {
    // One write at a time, each with the latest map.
    this.saving = this.saving.then(() => atomicWrite(join(this.root, META, "etags.json"), JSON.stringify(Object.fromEntries(this.etags ?? [])))).catch(() => undefined);
    return this.saving;
  }

  async readFile(path: string): Promise<MirrorFile | null> {
    const etag = (await this.loadEtags()).get(path);
    if (!etag) return null;
    try {
      return { bytes: new Uint8Array(await readFile(this.file(path))), etag };
    } catch {
      return null;
    }
  }

  async writeFile(path: string, bytes: Uint8Array, etag: string): Promise<void> {
    const etags = await this.loadEtags();
    // The etag goes last: a crash in between leaves a file without an etag, which is simply downloaded again.
    etags.delete(path);
    await atomicWrite(this.file(path), bytes);
    etags.set(path, etag);
    await this.persistEtags();
  }

  async deleteFile(path: string): Promise<void> {
    const etags = await this.loadEtags();
    etags.delete(path);
    await rm(this.file(path), { force: true });
    await this.persistEtags();
  }

  async paths(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string) => {
      let names: import("node:fs").Dirent[];
      try {
        names = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const d of names) {
        const full = join(dir, d.name);
        if (d.isDirectory()) {
          if (d.name !== META && d.name !== ".folevi-tmp") await walk(full);
        } else if (d.isFile() && !d.name.endsWith(".tmp")) {
          const rel = relative(this.root, full).split(sep).join("/");
          if (isValidLibraryPath(rel)) out.push(rel);
        }
      }
    };
    await walk(this.root);
    return out.sort();
  }

  async loadState(): Promise<unknown> {
    try {
      return JSON.parse(await readFile(join(this.root, META, "state.json"), "utf8"));
    } catch {
      return null;
    }
  }

  async saveState(state: unknown): Promise<void> {
    await atomicWrite(join(this.root, META, "state.json"), JSON.stringify(state));
  }
}
