// WP6: approving a new device from a trusted one (docs/E2EE_DESIGN.md §4.8): commit, reveal, the same 6-digit
// code on both sides, then the key sealed to the new device. A server that substitutes keys gets caught.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ARGON2ID_TEST } from "@folevi/local-store/e2ee";
import { setup, startKeySession } from "@/lib/e2ee/keys";
import { resetKeyRingForTests } from "@/lib/e2ee/keys/keyring";
import { memoryKeyStore } from "@/lib/e2ee/keys/keystore";
import { setPassphraseCostsForTests } from "@/lib/e2ee/keys/passphrase";
import { KeySessionImpl, resetKeySessionForTests, sessionImpl, type IncomingApproval } from "@/lib/e2ee/keys/session";
import { FakeKeysServer } from "./keysFakeServer";

const tick = () => new Promise((r) => setTimeout(r, 0));
async function until<T>(f: () => T | null | undefined | false, ms = 2000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** A trusted, unlocked browser (the singleton session) and a new browser (its own session) of the same person. */
async function twoDevices() {
  const fake = new FakeKeysServer();
  resetKeySessionForTests();
  resetKeyRingForTests();
  await startKeySession({ server: fake.as("p1"), profileId: "p1", store: memoryKeyStore(), mac: null, newDeviceId: async () => "web-trusted" });
  await setup.createAccount();
  const trusted = sessionImpl();
  const fresh = new KeySessionImpl();
  const freshStore = memoryKeyStore();
  await fresh.start({ server: fake.as("p1"), profileId: "p1", store: freshStore, mac: null, newDeviceId: async () => "web-new" });
  await tick();
  return { fake, trusted, fresh, freshStore };
}

beforeEach(() => setPassphraseCostsForTests(ARGON2ID_TEST));
afterEach(() => {
  resetKeySessionForTests();
  resetKeyRingForTests();
  setPassphraseCostsForTests(null);
});

describe("device approval", () => {
  test("both devices show the same code; after 'They match' the new one unlocks and is trusted", async () => {
    const { fake, trusted, fresh, freshStore } = await twoDevices();
    expect(fresh.state()).toBe("locked");
    const handle = await fresh.requestApproval();
    const incoming = await until(() => trusted.approvals[0]);
    expect(incoming.label).toMatch(/./);
    // The request is offered to trusted devices only, never to the one asking.
    expect(fresh.approvals).toEqual([]);
    const [codeT, codeN] = await Promise.all([incoming.start(), handle.code]);
    expect(codeT).toMatch(/^\d{6}$/);
    expect(codeN).toBe(codeT);
    await incoming.confirm();
    expect(await handle.done).toBe(true);
    expect(fresh.state()).toBe("unlocked");
    expect(Buffer.from(fresh.accountKeys().ed25519.publicKey).equals(Buffer.from(trusted.accountKeys().ed25519.publicKey))).toBe(true);
    const dev = fake.devices.find((d) => d.deviceId === "web-new")!;
    expect(dev.status).toBe("trusted");
    expect(JSON.parse(dev.statement!.body)).toMatchObject({ approvedBy: "web-trusted", deviceId: "web-new", profileId: "p1" });
    expect(await freshStore.getWrap("p1")).not.toBeNull();
    // Restarting the new browser: it unlocks by itself now.
    const again = new KeySessionImpl();
    await again.start({ server: fake.as("p1"), profileId: "p1", store: freshStore, mac: null });
    expect(again.state()).toBe("unlocked");
    // The finished request is gone from the trusted device's list.
    await until(() => trusted.approvals.length === 0);
  });

  test("'They don't match' cancels: the new device stays locked", async () => {
    const { trusted, fresh } = await twoDevices();
    const handle = await fresh.requestApproval();
    const incoming = await until(() => trusted.approvals[0]);
    await Promise.all([incoming.start(), handle.code]);
    await incoming.reject();
    expect(await handle.done).toBe(false);
    expect(fresh.state()).toBe("locked");
    await expect(handle.code).resolves.toMatch(/^\d{6}$/);
  });

  test("a server that substitutes the new device's keys is caught by the commitment", async () => {
    const { fake, trusted, fresh } = await twoDevices();
    const handle = await fresh.requestApproval();
    const incoming: IncomingApproval = await until(() => trusted.approvals[0]);
    const evil = new Uint8Array(32).fill(9).buffer;
    fake.tamperApprovals = (rows) => rows.map((r) => ({ ...r, x25519Pub: evil }));
    await expect(incoming.start()).rejects.toMatchObject({ code: "e2ee_approval_mismatch" });
    expect(await handle.done).toBe(false);
  });

  test("a server that substitutes the approver's key: the codes differ, so the person says no", async () => {
    const { fake, trusted, fresh } = await twoDevices();
    fake.tamperApproval = (row) => ({ ...row, approverEd25519Pub: row.approverEd25519Pub ? new Uint8Array(32).fill(3).buffer : null });
    const handle = await fresh.requestApproval();
    const incoming = await until(() => trusted.approvals[0]);
    const [codeT, codeN] = await Promise.all([incoming.start(), handle.code]);
    expect(codeN).not.toBe(codeT);
  });

  test("the new device giving up cancels the request", async () => {
    const { fake, fresh } = await twoDevices();
    const handle = await fresh.requestApproval();
    handle.cancel();
    expect(await handle.done).toBe(false);
    await tick();
    expect(fake.approvals[0]!.status).toBe("cancelled");
  });

  test("a public session can't approve and doesn't see requests", async () => {
    const { fake, fresh } = await twoDevices();
    // The trusted browser leaves; another browser unlocks with a passphrase as a public computer.
    await setup.addPassphrase("tidal orchard lamp 42");
    resetKeySessionForTests();
    resetKeyRingForTests();
    await startKeySession({ server: fake.as("p1"), profileId: "p1", store: memoryKeyStore(), mac: null });
    const pub = sessionImpl();
    expect(await pub.unlockWithPassphrase("tidal orchard lamp 42")).toBe("ok");
    await pub.trust("public");
    await fresh.requestApproval();
    await tick();
    await tick();
    expect(pub.approvals).toEqual([]);
  });
});
