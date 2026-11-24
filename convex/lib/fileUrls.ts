import { secretOrDevFallback, toHex } from "./crypto";

const enc = new TextEncoder();

/**
 * Where signed file links point: this deployment's HTTP actions. Folevi Server runs its backend on a loopback
 * address behind a one-origin proxy (docs/SELF_HOSTING_PLAN.md §5.8), so it sets FOLEVI_PUBLIC_SITE_URL to the
 * address browsers use (`<server address>/convex-site`). Folevi Cloud leaves it unset.
 */
export function publicSiteUrl(): string {
  return process.env.FOLEVI_PUBLIC_SITE_URL || process.env.CONVEX_SITE_URL || "";
}

export async function signFileUrl(value: string): Promise<string> {
  const secret = secretOrDevFallback(["FOLEVI_FILE_URL_SECRET", "FOLEVI_HASH_SALT"], "folevi-development-file-secret");
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(value))).slice(0, 40);
}

/**
 * An upload address from ctx.storage.generateUploadUrl() as the browser should use it. Folevi Server's backend
 * runs on a loopback address, so it sets FOLEVI_PUBLIC_CONVEX_URL to the path its proxy serves Convex on
 * ("/convex"); the page then uploads to its own origin, whichever address it was opened on.
 */
export function publicUploadUrl(url: string): string {
  const pub = process.env.FOLEVI_PUBLIC_CONVEX_URL;
  const cloud = process.env.CONVEX_CLOUD_URL;
  if (!pub || !cloud || !url.startsWith(cloud)) return url;
  return `${pub.replace(/\/$/, "")}${url.slice(cloud.length)}`;
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
