// KeySession (docs/E2EE_DESIGN.md §4.7, §4.8, §6.2, §6.3, §6.10, WP6): whether this tab holds the account
// master key (AMK), and every way of getting it: this device's own wrap (no prompt), a passphrase, the
// recovery key, a passkey, or approval from another device. Then "Trust this browser" or "This is a public or
// shared computer".
//
// The AMK is kept only as a SecretBox (ciphertext under a non-extractable key made for this tab) and as the
// account keys derived from it (non-extractable CryptoKeys on WebCrypto). Nothing here logs a key, a wrap or
// what one holds.
//
// Lifecycle: `startKeySession(binding)` once signed in (AccountGate), `endKeySession()` at sign-out. A Standard
// account (no E2EE set up) stays at "none" and nothing else runs.
import {
  constantTimeEqual,
  ctx,
  deriveAccountKeys,
  sealTo,
  signStatement,
  toBase64Url,
  type AccountKeys,
} from "@folevi/local-store/e2ee";
import { ulid } from "@folevi/editor-schema";
import type { ShellE2ee } from "@/lib/shell/types";
import { browserIdentity, idbKeyStore, memoryKeyStore, newBrowserDevice, persistable, type BrowserDeviceRecord, type DeviceIdentity, type DeviceKind, type KeyStore } from "./keystore";
import { inMacApp, macE2ee, macIdentity, macLabel } from "./macBridge";
import { openWithPassphrase } from "./passphrase";
import { evaluatePrf, openWithPrf, passkeysPossible } from "./passkey";
import { clearPublicDatabases, clearPublicLeftovers, markPublicSession, sessionIdentity, wasPublicSession } from "./publicMode";
import { localDbInMemory } from "@/lib/sync/db";
import { openWithRecoveryKey, parseRecoveryKey } from "./recoveryKey";
import type { AccountStatus, KeysServer, WrapListRow } from "./server";
import { Emitter, KeysError, SecretBox, browserLabel, bytes, errorCode, wire } from "./util";

export type LockState = "none" /* no E2EE on this account */ | "locked" | "unlocking" | "unlocked";
export type MethodKind = "device" | "recoveryKey" | "passkey" | "passphrase";

/** One way in, as `e2ee.keys.listWraps` reports it (never the wrapped key). */
export interface MethodSummary {
  publicId: string;
  kind: MethodKind;
  label: string;
  createdAt: number;
  lastUsedAt?: number;
  /** kind "device": which device (this one's id is `getKeySession().deviceId()`). */
  deviceId?: string;
}

/** The new device's side of an approval (§4.8). */
export interface ApprovalHandle {
  /** The 6-digit code to compare, once the other device answered. */
  code: Promise<string>;
  /** True once the other device confirmed and this one opened the key; false if cancelled or expired. */
  done: Promise<boolean>;
  cancel(): void;
}

/** A request from a new device, shown on a trusted one (`e2ee.devices.approvals`). */
export interface IncomingApproval {
  requestId: string;
  /** "Chrome on Windows" */
  label: string;
  createdAt: number;
  /** Answers the request (`answerApproval`), waits for the reveal and resolves the 6-digit code. */
  start(): Promise<string>;
  /** "They match": seals the AMK to the new device (`completeApproval`). */
  confirm(): Promise<void>;
  /** "They don't match": cancels (`cancelApproval`). */
  reject(): Promise<void>;
}

export interface KeySession {
  state(): LockState;
  subscribe(cb: () => void): () => void;
  unlockWithDevice(): Promise<boolean>;
  unlockWithPassphrase(p: string): Promise<"ok" | "wrong" | "rate_limited">;
  unlockWithRecoveryKey(text: string): Promise<"ok" | "wrong" | "bad_format" | "rate_limited">;
  unlockWithPasskey(): Promise<"ok" | "cancelled" | "unsupported">;
  requestApproval(): Promise<ApprovalHandle>;
  trust(mode: "browser" | "public"): Promise<void>;
  lock(): void;
  /** Throws when locked. */
  accountKeys(): AccountKeys;
  deviceId(): string;
}

export interface KeysBinding {
  server: KeysServer;
  /** The signed-in person's profile id (as clients see it; it names them in contexts and statements). */
  profileId: string;
  email?: string;
  /** The id a new browser device starts with: the sync engine's (`lib/sync/db.ts` deviceId). */
  newDeviceId?: () => Promise<string>;
  /** Reloads the page (public computer chosen after the account's database opened on disk). Tests pass their own. */
  reload?: () => void;
  /** Defaults: IndexedDB "folevi-e2ee", and the Mac app's bridge when there is one. Tests pass their own. */
  store?: KeyStore;
  mac?: ShellE2ee | null;
  now?: () => number;
}

/** What setup.ts, keyring.ts and approval.ts use while unlocked. */
export interface Unlocked {
  server: KeysServer;
  profileId: string;
  email: string;
  epoch: number;
  account: AccountKeys;
  amk: SecretBox;
  device: DeviceIdentity | null;
  now: () => number;
}

const TOUCH_EVERY_MS = 60 * 60_000;
const publicStore = memoryKeyStore();
const reloadPage = () => {
  if (typeof location !== "undefined") location.reload();
};
const randomId = () => `web-${ulid()}`;

const eq = (a: Uint8Array, b: Uint8Array) => constantTimeEqual(a, b);

type Expected = { x25519Pub: Uint8Array; ed25519Pub: Uint8Array; amkCheck: Uint8Array };

function expectedOf(status: AccountStatus | null): Expected | null {
  if (!status || !status.setUp || !status.x25519Pub || !status.ed25519Pub || !status.amkCheck) return null;
  return { x25519Pub: bytes(status.x25519Pub), ed25519Pub: bytes(status.ed25519Pub), amkCheck: bytes(status.amkCheck) };
}

function methodsOf(rows: WrapListRow[], myDeviceId: string, mac: boolean): MethodSummary[] {
  const defaults: Record<MethodKind, string> = { device: "Another device", recoveryKey: "Recovery key", passkey: "Passkey", passphrase: "Encryption passphrase" };
  return rows.map((w) => {
    const kind = w.kind as MethodKind;
    const label = w.label || (kind === "device" && w.deviceId === myDeviceId ? (mac ? "This Mac" : "This browser") : defaults[kind]);
    const m: MethodSummary = { publicId: w.publicId, kind, label, createdAt: w.createdAt };
    if (w.lastUsedAt != null) m.lastUsedAt = w.lastUsedAt;
    if (w.deviceId) m.deviceId = w.deviceId;
    return m;
  });
}

export class KeySessionImpl implements KeySession {
  private binding: KeysBinding | null = null;
  private st: LockState = "none";
  private status: AccountStatus | null = null;
  private expected: Expected | null = null;
  private amk: SecretBox | null = null;
  private account: AccountKeys | null = null;
  private epoch = 0;
  private device: DeviceIdentity | null = null;
  private publicMode = false;
  private lastWrapId: string | null = null;
  private generation = 0;
  private offs: (() => void)[] = [];
  private approvalsOff: (() => void) | null = null;
  private touchTimer: ReturnType<typeof setInterval> | null = null;
  private readonly emitter = new Emitter();
  /** Snapshots for useSyncExternalStore (replaced, never mutated). */
  methods: MethodSummary[] = [];
  approvals: IncomingApproval[] = [];
  /** Called when the session locks or unlocks (keyring.ts clears its keys on lock). */
  onLock: (() => void)[] = [];
  /** Set by approval.ts: turns server rows into IncomingApprovals. */
  approvalsFrom: ((rows: import("./server").ApprovalListRow[]) => IncomingApproval[]) | null = null;

  // ---------------------------------------------------------------- lifecycle

  async start(binding: KeysBinding): Promise<void> {
    this.stop();
    const gen = ++this.generation;
    this.binding = binding;
    await clearPublicLeftovers().catch(() => undefined);
    let status: AccountStatus | null = null;
    try {
      status = await binding.server.keys.status({});
    } catch {
      // Offline: this device's cached wrap says whether the account has keys.
      const cached = await this.store().getWrap(binding.profileId).catch(() => null);
      if (cached) this.expected = { x25519Pub: cached.account.x25519Pub, ed25519Pub: cached.account.ed25519Pub, amkCheck: cached.account.amkCheck };
    }
    if (gen !== this.generation) return;
    if (status) this.applyStatus(status);
    else this.set(this.expected ? "locked" : "none");
    // A Standard account watches only its status (one small query), to notice encryption set up elsewhere.
    this.offs.push(binding.server.watchStatus((s) => gen === this.generation && this.applyStatus(s)));
    if (this.st === "locked") await this.unlockWithDevice().catch(() => false);
  }

  /** Signed out (or switched account): forgets everything this tab holds. */
  stop(): void {
    this.generation++;
    for (const off of this.offs.splice(0)) off();
    this.clearKeys();
    this.binding = null;
    this.status = null;
    this.expected = null;
    this.device = null;
    this.methods = [];
    this.set("none");
  }

  private wrapsOff: (() => void) | null = null;
  /** The ways to unlock, live, once the account has keys. */
  private watchWraps(): void {
    const b = this.binding;
    if (!b || this.wrapsOff) return;
    const gen = this.generation;
    this.wrapsOff = b.server.watchWraps((rows) => {
      if (gen !== this.generation) return;
      this.methods = methodsOf(rows, this.device?.deviceId ?? "", !!this.mac());
      this.emitter.emit();
    });
    this.offs.push(() => {
      this.wrapsOff?.();
      this.wrapsOff = null;
    });
  }

  private applyStatus(s: AccountStatus): void {
    const before = this.status;
    this.status = s;
    this.expected = expectedOf(s);
    if (!s.setUp) {
      this.clearKeys();
      this.set("none");
      return;
    }
    if (this.st === "none") this.set("locked");
    this.watchWraps();
    // The account key changed on another device (rotated or reset): what this tab holds is the old one.
    if (this.st === "unlocked" && before?.setUp && before.epoch !== s.epoch) {
      this.clearKeys();
      this.set("locked");
      void this.unlockWithDevice().catch(() => false);
    }
  }

  // ---------------------------------------------------------------- KeySession

  state(): LockState {
    return this.st;
  }
  subscribe = (cb: () => void): (() => void) => this.emitter.subscribe(cb);

  deviceId(): string {
    return this.device?.deviceId ?? "";
  }

  accountKeys(): AccountKeys {
    if (!this.account) throw new KeysError("e2ee_locked_session", "Your encrypted notes are locked.");
    return this.account;
  }

  lock(): void {
    if (this.st === "none") return;
    this.clearKeys();
    this.set("locked");
  }

  async unlockWithDevice(): Promise<boolean> {
    if (this.st === "unlocked") return true;
    const b = this.binding;
    if (!b || !this.expected) return false;
    const gen = this.generation;
    const dev = await this.trustedDevice().catch(() => null);
    if (!dev || gen !== this.generation) return false;
    const before = this.st;
    this.set("unlocking");
    try {
      let wrapped: Uint8Array | null = null;
      let epoch = this.status?.epoch ?? 0;
      let expected = this.expected;
      try {
        const w = await b.server.keys.getDeviceWrap({ deviceId: dev.deviceId });
        if (!w) {
          // Revoked from another device, or never wrapped: this device is no longer trusted (§11.5 "revoke from
          // the web, the Mac asks to unlock").
          await this.forgetTrust(dev);
          this.set(before === "unlocking" ? "locked" : before);
          return false;
        }
        wrapped = bytes(w.wrapped);
        epoch = w.epoch;
      } catch {
        const cached = await this.store().getWrap(b.profileId).catch(() => null);
        if (!cached || cached.deviceId !== dev.deviceId) throw new KeysError("offline", "Can't reach Folevi.");
        wrapped = cached.wrapped;
        epoch = cached.epoch;
        expected = cached.account;
      }
      let amk: Uint8Array;
      try {
        amk = await dev.open(wrapped, ctx.amkDevice(b.profileId, dev.deviceId));
      } catch {
        // Touch ID cancelled, or a wrap these keys can't open.
        this.set("locked");
        return false;
      }
      if (gen !== this.generation) {
        amk.fill(0);
        return false;
      }
      if (!(await this.finishUnlock(amk, epoch, expected))) {
        this.set("locked");
        return false;
      }
      this.device = dev;
      await this.cacheWrap(dev, epoch, wrapped);
      this.afterUnlock();
      return true;
    } catch {
      if (this.st === "unlocking") this.set("locked");
      return false;
    }
  }

  async unlockWithPassphrase(p: string): Promise<"ok" | "wrong" | "rate_limited"> {
    return this.withMethod(async (b) => {
      const w = await b.server.keys.getWrap({ kind: "passphrase" });
      if (!w || !w.kdf) return null;
      const kdf = { ...w.kdf, salt: bytes(w.kdf.salt) };
      const amk = await openWithPassphrase(p, kdf, ctx.amkPassphrase(b.profileId, w.publicId), bytes(w.wrapped));
      return amk ? { amk, epoch: w.epoch, wrapId: w.publicId } : null;
    });
  }

  async unlockWithRecoveryKey(text: string): Promise<"ok" | "wrong" | "bad_format" | "rate_limited"> {
    const keyBytes = parseRecoveryKey(text);
    if (!keyBytes) return "bad_format";
    return this.withMethod(async (b) => {
      const w = await b.server.keys.getWrap({ kind: "recoveryKey" });
      if (!w) {
        keyBytes.fill(0);
        return null;
      }
      const amk = await openWithRecoveryKey(keyBytes, ctx.amkRecovery(b.profileId, w.publicId), bytes(w.wrapped));
      return amk ? { amk, epoch: w.epoch, wrapId: w.publicId } : null;
    });
  }

  async unlockWithPasskey(): Promise<"ok" | "cancelled" | "unsupported"> {
    const b = this.binding;
    if (!b || !passkeysPossible()) return "unsupported";
    const rows = await b.server.keys.listWraps({});
    const creds = rows.filter((w) => w.kind === "passkey" && w.credentialId && w.prfSalt).map((w) => ({ credentialId: w.credentialId!, prfSalt: bytes(w.prfSalt!) }));
    if (!creds.length) return "unsupported";
    const prf = await evaluatePrf(creds);
    if (typeof prf === "string") return prf;
    const r = await this.withMethod(async (bb) => {
      const w = await bb.server.keys.getWrap({ kind: "passkey", credentialId: prf.credentialId });
      if (!w) {
        prf.prfOutput.fill(0);
        return null;
      }
      const amk = await openWithPrf(prf.prfOutput, ctx.amkPasskey(bb.profileId, prf.credentialId), bytes(w.wrapped));
      return amk ? { amk, epoch: w.epoch, wrapId: w.publicId } : null;
    });
    // A passkey that opened nothing (another site's, or a stale credential) reads as "can't unlock".
    return r === "ok" ? "ok" : r === "rate_limited" ? "cancelled" : "unsupported";
  }

  async requestApproval(): Promise<ApprovalHandle> {
    const { newDeviceApproval } = await import("./approval");
    return newDeviceApproval(this);
  }

  /**
   * After unlocking with a method: "browser" registers this browser (or Mac) as a trusted device and stores
   * its wrap, so the next visit unlocks with no prompt; "public" keeps the key in this tab only (§6.10).
   */
  async trust(mode: "browser" | "public"): Promise<void> {
    const u = this.unlocked();
    if (mode === "browser") {
      markPublicSession(false);
      this.publicMode = false;
      if (this.device && this.device.kind !== "session") return;
      let dev = await this.deviceToTrust();
      try {
        await this.registerTrusted(u, dev);
      } catch (e) {
        // This device's id was removed from the account earlier, or the account holds other keys for it (this
        // browser lost its copy): it starts again with new keys and a new id.
        const code = errorCode(e);
        if (code !== "forbidden" && code !== "conflict") throw e;
        await this.forgetTrust(dev);
        await this.mac()?.reset();
        dev = await this.deviceToTrust(true);
        await this.registerTrusted(u, dev);
      }
      const wrapped = await u.amk.use((raw) => sealTo(dev.x25519Pub, ctx.amkDevice(u.profileId, dev.deviceId), raw));
      await u.server.keys.addWrap({ kind: "device", deviceId: dev.deviceId, wrapped: wire(wrapped) });
      await this.markTrusted(dev);
      await this.cacheWrap(dev, u.epoch, wrapped);
      this.device = dev;
      this.afterUnlock();
      return;
    }
    // A public computer: nothing readable stays once the tab closes.
    const prev = this.device;
    if (prev && prev.kind !== "session") {
      await this.forgetTrust(prev);
      const own = this.methods.find((m) => m.kind === "device" && m.deviceId === prev.deviceId);
      if (own) await u.server.keys.removeWrap({ publicId: own.publicId }).catch(() => undefined);
    }
    markPublicSession(true);
    if (!localDbInMemory()) {
      // This tab opened the account's database on disk before the choice (and may have kept a replica):
      // it starts again in memory, and that load deletes what was written. The key goes with the tab, so the
      // person unlocks once more (this browser then reads as a public computer from the start).
      this.lock();
      (this.binding?.reload ?? reloadPage)();
      return;
    }
    const dev = await sessionIdentity();
    await this.registerTrusted(u, dev);
    this.device = dev;
    this.publicMode = true;
    this.afterUnlock();
  }

  /** This browser is a public computer (chosen here before): the trust step can say so, and keeps it. */
  publicBrowser(): boolean {
    return wasPublicSession();
  }

  // ---------------------------------------------------------------- for the other key modules

  /** The binding, or throws when signed out. */
  bound(): KeysBinding {
    if (!this.binding) throw new KeysError("e2ee_locked_session", "Sign in first.");
    return this.binding;
  }

  /** Everything needed to act with the AMK; throws `e2ee_locked_session` when locked. */
  unlocked(): Unlocked {
    const b = this.bound();
    if (this.st !== "unlocked" || !this.amk || !this.account) throw new KeysError("e2ee_locked_session", "Your encrypted notes are locked.");
    return { server: b.server, profileId: b.profileId, email: b.email ?? "", epoch: this.epoch, account: this.account, amk: this.amk, device: this.device, now: b.now ?? Date.now };
  }

  accountStatus(): AccountStatus | null {
    return this.status;
  }
  /** Nothing of this tab's may be kept on disk: a public session, or a browser used as a public computer. */
  isPublic(): boolean {
    return this.publicMode || wasPublicSession();
  }
  /** The wrap the last method unlock (or re-check) opened: `e2ee.spaces.lower`'s `recheckedWrapId`. */
  recheckedWrapId(): string | null {
    return this.lastWrapId;
  }

  /** A newly made AMK (setup: create, rotate, reset) becomes this tab's. Zeroes `amk`. */
  async adopt(amk: Uint8Array, epoch: number, keys: AccountKeys, device: DeviceIdentity | null): Promise<void> {
    this.clearKeys();
    this.amk = await SecretBox.hold(amk);
    this.account = keys;
    this.epoch = epoch;
    this.expected = { x25519Pub: keys.x25519.publicKey, ed25519Pub: keys.ed25519.publicKey, amkCheck: keys.check };
    if (device) this.device = device;
    this.set("unlocked");
    this.afterUnlock();
  }

  /** Re-reads the account status (after setup changed it). */
  async refreshStatus(): Promise<AccountStatus | null> {
    const b = this.bound();
    const s = await b.server.keys.status({});
    this.status = s;
    if (this.st === "none" && s.setUp) this.set("locked");
    if (s.setUp) this.watchWraps();
    this.expected = expectedOf(s) ?? this.expected;
    return s;
  }

  /** This device as it will be trusted: the Mac's keys, or this browser's (made and kept on first use). */
  async deviceToTrust(freshId = false): Promise<DeviceIdentity> {
    const mac = this.mac();
    if (mac) return macIdentity(mac);
    const rec = await this.browserRecord(true, freshId);
    return browserIdentity(rec!);
  }

  /** Registers a device as trusted with a statement this account signed (`approvedBy: "recovery"`). */
  async registerTrusted(u: Unlocked, dev: DeviceIdentity): Promise<void> {
    const statement = await signStatement(u.account.ed25519.privateKey, "device", {
      profileId: u.profileId,
      deviceId: dev.deviceId,
      kind: dev.kind,
      x25519Pub: toBase64Url(dev.x25519Pub),
      ed25519Pub: toBase64Url(dev.ed25519Pub),
      label: this.label(dev.kind),
      approvedBy: "recovery",
      approvedAt: u.now(),
    });
    await u.server.devices.register({
      device: { deviceId: dev.deviceId, kind: dev.kind, label: this.label(dev.kind), platform: this.platform(), x25519Pub: wire(dev.x25519Pub), ed25519Pub: wire(dev.ed25519Pub), statement },
    });
  }

  label(kind: DeviceKind): string {
    return kind === "app" ? macLabel() : browserLabel();
  }
  platform(): string {
    return this.mac() || inMacApp() ? "mac" : "web";
  }

  /** A browser's device record (made when `create`). */
  async browserRecord(create: boolean, freshId = false): Promise<BrowserDeviceRecord | null> {
    const b = this.bound();
    const existing = await this.store().getDevice(b.profileId).catch(() => null);
    if (existing || !create) return existing;
    const id = b.newDeviceId && !freshId ? await b.newDeviceId() : randomId();
    const rec = await newBrowserDevice(b.profileId, id);
    if (persistable(rec)) await this.store().putDevice(rec);
    return rec;
  }

  async markTrusted(dev: DeviceIdentity): Promise<void> {
    if (dev.kind !== "browser") return;
    const rec = await this.browserRecord(false);
    if (rec && rec.deviceId === dev.deviceId && persistable(rec)) await this.store().putDevice({ ...rec, trusted: true });
  }

  async cacheWrap(dev: DeviceIdentity, epoch: number, wrapped: Uint8Array): Promise<void> {
    const b = this.binding;
    if (!b || !this.expected || dev.kind === "session") return;
    await this.store()
      .putWrap({ profileId: b.profileId, deviceId: dev.deviceId, epoch, wrapped: new Uint8Array(wrapped), account: this.expected })
      .catch(() => undefined);
  }

  /** Approval finished on this (new) device: the AMK it opened becomes this tab's. */
  async finishApproved(dev: DeviceIdentity, amk: Uint8Array, epoch: number, wrapped: Uint8Array): Promise<boolean> {
    if (!(await this.finishUnlock(amk, epoch, this.expected))) return false;
    this.device = dev;
    await this.markTrusted(dev);
    await this.cacheWrap(dev, epoch, wrapped);
    this.afterUnlock();
    return true;
  }

  // ---------------------------------------------------------------- internals

  mac(): ShellE2ee | null {
    const b = this.binding;
    if (b && b.mac !== undefined) return b.mac;
    return macE2ee();
  }
  private store(): KeyStore {
    // A public computer keeps no keys or wraps on disk (until someone trusts it).
    return this.binding?.store ?? (wasPublicSession() ? publicStore : idbKeyStore);
  }

  /** A device that holds a wrap here: the Mac's, or this browser's record once trusted. */
  private async trustedDevice(): Promise<DeviceIdentity | null> {
    const mac = this.mac();
    if (mac) return macIdentity(mac);
    const rec = await this.browserRecord(false);
    return rec && rec.trusted ? browserIdentity(rec) : null;
  }

  private async forgetTrust(dev: DeviceIdentity): Promise<void> {
    const b = this.binding;
    if (!b) return;
    await this.store().deleteWrap(b.profileId).catch(() => undefined);
    if (dev.kind === "browser") await this.store().deleteDevice(b.profileId).catch(() => undefined);
    if (this.device?.deviceId === dev.deviceId) this.device = null;
  }

  private async withMethod(
    open: (b: KeysBinding) => Promise<{ amk: Uint8Array; epoch: number; wrapId: string } | null>,
  ): Promise<"ok" | "wrong" | "rate_limited"> {
    const b = this.binding;
    if (!b || !this.expected) return "wrong";
    const before = this.st;
    const gen = this.generation;
    if (before !== "unlocked") this.set("unlocking");
    const restore = () => {
      if (this.st === "unlocking") this.set(before === "unlocking" ? "locked" : before);
    };
    let got: { amk: Uint8Array; epoch: number; wrapId: string } | null;
    try {
      got = await open(b);
    } catch (e) {
      restore();
      if (errorCode(e) === "e2ee_rate_limited") return "rate_limited";
      throw e;
    }
    if (!got || gen !== this.generation) {
      got?.amk.fill(0);
      restore();
      return "wrong";
    }
    if (before === "unlocked" && this.account) {
      // A re-check (before lowering a level): the method must open this same key; nothing else changes.
      const keys = await deriveAccountKeys(got.amk);
      got.amk.fill(0);
      const same = eq(keys.check, this.account.check);
      if (same) this.lastWrapId = got.wrapId;
      return same ? "ok" : "wrong";
    }
    if (!(await this.finishUnlock(got.amk, got.epoch, this.expected))) {
      restore();
      return "wrong";
    }
    this.lastWrapId = got.wrapId;
    return "ok";
  }

  /** Checks an opened AMK against the account (check value and both public keys), then holds it. Zeroes `amk`. */
  private async finishUnlock(amk: Uint8Array, epoch: number, expected: Expected | null): Promise<boolean> {
    try {
      if (!expected) return false;
      const keys = await deriveAccountKeys(amk);
      if (!eq(keys.check, expected.amkCheck) || !eq(keys.x25519.publicKey, expected.x25519Pub) || !eq(keys.ed25519.publicKey, expected.ed25519Pub)) return false;
      this.clearKeys();
      this.amk = await SecretBox.hold(amk);
      this.account = keys;
      this.epoch = epoch;
      this.set("unlocked");
      return true;
    } finally {
      amk.fill(0);
    }
  }

  private afterUnlock(): void {
    const b = this.binding;
    if (!b || this.st !== "unlocked") return;
    this.watchApprovals();
    if (this.touchTimer) clearInterval(this.touchTimer);
    const touch = () => {
      const id = this.device?.deviceId;
      if (id && this.device?.kind !== "session") void b.server.devices.touch({ deviceId: id }).catch(() => undefined);
    };
    touch();
    this.touchTimer = setInterval(touch, TOUCH_EVERY_MS);
    this.emitter.emit();
  }

  /** Trusted devices and browsers (not public sessions) answer other devices' requests. */
  private watchApprovals(): void {
    this.approvalsOff?.();
    this.approvalsOff = null;
    const b = this.binding;
    const me = this.device;
    if (!b || !me || me.kind === "session" || this.st !== "unlocked") {
      if (this.approvals.length) {
        this.approvals = [];
        this.emitter.emit();
      }
      return;
    }
    void import("./approval").then(({ incomingApprovals }) => {
      if (this.binding !== b || this.st !== "unlocked") return;
      this.approvalsFrom ??= incomingApprovals(this);
      this.approvalsOff = b.server.watchApprovals((rows) => {
        this.approvals = this.approvalsFrom!(rows);
        this.emitter.emit();
      });
    });
  }

  private clearKeys(): void {
    this.amk?.clear();
    this.amk = null;
    this.account = null;
    this.approvalsOff?.();
    this.approvalsOff = null;
    this.approvals = [];
    if (this.touchTimer) clearInterval(this.touchTimer);
    this.touchTimer = null;
    for (const f of this.onLock) {
      try {
        f();
      } catch {
        /* keep going */
      }
    }
  }

  private set(next: LockState): void {
    if (this.st === next) return;
    this.st = next;
    this.emitter.emit();
  }

  /** Sign-out: a public session leaves nothing; "Forget this browser" (or this Mac) also drops the device keys. */
  async end(o: { forget?: boolean } = {}): Promise<void> {
    const b = this.binding;
    const mac = this.mac();
    const wasPublic = this.publicMode;
    this.stop();
    this.publicMode = false;
    // A public computer stays one (the next person also starts in memory); what is on disk goes.
    if (wasPublic || wasPublicSession()) await clearPublicDatabases().catch(() => undefined);
    if (o.forget && b) {
      await (b.store ?? idbKeyStore).deleteDevice(b.profileId).catch(() => undefined);
      await (b.store ?? idbKeyStore).deleteWrap(b.profileId).catch(() => undefined);
      await mac?.reset().catch(() => undefined);
    }
  }
}

let session: KeySessionImpl | null = null;

export function sessionImpl(): KeySessionImpl {
  session ??= new KeySessionImpl();
  return session;
}

export function getKeySession(): KeySession {
  return sessionImpl();
}

/** Once signed in (AccountGate): reads the account's status and, if it has keys, unlocks with this device's. */
export function startKeySession(binding: KeysBinding): Promise<void> {
  return sessionImpl().start(binding);
}

/** At sign-out. `forget`: "Forget this browser" (the device keys go too). */
export function endKeySession(o: { forget?: boolean } = {}): Promise<void> {
  return sessionImpl().end(o);
}

/**
 * For `clearAllLocalData({ keep })` at sign-out (lib/sync/db.ts): a trusted browser keeps its device keys so
 * the next sign-in here unlocks with no prompt (§6.3), unless the person chose "Forget this browser".
 */
export function keepOnSignOut(forget: boolean): (name: string) => boolean {
  return (name) => !forget && name === "folevi-e2ee" && !sessionImpl().isPublic() && !wasPublicSession();
}

/** Tests only: a fresh session. */
export function resetKeySessionForTests(): void {
  session?.stop();
  session = null;
}
