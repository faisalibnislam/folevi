// The person's own AI keys on all their devices (lib/ai/ownKeySync.ts), against the in-memory key server: a key
// saved while encryption is unlocked goes up sealed with the account master key, a device without it gets it on
// its next sync, a removal reaches the other devices, and an account without encryption keeps keys per device.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ARGON2ID_TEST, ctx, openRecord } from "@folevi/local-store/e2ee";
import { getKeySession, setup, startKeySession } from "@/lib/e2ee/keys";
import { resetKeyRingForTests } from "@/lib/e2ee/keys/keyring";
import { memoryKeyStore } from "@/lib/e2ee/keys/keystore";
import { setPassphraseCostsForTests } from "@/lib/e2ee/keys/passphrase";
import { resetKeySessionForTests, sessionImpl } from "@/lib/e2ee/keys/session";
import { clearPageOwnKeys, hasOwnKey, ownKeyForRequest, removeOwnKey, saveOwnKey, setOwnKeyChoice, startOwnKeySync, syncOwnKeysNow, ownKeyChoice } from "@/lib/ai/ownKey";
import { FakeKeysServer } from "./keysFakeServer";

const KEY = "sk-ant-api03-SYNCTEST-0000000000000000";
const tick = () => new Promise((r) => setTimeout(r, 0));

async function signIn(fake: FakeKeysServer, profileId: string) {
  resetKeySessionForTests();
  resetKeyRingForTests();
  let n = 0;
  await startKeySession({ server: fake.as(profileId), profileId, email: `${profileId}@example.com`, store: memoryKeyStore(), mac: null, newDeviceId: async () => `web-${profileId}-${++n}`, reload: () => undefined });
  await tick();
  return getKeySession();
}

/** Another device: this one's own copy is gone (its page store and its record of when keys were saved). */
const anotherDevice = () => clearPageOwnKeys();

beforeEach(() => {
  setPassphraseCostsForTests(ARGON2ID_TEST);
  localStorage.clear();
});
afterEach(async () => {
  await clearPageOwnKeys();
  resetKeySessionForTests();
  resetKeyRingForTests();
  setPassphraseCostsForTests(null);
});

describe("own AI keys follow the person to their devices", () => {
  test("saved while unlocked: sealed with the master key, never in the clear, and another device gets it", async () => {
    const fake = new FakeKeysServer();
    await signIn(fake, "p1");
    await setup.createAccount();
    await saveOwnKey("anthropic", KEY);
    expect(fake.accountRecords).toHaveLength(1);
    const row = fake.accountRecords[0]!;
    expect(row).toMatchObject({ profileId: "p1", kind: "aiKey", recordId: "anthropic", epoch: 1 });
    expect(Buffer.from(new Uint8Array(row.sealed!)).toString("latin1")).not.toContain("SYNCTEST");
    const plain = await openRecord(sessionImpl().accountKeys().records, ctx.accountRecord("p1", "aiKey", "anthropic"), new Uint8Array(row.sealed!));
    expect(JSON.parse(new TextDecoder().decode(plain))).toEqual({ apiKey: KEY });

    await anotherDevice();
    expect(await hasOwnKey("anthropic")).toBe(false);
    setOwnKeyChoice({ provider: "anthropic", model: "claude-sonnet-5-5" });
    // The first request fetches it from the account, and this device keeps a copy.
    expect(await ownKeyForRequest()).toEqual({ provider: "anthropic", apiKey: KEY, model: "claude-sonnet-5-5" });
    expect(await hasOwnKey("anthropic")).toBe(true);
  });

  test("removed on one device: the others forget it on their next sync", async () => {
    const fake = new FakeKeysServer();
    await signIn(fake, "p1");
    await setup.createAccount();
    await saveOwnKey("openai", "sk-proj-SYNCTEST-11111111111111111111");
    await removeOwnKey("openai");
    expect(fake.accountRecords[0]).toMatchObject({ recordId: "openai", sealed: null });
    expect(fake.accountRecords[0]!.deletedAt).toBeGreaterThan(0);
    await anotherDevice();
    setOwnKeyChoice({ provider: "openai", model: "gpt-6.1-sol" });
    expect(await ownKeyForRequest()).toBeNull();
  });

  test("a key saved before encryption was set up is sealed for the other devices once it's unlocked", async () => {
    const fake = new FakeKeysServer();
    await signIn(fake, "p1");
    await saveOwnKey("gemini", "AIzaSySYNCTEST000000000000000000000");
    expect(fake.accountRecords).toHaveLength(0);
    await setup.createAccount();
    // What AccountGate starts once the key session is up: it syncs now (already unlocked) and on every unlock.
    await startOwnKeySync();
    for (let i = 0; i < 50 && !fake.accountRecords.length; i++) await tick();
    expect(fake.accountRecords.map((r) => r.recordId)).toEqual(["gemini"]);
  });

  test("the provider and model in use follow too, and turning it off reaches the other devices", async () => {
    const fake = new FakeKeysServer();
    await signIn(fake, "p1");
    await setup.createAccount();
    await saveOwnKey("anthropic", KEY);
    setOwnKeyChoice({ provider: "anthropic", model: "claude-opus-5-5" });
    const choiceRow = () => fake.accountRecords.find((r) => r.recordId === "choice");
    for (let i = 0; i < 50 && !choiceRow(); i++) await tick();
    const row = choiceRow()!;
    const plain = await openRecord(sessionImpl().accountKeys().records, ctx.accountRecord("p1", "aiKey", "choice"), new Uint8Array(row.sealed!));
    expect(JSON.parse(new TextDecoder().decode(plain))).toEqual({ choice: { provider: "anthropic", model: "claude-opus-5-5" } });

    // Another device: nothing chosen there until it syncs, then the same provider, model and key.
    await anotherDevice();
    expect(ownKeyChoice()).toBeNull();
    expect(await syncOwnKeysNow()).toBe(2);
    expect(ownKeyChoice()).toEqual({ provider: "anthropic", model: "claude-opus-5-5" });
    expect(await ownKeyForRequest()).toEqual({ provider: "anthropic", apiKey: KEY, model: "claude-opus-5-5" });

    // Turned off on the first device later: off here at the next sync, the key kept.
    const before = row.updatedAt;
    setOwnKeyChoice(null);
    for (let i = 0; i < 50 && choiceRow()!.updatedAt === before; i++) await tick();
    localStorage.setItem("folevi:own-ai-key", JSON.stringify({ provider: "anthropic", model: "claude-opus-5-5" }));
    localStorage.setItem("folevi:own-ai-key-at", JSON.stringify({ anthropic: 1, choice: before }));
    await syncOwnKeysNow();
    expect(ownKeyChoice()).toBeNull();
    expect(await hasOwnKey("anthropic")).toBe(true);
  });

  test("without encryption a key stays on this device", async () => {
    const fake = new FakeKeysServer();
    await signIn(fake, "p2");
    await saveOwnKey("anthropic", KEY);
    expect(fake.accountRecords).toHaveLength(0);
    expect(fake.calls.some((c) => c.startsWith("accountRecords"))).toBe(false);
  });
});
