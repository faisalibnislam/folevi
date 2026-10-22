// End-to-end encryption on the Mac (docs/E2EE_DESIGN.md §4.8, §6.2, §6.11, WP6): this Mac's device keys.
//
// The main process owns an X25519 key pair (it receives the account master key, sealed to it as an FLS1 box)
// and an Ed25519 key pair (it signs as this device). Their private halves never leave this process: they are
// sealed with Electron's safeStorage (a key macOS keeps in the Keychain for this app) in
// `userData/e2ee/device.bin`; the device id and the public halves are in `userData/e2ee/device.json`.
// The page reaches them through `foleviShell.e2ee` / `foleviDesktop.e2ee` (preload.ts), checked to come from
// Folevi's own pages (main.ts), and can only ask for the public keys, open a sealed box addressed to this
// device, sign a statement, or forget the keys. The one secret that crosses is what `open` unseals (the
// account master key), which the page imports as non-extractable keys and zeroes.
//
// With "Ask for Touch ID to unlock encrypted notes" on (Settings > Desktop app), `open` asks for Touch ID first.
//
// Nothing here logs a key, a box or what a box holds. The cipher and Touch ID are passed in (main.ts gives
// safeStorage and systemPreferences), so this file loads without Electron in tests (e2ee.test.ts).
import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, sign as edSign, type KeyObject } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Cipher } from "./secrets";

/** The calls preload.ts makes (it can't import this file: a sandboxed preload loads no modules). */
export const E2EE_CHANNELS = {
  deviceKeys: "shell:e2ee-device-keys",
  open: "shell:e2ee-open",
  sign: "shell:e2ee-sign",
  reset: "shell:e2ee-reset",
  settings: "shell:e2ee-settings",
  setTouchId: "shell:e2ee-set-touch-id",
} as const;

export const CONTEXT_PREFIX = "folevi/e2ee/v1/";
const SEALED_MAGIC = Buffer.from("FLS1", "utf8");
const SEALED_VERSION = 0x01;
const SEALED_HEADER = 49;
const TAG_BYTES = 16;
/** A sealed box the page may hand over: an AMK wrap is about 100 bytes; this leaves room and refuses floods. */
const MAX_BOX = 64 * 1024;
const MAX_CONTEXT = 512;
const MAX_STATEMENT = 4096;
const STATEMENT_KINDS = ["device", "space-grant", "note-grant", "account-key"] as const;
/** After Touch ID says yes, other windows opening at the same moment don't ask again. */
const TOUCH_ID_GRACE_MS = 30_000;

// PKCS#8 prefixes for a raw 32-byte X25519 / Ed25519 private key (RFC 8410).
const X25519_PKCS8 = Buffer.from("302e020100300506032b656e04220420", "hex");
const ED25519_PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");

export type E2eeErrorCode = "unavailable" | "invalid_argument" | "cancelled" | "failed";

/** A rejection the page can read (contextBridge keeps a plain object's fields, not an Error's `code`). */
export class E2eeBridgeError extends Error {
  constructor(
    readonly code: E2eeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface DevicePublicKeys {
  deviceId: string;
  x25519Pub: Uint8Array;
  ed25519Pub: Uint8Array;
}

export interface E2eeSettings {
  /** Touch ID is asked for before encrypted notes unlock. */
  touchId: boolean;
  /** Whether this Mac can ask for Touch ID at all. */
  available: boolean;
}

export interface TouchId {
  canPrompt(): boolean;
  /** Rejects when it fails or the person cancels. */
  prompt(reason: string): Promise<void>;
}

/** The private halves as kept: raw 32-byte keys (X25519 scalar, Ed25519 seed). */
interface PrivateKeys {
  x: KeyObject;
  ed: KeyObject;
}

export interface DeviceKeysDeps {
  /** `userData/e2ee`. */
  dir: string;
  cipher: Cipher;
  touchId?: TouchId;
  now?: () => number;
  /** Tests: fixed keys instead of new random ones. */
  generate?: () => { x: Uint8Array; ed: Uint8Array };
}

const b64u = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const fromB64u = (text: string) => new Uint8Array(Buffer.from(text, "base64url"));

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** A ULID (time, then 80 random bits): the device id is `mac-<ulid>`, like the web's `web-<ulid>`. */
export function ulid(now = Date.now()): string {
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const rand = randomBytes(16);
  let tail = "";
  for (let i = 0; i < 16; i++) tail += CROCKFORD[rand[i]! % 32];
  return time + tail;
}

function privateKeyFrom(prefix: Buffer, raw: Uint8Array): KeyObject {
  const der = Buffer.concat([prefix, Buffer.from(raw)]);
  try {
    return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  } finally {
    der.fill(0);
  }
}

/** The raw 32 bytes of an OKP private key (the JWK `d`). The caller zeroes them. */
function rawPrivate(key: KeyObject): Uint8Array {
  const jwk = key.export({ format: "jwk" }) as { d?: string };
  if (!jwk.d) throw new E2eeBridgeError("failed", "The key couldn't be read.");
  const raw = fromB64u(jwk.d);
  jwk.d = "";
  return raw;
}

function rawPublic(key: KeyObject): Uint8Array {
  const jwk = createPublicKey(key).export({ format: "jwk" }) as { x?: string };
  if (!jwk.x) throw new E2eeBridgeError("failed", "The key couldn't be read.");
  return fromB64u(jwk.x);
}

/** The bytes an FST1 signature covers (docs/E2EE_DESIGN.md §4.4). */
export function statementMessage(kind: string, body: string): Buffer {
  return Buffer.concat([Buffer.from(`folevi/e2ee/v1/statement\n${kind}\n`, "utf8"), Buffer.from(body, "utf8")]);
}

function asBytes(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  return null;
}

function hasControl(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) < 0x20) return true;
  return false;
}

function checkContext(context: unknown): string {
  if (typeof context !== "string" || !context.startsWith(CONTEXT_PREFIX) || context.length <= CONTEXT_PREFIX.length || context.length > MAX_CONTEXT || hasControl(context))
    throw new E2eeBridgeError("invalid_argument", "Not an encryption context.");
  return context;
}

export class DeviceKeys {
  private keys: PrivateKeys | null = null;
  private pub: DevicePublicKeys | null = null;
  private confirmedAt = 0;
  private asking: Promise<void> | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: DeviceKeysDeps) {
    this.now = deps.now ?? Date.now;
  }

  private get jsonFile() {
    return join(this.deps.dir, "device.json");
  }
  private get binFile() {
    return join(this.deps.dir, "device.bin");
  }
  private get prefsFile() {
    return join(this.deps.dir, "prefs.json");
  }

  private available(): void {
    if (!this.deps.cipher.isEncryptionAvailable()) throw new E2eeBridgeError("unavailable", "This Mac can't keep encryption keys safely right now.");
  }

  /** Loads the keys from disk, or null when there are none (or they can't be read on this Mac any more). */
  private load(): boolean {
    if (this.keys && this.pub) return true;
    let meta: { version?: unknown; deviceId?: unknown; x25519Pub?: unknown; ed25519Pub?: unknown };
    let sealed: Buffer;
    try {
      meta = JSON.parse(readFileSync(this.jsonFile, "utf8")) as typeof meta;
      sealed = readFileSync(this.binFile);
    } catch {
      return false;
    }
    if (meta.version !== 1 || typeof meta.deviceId !== "string" || typeof meta.x25519Pub !== "string" || typeof meta.ed25519Pub !== "string") return false;
    let inner: { x?: unknown; ed?: unknown };
    try {
      inner = JSON.parse(this.deps.cipher.decryptString(sealed)) as typeof inner;
    } catch {
      // Another Mac's Keychain, or a damaged file: as good as absent (the page asks to approve this Mac again).
      return false;
    }
    if (typeof inner.x !== "string" || typeof inner.ed !== "string") return false;
    const xRaw = fromB64u(inner.x);
    const edRaw = fromB64u(inner.ed);
    inner.x = "";
    inner.ed = "";
    try {
      const keys = { x: privateKeyFrom(X25519_PKCS8, xRaw), ed: privateKeyFrom(ED25519_PKCS8, edRaw) };
      const pub = { deviceId: meta.deviceId, x25519Pub: rawPublic(keys.x), ed25519Pub: rawPublic(keys.ed) };
      // The public halves on disk must be the private halves' (a swapped file is refused, not trusted).
      if (b64u(pub.x25519Pub) !== meta.x25519Pub || b64u(pub.ed25519Pub) !== meta.ed25519Pub) return false;
      this.keys = keys;
      this.pub = pub;
      return true;
    } catch {
      return false;
    } finally {
      xRaw.fill(0);
      edRaw.fill(0);
    }
  }

  private create(): void {
    this.available();
    let xRaw: Uint8Array;
    let edRaw: Uint8Array;
    if (this.deps.generate) {
      const g = this.deps.generate();
      xRaw = new Uint8Array(g.x);
      edRaw = new Uint8Array(g.ed);
    } else {
      xRaw = rawPrivate(generateKeyPairSync("x25519").privateKey);
      edRaw = rawPrivate(generateKeyPairSync("ed25519").privateKey);
    }
    let secret = "";
    try {
      const keys = { x: privateKeyFrom(X25519_PKCS8, xRaw), ed: privateKeyFrom(ED25519_PKCS8, edRaw) };
      const pub = { deviceId: `mac-${ulid(this.now())}`, x25519Pub: rawPublic(keys.x), ed25519Pub: rawPublic(keys.ed) };
      secret = JSON.stringify({ x: b64u(xRaw), ed: b64u(edRaw) });
      mkdirSync(this.deps.dir, { recursive: true, mode: 0o700 });
      const sealed = this.deps.cipher.encryptString(secret);
      this.write(this.binFile, sealed);
      this.write(this.jsonFile, Buffer.from(JSON.stringify({ version: 1, deviceId: pub.deviceId, x25519Pub: b64u(pub.x25519Pub), ed25519Pub: b64u(pub.ed25519Pub), createdAt: this.now() }), "utf8"));
      this.keys = keys;
      this.pub = pub;
    } finally {
      xRaw.fill(0);
      edRaw.fill(0);
      secret = "";
    }
  }

  private write(target: string, bytes: Buffer): void {
    const tmp = `${target}.${process.pid}.${this.now()}.tmp`;
    writeFileSync(tmp, bytes, { mode: 0o600 });
    renameSync(tmp, target);
    try {
      chmodSync(target, 0o600);
    } catch {
      /* Best effort: the folder is the app's own. */
    }
  }

  /** This Mac's device id and public keys; made (and kept) on the first call. */
  deviceKeys(): DevicePublicKeys {
    if (!this.load()) this.create();
    const p = this.pub!;
    return { deviceId: p.deviceId, x25519Pub: new Uint8Array(p.x25519Pub), ed25519Pub: new Uint8Array(p.ed25519Pub) };
  }

  /** Opens an FLS1 sealed box addressed to this Mac's X25519 key (§4.4). Asks for Touch ID first when that's on. */
  async open(box: unknown, context: unknown): Promise<Uint8Array> {
    const bytes = asBytes(box);
    if (!bytes || bytes.length < SEALED_HEADER + TAG_BYTES || bytes.length > MAX_BOX) throw new E2eeBridgeError("invalid_argument", "Not a sealed Folevi box.");
    if (!SEALED_MAGIC.equals(Buffer.from(bytes.subarray(0, 4))) || bytes[4] !== SEALED_VERSION) throw new E2eeBridgeError("invalid_argument", "Not a sealed Folevi box.");
    const ctx = checkContext(context);
    this.available();
    if (!this.load()) throw new E2eeBridgeError("unavailable", "This Mac has no encryption keys yet.");
    await this.confirm();
    return openSealedBox(this.keys!.x, this.pub!.x25519Pub, ctx, bytes);
  }

  /** An FST1 signature (base64url) by this Mac's Ed25519 key over a statement's canonical JSON body. */
  async sign(kind: unknown, body: unknown): Promise<string> {
    if (typeof kind !== "string" || !(STATEMENT_KINDS as readonly string[]).includes(kind)) throw new E2eeBridgeError("invalid_argument", "Unknown statement kind.");
    if (typeof body !== "string" || body.length > MAX_STATEMENT) throw new E2eeBridgeError("invalid_argument", "Not a statement.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new E2eeBridgeError("invalid_argument", "Not a statement.");
    this.available();
    if (!this.load()) throw new E2eeBridgeError("unavailable", "This Mac has no encryption keys yet.");
    return Buffer.from(edSign(null, statementMessage(kind, body), this.keys!.ed)).toString("base64url");
  }

  /** Forgets this Mac's device keys (signed out for good, or the device was removed). The next call makes new ones. */
  reset(): void {
    this.keys = null;
    this.pub = null;
    this.confirmedAt = 0;
    rmSync(this.binFile, { force: true });
    rmSync(this.jsonFile, { force: true });
  }

  settings(): E2eeSettings {
    const available = this.deps.touchId?.canPrompt() ?? false;
    return { touchId: available && this.readPrefs().touchId, available };
  }

  /** Turning the Touch ID question on or off asks for Touch ID too, so someone at an unlocked Mac can't switch it off. */
  async setTouchId(on: unknown): Promise<E2eeSettings> {
    if (typeof on !== "boolean") throw new E2eeBridgeError("invalid_argument", "touchId is true or false.");
    const t = this.deps.touchId;
    if (!t || !t.canPrompt()) throw new E2eeBridgeError("unavailable", "This Mac has no Touch ID, or it isn't set up.");
    if (on !== this.readPrefs().touchId) {
      try {
        await t.prompt(on ? "ask for Touch ID before unlocking encrypted notes" : "stop asking for Touch ID before unlocking encrypted notes");
      } catch {
        throw new E2eeBridgeError("cancelled", "Touch ID didn't confirm it.");
      }
      mkdirSync(this.deps.dir, { recursive: true, mode: 0o700 });
      this.write(this.prefsFile, Buffer.from(JSON.stringify({ touchId: on }), "utf8"));
    }
    return this.settings();
  }

  private readPrefs(): { touchId: boolean } {
    try {
      const raw = JSON.parse(readFileSync(this.prefsFile, "utf8")) as { touchId?: unknown };
      return { touchId: raw.touchId === true };
    } catch {
      return { touchId: false };
    }
  }

  private async confirm(): Promise<void> {
    const t = this.deps.touchId;
    if (!t || !t.canPrompt() || !this.readPrefs().touchId) return;
    if (this.now() - this.confirmedAt < TOUCH_ID_GRACE_MS) return;
    // Two windows opening at once share one question.
    this.asking ??= t
      .prompt("unlock your encrypted notes")
      .then(() => {
        this.confirmedAt = this.now();
      })
      .finally(() => {
        this.asking = null;
      });
    try {
      await this.asking;
    } catch {
      throw new E2eeBridgeError("cancelled", "Touch ID didn't confirm it.");
    }
  }
}

/**
 * FLS1 open (§4.4): s = X25519(d, E); k = HKDF-SHA256(s, salt E ‖ R, info "seal/" ‖ context);
 * plaintext = AES-256-GCM-open(k, nonce, body, AAD = header ‖ utf8(context)). Refuses an all-zero s.
 */
export function openSealedBox(privateKey: KeyObject, recipientPub: Uint8Array, context: string, box: Uint8Array): Uint8Array {
  const header = Buffer.from(box.subarray(0, SEALED_HEADER));
  const eph = box.subarray(5, 37);
  const nonce = box.subarray(37, SEALED_HEADER);
  const body = box.subarray(SEALED_HEADER, box.length - TAG_BYTES);
  const tag = box.subarray(box.length - TAG_BYTES);
  let shared: Buffer | null = null;
  let key: Buffer | null = null;
  try {
    try {
      const ephKey = createPublicKey({ key: { kty: "OKP", crv: "X25519", x: b64u(eph) }, format: "jwk" });
      shared = diffieHellman({ privateKey, publicKey: ephKey });
    } catch {
      throw new E2eeBridgeError("failed", "The key agreement failed.");
    }
    let any = 0;
    for (const b of shared) any |= b;
    if (any === 0) throw new E2eeBridgeError("failed", "The key agreement failed.");
    key = Buffer.from(hkdfSync("sha256", shared, Buffer.concat([Buffer.from(eph), Buffer.from(recipientPub)]), Buffer.from(`seal/${context}`, "utf8"), 32));
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce), { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.concat([header, Buffer.from(context, "utf8")]));
    decipher.setAuthTag(Buffer.from(tag));
    try {
      const out = Buffer.concat([decipher.update(Buffer.from(body)), decipher.final()]);
      const result = new Uint8Array(out);
      out.fill(0);
      return result;
    } catch {
      throw new E2eeBridgeError("failed", "The sealed box failed its integrity check.");
    }
  } finally {
    shared?.fill(0);
    key?.fill(0);
  }
}

/** FLS1 seal, for tests (the Mac only opens boxes; sealing happens in the page with @folevi/local-store/e2ee). */
export function sealBoxForTest(recipientPub: Uint8Array, context: string, plaintext: Uint8Array): Uint8Array {
  const eph = generateKeyPairSync("x25519");
  const ephPub = rawPublic(eph.privateKey);
  const recipient = createPublicKey({ key: { kty: "OKP", crv: "X25519", x: b64u(recipientPub) }, format: "jwk" });
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: recipient });
  const key = Buffer.from(hkdfSync("sha256", shared, Buffer.concat([Buffer.from(ephPub), Buffer.from(recipientPub)]), Buffer.from(`seal/${context}`, "utf8"), 32));
  const nonce = randomBytes(12);
  const header = Buffer.concat([SEALED_MAGIC, Buffer.from([SEALED_VERSION]), Buffer.from(ephPub), nonce]);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.concat([header, Buffer.from(context, "utf8")]));
  const body = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  return new Uint8Array(Buffer.concat([header, body, cipher.getAuthTag()]));
}

type Handle = (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => void;
type Answer<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

/**
 * Registers the page's calls. `allowed` checks the sender is one of Folevi's own pages (main.ts `fromFolevi`:
 * the website the app shows, or app://folevi); anything else is refused without touching the keys.
 */
/**
 * `keys` gets the call's event: several places in the app (docs/MULTI_ACCOUNT_PLAN.md §4) keep a pair of device keys
 * per account, and the page asking is bound to one (main.ts).
 */
export function registerE2eeIpc(handle: Handle, keys: (event: unknown) => DeviceKeys | null, allowed: (event: unknown) => boolean): void {
  const answer =
    <T>(fn: (k: DeviceKeys, ...args: unknown[]) => T | Promise<T>) =>
    async (event: unknown, ...args: unknown[]): Promise<Answer<T>> => {
      const k = keys(event);
      if (!k || !allowed(event)) return { ok: false, error: { code: "unavailable", message: "Encryption keys aren't available here." } };
      try {
        return { ok: true, value: await fn(k, ...args) };
      } catch (err) {
        // Only the code and a fixed message go back: never anything about the key or the box.
        const code = err instanceof E2eeBridgeError ? err.code : "failed";
        const message = err instanceof E2eeBridgeError ? err.message : "Folevi couldn't use this Mac's encryption keys.";
        return { ok: false, error: { code, message } };
      }
    };
  handle(E2EE_CHANNELS.deviceKeys, answer((k) => k.deviceKeys()));
  handle(E2EE_CHANNELS.open, answer((k, box, context) => k.open(box, context)));
  handle(E2EE_CHANNELS.sign, answer((k, kind, body) => k.sign(kind, body)));
  handle(
    E2EE_CHANNELS.reset,
    answer((k) => {
      k.reset();
      return null;
    }),
  );
  handle(E2EE_CHANNELS.settings, answer((k) => k.settings()));
  handle(E2EE_CHANNELS.setTouchId, answer((k, on) => k.setTouchId(on)));
}
