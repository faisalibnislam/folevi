// Secrets the Mac app keeps for the built-in interface (docs/LOCAL_MODE_PLAN.md §1, §4.2): the account's
// bearer session (authBridge.ts) and, later, the person's own Foli AI keys. Each is encrypted with Electron's
// safeStorage (a key macOS keeps in the Keychain for this app) and written to its own file in the app's
// support folder. Nothing here is ever handed to a page: the page may only ask whether a key is set.
//
// The cipher is passed in (Electron's safeStorage in main.ts), so this file loads without Electron in tests.
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** What Electron's safeStorage offers. */
export interface Cipher {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** Every secret the app keeps, by name. The page's own (write-only) ones are the `ai.` keys. */
export const SECRET_NAMES = ["auth.session", "ai.openai", "ai.anthropic", "ai.google"] as const;
/** Each account's own session (several places, docs/MULTI_ACCOUNT_PLAN.md §2.2): `auth.session.<user id>`. */
export type AccountSessionName = `auth.session.${string}`;
export type SecretName = (typeof SECRET_NAMES)[number] | AccountSessionName;

const ACCOUNT_SESSION = /^auth\.session\.[A-Za-z0-9_-]{1,64}$/;

export function isSecretName(v: unknown): v is SecretName {
  return typeof v === "string" && ((SECRET_NAMES as readonly string[]).includes(v) || ACCOUNT_SESSION.test(v));
}

/** The secret an account's session is kept under. */
export function accountSessionName(userId: string): AccountSessionName {
  return `auth.session.${userId}`;
}

export interface SecretStore {
  get(name: SecretName): string | null;
  has(name: SecretName): boolean;
  /** Throws when this Mac can't encrypt (nothing is ever written in the clear). */
  set(name: SecretName, value: string): void;
  delete(name: SecretName): void;
}

const MAX_SECRET = 16 * 1024;

export function createSecretStore(dir: string, cipher: Cipher): SecretStore {
  const file = (name: SecretName) => {
    if (!isSecretName(name)) throw new Error("Unknown secret.");
    return join(dir, `${name}.bin`);
  };
  const get = (name: SecretName): string | null => {
    let bytes: Buffer;
    try {
      bytes = readFileSync(file(name));
    } catch {
      return null;
    }
    try {
      if (!cipher.isEncryptionAvailable()) return null;
      return cipher.decryptString(bytes);
    } catch {
      // Unreadable (another Mac's key, a damaged file): as good as absent.
      return null;
    }
  };
  return {
    get,
    has: (name) => get(name) !== null,
    set(name, value) {
      if (typeof value !== "string" || !value || value.length > MAX_SECRET) throw new Error("Not a secret Folevi can keep.");
      if (!cipher.isEncryptionAvailable()) throw new Error("This Mac can't encrypt Folevi's secrets right now.");
      const target = file(name);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tmp, cipher.encryptString(value), { mode: 0o600 });
      renameSync(tmp, target);
      try {
        chmodSync(target, 0o600);
      } catch {
        /* Best effort: the folder is the app's own. */
      }
    },
    delete(name) {
      rmSync(file(name), { force: true });
    },
  };
}
