// Dropbox and Google tokens on the Mac: one file in the app's support folder, encrypted with Electron's
// safeStorage (a key in the login Keychain), written atomically and readable by this user only. Nothing is ever
// stored in plain text: without safeStorage, connecting is refused. Node only (the iOS app uses the Keychain).
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TokenSet, TokenStore } from "./shared/oauth";
import type { CloudProvider } from "./shared/types";

/** The part of Electron's safeStorage used here (a fake in tests). */
export interface Cipher {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export class TokenStorageUnavailable extends Error {
  override name = "TokenStorageUnavailable";
  constructor() {
    super("This Mac can't keep the sign-in safe right now (the Keychain isn't available), so Folevi won't store it.");
  }
}

type Stored = Partial<Record<CloudProvider, TokenSet>>;

function valid(t: unknown): t is TokenSet {
  const v = t as TokenSet | null;
  return !!v && typeof v.accessToken === "string" && typeof v.refreshToken === "string" && typeof v.expiresAt === "number";
}

export class SafeStorageTokenStore implements TokenStore {
  constructor(
    private readonly file: string,
    private readonly cipher: Cipher,
  ) {}

  private readAll(): Stored {
    let raw: Buffer;
    try {
      raw = readFileSync(this.file);
    } catch {
      return {};
    }
    if (!this.cipher.isEncryptionAvailable()) return {};
    try {
      const parsed = JSON.parse(this.cipher.decryptString(raw)) as Record<string, unknown>;
      const out: Stored = {};
      for (const p of ["dropbox", "googleDrive"] as const) if (valid(parsed[p])) out[p] = parsed[p];
      return out;
    } catch {
      // Unreadable (another Mac's Keychain, a damaged file): as good as signed out.
      return {};
    }
  }

  private writeAll(all: Stored): void {
    if (!Object.keys(all).length) {
      rmSync(this.file, { force: true });
      return;
    }
    if (!this.cipher.isEncryptionAvailable()) throw new TokenStorageUnavailable();
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, this.cipher.encryptString(JSON.stringify(all)), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  async load(provider: CloudProvider): Promise<TokenSet | null> {
    return this.readAll()[provider] ?? null;
  }

  async save(provider: CloudProvider, tokens: TokenSet): Promise<void> {
    this.writeAll({ ...this.readAll(), [provider]: tokens });
  }

  async clear(provider: CloudProvider): Promise<void> {
    const all = this.readAll();
    delete all[provider];
    this.writeAll(all);
  }
}
