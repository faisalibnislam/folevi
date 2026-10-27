// Making passwords on the device (docs/VAULT_PLAN.md §4): random characters, or a memorable passphrase of
// pronounceable words, both from crypto.getRandomValues with no bias. And how strong a password is.

const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!#$%&*+-=?@^_~";
const CONSONANTS = "bdfghjklmnprstvz";
const VOWELS = "aeiou";

/** A uniform random index below `n` (rejection sampling, so no character is likelier than another). */
function randomBelow(n: number): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < limit) return buf[0]! % n;
  }
}

const pick = (s: string) => s[randomBelow(s.length)]!;

export interface PasswordOptions {
  length: number;
  digits: boolean;
  symbols: boolean;
}

/** Random characters (look-alikes such as l, 1, O and 0 left out), with at least one of each kind asked for. */
export function randomPassword(o: PasswordOptions = { length: 20, digits: true, symbols: true }): string {
  const length = Math.min(128, Math.max(8, Math.round(o.length)));
  const pools = [LOWER, UPPER, ...(o.digits ? [DIGITS] : []), ...(o.symbols ? [SYMBOLS] : [])];
  const all = pools.join("");
  for (;;) {
    const chars = Array.from({ length }, () => pick(all));
    if (pools.every((pool) => chars.some((c) => pool.includes(c)))) return chars.join("");
  }
}

/** One pronounceable word: consonant-vowel syllables (about 6.3 bits each). */
function word(syllables: number): string {
  let w = "";
  for (let i = 0; i < syllables; i++) w += pick(CONSONANTS) + pick(VOWELS);
  return w;
}

/**
 * A memorable passphrase: `words` pronounceable three-syllable words joined by hyphens, one capitalised and a digit
 * added (about 19 bits a word: 5 words give about 100 bits).
 */
export function passphrase(words = 5): string {
  const n = Math.min(10, Math.max(3, Math.round(words)));
  const list = Array.from({ length: n }, () => word(3));
  const cap = randomBelow(n);
  list[cap] = list[cap]![0]!.toUpperCase() + list[cap]!.slice(1);
  return `${list.join("-")}${pick(DIGITS)}`;
}

export type Strength = 0 | 1 | 2 | 3 | 4;

/**
 * How strong a password is, 0 (very weak) to 4 (strong): its length and character variety as entropy, less for
 * repeats, sequences and common words, with a label.
 */
export function passwordStrength(password: string): { score: Strength; label: string; bits: number } {
  if (!password) return { score: 0, label: "Empty", bits: 0 };
  let pool = 0;
  if (/[a-z]/.test(password)) pool += 26;
  if (/[A-Z]/.test(password)) pool += 26;
  if (/\d/.test(password)) pool += 10;
  if (/[^a-zA-Z\d]/.test(password)) pool += 32;
  let bits = password.length * Math.log2(Math.max(pool, 2));
  if (/(.)\1{2,}/.test(password)) bits *= 0.7;
  if (/(?:abc|bcd|cde|123|234|345|456|567|678|789|qwe|wer|asd|zxc)/i.test(password)) bits *= 0.8;
  if (/password|passw0rd|letmein|welcome|qwerty|admin|iloveyou|monkey|dragon|sunshine/i.test(password)) bits = Math.min(bits, 20);
  const score: Strength = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return { score, label: ["Very weak", "Weak", "Fair", "Good", "Strong"][score]!, bits: Math.round(bits) };
}
