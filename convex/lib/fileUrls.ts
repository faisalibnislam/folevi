import { toHex } from "./crypto";

const enc = new TextEncoder();

export async function signFileUrl(value: string): Promise<string> {
  const secret = process.env.FOLEVI_FILE_URL_SECRET ?? process.env.FOLEVI_HASH_SALT ?? "folevi-development-file-secret";
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(value))).slice(0, 40);
}

export async function verifyFileSignature(fileId: string, exp: number, sig: string, now = Date.now()): Promise<boolean> {
  if (!Number.isFinite(exp) || exp < now) return false;
  const expected = await signFileUrl(`${fileId}:${exp}`);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
