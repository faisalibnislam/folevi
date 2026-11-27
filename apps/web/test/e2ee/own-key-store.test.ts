// Where this browser keeps the person's own AI keys (lib/ai/ownKey.ts): its IndexedDB database is created only
// when a key is saved, never by reading, and a public or shared computer gets none at all: a key saved or synced
// there lasts in the tab's memory (docs/E2EE_DESIGN.md §4.8; e2e/e2ee-unlock.spec.ts checks the disk is empty).
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ARGON2ID_TEST } from "@folevi/local-store/e2ee";
import { getKeySession, setup, startKeySession } from "@/lib/e2ee/keys";
import { resetKeyRingForTests } from "@/lib/e2ee/keys/keyring";
import { memoryKeyStore } from "@/lib/e2ee/keys/keystore";
import { setPassphraseCostsForTests } from "@/lib/e2ee/keys/passphrase";
import { markPublicSession } from "@/lib/e2ee/keys/publicMode";
import { resetKeySessionForTests } from "@/lib/e2ee/keys/session";
import { clearPageOwnKeys, hasOwnKey, ownKeyForRequest, removeOwnKey, saveOwnKey, setOwnKeyChoice, syncOwnKeysNow } from "@/lib/ai/ownKey";
import { FakeKeysServer } from "./keysFakeServer";

const KEY = "sk-ant-api03-STORETEST-000000000000000";
const tick = () => new Promise((r) => setTimeout(r, 0));
const onDisk = async () => (await indexedDB.databases()).map((d) => d.name).filter((n) => n === "folevi-own-ai-key");

async function signIn(fake: FakeKeysServer, profileId: string) {
  resetKeySessionForTests();
  resetKeyRingForTests();
  let n = 0;
  await startKeySession({ server: fake.as(profileId), profileId, email: `${profileId}@example.com`, store: memoryKeyStore(), mac: null, newDeviceId: async () => `web-${profileId}-${++n}`, reload: () => undefined });
  await tick();
  return getKeySession();
}

beforeEach(() => {
  setPassphraseCostsForTests(ARGON2ID_TEST);
  localStorage.clear();
});
afterEach(async () => {
  markPublicSession(false);
  await clearPageOwnKeys();
  resetKeySessionForTests();
  resetKeyRingForTests();
  setPassphraseCostsForTests(null);
});

describe("the page's store for own AI keys", () => {
  test("reading, syncing and removing create nothing; saving creates it; signing out deletes it", async () => {
    const fake = new FakeKeysServer();
    await signIn(fake, "p1");
    await setup.createAccount();
    setOwnKeyChoice({ provider: "anthropic", model: "claude-sonnet-5-5" });
    expect(await hasOwnKey("anthropic")).toBe(false);
    expect(await ownKeyForRequest()).toBeNull();
    await syncOwnKeysNow();
    await removeOwnKey("openai");
    expect(await onDisk()).toEqual([]);

    await saveOwnKey("anthropic", KEY);
    expect(await onDisk()).toEqual(["folevi-own-ai-key"]);
    expect(await hasOwnKey("anthropic")).toBe(true);

    // Sign-out (lib/sync/db.ts clearAllLocalData), trusted browser or not.
    await clearPageOwnKeys();
    expect(await onDisk()).toEqual([]);
    expect(await hasOwnKey("anthropic")).toBe(false);
    expect(await onDisk()).toEqual([]);
  });

  test("on a public computer a key saved there stays in the tab, and a synced one too: nothing on disk", async () => {
    const fake = new FakeKeysServer();
    await signIn(fake, "p1");
    await setup.createAccount();
    markPublicSession(true);

    await saveOwnKey("anthropic", KEY);
    setOwnKeyChoice({ provider: "anthropic", model: "claude-sonnet-5-5" });
    expect(await ownKeyForRequest()).toEqual({ provider: "anthropic", apiKey: KEY, model: "claude-sonnet-5-5" });
    // Still sealed for the person's other devices.
    expect(fake.accountRecords.map((r) => r.recordId)).toContain("anthropic");

    // A key from another device, opened here.
    await saveOwnKey("openai", "sk-proj-STORETEST-1111111111111111111");
    await removeOwnKey("openai");
    await syncOwnKeysNow();
    expect(await hasOwnKey("anthropic")).toBe(true);
    expect(await hasOwnKey("openai")).toBe(false);
    expect(await onDisk()).toEqual([]);
  });

  test("a public computer opens the person's synced key into memory only", async () => {
    const fake = new FakeKeysServer();
    await signIn(fake, "p1");
    await setup.createAccount();
    await saveOwnKey("gemini", "AIzaSySTORETEST00000000000000000000");
    // The same person on a shared computer: nothing of this browser's own, used as a public computer.
    await clearPageOwnKeys();
    markPublicSession(true);
    expect(await syncOwnKeysNow()).toBe(1);
    expect(await hasOwnKey("gemini")).toBe(true);
    expect(await onDisk()).toEqual([]);
  });
});
