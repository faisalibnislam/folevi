// The unwrapped library key, cached on this Mac so the passphrase is asked for once (docs/LOCAL_MODE_PLAN.md
// §3.9 "Unlocking"): sealed with Electron's safeStorage (the login Keychain's "Folevi Safe Storage" key) in
// Application Support, never in the library and never sent to the page. Without safeStorage (it can be
// unavailable before the login keychain is unlocked) the key stays in memory only.
import { mkdirSync, readFileSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

/** Electron's safeStorage, or a stand-in in tests. */
export interface StringSealer {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(sealed: Buffer): string;
}

export class KeyCache {
  private memory = new Map<string, Buffer>();

  constructor(
    private readonly dir: string,
    private readonly sealer: StringSealer | null,
  ) {}

  private file(libraryId: string) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(libraryId)) throw new Error("Bad library id.");
    return join(this.dir, `${libraryId}.key`);
  }

  get(libraryId: string): Buffer | null {
    const m = this.memory.get(libraryId);
    if (m) return m;
    if (!this.sealer?.isEncryptionAvailable()) return null;
    try {
      const key = Buffer.from(this.sealer.decryptString(readFileSync(this.file(libraryId))), "base64");
      if (key.length !== 32) return null;
      this.memory.set(libraryId, key);
      return key;
    } catch {
      return null;
    }
  }

  set(libraryId: string, key: Uint8Array) {
    const k = Buffer.from(key);
    this.memory.set(libraryId, k);
    if (!this.sealer?.isEncryptionAvailable()) return;
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const f = this.file(libraryId);
      writeFileSync(`${f}.tmp`, this.sealer.encryptString(k.toString("base64")), { mode: 0o600 });
      renameSync(`${f}.tmp`, f);
    } catch {
      // Memory only this time.
    }
  }

  clear(libraryId: string) {
    this.memory.delete(libraryId);
    rmSync(this.file(libraryId), { force: true });
  }

  /** Forgets keys held in memory (locking again needs the passphrase only if nothing is cached on disk). */
  forgetMemory() {
    this.memory.clear();
  }
}
