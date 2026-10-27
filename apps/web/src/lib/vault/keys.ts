// The Vault on this device (docs/VAULT_PLAN.md §3): setting it up, unlocking it, keeping its keys in memory only
// while it's open, locking it again (by hand, after being idle, when the tab closes or the computer sleeps) and
// telling the server each time, for the log. The server's half is convex/vaultKeys.ts; the cryptography is in
// @folevi/local-store/e2ee (vault.ts). Nothing here is written to IndexedDB or localStorage.
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { ulid } from "@folevi/editor-schema";
import {
  checkVaultPasscode,
  constantTimeEqual,
  deriveVaultKeys,
  innerOfGrant,
  LIBRARY_VAULT_PERSON,
  newRecoveryKey,
  newVaultKey,
  openVaultGrant,
  parseRecoveryKey,
  randomBytes,
  sealVaultKeyTo,
  vaultPasscodeKey,
  vaultRecoveryKey,
  wrapWithPasscode,
  wrapWithRecovery,
  type VaultGrantFor,
  type VaultKeys,
  type X25519KeyPair,
} from "@folevi/local-store/e2ee";
import { api } from "@/lib/convex/api";
import { browserLabel, bytes, SecretBox, wire } from "@/lib/e2ee/keys/util";

/** The production Argon2id cost; the server refuses anything cheaper (convex/vaultKeys.ts checkKdf). */
const KDF = { m: 65536, t: 3, p: 1 } as const;

/** The Convex client calls the Vault makes (ConvexReactClient fits; tests pass a fake). */
export interface VaultClient {
  query<F extends FunctionReference<"query">>(ref: F, args: FunctionArgs<F>): Promise<FunctionReturnType<F>>;
  mutation<F extends FunctionReference<"mutation">>(ref: F, args: FunctionArgs<F>): Promise<FunctionReturnType<F>>;
}

/**
 * Who is acting on this device: their profile id (it names them in the grants' contexts) and their account keys. A
 * library on this device (no account, docs/MAC_REBUILD_PLAN.md §5.6) acts as `libraryVaultActor()`: no account key, so
 * its grants are the passcode and recovery layers straight around the vault key.
 */
export interface VaultActor {
  profileId: string;
  epoch: number;
  account: X25519KeyPair | null;
  /** This device's id (for the log). */
  deviceId?: string;
}

/** An open Vault on this device. */
interface Open {
  vaultId: string;
  /** Every live key version, raw keys sealed in memory (needed to share the key with someone else). */
  raw: Map<number, SecretBox>;
  keys: Map<number, VaultKeys>;
  current: number;
  role: string;
  autoLockMs: number;
  unlockedAt: number;
  lastActive: number;
  sessionId: string;
  timer: ReturnType<typeof setTimeout> | null;
}

export type LockHow = "manual" | "idle" | "tab" | "sleep" | "signout";

export type UnlockResult = { status: "ok" } | { status: "wrong" } | { status: "locked"; until: number } | { status: "needsPasscode" } | { status: "notSetUp" };

/** Where an action came from, for the Vault's log (convex/lib/vault/validators.ts vVaultClient). */
export function vaultClientInfo(o: { deviceId?: string; sessionId?: string } = {}) {
  let timeZone: string | undefined;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    timeZone = undefined;
  }
  return {
    ...(o.deviceId ? { deviceId: o.deviceId } : {}),
    deviceLabel: browserLabel(),
    deviceKind: "browser",
    ...(timeZone ? { timeZone } : {}),
    ...(o.sessionId ? { sessionId: o.sessionId } : {}),
  };
}

const grantFor = (vaultId: string, keyVersion: number, profileId: string): VaultGrantFor => ({ vaultId, keyVersion, profileId });

/** The actor of a library's Vault (no account). */
export const libraryVaultActor = (deviceId?: string): VaultActor => ({ profileId: LIBRARY_VAULT_PERSON, epoch: 0, account: null, ...(deviceId ? { deviceId } : {}) });

/** A grant's inner layer: the vault key sealed to the account key, or (a library's Vault) the vault key itself. */
async function innerFor(vk: Uint8Array, actor: VaultActor, g: VaultGrantFor): Promise<Uint8Array> {
  return actor.account ? await sealVaultKeyTo(vk, actor.account.publicKey, g) : vk.slice();
}

/** The vault key from a grant's inner layer, checked against the Vault's check value. */
async function openInner(inner: Uint8Array, actor: VaultActor, g: VaultGrantFor, check: Uint8Array): Promise<Uint8Array> {
  if (actor.account) return await openVaultGrant(inner, { kind: "custodian" }, actor.account, g, check);
  const vk = inner.slice();
  const keys = await deriveVaultKeys(vk);
  if (!constantTimeEqual(keys.check, check)) {
    vk.fill(0);
    throw new Error("This vault key doesn't match the Vault.");
  }
  return vk;
}

/** Problems with a passcode before anything slow runs, or null. */
export const passcodeProblem = (passcode: string) => checkVaultPasscode(passcode);

class VaultSessions {
  private open = new Map<string, Open>();
  private listeners = new Set<() => void>();
  private client: VaultClient | null = null;
  private actor: VaultActor | null = null;
  private wired = false;
  /** A new recovery key not yet confirmed as saved, by Vault: kept here so a page redraw can't lose it. */
  private recoveryToSave = new Map<string, string>();

  /** The recovery key still to show for a Vault (until `recoverySaved`), or null. */
  recoveryFor(vaultId: string): string | null {
    return this.recoveryToSave.get(vaultId) ?? null;
  }

  recoverySaved(vaultId: string) {
    this.recoveryToSave.delete(vaultId);
    this.emit();
  }

  bind(client: VaultClient, actor: VaultActor | null) {
    this.client = client;
    // No account for a moment (the key session between states): keep what's open. Another person: lock everything.
    if (!actor) return;
    if (this.actor && actor.profileId !== this.actor.profileId) this.lockAll("signout");
    this.actor = actor;
    this.wire();
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit() {
    for (const cb of this.listeners) cb();
  }

  isOpen(vaultId: string): boolean {
    return this.open.has(vaultId);
  }

  /** When an open Vault locks itself (ms since 1970), or null. */
  locksAt(vaultId: string): number | null {
    const o = this.open.get(vaultId);
    return o ? o.lastActive + o.autoLockMs : null;
  }

  /** The current keys of an open Vault (throws when it's locked). */
  keys(vaultId: string, version?: number): VaultKeys {
    const o = this.open.get(vaultId);
    if (!o) throw new Error("The Vault is locked.");
    const k = o.keys.get(version ?? o.current);
    if (!k) throw new Error("This Vault key version isn't available.");
    return k;
  }

  currentVersion(vaultId: string): number | null {
    return this.open.get(vaultId)?.current ?? null;
  }

  /** For the log: this device and the open session. */
  info(vaultId?: string) {
    const o = vaultId ? this.open.get(vaultId) : undefined;
    return vaultClientInfo({ deviceId: this.actor?.deviceId, sessionId: o?.sessionId });
  }

  private need(): { client: VaultClient; actor: VaultActor } {
    if (!this.client || !this.actor) throw new Error("Set up encryption on this device first.");
    return { client: this.client, actor: this.actor };
  }

  /** Activity keeps an open Vault open; tab close, sleep and long hiding lock it. */
  private wire() {
    if (this.wired || typeof window === "undefined") return;
    this.wired = true;
    const active = () => {
      const now = Date.now();
      for (const o of this.open.values()) {
        o.lastActive = now;
        this.arm(o);
      }
    };
    for (const type of ["pointerdown", "keydown", "wheel", "touchstart"]) window.addEventListener(type, active, { capture: true, passive: true });
    window.addEventListener("pagehide", () => this.lockAll("tab"));
    // A computer that slept: the timers didn't run, so a wake finds the clock far past the last tick.
    let tick = Date.now();
    setInterval(() => {
      const now = Date.now();
      if (now - tick > 60_000) this.lockAll("sleep");
      tick = now;
      for (const o of [...this.open.values()]) if (now >= o.lastActive + o.autoLockMs) void this.lock(o.vaultId, "idle");
    }, 5_000);
  }

  private arm(o: Open) {
    if (o.timer) clearTimeout(o.timer);
    o.timer = setTimeout(() => void this.lock(o.vaultId, "idle"), Math.max(1_000, o.lastActive + o.autoLockMs - Date.now()));
  }

  private async adopt(vaultId: string, raw: Map<number, Uint8Array>, current: number, role: string, autoLockMinutes: number) {
    const keys = new Map<number, VaultKeys>();
    const boxes = new Map<number, SecretBox>();
    for (const [version, vk] of raw) {
      keys.set(version, await deriveVaultKeys(vk));
      boxes.set(version, await SecretBox.hold(vk));
    }
    const now = Date.now();
    const o: Open = { vaultId, raw: boxes, keys, current, role, autoLockMs: autoLockMinutes * 60_000, unlockedAt: now, lastActive: now, sessionId: ulid(), timer: null };
    this.open.set(vaultId, o);
    this.arm(o);
    this.emit();
  }

  /**
   * First open of a Vault by its owner: a new vault key, sealed to their account key and then to their passcode and
   * to a new recovery key. Returns the recovery key's text for them to save; nothing else keeps it.
   */
  async setUp(vaultId: string, passcode: string, onProgress?: (f: number) => void): Promise<{ recoveryText: string }> {
    const problem = passcodeProblem(passcode);
    if (problem) throw new Error(problem);
    const { client, actor } = this.need();
    const vk = newVaultKey();
    const g = grantFor(vaultId, 1, actor.profileId);
    const keys = await deriveVaultKeys(vk);
    const inner = await innerFor(vk, actor, g);
    const salt = randomBytes(16);
    const passcodeKey = await vaultPasscodeKey(passcode, { name: "argon2id", ...KDF, salt }, onProgress);
    const recovery = newRecoveryKey();
    const recoveryKey = await vaultRecoveryKey(recovery.bytes);
    await client.mutation(api.vaultKeys.setUp, {
      vaultId,
      check: wire(keys.check),
      passcode: { version: 1, epoch: actor.epoch, wrapped: wire(await wrapWithPasscode(inner, passcodeKey, g)), salt: wire(salt), kdf: KDF },
      recovery: { version: 1, epoch: actor.epoch, wrapped: wire(await wrapWithRecovery(inner, recoveryKey, g)) },
      client: this.info(),
    });
    recovery.bytes.fill(0);
    this.recoveryToSave.set(vaultId, recovery.text);
    // A new Vault locks after the default 5 minutes until someone changes it.
    await this.adopt(vaultId, new Map([[1, vk]]), 1, "owner", 5);
    return { recoveryText: recovery.text };
  }

  /** Unlocks with the passcode, or with the vault recovery key's text. */
  async unlock(vaultId: string, secret: { passcode: string } | { recoveryText: string }, onProgress?: (f: number) => void): Promise<UnlockResult> {
    const { client, actor } = this.need();
    const way = "passcode" in secret ? "passcode" : "recovery";
    let recoveryBytes: Uint8Array | null = null;
    if ("recoveryText" in secret) {
      recoveryBytes = parseRecoveryKey(secret.recoveryText);
      if (!recoveryBytes) return { status: "wrong" };
    }
    const r = await client.mutation(api.vaultKeys.unlock, { vaultId, way, client: this.info() });
    if (r.locked) return { status: "locked", until: r.lockedUntil };
    if (!r.grants.length) return r.fromCustodian.length ? { status: "needsPasscode" } : { status: "notSetUp" };
    const checks = new Map(r.keys.map((k) => [k.version, bytes(k.check)]));
    const raw = new Map<number, Uint8Array>();
    // Each version's inner layer (sealed to the account key), to wrap again after a new key version.
    const inners = new Map<number, Uint8Array>();
    let passcodeKeyUsed: Awaited<ReturnType<typeof vaultPasscodeKey>> | null = null;
    try {
      for (const grant of r.grants) {
        const g = grantFor(vaultId, grant.version, actor.profileId);
        const key =
          way === "passcode"
            ? await vaultPasscodeKey((secret as { passcode: string }).passcode, { name: "argon2id", ...grant.kdf!, salt: bytes(grant.salt!) }, grant.version === r.keyVersion ? onProgress : undefined)
            : await vaultRecoveryKey(recoveryBytes!);
        if (way === "passcode") passcodeKeyUsed = key;
        const inner = await innerOfGrant(bytes(grant.wrapped), { kind: way, key }, g);
        raw.set(grant.version, await openInner(inner, actor, g, checks.get(grant.version)!));
        inners.set(grant.version, inner);
      }
    } catch {
      for (const vk of raw.values()) vk.fill(0);
      const res = await client.mutation(api.vaultKeys.unlockResult, { vaultId, ok: false, way, client: this.info() });
      return res.lockedUntil ? { status: "locked", until: res.lockedUntil } : { status: "wrong" };
    } finally {
      recoveryBytes?.fill(0);
    }
    // Versions a custodian sealed to this person since (a new key after someone left): opened with the account key,
    // then given this person's passcode layer, so the passcode keeps guarding every version.
    const added = r.fromCustodian.filter((gr) => !raw.has(gr.version));
    for (const gr of added) {
      const g = grantFor(vaultId, gr.version, actor.profileId);
      const inner = bytes(gr.wrapped);
      raw.set(gr.version, await openInner(inner, actor, g, checks.get(gr.version)!));
      inners.set(gr.version, inner);
    }
    if (added.length && way === "passcode" && passcodeKeyUsed) {
      const salt = randomBytes(16);
      const passcodeKey = await vaultPasscodeKey((secret as { passcode: string }).passcode, { name: "argon2id", ...KDF, salt });
      const grants = [];
      for (const [version, inner] of inners) {
        const g = grantFor(vaultId, version, actor.profileId);
        grants.push({ version, epoch: actor.epoch, wrapped: wire(await wrapWithPasscode(inner, passcodeKey, g)), salt: wire(salt), kdf: KDF });
      }
      await client.mutation(api.vaultKeys.setPasscode, { vaultId, grants, reason: "rotation", client: this.info() });
    }
    await this.adopt(vaultId, raw, r.keyVersion, r.role, r.autoLockMinutes);
    await client.mutation(api.vaultKeys.unlockResult, { vaultId, ok: true, way, client: this.info(vaultId) });
    return { status: "ok" };
  }

  /**
   * After a custodian shared the key (or a reset), the person chooses their passcode: their device opens the
   * custodian's grant with their account key and wraps it with the new passcode, for every live version.
   */
  async finishWithPasscode(vaultId: string, passcode: string, onProgress?: (f: number) => void): Promise<UnlockResult> {
    const problem = passcodeProblem(passcode);
    if (problem) throw new Error(problem);
    const { client, actor } = this.need();
    const r = await client.mutation(api.vaultKeys.unlock, { vaultId, way: "passcode", client: this.info() });
    if (r.locked) return { status: "locked", until: r.lockedUntil };
    if (!r.fromCustodian.length) return { status: "notSetUp" };
    const checks = new Map(r.keys.map((k) => [k.version, bytes(k.check)]));
    const salt = randomBytes(16);
    const passcodeKey = await vaultPasscodeKey(passcode, { name: "argon2id", ...KDF, salt }, onProgress);
    const raw = new Map<number, Uint8Array>();
    const grants = [];
    for (const grant of r.fromCustodian) {
      const g = grantFor(vaultId, grant.version, actor.profileId);
      const inner = bytes(grant.wrapped);
      raw.set(grant.version, await openInner(inner, actor, g, checks.get(grant.version)!));
      grants.push({ version: grant.version, epoch: actor.epoch, wrapped: wire(await wrapWithPasscode(inner, passcodeKey, g)), salt: wire(salt), kdf: KDF });
    }
    await client.mutation(api.vaultKeys.setPasscode, { vaultId, grants, reason: "first", client: this.info() });
    await this.adopt(vaultId, raw, r.keyVersion, r.role, r.autoLockMinutes);
    await client.mutation(api.vaultKeys.unlockResult, { vaultId, ok: true, way: "passcode", client: this.info(vaultId) });
    return { status: "ok" };
  }

  /**
   * A new passcode, proven by the current one or by the recovery key (a forgotten passcode): the inner layers are
   * re-opened and wrapped again. Leaves the Vault open.
   */
  async changePasscode(vaultId: string, proof: { passcode: string } | { recoveryText: string }, next: string, onProgress?: (f: number) => void): Promise<UnlockResult> {
    const problem = passcodeProblem(next);
    if (problem) throw new Error(problem);
    const { client, actor } = this.need();
    const way = "passcode" in proof ? "passcode" : "recovery";
    const recoveryBytes = "recoveryText" in proof ? parseRecoveryKey(proof.recoveryText) : null;
    if ("recoveryText" in proof && !recoveryBytes) return { status: "wrong" };
    const r = await client.mutation(api.vaultKeys.unlock, { vaultId, way, client: this.info(vaultId) });
    if (r.locked) return { status: "locked", until: r.lockedUntil };
    const salt = randomBytes(16);
    const nextKey = await vaultPasscodeKey(next, { name: "argon2id", ...KDF, salt }, onProgress);
    const grants = [];
    try {
      for (const grant of r.grants) {
        const g = grantFor(vaultId, grant.version, actor.profileId);
        const key = way === "passcode" ? await vaultPasscodeKey((proof as { passcode: string }).passcode, { name: "argon2id", ...grant.kdf!, salt: bytes(grant.salt!) }) : await vaultRecoveryKey(recoveryBytes!);
        const inner = await innerOfGrant(bytes(grant.wrapped), { kind: way, key }, g);
        grants.push({ version: grant.version, epoch: actor.epoch, wrapped: wire(await wrapWithPasscode(inner, nextKey, g)), salt: wire(salt), kdf: KDF });
      }
    } catch {
      const res = await client.mutation(api.vaultKeys.unlockResult, { vaultId, ok: false, way, client: this.info(vaultId) });
      return res.lockedUntil ? { status: "locked", until: res.lockedUntil } : { status: "wrong" };
    } finally {
      recoveryBytes?.fill(0);
    }
    await client.mutation(api.vaultKeys.setPasscode, { vaultId, grants, reason: way === "recovery" ? "reset" : "changed", client: this.info(vaultId) });
    return this.isOpen(vaultId) ? { status: "ok" } : await this.unlock(vaultId, { passcode: next });
  }

  /** A new vault recovery key (the Vault must be open). Returns its text; the old one stops working. */
  async newRecoveryKey(vaultId: string): Promise<{ recoveryText: string }> {
    const { client, actor } = this.need();
    const o = this.open.get(vaultId);
    if (!o) throw new Error("Open the Vault first.");
    const recovery = newRecoveryKey();
    const key = await vaultRecoveryKey(recovery.bytes);
    const grants = [];
    for (const [version, box] of o.raw) {
      const g = grantFor(vaultId, version, actor.profileId);
      const inner = await box.use((vk) => innerFor(vk, actor, g));
      grants.push({ version, epoch: actor.epoch, wrapped: wire(await wrapWithRecovery(inner, key, g)) });
    }
    await client.mutation(api.vaultKeys.setRecovery, { vaultId, grants, client: this.info(vaultId) });
    recovery.bytes.fill(0);
    this.recoveryToSave.set(vaultId, recovery.text);
    this.emit();
    return { recoveryText: recovery.text };
  }

  /**
   * A custodian's device shares the key with everyone waiting who has set up encryption (people added, resets,
   * after a rotation). Returns how many it shared with.
   */
  async grantWaiting(vaultId: string): Promise<number> {
    const { client } = this.need();
    const o = this.open.get(vaultId);
    if (!o) return 0;
    const waiting = await client.query(api.vaultKeys.pending, { vaultId });
    let n = 0;
    for (const p of waiting.people) {
      if (!p.account) continue;
      const grants = [];
      for (const version of waiting.keyVersions) {
        const box = o.raw.get(version);
        if (!box) continue;
        const g = grantFor(vaultId, version, p.profileId);
        const pub = bytes(p.account.x25519Pub);
        grants.push({ version, epoch: p.account.epoch, wrapped: wire(await box.use((vk) => sealVaultKeyTo(vk, pub, g))) });
      }
      await client.mutation(api.vaultKeys.grant, { vaultId, profileId: p.profileId, grants, client: this.info(vaultId) });
      n++;
    }
    return n;
  }

  /**
   * A new key version (a custodian's device, when someone lost access): sealed to everyone who holds the key. New
   * writes use it from now on; each person adds their passcode layer at their next unlock.
   */
  async rotate(vaultId: string): Promise<boolean> {
    const { client } = this.need();
    const o = this.open.get(vaultId);
    if (!o) return false;
    const holders = await client.query(api.vaultPeople.keyHolders, { vaultId });
    if (!holders.rotationNeeded || holders.keyVersion !== o.current) return false;
    const version = o.current + 1;
    const vk = newVaultKey();
    const keys = await deriveVaultKeys(vk);
    const grants = [];
    for (const p of holders.people) {
      grants.push({ profileId: p.profileId, epoch: p.epoch, wrapped: wire(await sealVaultKeyTo(vk, bytes(p.x25519Pub), grantFor(vaultId, version, p.profileId))) });
    }
    await client.mutation(api.vaultPeople.rotate, { vaultId, version, check: wire(keys.check), grants, client: this.info(vaultId) });
    o.keys.set(version, keys);
    o.raw.set(version, await SecretBox.hold(vk));
    o.current = version;
    this.emit();
    return true;
  }

  /** Locks a Vault on this device: forgets its keys and tells the server how it locked (for the log). */
  async lock(vaultId: string, how: LockHow): Promise<void> {
    const o = this.open.get(vaultId);
    if (!o) return;
    if (o.timer) clearTimeout(o.timer);
    for (const box of o.raw.values()) box.clear();
    this.open.delete(vaultId);
    this.emit();
    const info = vaultClientInfo({ deviceId: this.actor?.deviceId, sessionId: o.sessionId });
    await this.client?.mutation(api.vaultKeys.lock, { vaultId, how, openForMs: Date.now() - o.unlockedAt, client: info }).catch(() => undefined);
  }

  lockAll(how: LockHow) {
    for (const id of [...this.open.keys()]) void this.lock(id, how);
  }

  /** Activity inside the Vault (copying, revealing) counts as use. */
  touch(vaultId: string) {
    const o = this.open.get(vaultId);
    if (!o) return;
    o.lastActive = Date.now();
    this.arm(o);
  }
}

let sessions: VaultSessions | null = null;

/** The one Vault session of this page. */
export function vaultSessions(): VaultSessions {
  if (!sessions) sessions = new VaultSessions();
  return sessions;
}

/** Tests only. */
export function resetVaultSessionsForTests() {
  sessions?.lockAll("signout");
  sessions = null;
}
