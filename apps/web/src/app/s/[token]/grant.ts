import "server-only";
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

/**
 * Short-lived unlock grant for password-protected share links.
 *
 * The visitor's password is never stored in a cookie as-is. After they submit it, the server seals
 * `{ link fingerprint, password, expiry }` with AES-256-GCM under a key derived from
 * FOLEVI_SERVER_SECRET. The cookie is opaque, HTTP-only, SameSite=Strict, scoped to this link's path,
 * bound to this link (it can't unlock another one) and expires after GRANT_TTL_MS — even if the
 * browser keeps the cookie. Every page load still re-checks the password in Convex, so changing or
 * removing the link's password immediately invalidates old grants.
 */

export const GRANT_COOKIE = "folevi_share_grant";
export const GRANT_TTL_MS = 30 * 60 * 1000;

const VERSION = 1;

function keyFrom(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "folevi-share-grant", "v1", 32));
}

/** A non-reversible fingerprint of the link token (the raw token never goes into the grant). */
function linkFingerprint(token: string): Buffer {
  return createHash("sha256").update(`share-link:${token}`).digest().subarray(0, 16);
}

export function sealGrant(token: string, password: string, secret: string, now = Date.now()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  cipher.setAAD(linkFingerprint(token));
  const payload = Buffer.from(JSON.stringify({ v: VERSION, exp: now + GRANT_TTL_MS, p: password }), "utf8");
  const sealed = Buffer.concat([cipher.update(payload), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString("base64url");
}

/** Returns the password inside a valid, unexpired grant for this exact link, else null. */
export function openGrant(value: string | undefined, token: string, secret: string, now = Date.now()): string | null {
  if (!value || value.length > 2048) return null;
  const raw = Buffer.from(value, "base64url");
  if (raw.length < 12 + 16 + 1) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), raw.subarray(0, 12));
    decipher.setAAD(linkFingerprint(token));
    decipher.setAuthTag(raw.subarray(12, 28));
    const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    const data = JSON.parse(plain) as { v?: unknown; exp?: unknown; p?: unknown };
    if (data.v !== VERSION || typeof data.exp !== "number" || typeof data.p !== "string") return null;
    if (data.exp <= now) return null;
    return data.p;
  } catch {
    // Tampered, from another link, or sealed with an old secret: treat as no grant.
    return null;
  }
}
