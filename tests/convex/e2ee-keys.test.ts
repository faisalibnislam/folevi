// End-to-end encryption, account keys and devices (docs/E2EE_DESIGN.md §4.7, §4.8, §5.3; WP2): setting
// up, the two-method rule, the unlock rate limit, device approval (commit, answer, reveal, complete),
// expiry and lockout, revoking, rotating and resetting the account key.
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import {
  authSession,
  deviceRegistration,
  deviceStatement,
  e2eeDeviceKeys,
  e2eeEpoch,
  e2eeLib,
  e2eePerson,
  e2eeRecoveryMethods,
  e2eeScopeString,
  e2eeSpace,
  enableE2eeFlag,
  identity,
  join,
  person,
  PERSONAL,
  setup,
  spaceGrant,
  teamWorkspace,
  ulid,
  wire,
  type E2eePerson,
  type T,
} from "./helpers";

const dataOf = (e: unknown) => (e as { data?: Record<string, unknown> }).data;

/** The same person signed in on another browser (a second session). */
async function otherBrowser(t: T, p: { userId: string; as: E2eePerson["as"] }, email: string) {
  const sessionId = await authSession(t, p.userId);
  return t.withIdentity(identity(email, { subject: p.userId, tokenIdentifier: `https://test.folevi.local|${p.userId}`, sessionId }));
}

async function setUpAndEncrypt(p: E2eePerson) {
  await e2eeRecoveryMethods(p);
  await e2eeSpace(p, PERSONAL);
  await p.as.mutation(api.e2ee.spaces.enable, { scope: PERSONAL, level: "selected", switches: { foliAi: "ask", backgroundAi: false, searchEverywhere: false, apps: false, emailToNote: false, webClipper: false, notificationPreviews: false } });
}

describe("setting up", () => {
  test("Standard accounts have nothing: status says not set up, and no E2EE rows exist", async () => {
    const t = setup();
    const a = await person(t, "plain@example.com");
    expect(await a.as.query(api.e2ee.keys.status, {})).toMatchObject({ setUp: false, epoch: null, methods: [] });
    expect(await a.as.query(api.e2ee.keys.listWraps, {})).toEqual([]);
    expect(await a.as.query(api.e2ee.spaces.mine, {})).toEqual([]);
    expect(await a.as.query(api.e2ee.spaces.get, { scope: PERSONAL })).toMatchObject({ setUp: false, level: "standard", active: false, switches: { foliAi: "auto", searchEverywhere: true, apps: true } });
    const counts = await t.run(async (ctx) => ({
      accounts: (await ctx.db.query("e2eeAccounts").collect()).length,
      spaces: (await ctx.db.query("e2eeSpaces").collect()).length,
      devices: (await ctx.db.query("e2eeDevices").collect()).length,
    }));
    expect(counts).toEqual({ accounts: 0, spaces: 0, devices: 0 });
  });

  test("the e2ee flag gates setting up until launch", async () => {
    const t = setup();
    const a = await person(t, "flag@example.com");
    const { keys, statement } = await e2eeEpoch(a.profileId, 1);
    const device = await e2eeDeviceKeys();
    const err = await a.as
      .mutation(api.e2ee.keys.createAccount, { x25519Pub: wire(keys.x25519.publicKey), ed25519Pub: wire(keys.ed25519.publicKey), amkCheck: wire(keys.check), statement, device: deviceRegistration(device), deviceWrap: new ArrayBuffer(97) })
      .catch(dataOf);
    expect(err).toMatchObject({ code: "e2ee_unavailable", feature: "e2ee" });
  });

  test("createAccount stores public keys and the first trusted device with its own wrap; it opens on that device", async () => {
    const t = setup();
    const a = await e2eePerson(t, "setup@example.com");
    const status = await a.as.query(api.e2ee.keys.status, {});
    expect(status).toMatchObject({ setUp: true, epoch: 1, devices: 1, methods: [] });
    const e2ee = await e2eeLib();
    expect(new Uint8Array(status.x25519Pub!)).toEqual(a.account.x25519.publicKey);
    expect(await e2ee.verifyStatement(a.account.ed25519.publicKey, status.statement!)).toBe(true);
    const wrap = await a.as.query(api.e2ee.keys.getDeviceWrap, { deviceId: a.device.deviceId });
    const opened = await e2ee.openSealed(a.device.x.privateKey, a.device.x.publicKey, e2ee.ctx.amkDevice(a.profileId, a.device.deviceId), new Uint8Array(wrap!.wrapped));
    expect(opened).toEqual(a.amk);
    // Only one account per person.
    const again = await e2eeEpoch(a.profileId, 1);
    await expect(
      a.as.mutation(api.e2ee.keys.createAccount, { x25519Pub: again.registration.x25519Pub, ed25519Pub: again.registration.ed25519Pub, amkCheck: again.registration.amkCheck, statement: again.statement, device: deviceRegistration(await e2eeDeviceKeys()), deviceWrap: new ArrayBuffer(97) }),
    ).rejects.toThrow(/already set up/);
  });

  test("a statement that names another person or other keys is refused", async () => {
    const t = setup();
    const a = await person(t, "liar@example.com");
    const b = await person(t, "victim@example.com");
    await enableE2eeFlag(t);
    const { keys, statement } = await e2eeEpoch(b.profileId, 1);
    const device = await e2eeDeviceKeys();
    await expect(
      a.as.mutation(api.e2ee.keys.createAccount, { x25519Pub: wire(keys.x25519.publicKey), ed25519Pub: wire(keys.ed25519.publicKey), amkCheck: wire(keys.check), statement, device: deviceRegistration(device), deviceWrap: new ArrayBuffer(97) }),
    ).rejects.toThrow(/doesn't match \(profileId\)/);
    const own = await e2eeEpoch(a.profileId, 1);
    const other = await e2eeEpoch(a.profileId, 1);
    await expect(
      a.as.mutation(api.e2ee.keys.createAccount, { x25519Pub: other.registration.x25519Pub, ed25519Pub: own.registration.ed25519Pub, amkCheck: own.registration.amkCheck, statement: own.statement, device: deviceRegistration(device), deviceWrap: new ArrayBuffer(97) }),
    ).rejects.toThrow(/doesn't match \(x25519Pub\)/);
  });
});

describe("recovery methods and the two-method rule", () => {
  test("adding a recovery key and a passphrase counts two kinds; listWraps never returns the wrapped key", async () => {
    const t = setup();
    const a = await e2eePerson(t, "methods@example.com");
    const { recovery, recoveryWrapId } = await e2eeRecoveryMethods(a);
    expect((await a.as.query(api.e2ee.keys.status, {})).methods).toEqual(["passphrase", "recoveryKey"]);
    const listed = await a.as.query(api.e2ee.keys.listWraps, {});
    expect(listed.map((w) => w.kind).sort()).toEqual(["device", "passphrase", "recoveryKey"]);
    for (const w of listed) expect(w).not.toHaveProperty("wrapped");
    // The recovery wrap opens with the recovery key, under its own id's context.
    const e2ee = await e2eeLib();
    const got = await a.as.mutation(api.e2ee.keys.getWrap, { kind: "recoveryKey" });
    expect(got!.publicId).toBe(recoveryWrapId);
    const opened = await e2ee.openRecord(await e2ee.recoveryWrapKey(e2ee.parseRecoveryKey(recovery.text)!), e2ee.ctx.amkRecovery(a.profileId, recoveryWrapId), new Uint8Array(got!.wrapped));
    expect(opened).toEqual(a.amk);
    // A new recovery key replaces the old one.
    const second = await e2eeRecoveryMethods(a);
    const after = await a.as.query(api.e2ee.keys.listWraps, {});
    expect(after.filter((w) => w.kind === "recoveryKey").map((w) => w.publicId)).toEqual([second.recoveryWrapId]);
    expect(after.filter((w) => w.kind === "passphrase").map((w) => w.publicId)).toEqual([second.passWrapId]);
  });

  test("weak passphrase settings, a malformed passkey and a session's device wrap are refused", async () => {
    const t = setup();
    const a = await e2eePerson(t, "weak@example.com");
    await expect(a.as.mutation(api.e2ee.keys.addWrap, { kind: "passphrase", wrapped: new ArrayBuffer(70), kdf: { name: "argon2id", m: 1024, t: 1, p: 1, salt: new ArrayBuffer(16) } })).rejects.toThrow(/too weak/);
    await expect(a.as.mutation(api.e2ee.keys.addWrap, { kind: "passkey", wrapped: new ArrayBuffer(70), credentialId: "abc" })).rejects.toThrow(/salt/);
    await expect(a.as.mutation(api.e2ee.keys.addWrap, { kind: "recoveryKey", wrapped: new ArrayBuffer(10) })).rejects.toThrow(/bytes/);
    await expect(a.as.mutation(api.e2ee.keys.addWrap, { kind: "recoveryKey", wrapId: "not-a-ulid", wrapped: new ArrayBuffer(70) })).rejects.toThrow(/wrap id/);
    const passkey = await a.as.mutation(api.e2ee.keys.addWrap, { kind: "passkey", wrapped: new ArrayBuffer(70), credentialId: "Y3JlZA", prfSalt: new ArrayBuffer(32), label: "Phone\u0000 passkey" });
    const listed = await a.as.query(api.e2ee.keys.listWraps, {});
    expect(listed.find((w) => w.publicId === passkey.publicId)).toMatchObject({ kind: "passkey", credentialId: "Y3JlZA", label: "Phone passkey" });
  });

  test("encrypting a space needs two kinds; then removing one that leaves one is refused (e2ee_last_method)", async () => {
    const t = setup();
    const a = await e2eePerson(t, "two@example.com");
    await e2eeSpace(a, PERSONAL);
    const switches = { foliAi: "ask" as const, backgroundAi: false, searchEverywhere: false, apps: false, emailToNote: false, webClipper: false, notificationPreviews: false };
    expect(await a.as.mutation(api.e2ee.spaces.enable, { scope: PERSONAL, level: "selected", switches }).catch(dataOf)).toMatchObject({ code: "e2ee_recovery_required" });
    const { recoveryWrapId, passWrapId } = await e2eeRecoveryMethods(a);
    await a.as.mutation(api.e2ee.spaces.enable, { scope: PERSONAL, level: "selected", switches });
    expect(await a.as.mutation(api.e2ee.keys.removeWrap, { publicId: recoveryWrapId }).catch(dataOf)).toMatchObject({ code: "e2ee_last_method" });
    // With a third kind, one can go.
    await a.as.mutation(api.e2ee.keys.addWrap, { kind: "passkey", wrapped: new ArrayBuffer(70), credentialId: "Y3JlZA", prfSalt: new ArrayBuffer(32) });
    await a.as.mutation(api.e2ee.keys.removeWrap, { publicId: passWrapId });
    expect((await a.as.query(api.e2ee.keys.status, {})).methods).toEqual(["passkey", "recoveryKey"]);
  });

  test("without an encrypted space, methods can be removed freely; others' wraps read as not found", async () => {
    const t = setup();
    const a = await e2eePerson(t, "free@example.com");
    const b = await e2eePerson(t, "other@example.com");
    const { recoveryWrapId } = await e2eeRecoveryMethods(a);
    await expect(b.as.mutation(api.e2ee.keys.removeWrap, { publicId: recoveryWrapId })).rejects.toThrow(/Not found/);
    await a.as.mutation(api.e2ee.keys.removeWrap, { publicId: recoveryWrapId });
    expect((await a.as.query(api.e2ee.keys.status, {})).methods).toEqual(["passphrase"]);
  });

  test("two trusted browsers count as the device method", async () => {
    const t = setup();
    const a = await e2eePerson(t, "devices@example.com");
    const second = await e2eeDeviceKeys();
    const statement = await deviceStatement(a.account, a.profileId, second, "recovery");
    await a.as.mutation(api.e2ee.devices.register, { device: deviceRegistration(second, "browser", statement) });
    await a.as.mutation(api.e2ee.keys.addWrap, { kind: "device", deviceId: second.deviceId, wrapped: new ArrayBuffer(97) });
    expect((await a.as.query(api.e2ee.keys.status, {})).methods).toEqual(["device"]);
  });
});

describe("unlocking is rate limited (§4.7.3)", () => {
  test("ten wrap fetches an hour, then e2ee_rate_limited; the next hour works again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 21, 10, 5));
    try {
      const t = setup();
      const a = await e2eePerson(t, "rate@example.com");
      await e2eeRecoveryMethods(a);
      for (let i = 0; i < 10; i++) expect(await a.as.mutation(api.e2ee.keys.getWrap, { kind: "passphrase" })).not.toBeNull();
      const err = await a.as.mutation(api.e2ee.keys.getWrap, { kind: "recoveryKey" }).catch(dataOf);
      expect(err).toMatchObject({ code: "e2ee_rate_limited" });
      vi.setSystemTime(Date.UTC(2026, 9, 21, 11, 1));
      const got = await a.as.mutation(api.e2ee.keys.getWrap, { kind: "passphrase" });
      expect(got).toMatchObject({ kind: "passphrase", kdf: { name: "argon2id", m: 65536, t: 3, p: 1 } });
      const listed = await a.as.query(api.e2ee.keys.listWraps, {});
      expect(listed.find((w) => w.kind === "passphrase")!.lastUsedAt).toBe(Date.UTC(2026, 9, 21, 11, 1));
    } finally {
      vi.useRealTimers();
    }
  });
});

/** Runs the approval protocol between the person's first browser (T) and a new browser (N). */
async function approveNewBrowser(t: T, a: E2eePerson, email: string) {
  const e2ee = await e2eeLib();
  const n = await otherBrowser(t, a, email);
  const keys = await e2eeDeviceKeys();
  const nNonce = e2ee.randomBytes(32);
  const commit = await e2ee.approvalCommit(nNonce, keys.x.publicKey, keys.ed.publicKey);
  const { requestId } = await n.mutation(api.e2ee.devices.requestApproval, { deviceId: keys.deviceId, kind: "browser", label: "New laptop", x25519Pub: wire(keys.x.publicKey), ed25519Pub: wire(keys.ed.publicKey), commit: wire(commit) });
  // T sees the request and answers with its nonce.
  const waiting = await a.as.query(api.e2ee.devices.approvals, {});
  expect(waiting).toHaveLength(1);
  expect(waiting[0]).toMatchObject({ requestId, status: "waiting", label: "New laptop", requesterNonce: null });
  const tNonce = e2ee.randomBytes(32);
  await a.as.mutation(api.e2ee.devices.answerApproval, { requestId, nonce: wire(tNonce), approverDeviceId: a.device.deviceId });
  // N sees the answer and reveals.
  const answered = await n.query(api.e2ee.devices.approval, { requestId });
  expect(answered).toMatchObject({ status: "answered", approverDeviceId: a.device.deviceId, wrapped: null });
  await n.mutation(api.e2ee.devices.revealApproval, { requestId, nonce: wire(nNonce) });
  // T checks the commitment, and both compute the code.
  const revealed = (await a.as.query(api.e2ee.devices.approvals, {}))[0]!;
  expect(await e2ee.checkApprovalCommit(new Uint8Array(revealed.commit), new Uint8Array(revealed.requesterNonce!), new Uint8Array(revealed.x25519Pub), new Uint8Array(revealed.ed25519Pub))).toBe(true);
  const accountX = a.account.x25519.publicKey;
  const accountEd = a.account.ed25519.publicKey;
  const codeOnT = await e2ee.approvalCode({ newX: new Uint8Array(revealed.x25519Pub), newEd: new Uint8Array(revealed.ed25519Pub), approverEd: a.device.ed.publicKey, accountX, accountEd, approverNonce: tNonce, newNonce: nNonce });
  const status = await n.query(api.e2ee.keys.status, {});
  const codeOnN = await e2ee.approvalCode({ newX: keys.x.publicKey, newEd: keys.ed.publicKey, approverEd: new Uint8Array(answered!.approverEd25519Pub!), accountX: new Uint8Array(status.x25519Pub!), accountEd: new Uint8Array(status.ed25519Pub!), approverNonce: new Uint8Array(answered!.approverNonce!), newNonce: nNonce });
  expect(codeOnN).toBe(codeOnT);
  // The codes match: T seals the AMK to N and signs N's statement.
  const sealed = await e2ee.sealTo(new Uint8Array(revealed.x25519Pub), e2ee.ctx.amkDevice(a.profileId, keys.deviceId), a.amk);
  const statement = await deviceStatement(a.account, a.profileId, keys, a.device.deviceId);
  await a.as.mutation(api.e2ee.devices.completeApproval, { requestId, wrapped: wire(sealed), statement });
  return { n, keys, requestId };
}

describe("approving a new device (§4.8)", () => {
  test("request, answer, reveal, complete: codes agree, the new browser opens the AMK and becomes trusted", async () => {
    const t = setup();
    const a = await e2eePerson(t, "approve@example.com");
    const { n, keys, requestId } = await approveNewBrowser(t, a, "approve@example.com");
    const e2ee = await e2eeLib();
    const done = await n.query(api.e2ee.devices.approval, { requestId });
    expect(done!.status).toBe("done");
    expect(await e2ee.openSealed(keys.x.privateKey, keys.x.publicKey, e2ee.ctx.amkDevice(a.profileId, keys.deviceId), new Uint8Array(done!.wrapped!))).toEqual(a.amk);
    const wrap = await n.query(api.e2ee.keys.getDeviceWrap, { deviceId: keys.deviceId });
    expect(wrap).not.toBeNull();
    const devices = await n.query(api.e2ee.devices.list, {});
    const listed = devices.find((d) => d.deviceId === keys.deviceId)!;
    expect(listed).toMatchObject({ status: "trusted", hasWrap: true, label: "New laptop" });
    expect(await e2ee.verifyStatement(a.account.ed25519.publicKey, listed.statement!)).toBe(true);
    expect(await a.as.query(api.e2ee.devices.approvals, {})).toEqual([]);
    // Two trusted browsers now count as a recovery method.
    expect((await a.as.query(api.e2ee.keys.status, {})).methods).toEqual(["device"]);
  });

  test("steps out of order, self-approval, an untrusted approver and someone else's request are refused", async () => {
    const t = setup();
    const a = await e2eePerson(t, "order@example.com");
    const b = await e2eePerson(t, "stranger@example.com");
    const e2ee = await e2eeLib();
    const n = await otherBrowser(t, a, "order@example.com");
    const keys = await e2eeDeviceKeys();
    const nonce = e2ee.randomBytes(32);
    const commit = await e2ee.approvalCommit(nonce, keys.x.publicKey, keys.ed.publicKey);
    const { requestId } = await n.mutation(api.e2ee.devices.requestApproval, { deviceId: keys.deviceId, kind: "browser", label: "N", x25519Pub: wire(keys.x.publicKey), ed25519Pub: wire(keys.ed.publicKey), commit: wire(commit) });
    await expect(n.mutation(api.e2ee.devices.revealApproval, { requestId, nonce: wire(nonce) })).rejects.toThrow(/Wait for your other device/);
    await expect(n.mutation(api.e2ee.devices.answerApproval, { requestId, nonce: wire(nonce), approverDeviceId: keys.deviceId })).rejects.toThrow(/can't approve itself/);
    await expect(a.as.mutation(api.e2ee.devices.answerApproval, { requestId, nonce: wire(nonce), approverDeviceId: "unknown" })).rejects.toThrow(/trusted device/);
    await expect(b.as.mutation(api.e2ee.devices.answerApproval, { requestId, nonce: wire(nonce), approverDeviceId: b.device.deviceId })).rejects.toThrow(/has ended/);
    expect(await b.as.query(api.e2ee.devices.approval, { requestId })).toBeNull();
    await a.as.mutation(api.e2ee.devices.answerApproval, { requestId, nonce: wire(e2ee.randomBytes(32)), approverDeviceId: a.device.deviceId });
    await expect(a.as.mutation(api.e2ee.devices.answerApproval, { requestId, nonce: wire(e2ee.randomBytes(32)), approverDeviceId: a.device.deviceId })).rejects.toThrow(/already answered/);
    await expect(a.as.mutation(api.e2ee.devices.completeApproval, { requestId, wrapped: new ArrayBuffer(97), statement: await deviceStatement(a.account, a.profileId, keys, a.device.deviceId) })).rejects.toThrow(/isn't ready/);
    // A statement for other keys than the ones the new device registered is refused.
    await n.mutation(api.e2ee.devices.revealApproval, { requestId, nonce: wire(nonce) });
    const impostor = await e2eeDeviceKeys(keys.deviceId);
    await expect(a.as.mutation(api.e2ee.devices.completeApproval, { requestId, wrapped: new ArrayBuffer(97), statement: await deviceStatement(a.account, a.profileId, impostor, a.device.deviceId) })).rejects.toThrow(/doesn't match \(x25519Pub\)/);
  });

  test("a request expires after 10 minutes; the cron marks it and later deletes it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 21, 9, 0));
    try {
      const t = setup();
      const a = await e2eePerson(t, "expire@example.com");
      const keys = await e2eeDeviceKeys();
      const n = await otherBrowser(t, a, "expire@example.com");
      const { requestId } = await n.mutation(api.e2ee.devices.requestApproval, { deviceId: keys.deviceId, kind: "browser", label: "N", x25519Pub: wire(keys.x.publicKey), ed25519Pub: wire(keys.ed.publicKey), commit: new ArrayBuffer(32) });
      vi.setSystemTime(Date.UTC(2026, 9, 21, 9, 11));
      expect((await n.query(api.e2ee.devices.approval, { requestId }))!.status).toBe("expired");
      expect(await a.as.query(api.e2ee.devices.approvals, {})).toEqual([]);
      await expect(a.as.mutation(api.e2ee.devices.answerApproval, { requestId, nonce: new ArrayBuffer(32), approverDeviceId: a.device.deviceId })).rejects.toThrow(/has ended/);
      expect(await t.mutation(internal.e2ee.devices.expireRequests, {})).toEqual({ expired: 1, deleted: 0 });
      vi.setSystemTime(Date.UTC(2026, 9, 22, 10, 0));
      expect(await t.mutation(internal.e2ee.devices.expireRequests, {})).toEqual({ expired: 0, deleted: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  test("three cancelled requests in an hour lock approvals for an hour", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 21, 9, 0));
    try {
      const t = setup();
      const a = await e2eePerson(t, "lock@example.com");
      const n = await otherBrowser(t, a, "lock@example.com");
      const keys = await e2eeDeviceKeys();
      const ask = () => n.mutation(api.e2ee.devices.requestApproval, { deviceId: keys.deviceId, kind: "browser", label: "N", x25519Pub: wire(keys.x.publicKey), ed25519Pub: wire(keys.ed.publicKey), commit: new ArrayBuffer(32) });
      for (let i = 0; i < 3; i++) {
        const { requestId } = await ask();
        await a.as.mutation(api.e2ee.devices.cancelApproval, { requestId });
      }
      expect(await ask().catch(dataOf)).toMatchObject({ code: "e2ee_rate_limited" });
      vi.setSystemTime(Date.UTC(2026, 9, 21, 10, 1));
      expect((await ask()).requestId).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("revoking a device", () => {
  test("deletes its wraps and statement, signs its session out, and it can't fetch a wrap again", async () => {
    const t = setup();
    const a = await e2eePerson(t, "revoke@example.com");
    const e2ee = await e2eeLib();
    // The new browser registers its session the way the app does, then is approved.
    const n = await otherBrowser(t, a, "revoke@example.com");
    await n.mutation(api.users.registerSession, { client: "web", label: "Laptop" });
    const keys = await e2eeDeviceKeys();
    const statement = await deviceStatement(a.account, a.profileId, keys, "recovery");
    await n.mutation(api.e2ee.devices.register, { device: deviceRegistration(keys, "browser", statement) });
    const sealed = await e2ee.sealTo(keys.x.publicKey, e2ee.ctx.amkDevice(a.profileId, keys.deviceId), a.amk);
    await n.mutation(api.e2ee.keys.addWrap, { kind: "device", deviceId: keys.deviceId, wrapped: wire(sealed) });
    expect(await n.query(api.e2ee.keys.getDeviceWrap, { deviceId: keys.deviceId })).not.toBeNull();
    expect(await a.as.mutation(api.e2ee.devices.revoke, { deviceId: keys.deviceId })).toEqual({ signedOut: true });
    // Its session is gone: it can't call anything any more.
    await expect(n.query(api.e2ee.keys.getDeviceWrap, { deviceId: keys.deviceId })).rejects.toThrow(/session has ended/);
    expect(await a.as.query(api.e2ee.keys.getDeviceWrap, { deviceId: keys.deviceId })).toBeNull();
    const listed = (await a.as.query(api.e2ee.devices.list, {})).find((d) => d.deviceId === keys.deviceId)!;
    expect(listed).toMatchObject({ status: "revoked", statement: null, hasWrap: false });
    // A revoked device can't register itself back.
    await expect(a.as.mutation(api.e2ee.devices.register, { device: deviceRegistration(keys, "browser", statement) })).rejects.toThrow(/removed/);
  });

  test("a trusted device's keys can't be swapped by registering again", async () => {
    const t = setup();
    const a = await e2eePerson(t, "swap@example.com");
    const fresh = await e2eeDeviceKeys(a.device.deviceId);
    await expect(a.as.mutation(api.e2ee.devices.register, { device: deviceRegistration(fresh) })).rejects.toThrow(/already has keys/);
    expect(await a.as.mutation(api.e2ee.devices.register, { device: deviceRegistration(a.device) })).toEqual({ status: "trusted" });
  });
});

describe("rotating and resetting the account key", () => {
  test("rotateAccount: a new epoch with new wraps, the Personal key granted again, device statements re-signed", async () => {
    const t = setup();
    const a = await e2eePerson(t, "rotate@example.com");
    await setUpAndEncrypt(a);
    const e2ee = await e2eeLib();
    const next = await e2eeEpoch(a.profileId, 2);
    const scopeId = e2eeScopeString(PERSONAL, a.profileId);
    // The device opens its Personal grant (v1) with the old account key and re-grants it to the new one.
    const mine = await a.as.query(api.e2ee.spaces.mine, {});
    const sk = await e2ee.openSealed(a.account.x25519.privateKey, a.account.x25519.publicKey, e2ee.ctx.spaceGrant(scopeId, 1, a.profileId), new Uint8Array(mine[0]!.grants[0]!.wrapped));
    const regrant = await spaceGrant(scopeId, 1, sk, { profileId: a.profileId, account: next.keys }, { profileId: a.profileId, x25519Pub: next.keys.x25519.publicKey, epoch: 2 });
    const recovery = e2ee.newRecoveryKey();
    const recoveryId = ulid();
    const recoveryWrap = await e2ee.sealRecord(await e2ee.recoveryWrapKey(recovery.bytes.slice()), 2, e2ee.ctx.amkRecovery(a.profileId, recoveryId), next.amk);
    const deviceWrap = await e2ee.sealTo(a.device.x.publicKey, e2ee.ctx.amkDevice(a.profileId, a.device.deviceId), next.amk);
    const passId = ulid();
    // Fewer than two kinds while a space is encrypted is refused, and nothing is changed.
    await expect(
      a.as.mutation(api.e2ee.keys.rotateAccount, { newEpoch: next.registration, wraps: [{ kind: "recoveryKey", wrapId: recoveryId, wrapped: wire(recoveryWrap) }], regrants: [{ scope: PERSONAL, grant: regrant }] }),
    ).rejects.toThrow(/second way to unlock/);
    expect((await a.as.query(api.e2ee.keys.status, {})).epoch).toBe(1);
    await a.as.mutation(api.e2ee.keys.rotateAccount, {
      newEpoch: next.registration,
      wraps: [
        { kind: "recoveryKey", wrapId: recoveryId, wrapped: wire(recoveryWrap) },
        { kind: "passphrase", wrapId: passId, wrapped: new ArrayBuffer(70), kdf: { name: "argon2id", m: 65536, t: 3, p: 1, salt: new ArrayBuffer(16) } },
        { kind: "device", deviceId: a.device.deviceId, wrapped: wire(deviceWrap) },
      ],
      regrants: [{ scope: PERSONAL, grant: regrant }],
      deviceStatements: [{ deviceId: a.device.deviceId, statement: await deviceStatement(next.keys, a.profileId, a.device, "setup") }],
    });
    const status = await a.as.query(api.e2ee.keys.status, {});
    expect(status).toMatchObject({ epoch: 2, methods: ["passphrase", "recoveryKey"] });
    const grants = (await a.as.query(api.e2ee.spaces.mine, {}))[0]!.grants;
    expect(grants).toEqual([expect.objectContaining({ version: 1, epoch: 2 })]);
    expect(await e2ee.openSealed(next.keys.x25519.privateKey, next.keys.x25519.publicKey, e2ee.ctx.spaceGrant(scopeId, 1, a.profileId), new Uint8Array(grants[0]!.wrapped))).toEqual(sk);
    const device = (await a.as.query(api.e2ee.devices.list, {}))[0]!;
    expect(await e2ee.verifyStatement(next.keys.ed25519.publicKey, device.statement!)).toBe(true);
    // The old epoch's wraps are kept 30 days, then swept with its public keys.
    const before = await t.run(async (ctx) => (await ctx.db.query("e2eeAccountWraps").collect()).filter((w) => w.epoch === 1).length);
    expect(before).toBeGreaterThan(0);
    await t.run(async (ctx) => {
      const old = (await ctx.db.query("e2eeAccounts").collect()).find((r) => r.epoch === 1)!;
      await ctx.db.patch(old._id, { supersededAt: Date.now() - 31 * 86_400_000 });
    });
    expect((await t.mutation(internal.e2ee.keys.sweep, {})).deleted).toBe(before);
    expect(await t.run(async (ctx) => (await ctx.db.query("e2eeAccounts").collect()).map((r) => r.epoch))).toEqual([2]);
  });

  test("resetAccount: a new epoch, and every encrypted workspace gets a reset pending grant for an admin to fulfil", async () => {
    const t = setup();
    const owner = await e2eePerson(t, "ws-owner@example.com");
    const member = await e2eePerson(t, "ws-member@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner);
    await join(t, owner, member, "ws-member@example.com", workspaceId, "editor");
    await e2eeRecoveryMethods(owner);
    const space = await e2eeSpace(owner, scope, [member]);
    await owner.as.mutation(api.e2ee.spaces.enable, { scope, level: "full", switches: { foliAi: "auto", backgroundAi: true, searchEverywhere: true, apps: true, emailToNote: true, webClipper: true, notificationPreviews: true } });
    const next = await e2eeEpoch(member.profileId, 2);
    const res = await member.as.mutation(api.e2ee.keys.resetAccount, { newEpoch: next.registration, wraps: [] });
    expect(res).toEqual({ epoch: 2, pending: 1 });
    // The epoch must follow on: replaying epoch 2 is refused.
    await expect(member.as.mutation(api.e2ee.keys.resetAccount, { newEpoch: next.registration, wraps: [] })).rejects.toThrow(/changed on another device/);
    const pending = await owner.as.query(api.e2ee.grants.pending, { scope });
    expect(pending).toEqual([expect.objectContaining({ profileId: member.profileId, reason: "reset", hasKeys: true, epoch: 2 })]);
    expect((await owner.as.query(api.e2ee.spaces.keyHolders, { scope })).count).toBe(1);
    // The owner's device checks the new statement and grants the key again; the pending row goes.
    const keys = (await owner.as.query(api.e2ee.keys.accountKeysOf, { profileIds: [member.profileId] }))[0]!;
    const e2ee = await e2eeLib();
    expect(await e2ee.verifyStatement(new Uint8Array(keys.ed25519Pub), keys.statement)).toBe(true);
    const grant = await spaceGrant(space.scopeId, 1, space.sk, owner, { profileId: member.profileId, x25519Pub: new Uint8Array(keys.x25519Pub), epoch: keys.epoch });
    await owner.as.mutation(api.e2ee.grants.grantSpace, { scope, grants: [grant] });
    expect(await owner.as.query(api.e2ee.grants.pending, { scope })).toEqual([]);
    expect((await owner.as.query(api.e2ee.spaces.keyHolders, { scope })).count).toBe(2);
  });

  test("accountKeysOf: people you share a workspace or a page with; strangers read as nothing", async () => {
    const t = setup();
    const a = await e2eePerson(t, "keys-a@example.com");
    const b = await e2eePerson(t, "keys-b@example.com");
    const c = await e2eePerson(t, "keys-c@example.com");
    const guest = await e2eePerson(t, "keys-guest@example.com");
    const { workspaceId } = await teamWorkspace(a);
    await join(t, a, b, "keys-b@example.com", workspaceId, "viewer");
    // A page in a's Personal shared with the guest.
    const { id: docId } = await a.as.mutation(api.documents.create, { scope: PERSONAL, title: "Shared" });
    await t.run(async (ctx) => {
      const doc = await ctx.db
        .query("documents")
        .withIndex("by_public_id", (q) => q.eq("publicId", docId))
        .unique();
      await ctx.db.insert("documentPermissions", { documentId: doc!._id, ownerProfileId: doc!.ownerProfileId, profileId: guest.profileId as never, role: "viewer", grantedBy: doc!.createdBy, createdAt: Date.now() });
    });
    const got = await a.as.query(api.e2ee.keys.accountKeysOf, { profileIds: [a.profileId, b.profileId, c.profileId, guest.profileId, "nonsense"] });
    expect(got.map((k) => k.profileId).sort()).toEqual([a.profileId, b.profileId, guest.profileId].sort());
    // The guest sees a's keys back (the page links them); c sees nobody's.
    expect((await guest.as.query(api.e2ee.keys.accountKeysOf, { profileIds: [a.profileId] })).length).toBe(1);
    expect(await c.as.query(api.e2ee.keys.accountKeysOf, { profileIds: [a.profileId, b.profileId] })).toEqual([]);
  });
});
