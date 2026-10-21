// The encryption passphrase (docs/E2EE_DESIGN.md §4.7.3): at least 12 characters, not a common password,
// NFC normalized; stretched with Argon2id on the device (never on the server) into the key that wraps the
// account master key.
//
// The common-password check: the plan names "the 10,000 most common passwords". Only the ones of 12 or more
// characters matter (shorter ones are refused anyway), so the app ships those (COMMON_LONG) plus the
// patterns that make up most of the rest of such lists at this length: one character or a short run
// repeated, keyboard rows, counting, and a common word padded with digits or symbols.
import {
  ARGON2ID_DEFAULTS,
  newPassphraseKdf,
  openRecord,
  passphraseWrapKey,
  randomBytes,
  sealRecord,
  type Argon2idParams,
  type PassphraseKdf,
} from "@folevi/local-store/e2ee";

export const MIN_PASSPHRASE = 12;

export type PassphraseProblem = "short" | "common";

const COMMON_LONG = new Set(
  [
    "123456789012", "1234567890123", "12345678901234", "123456789123", "1234567891011", "123123123123",
    "123412341234", "111111111111", "000000000000", "121212121212", "112233445566", "123456654321",
    "qwertyuiopas", "qwertyuiop12", "qwertyuiop123", "qwerty123456", "qwertyqwerty", "1qaz2wsx3edc",
    "1q2w3e4r5t6y", "q1w2e3r4t5y6", "zaq12wsxcde3", "asdfghjkl123", "zxcvbnm12345", "abcdefghijkl",
    "abc123abc123", "abcd1234abcd", "password1234", "password12345", "password123456", "passwordpassword",
    "password1!", "password123!", "mypassword123", "password2024", "password2025", "password2026",
    "iloveyou1234", "iloveyouforever", "iloveyoubaby", "iloveyou123456", "letmein12345", "welcome12345",
    "welcome123456", "welcometothejungle", "changeme1234", "administrator", "administrator1",
    "adminadmin123", "trustno1trustno1", "sunshine1234", "princess1234", "football1234", "baseball1234",
    "basketball12", "basketball123", "superman1234", "batman123456", "starwars1234", "pokemon12345",
    "michael12345", "jennifer1234", "christopher", "christopher1", "elizabeth123", "alexander123",
    "manchesterunited", "liverpool1234", "chelsea12345", "arsenal12345", "barcelona123", "realmadrid123",
    "monkey123456", "dragon123456", "master123456", "shadow123456", "freedom12345", "whatever1234",
    "computer1234", "internet1234", "samsung12345", "google123456", "facebook1234", "instagram123",
    "linkedin1234", "microsoft123", "apple1234567", "iphone123456", "dropbox12345", "folevi123456",
    "foleviapp123", "thequickbrownfox", "correcthorsebatterystaple", "letmeinletmein", "nopassword123",
    "secret123456", "mysecret1234", "qazwsxedcrfv", "qazwsxedc123", "1234qwerasdf", "asdf1234asdf",
    "1q2w3e4r5t6y7u", "aaaaaaaaaaaa", "abcabcabcabc", "loveyou12345", "lovelovelove", "happy1234567",
    "summer123456", "winter123456", "spring123456", "autumn123456", "january12345", "december1234",
    "september123", "november1234", "october12345", "hello1234567", "helloworld123", "helloworld12",
    "testtesttest", "test12345678", "testing12345", "qwerty1234567", "qwertyuiopasdfghjkl", "zxcvbnmasdfghjkl",
  ].map((p) => p.toLowerCase()),
);

const WORDS = ["password", "passw0rd", "p@ssw0rd", "qwerty", "letmein", "iloveyou", "welcome", "admin", "monkey", "dragon", "folevi", "secret", "login", "abc", "test"];
const ROWS = ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm", "abcdefghijklmnopqrstuvwxyz", "0987654321", "poiuytrewq", "lkjhgfdsa", "mnbvcxz", "zyxwvutsrqponmlkjihgfedcba"];

/** Whether the text is one short piece (up to 4 characters) repeated. */
function repeated(p: string): boolean {
  for (let n = 1; n <= 4; n++) {
    const unit = p.slice(0, n);
    if (unit.repeat(Math.ceil(p.length / n)).slice(0, p.length) === p) return true;
  }
  return false;
}

/** Whether it's a run along a keyboard row or the alphabet (or digits), at least 8 long, plus a few extra characters. */
function rowRun(p: string): boolean {
  for (const row of ROWS) {
    for (let len = row.length; len >= 8; len--) {
      for (let i = 0; i + len <= row.length; i++) {
        const run = row.slice(i, i + len);
        if (p.includes(run) && p.length - len <= 4) return true;
      }
    }
  }
  return false;
}

/** A common word padded only with digits and symbols ("password!2026"). */
function paddedWord(p: string): boolean {
  for (const w of WORDS) {
    const i = p.indexOf(w);
    if (i < 0) continue;
    const rest = p.slice(0, i) + p.slice(i + w.length);
    if (!/[a-z]/.test(rest) || repeated(rest) || WORDS.some((x) => x === rest)) return true;
  }
  return false;
}

/** Null when the passphrase is acceptable, else what's wrong with it. The wizard says it should differ from the sign-in password; it can't check that. */
export function passphraseProblem(passphrase: string): PassphraseProblem | null {
  const p = passphrase.normalize("NFC");
  if ([...p].length < MIN_PASSPHRASE) return "short";
  const lower = p.toLowerCase();
  const squeezed = lower.replace(/\s+/g, "");
  if (COMMON_LONG.has(lower) || COMMON_LONG.has(squeezed) || repeated(squeezed) || rowRun(squeezed) || paddedWord(squeezed)) return "common";
  return null;
}

/** Argon2id costs for new wraps. Tests lower them (`ARGON2ID_TEST`); nothing else may. */
let params: { m: number; t: number; p: number } = ARGON2ID_DEFAULTS;
export function setPassphraseCostsForTests(p: { m: number; t: number; p: number } | null): void {
  params = p ?? ARGON2ID_DEFAULTS;
}

export function newKdf(): Argon2idParams {
  return { ...newPassphraseKdf(randomBytes(16)), ...params };
}

/** The AMK wrapped with a passphrase (FLV1 0x03, keyVersion = the account epoch). */
export async function wrapWithPassphrase(passphrase: string, kdf: Argon2idParams, epoch: number, context: string, amk: Uint8Array): Promise<Uint8Array> {
  const key = await passphraseWrapKey(passphrase.normalize("NFC"), kdf);
  return sealRecord(key, epoch, context, amk);
}

/** The AMK from a passphrase wrap, or null when the passphrase is wrong. */
export async function openWithPassphrase(passphrase: string, kdf: PassphraseKdf, context: string, wrapped: Uint8Array): Promise<Uint8Array | null> {
  const key = await passphraseWrapKey(passphrase.normalize("NFC"), kdf);
  try {
    return await openRecord(key, context, wrapped);
  } catch {
    return null;
  }
}
