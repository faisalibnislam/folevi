import { secretOrDevFallback, toHex } from "./crypto";

const enc = new TextEncoder();

export async function signFileUrl(value: string): Promise<string> {
  const secret = secretOrDevFallback(["FOLEVI_FILE_URL_SECRET", "FOLEVI_HASH_SALT"], "folevi-development-file-secret");
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(value))).slice(0, 40);
}

/** No link we sign lasts longer than this (identity images: 8 days, rounded to the day). */
const MAX_LINK_LIFETIME_MS = 9 * 86_400_000;

export async function verifyFileSignature(fileId: string, exp: number, sig: string, now = Date.now()): Promise<boolean> {
  // Expired, or further out than any link we hand out (e.g. one minted from a client's far-future clock).
  if (!Number.isFinite(exp) || exp < now || exp > now + MAX_LINK_LIFETIME_MS) return false;
  const expected = await signFileUrl(`${fileId}:${exp}`);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
