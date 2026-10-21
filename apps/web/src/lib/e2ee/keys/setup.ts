// Setting encryption up and changing it (docs/E2EE_DESIGN.md §4.7, §4.8, §4.9, §8): the account and its
// first device, the ways to unlock, rotating or resetting the account key, a space's first key and its
// rotation, and handing keys to members and guests. Everything is sealed on this device; the server stores
// public keys, sealed boxes and signed statements.
import {
  ctx,
  deriveAccountKeys,
  deriveSpaceKeys,
  openStatement,
  randomBytes,
  sealRecord,
  sealTo,
  signStatement,
  toBase64Url,
  type AccountKeys,
} from "@folevi/local-store/e2ee";
import { ulid, type WireScope } from "@folevi/editor-schema";
import { keyRingImpl } from "./keyring";
import type { DeviceIdentity } from "./keystore";
import { inMacApp } from "./macBridge";
import { newKdf, passphraseProblem, wrapWithPassphrase } from "./passphrase";
import { createPrfCredential, evaluatePrf, passkeysPossible, wrapWithPrf } from "./passkey";
import { groupsMatch, newRecoveryKey, wrapWithRecoveryKey } from "./recoveryKey";
import type { AccountKeysRow } from "./server";
import { sessionImpl, type KeySessionImpl, type Unlocked } from "./session";
import { KeysError, bytes, errorCode, scopeString, wire } from "./util";

const BATCH = 200;

type Registration = { epoch: number; x25519Pub: ArrayBuffer; ed25519Pub: ArrayBuffer; amkCheck: ArrayBuffer; statement: { kind: "account-key"; body: string; sig: string } };

async function newAccount(profileId: string, epoch: number, now: number): Promise<{ amk: Uint8Array; keys: AccountKeys; reg: Registration }> {
  const amk = randomBytes(32);
  const keys = await deriveAccountKeys(amk);
  const statement = await signStatement(keys.ed25519.privateKey, "account-key", {
    profileId,
    epoch,
    x25519Pub: toBase64Url(keys.x25519.publicKey),
    ed25519Pub: toBase64Url(keys.ed25519.publicKey),
    createdAt: now,
  });
  return { amk, keys, reg: { epoch, x25519Pub: wire(keys.x25519.publicKey), ed25519Pub: wire(keys.ed25519.publicKey), amkCheck: wire(keys.check), statement } };
}

async function deviceStatement(keys: AccountKeys, s: KeySessionImpl, profileId: string, dev: DeviceIdentity, now: number) {
  return signStatement(keys.ed25519.privateKey, "device", {
    profileId,
    deviceId: dev.deviceId,
    kind: dev.kind,
    x25519Pub: toBase64Url(dev.x25519Pub),
    ed25519Pub: toBase64Url(dev.ed25519Pub),
    label: s.label(dev.kind),
    approvedBy: "recovery",
    approvedAt: now,
  });
}

/** Another person's current account keys, after checking their self-signed account statement is consistent. */
async function checkedAccount(row: AccountKeysRow): Promise<{ profileId: string; epoch: number; x25519Pub: Uint8Array; ed25519Pub: Uint8Array } | null> {
  const x = bytes(row.x25519Pub);
  const ed = bytes(row.ed25519Pub);
  const body = await openStatement(ed, row.statement as { kind: "account-key"; body: string; sig: string });
  if (!body || body.profileId !== row.profileId || body.epoch !== row.epoch || body.x25519Pub !== toBase64Url(x) || body.ed25519Pub !== toBase64Url(ed)) return null;
  return { profileId: row.profileId, epoch: row.epoch, x25519Pub: x, ed25519Pub: ed };
}

async function spaceGrant(u: Unlocked, scopeId: string, version: number, to: { profileId: string; epoch: number; x25519Pub: Uint8Array }, raw: Uint8Array, signer = u.account) {
  const wrapped = await sealTo(to.x25519Pub, ctx.spaceGrant(scopeId, version, to.profileId), raw);
  const statement = await signStatement(signer.ed25519.privateKey, "space-grant", {
    scope: scopeId,
    version,
    profileId: to.profileId,
    granteeX25519Pub: toBase64Url(to.x25519Pub),
    grantedBy: u.profileId,
    at: u.now(),
  });
  return { profileId: to.profileId, version, epoch: to.epoch, wrapped: wire(wrapped), statement };
}

const ring = keyRingImpl;
const me = (u: Unlocked) => ({ profileId: u.profileId, epoch: u.epoch, x25519Pub: u.account.x25519.publicKey });

async function inBatches<T>(items: T[], fn: (batch: T[], index: number) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH) await fn(items.slice(i, i + BATCH), i / BATCH);
}

/** Note keys of a space wrapped by a new space key version: the newest version of each note this device can open. */
async function rewrapNoteKeys(scope: WireScope, scopeId: string, newVersion: number, wrapKey: Awaited<ReturnType<typeof deriveSpaceKeys>>["wrap"], onProgress?: (n: number, of: number) => void) {
  const rows = await ring().allNoteKeyRows(scope);
  const newest = new Map<string, number>();
  for (const r of rows) newest.set(r.documentId, Math.max(newest.get(r.documentId) ?? 0, r.version));
  const out: { documentId: string; version: number; wrappedBy: "space"; spaceVersion: number; wrapped: ArrayBuffer }[] = [];
  let n = 0;
  for (const [documentId, version] of newest) {
    let raw: Uint8Array | null = null;
    try {
      raw = await ring().openNoteRaw(documentId, version);
      const wrapped = await sealRecord(wrapKey, newVersion, ctx.noteKeySpace(documentId, version, scopeId, newVersion), raw);
      out.push({ documentId, version, wrappedBy: "space", spaceVersion: newVersion, wrapped: wire(wrapped) });
    } catch {
      // A note whose key this device can't open (none of its wraps are ours): left to a device that can.
    } finally {
      raw?.fill(0);
    }
    onProgress?.(++n, newest.size * 2);
  }
  return out;
}

export const setup = {
  /** Sets encryption up for this account: the account master key, its keys, and this device as the first trusted one. */
  async createAccount(): Promise<void> {
    const s = sessionImpl();
    const b = s.bound();
    const status = await s.refreshStatus();
    if (status?.setUp) return;
    const now = (b.now ?? Date.now)();
    const { amk, keys, reg } = await newAccount(b.profileId, 1, now);
    try {
      const dev = await s.deviceToTrust();
      const deviceWrap = await sealTo(dev.x25519Pub, ctx.amkDevice(b.profileId, dev.deviceId), amk);
      await b.server.keys.createAccount({
        x25519Pub: reg.x25519Pub,
        ed25519Pub: reg.ed25519Pub,
        amkCheck: reg.amkCheck,
        statement: reg.statement,
        device: {
          deviceId: dev.deviceId,
          kind: dev.kind,
          label: s.label(dev.kind),
          platform: s.platform(),
          x25519Pub: wire(dev.x25519Pub),
          ed25519Pub: wire(dev.ed25519Pub),
          statement: await deviceStatement(keys, s, b.profileId, dev, now),
        },
        deviceWrap: wire(deviceWrap),
      });
      await s.markTrusted(dev);
      await s.adopt(amk, 1, keys, dev);
      await s.cacheWrap(dev, 1, deviceWrap);
      await s.refreshStatus();
    } finally {
      amk.fill(0);
    }
  },

  /**
   * A new recovery key, shown once (§4.7.1). It counts, and replaces the old one, only once `confirm` gets
   * groups 3 and 7 back.
   */
  async addRecoveryKey(): Promise<{ text: string; confirm(groups: [string, string]): Promise<boolean> }> {
    sessionImpl().unlocked();
    const { bytes: keyBytes, text } = newRecoveryKey();
    let done = false;
    return {
      text,
      async confirm(groups) {
        if (done) return true;
        if (!groupsMatch(text, groups)) return false;
        const u = sessionImpl().unlocked();
        const wrapId = ulid();
        const wrapped = await u.amk.use((raw) => wrapWithRecoveryKey(keyBytes, u.epoch, ctx.amkRecovery(u.profileId, wrapId), raw));
        await u.server.keys.addWrap({ kind: "recoveryKey", wrapId, wrapped: wire(wrapped), label: "Recovery key" });
        keyBytes.fill(0);
        done = true;
        return true;
      },
    };
  },

  /** The encryption passphrase (§4.7.3). Refuses a short or common one with `e2ee_passphrase_short` / `_common`. */
  async addPassphrase(p: string): Promise<void> {
    const problem = passphraseProblem(p);
    if (problem) throw new KeysError(`e2ee_passphrase_${problem}`, problem === "short" ? "Use at least 12 characters." : "That passphrase is too common.");
    const u = sessionImpl().unlocked();
    const kdf = newKdf();
    const wrapId = ulid();
    const wrapped = await u.amk.use((raw) => wrapWithPassphrase(p, kdf, u.epoch, ctx.amkPassphrase(u.profileId, wrapId), raw));
    await u.server.keys.addWrap({
      kind: "passphrase",
      wrapId,
      wrapped: wire(wrapped),
      kdf: { name: "argon2id", m: kdf.m, t: kdf.t, p: kdf.p, salt: wire(kdf.salt) },
      label: "Encryption passphrase",
    });
  },

  /** A passkey with PRF (§4.7.2). Not in the Mac app. */
  async addPasskey(label: string): Promise<"ok" | "unsupported" | "cancelled"> {
    if (inMacApp() || !passkeysPossible()) return "unsupported";
    const u = sessionImpl().unlocked();
    const r = await createPrfCredential(u.email);
    if (typeof r === "string") return r;
    const wrapped = await u.amk.use((raw) => wrapWithPrf(r.prfOutput, u.epoch, ctx.amkPasskey(u.profileId, r.credentialId), raw));
    await u.server.keys.addWrap({ kind: "passkey", credentialId: r.credentialId, prfSalt: wire(r.prfSalt), wrapped: wire(wrapped), label: label || "Passkey" });
    return "ok";
  },

  /** Removes a way to unlock; the server refuses with `e2ee_last_method` when it would leave fewer than two. */
  async removeMethod(publicId: string): Promise<void> {
    await sessionImpl().bound().server.keys.removeWrap({ publicId });
  },

  /**
   * A new account master key (after removing a device with "Also change your encryption key", §4.8): wraps
   * for every remaining trusted device; a new recovery key when there was one (returned: it must be shown);
   * the passphrase again when it's given; passkeys again through a passkey prompt (`passkeys`, default on);
   * every space key granted again to the new account key; then a new Personal space key, so the removed
   * device can't read new notes. The server refuses (`e2ee_recovery_required`) if fewer than two kinds of
   * ways in would be left.
   */
  async rotateAccount(o: { passphrase?: string; passkeys?: boolean } = {}): Promise<{ recoveryKey: string | null }> {
    const s = sessionImpl();
    const u = s.unlocked();
    const status = await s.refreshStatus();
    if (!status?.setUp) throw new KeysError("e2ee_not_set_up", "Set up encryption first.");
    if (o.passphrase !== undefined) {
      const problem = passphraseProblem(o.passphrase);
      if (problem) throw new KeysError(`e2ee_passphrase_${problem}`, "Choose another passphrase.");
    }
    const epoch = status.epoch + 1;
    const { amk, keys, reg } = await newAccount(u.profileId, epoch, u.now());
    let recoveryText: string | null = null;
    try {
      const methods = await u.server.keys.listWraps({});
      const wraps: { kind: "device" | "recoveryKey" | "passkey" | "passphrase"; wrapped: ArrayBuffer; deviceId?: string; credentialId?: string; prfSalt?: ArrayBuffer; kdf?: { name: "argon2id"; m: number; t: number; p: number; salt: ArrayBuffer }; label?: string; wrapId?: string }[] = [];
      const deviceStatements: { deviceId: string; statement: { kind: "device"; body: string; sig: string } }[] = [];
      let ownWrap: Uint8Array | null = null;
      // Devices: only those whose statement this account signed (a device the server slipped in gets nothing).
      for (const d of await u.server.devices.list({})) {
        if (d.status !== "trusted" || d.kind === "session" || !d.statement) continue;
        const body = await openStatement(u.account.ed25519.publicKey, d.statement as { kind: "device"; body: string; sig: string });
        if (!body || body.deviceId !== d.deviceId || body.x25519Pub !== toBase64Url(bytes(d.x25519Pub)) || body.ed25519Pub !== toBase64Url(bytes(d.ed25519Pub))) continue;
        const wrapped = await sealTo(bytes(d.x25519Pub), ctx.amkDevice(u.profileId, d.deviceId), amk);
        if (d.deviceId === u.device?.deviceId) ownWrap = wrapped;
        wraps.push({ kind: "device", deviceId: d.deviceId, wrapped: wire(wrapped) });
        deviceStatements.push({ deviceId: d.deviceId, statement: await signStatement(keys.ed25519.privateKey, "device", body) });
      }
      if (methods.some((m) => m.kind === "recoveryKey")) {
        const rk = newRecoveryKey();
        const wrapId = ulid();
        wraps.push({ kind: "recoveryKey", wrapId, wrapped: wire(await wrapWithRecoveryKey(rk.bytes, epoch, ctx.amkRecovery(u.profileId, wrapId), amk)), label: "Recovery key" });
        rk.bytes.fill(0);
        recoveryText = rk.text;
      }
      if (o.passphrase !== undefined) {
        const kdf = newKdf();
        const wrapId = ulid();
        wraps.push({
          kind: "passphrase",
          wrapId,
          wrapped: wire(await wrapWithPassphrase(o.passphrase, kdf, epoch, ctx.amkPassphrase(u.profileId, wrapId), amk)),
          kdf: { name: "argon2id", m: kdf.m, t: kdf.t, p: kdf.p, salt: wire(kdf.salt) },
          label: "Encryption passphrase",
        });
      }
      const passkeys = methods.filter((m) => m.kind === "passkey" && m.credentialId && m.prfSalt);
      if (passkeys.length && o.passkeys !== false && passkeysPossible()) {
        const r = await evaluatePrf(passkeys.map((m) => ({ credentialId: m.credentialId!, prfSalt: bytes(m.prfSalt!) })));
        if (typeof r !== "string") {
          const m = passkeys.find((x) => x.credentialId === r.credentialId)!;
          wraps.push({ kind: "passkey", credentialId: r.credentialId, prfSalt: wire(bytes(m.prfSalt!)), wrapped: wire(await wrapWithPrf(r.prfOutput, epoch, ctx.amkPasskey(u.profileId, r.credentialId), amk)), label: m.label ?? "Passkey" });
        }
      }
      // Every space key this person holds, granted again to the new account key (the keys themselves stay).
      const regrants: { scope: WireScope; grant: Awaited<ReturnType<typeof spaceGrant>> }[] = [];
      const target = { profileId: u.profileId, epoch, x25519Pub: keys.x25519.publicKey };
      for (const space of await ring().loadSpaces(true)) {
        for (const g of space.grants) {
          const grant = await ring().withRawSpaceKey(space.scope, g.version, (raw) => spaceGrant(u, space.scopeId, g.version, target, raw, keys));
          regrants.push({ scope: space.scope, grant });
        }
      }
      await u.server.keys.rotateAccount({ newEpoch: reg, wraps, regrants, deviceStatements });
      await s.adopt(new Uint8Array(amk), epoch, keys, u.device);
      if (u.device && ownWrap) await s.cacheWrap(u.device, epoch, ownWrap);
      await s.refreshStatus();
    } finally {
      amk.fill(0);
    }
    // New notes in Personal get a key the removed device never had.
    const personal: WireScope = { kind: "personal" };
    const row = await s.bound().server.spaces.get({ scope: personal });
    if (row.setUp) await setup.rotateSpace(personal, () => undefined);
    return { recoveryKey: recoveryText };
  },

  /**
   * Starts over when every way to unlock is lost (§8.7): a new account master key with this device as its
   * first trusted device. Notes keyed only to the old key stay unreadable; workspaces wait for an admin's
   * device to share their keys again; Personal gets a new key for new notes. The person then adds recovery
   * methods again (the wizard's methods step).
   */
  async resetAccount(): Promise<void> {
    const s = sessionImpl();
    const b = s.bound();
    const status = await s.refreshStatus();
    if (!status?.setUp) return setup.createAccount();
    const now = (b.now ?? Date.now)();
    const epoch = status.epoch + 1;
    const { amk, keys, reg } = await newAccount(b.profileId, epoch, now);
    try {
      s.lock();
      let dev = await s.deviceToTrust();
      // Signed by the new account key, which is the one every device will check it against.
      const statement = await deviceStatement(keys, s, b.profileId, dev, now);
      const device = { deviceId: dev.deviceId, kind: dev.kind, label: s.label(dev.kind), platform: s.platform(), x25519Pub: wire(dev.x25519Pub), ed25519Pub: wire(dev.ed25519Pub), statement };
      try {
        await b.server.devices.register({ device });
      } catch (e) {
        if (errorCode(e) !== "forbidden") throw e;
        // This device's id was removed from the account before: new keys and a new id.
        await s.mac()?.reset();
        dev = await s.deviceToTrust(true);
        Object.assign(device, { deviceId: dev.deviceId, x25519Pub: wire(dev.x25519Pub), ed25519Pub: wire(dev.ed25519Pub), statement: await deviceStatement(keys, s, b.profileId, dev, now) });
        await b.server.devices.register({ device });
      }
      const wrapped = await sealTo(dev.x25519Pub, ctx.amkDevice(b.profileId, dev.deviceId), amk);
      await b.server.keys.resetAccount({ newEpoch: reg, wraps: [{ kind: "device", deviceId: dev.deviceId, wrapped: wire(wrapped) }] });
      await s.markTrusted(dev);
      await s.adopt(new Uint8Array(amk), epoch, keys, dev);
      await s.cacheWrap(dev, epoch, wrapped);
      await s.refreshStatus();
    } finally {
      amk.fill(0);
    }
    const personal: WireScope = { kind: "personal" };
    const row = await b.server.spaces.get({ scope: personal });
    if (row.setUp) await freshSpaceKey(personal, row.currentKeyVersion + 1);
  },

  /** A space's first key (version 1), granted to this person and, in a workspace, to every member with keys. */
  async setUpSpace(scope: WireScope): Promise<void> {
    const u = sessionImpl().unlocked();
    const scopeId = scopeString(scope, u.profileId);
    const sk = randomBytes(32);
    try {
      const keys = await deriveSpaceKeys(sk);
      const own = await spaceGrant(u, scopeId, 1, me(u), sk);
      await u.server.spaces.setUp({ scope, key: { version: 1, inboxPub: wire(keys.inbox.publicKey), skCheck: wire(keys.check) }, grants: [own] });
      await ring().rememberSpaceKey(scope, 1, sk, { epoch: u.epoch, wrapped: bytes(own.wrapped) });
    } finally {
      sk.fill(0);
    }
    if (scope.kind === "workspace") await setup.completePendingGrants(scope).catch(() => 0);
  },

  /**
   * A new space key (§4.9, §8.3): version n+1 granted to every remaining member with keys, version n retired,
   * and the newest key of every note wrapped by the new version. Old data is re-sealed in the background.
   */
  async rotateSpace(scope: WireScope, onProgress: (n: number, of: number) => void): Promise<void> {
    const u = sessionImpl().unlocked();
    const scopeId = scopeString(scope, u.profileId);
    const current = await ring().currentVersion(scope);
    const version = current + 1;
    const sk = randomBytes(32);
    try {
      const keys = await deriveSpaceKeys(sk);
      const grants = [await spaceGrant(u, scopeId, version, me(u), sk)];
      if (scope.kind === "workspace") {
        const holders = await u.server.spaces.keyHolders({ scope });
        const people = new Set([...holders.holders.map((h) => h.profileId), ...holders.pending.filter((p) => p.hasKeys && (p.reason === "joined" || p.reason === "reset")).map((p) => p.profileId)]);
        people.delete(u.profileId);
        for (const row of people.size ? await u.server.keys.accountKeysOf({ profileIds: [...people] }) : []) {
          const acct = await checkedAccount(row);
          if (acct) grants.push(await spaceGrant(u, scopeId, version, acct, sk));
        }
      }
      const noteKeys = await rewrapNoteKeys(scope, scopeId, version, keys.wrap, (n, of) => onProgress(n, of));
      const total = noteKeys.length;
      await u.server.spaces.rotate({ scope, key: { version, inboxPub: wire(keys.inbox.publicKey), skCheck: wire(keys.check) }, grants, noteKeys: noteKeys.slice(0, BATCH) });
      await ring().rememberSpaceKey(scope, version, sk, { epoch: u.epoch, wrapped: bytes(grants[0]!.wrapped) });
      let done = Math.min(BATCH, total);
      onProgress(total + done, total * 2 || 1);
      await inBatches(noteKeys.slice(BATCH), async (batch) => {
        await u.server.spaces.addNoteKeyWraps({ scope, noteKeys: batch });
        done += batch.length;
        onProgress(total + done, total * 2);
      });
      await ring().addNoteKeys(noteKeys.map((n) => ({ ...n, scope })));
    } finally {
      sk.fill(0);
    }
  },

  /**
   * Shares a space's keys with members waiting for them (§8.2, §8.7): every version this person holds, to each
   * waiting member who has set up encryption. Page invites ("page" pending rows) get the page's note key.
   * Owners and admins only; anyone else gets 0. Returns how many people got keys.
   */
  async completePendingGrants(scope: WireScope): Promise<number> {
    const u = sessionImpl().unlocked();
    const scopeId = scopeString(scope, u.profileId);
    let rows;
    try {
      rows = await u.server.grants.pending({ scope });
    } catch (e) {
      if (errorCode(e) === "forbidden") return 0;
      throw e;
    }
    const waiting = rows.filter((r) => r.hasKeys && r.profileId !== u.profileId);
    if (!waiting.length) return 0;
    const accounts = new Map<string, NonNullable<Awaited<ReturnType<typeof checkedAccount>>>>();
    for (const row of await u.server.keys.accountKeysOf({ profileIds: [...new Set(waiting.map((r) => r.profileId))] })) {
      const acct = await checkedAccount(row);
      if (acct) accounts.set(acct.profileId, acct);
    }
    const versions = await ring().heldVersions(scope);
    const grants: Awaited<ReturnType<typeof spaceGrant>>[] = [];
    const people = new Set<string>();
    for (const r of waiting) {
      const acct = accounts.get(r.profileId);
      if (!acct) continue;
      if (r.reason === "page" && r.documentId) {
        await setup.grantNote(r.documentId, r.profileId).then(
          () => people.add(r.profileId),
          () => undefined,
        );
        continue;
      }
      if (r.reason !== "joined" && r.reason !== "reset") continue;
      for (const v of versions) grants.push(await ring().withRawSpaceKey(scope, v, (raw) => spaceGrant(u, scopeId, v, acct, raw)));
      people.add(r.profileId);
    }
    await inBatches(grants, async (batch) => {
      await u.server.grants.grantSpace({ scope, grants: batch });
    });
    return people.size;
  },

  /** Gives a page's newest note key to a person it's shared with (§8.4). Sub-pages are granted one by one by the caller. */
  async grantNote(documentId: string, profileId: string): Promise<void> {
    const u = sessionImpl().unlocked();
    const [row] = await u.server.keys.accountKeysOf({ profileIds: [profileId] });
    const acct = row ? await checkedAccount(row) : null;
    if (!acct) throw new KeysError("e2ee_no_keys", "They haven't set up encryption yet.");
    const { version } = await ring().noteKeys(documentId);
    const raw = await ring().openNoteRaw(documentId, version);
    try {
      const wrapped = await sealTo(acct.x25519Pub, ctx.noteKeyGrant(documentId, version, profileId), raw);
      const statement = await signStatement(u.account.ed25519.privateKey, "note-grant", {
        documentId,
        version,
        profileId,
        granteeX25519Pub: toBase64Url(acct.x25519Pub),
        grantedBy: u.profileId,
        at: u.now(),
      });
      await u.server.grants.grantNote({ documentId, version, profileId, wrapped: wire(wrapped), statement });
    } finally {
      raw.fill(0);
    }
  },
};

/** After a reset: a space key version that only this person holds, with no old note keys (they can't be opened). */
async function freshSpaceKey(scope: WireScope, version: number): Promise<void> {
  const u = sessionImpl().unlocked();
  const scopeId = scopeString(scope, u.profileId);
  const sk = randomBytes(32);
  try {
    const keys = await deriveSpaceKeys(sk);
    const own = await spaceGrant(u, scopeId, version, me(u), sk);
    await u.server.spaces.rotate({ scope, key: { version, inboxPub: wire(keys.inbox.publicKey), skCheck: wire(keys.check) }, grants: [own], noteKeys: [] });
    await ring().rememberSpaceKey(scope, version, sk, { epoch: u.epoch, wrapped: bytes(own.wrapped) });
  } finally {
    sk.fill(0);
  }
}
