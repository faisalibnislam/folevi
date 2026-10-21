// The recovery key (docs/E2EE_DESIGN.md §4.7.1): 20 random bytes plus a 20-bit check value (the first 20 bits
// of SHA-256(utf8("folevi/e2ee/v1/recovery-key") ‖ bytes)), 180 bits written as 36 Crockford base32
// characters in 9 groups of 4, uppercase. On input `O` reads as `0`, `I` and `L` as `1`; spaces, dashes and
// case are ignored.
import { E2eeError, constantTimeEqual, randomBytes, sha256Concat } from "./primitives";

export const RECOVERY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const RECOVERY_KEY_BYTES = 20;
const CHARS = 36;

function checkValue(bytes: Uint8Array): Uint8Array {
  const h = sha256Concat("folevi/e2ee/v1/recovery-key", bytes);
  // First 20 bits, as 3 bytes with the low 4 bits of the last one cleared.
  return new Uint8Array([h[0]!, h[1]!, h[2]! & 0xf0]);
}

/** The display text for 20 recovery key bytes: "7KQ2-M9XD-…-R4TA". */
export function formatRecoveryKey(bytes: Uint8Array): string {
  if (bytes.length !== RECOVERY_KEY_BYTES) throw new E2eeError("A recovery key is 20 bytes.");
  const all = new Uint8Array(23);
  all.set(bytes);
  all.set(checkValue(bytes), 20);
  let out = "";
  for (let i = 0; i < CHARS; i++) {
    let v = 0;
    for (let b = 0; b < 5; b++) {
      const bit = i * 5 + b;
      v = (v << 1) | ((all[bit >> 3]! >> (7 - (bit & 7))) & 1);
    }
    out += RECOVERY_ALPHABET[v];
    if (i % 4 === 3 && i !== CHARS - 1) out += "-";
  }
  all.fill(0);
  return out;
}

export function newRecoveryKey(): { bytes: Uint8Array; text: string } {
  const bytes = randomBytes(RECOVERY_KEY_BYTES);
  return { bytes, text: formatRecoveryKey(bytes) };
}

/** The 20 key bytes, or null when the text isn't a recovery key or its check value is wrong. */
export function parseRecoveryKey(text: string): Uint8Array | null {
  if (typeof text !== "string") return null;
  const clean = text
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (clean.length !== CHARS) return null;
  const all = new Uint8Array(23);
  for (let i = 0; i < CHARS; i++) {
    const v = RECOVERY_ALPHABET.indexOf(clean[i]!);
    if (v < 0) return null;
    for (let b = 0; b < 5; b++) {
      const bit = i * 5 + b;
      if ((v >> (4 - b)) & 1) all[bit >> 3]! |= 1 << (7 - (bit & 7));
    }
  }
  const bytes = all.slice(0, 20);
  const ok = constantTimeEqual(all.subarray(20, 23), checkValue(bytes));
  all.fill(0);
  if (!ok) {
    bytes.fill(0);
    return null;
  }
  return bytes;
}

/** Groups (1-based) the setup wizard asks back before the key counts (§4.7.1 asks for 3 and 7). */
export function recoveryKeyGroup(text: string, group: number): string {
  const parts = text.split("-");
  const g = parts[group - 1];
  if (parts.length !== 9 || !g) throw new E2eeError("Not a formatted recovery key.");
  return g;
}
