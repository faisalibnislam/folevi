// Small shared pieces of the key code (docs/E2EE_DESIGN.md §4, §6.2): server error codes, the scope string
// inside AAD contexts and statements, wire bytes, and SecretBox, which keeps a raw key in memory only as
// ciphertext under a non-extractable key made for this tab.
import { aeadDecrypt, aeadEncrypt, importAead, randomBytes, toWireBytes, type AeadKey } from "@folevi/local-store/e2ee";
import type { WireScope } from "@folevi/editor-schema";

/** The `code` of a ConvexError (or a bridge rejection), if any. */
export function errorCode(e: unknown): string | null {
  if (!e || typeof e !== "object") return null;
  const data = (e as { data?: unknown }).data;
  if (data && typeof data === "object" && typeof (data as { code?: unknown }).code === "string") return (data as { code: string }).code;
  const code = (e as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/** An error the screens can tell apart by `code` (the same shape as the server's, `data.code`). */
export class KeysError extends Error {
  readonly data: { code: string };
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.data = { code };
  }
}

/**
 * The scope as AAD contexts and statements name it (§4.5): `personal:<profile id>` or
 * `workspace:<workspace public id>` (convex/lib/e2ee/state.ts e2eeScopeId).
 */
export function scopeString(scope: WireScope, profileId: string): string {
  return scope.kind === "personal" ? `personal:${profileId}` : `workspace:${scope.workspaceId}`;
}

export function scopeOfString(s: string): WireScope | null {
  if (s.startsWith("personal:")) return { kind: "personal" };
  if (s.startsWith("workspace:")) return { kind: "workspace", workspaceId: s.slice("workspace:".length) };
  return null;
}

export const wire = toWireBytes;

/**
 * A Uint8Array view of wire bytes. Works across realms (an ArrayBuffer from structuredClone, IPC or another
 * frame isn't `instanceof` this page's ArrayBuffer).
 */
export function bytes(b: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (ArrayBuffer.isView(b)) return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  return new Uint8Array(b);
}

/** A copy (callers zero theirs). */
export const copyBytes = (b: Uint8Array) => new Uint8Array(b);

const SECRET_AAD = new TextEncoder().encode("folevi/e2ee/v1/secret-box");

/**
 * A raw key kept in memory as AES-GCM ciphertext under a random non-extractable key, so its bytes exist in
 * the clear only inside `use` (and are zeroed after). JavaScript can't promise more (§4.2, §13 R10).
 */
export class SecretBox {
  private constructor(
    private key: AeadKey | null,
    private nonce: Uint8Array,
    private sealed: Uint8Array | null,
    readonly length: number,
  ) {}

  /** Takes the bytes and zeroes the caller's array. */
  static async hold(raw: Uint8Array): Promise<SecretBox> {
    const key = await importAead(randomBytes(32));
    const nonce = randomBytes(12);
    try {
      return new SecretBox(key, nonce, await aeadEncrypt(key, nonce, raw, SECRET_AAD), raw.length);
    } finally {
      raw.fill(0);
    }
  }

  /** Runs `fn` with a fresh copy of the bytes, zeroed when it settles. */
  async use<T>(fn: (raw: Uint8Array) => Promise<T> | T): Promise<T> {
    if (!this.key || !this.sealed) throw new KeysError("e2ee_locked_session", "Your encrypted notes are locked.");
    const raw = await aeadDecrypt(this.key, this.nonce, this.sealed, SECRET_AAD);
    try {
      return await fn(raw);
    } finally {
      raw.fill(0);
    }
  }

  clear(): void {
    this.sealed?.fill(0);
    if (this.key instanceof Uint8Array) this.key.fill(0);
    this.key = null;
    this.sealed = null;
  }
}

/** "Chrome on Mac", for Settings > Devices and the approval dialog (§10.6). */
export function browserLabel(ua: string = typeof navigator !== "undefined" ? navigator.userAgent : ""): string {
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "A browser";
  const system = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X|Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux|CrOS/.test(ua)
              ? "Linux"
              : "";
  return system ? `${browser} on ${system}` : browser;
}

/** An ever-growing list of listeners. */
export class Emitter {
  private listeners = new Set<() => void>();
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };
  emit(): void {
    for (const l of [...this.listeners]) {
      try {
        l();
      } catch {
        /* One listener failing doesn't stop the rest. */
      }
    }
  }
}
