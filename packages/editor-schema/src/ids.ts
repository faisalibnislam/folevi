// Crockford base32 ULIDs. Works in browsers, Node, the Convex runtime and matches Swift `ULID`.
import type { WireScope } from "./types";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function ulid(now: number = Date.now()): string {
  let time = "";
  let t = Math.floor(now);
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(16);
  let rand = "";
  for (let i = 0; i < 16; i++) rand += ALPHABET[(bytes[i] ?? 0) % 32];
  return time + rand;
}

/** Ids are ULIDs for new content; legacy/imported ids may be any url-safe string up to 64 chars. */
export function isValidId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

/** FNV-1a (64-bit): deterministic, non-cryptographic; used only to derive stable ids. */
function fnv1a64(input: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i));
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

/** The key `dailyDocumentId` / `inboxDocumentId` use for a person's own Personal. */
export const PERSONAL_SCOPE_KEY = "personal";

/** The key of a scope for deterministic ids: "personal", or the team workspace's public id. */
export function scopeIdKey(scope: WireScope): string {
  return scope.kind === "personal" ? PERSONAL_SCOPE_KEY : scope.workspaceId;
}

/**
 * The id of a person's Daily Note for a date in a scope (`scopeIdKey`). Deterministic so every device
 * (even offline) creates or opens the same document instead of racing to create duplicates.
 */
export function dailyDocumentId(profileId: string, scopeKey: string, date: string): string {
  return `daily-${date}-${fnv1a64(`${profileId}:${scopeKey}`)}`;
}

/**
 * The person's Inbox page in a scope (`scopeIdKey`), where Quick Add puts tasks. Deterministic for the
 * same reason as daily ids: two offline devices adding a task create the same page instead of two Inboxes.
 */
export function inboxDocumentId(profileId: string, scopeKey: string): string {
  return `inbox-${fnv1a64(`${profileId}:${scopeKey}`)}`;
}
