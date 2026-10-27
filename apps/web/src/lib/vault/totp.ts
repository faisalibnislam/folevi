// 2FA codes (TOTP, RFC 6238) worked out on the device from a secret stored in a Vault item. Accepts a bare base32
// secret or an otpauth:// URI (its algorithm, digits and period).

export interface TotpParams {
  secret: Uint8Array;
  algorithm: "SHA-1" | "SHA-256" | "SHA-512";
  digits: number;
  period: number;
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(text: string): Uint8Array | null {
  const clean = text.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (!clean || /[^A-Z2-7]/.test(clean)) return null;
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    value = (value << 5) | BASE32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** The code settings from what someone pasted (an otpauth:// link or a secret), or null if it isn't one. */
export function parseTotp(input: string): TotpParams | null {
  const text = input.trim();
  if (/^otpauth:\/\/totp\//i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    const secret = base32Decode(url.searchParams.get("secret") ?? "");
    if (!secret) return null;
    const alg = (url.searchParams.get("algorithm") ?? "SHA1").toUpperCase().replace("SHA", "SHA-");
    const digits = Number(url.searchParams.get("digits") ?? 6);
    const period = Number(url.searchParams.get("period") ?? 30);
    if (!["SHA-1", "SHA-256", "SHA-512"].includes(alg) || ![6, 7, 8].includes(digits) || !(period >= 10 && period <= 120)) return null;
    return { secret, algorithm: alg as TotpParams["algorithm"], digits, period };
  }
  const secret = base32Decode(text);
  return secret && secret.length >= 10 ? { secret, algorithm: "SHA-1", digits: 6, period: 30 } : null;
}

/** The code at `now` (ms), and the seconds it has left. */
export async function totpCode(p: TotpParams, now = Date.now()): Promise<{ code: string; secondsLeft: number }> {
  const counter = Math.floor(now / 1000 / p.period);
  const msg = new ArrayBuffer(8);
  const view = new DataView(msg);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);
  const key = await crypto.subtle.importKey("raw", p.secret.slice(), { name: "HMAC", hash: p.algorithm }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  const code = String(bin % 10 ** p.digits).padStart(p.digits, "0");
  return { code, secondsLeft: p.period - (Math.floor(now / 1000) % p.period) };
}
