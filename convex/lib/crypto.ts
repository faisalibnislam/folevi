// Web Crypto helpers available in the Convex V8 runtime.
const enc = new TextEncoder();

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += b.toString(16).padStart(2, "0");
  return s;
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(value)));
}

/** base64url SHA-256 without padding: how bearer tokens are stored (OAuth access tokens, API tokens). */
export async function sha256Base64url(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value)));
  let bin = "";
  for (const b of digest) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * A secret from the environment, or a fixed stand-in on development and test deployments. Production never
 * falls back: a known stand-in would let anyone forge signed links or reverse keyed hashes. (The deploy check,
 * scripts/check-prod-env.mjs, also refuses to ship without them.)
 */
export function secretOrDevFallback(names: string[], fallback: string): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  if (process.env.FOLEVI_ENV === "production") throw new Error(`${names[0]} is not set`);
  return fallback;
}

/** Keyed hash for identifiers that must be correlatable but not reversible (emails, IPs, user agents). */
export async function keyedHash(value: string, purpose: string): Promise<string> {
  const secret = secretOrDevFallback(["FOLEVI_HASH_SALT"], "folevi-development-salt");
  const key = await crypto.subtle.importKey("raw", enc.encode(`${secret}:${purpose}`), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(value))).slice(0, 32);
}

async function sealingKey(purpose: string): Promise<CryptoKey> {
  const secret = secretOrDevFallback(["FOLEVI_HASH_SALT"], "folevi-development-salt");
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`${secret}:seal:${purpose}`));
  return await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

const toB64 = (bytes: Uint8Array) => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

/**
 * A secret Folevi must use again later (a webhook's signing secret), encrypted at rest with AES-GCM under
 * a key derived from the server's own secret: the database alone never holds it in the clear.
 */
export async function sealSecret(plain: string, purpose: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await sealingKey(purpose), enc.encode(plain)));
  return `v1.${toB64(iv)}.${toB64(sealed)}`;
}

export async function openSecret(sealed: string, purpose: string): Promise<string> {
  const [version, iv, data] = sealed.split(".");
  if (version !== "v1" || !iv || !data) throw new Error("Unknown sealed secret format");
  const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(iv) }, await sealingKey(purpose), bytes(data));
  return new TextDecoder().decode(plain);
}

/** URL-safe random token with `bytes` of entropy. */
export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PBKDF2-SHA256 for optional share-link passwords (account passwords are handled by the identity provider). */
export async function hashSharePassword(password: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltHex ?? toHex(crypto.getRandomValues(new Uint8Array(16)));
  const saltBytes = new Uint8Array(salt.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: 210_000 }, key, 256);
  return { hash: toHex(bits), salt };
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function redactEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const [host = "", ...tld] = domain.split(".");
  return `${local.slice(0, 1)}***@${host.slice(0, 1)}***.${tld.join(".") || "?"}`;
}
