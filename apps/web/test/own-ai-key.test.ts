// "Your own AI key" on this device (lib/ai/ownKey.ts): the key is kept sealed in the browser, or in the app's
// keychain when the app can hand it back; it goes with a Folevi Cloud request only once the person turns it on.
import { afterEach, describe, expect, test } from "vitest";
import { clearPageOwnKeys, hasOwnKey, ownKeyArgs, ownKeyChoice, removeOwnKey, saveOwnKey, setOwnKeyChoice } from "@/lib/ai/ownKey";

const KEY = "sk-ant-api03-TESTKEY-0000000000000000";

afterEach(async () => {
  delete (window as { __foleviTestShell?: unknown }).__foleviTestShell;
  await clearPageOwnKeys();
});

describe("own AI key on this device", () => {
  test("a browser keeps it sealed; nothing goes with a request until it's turned on", async () => {
    await saveOwnKey("anthropic", KEY);
    expect(await hasOwnKey("anthropic")).toBe(true);
    expect(await ownKeyArgs()).toEqual({});
    setOwnKeyChoice({ provider: "anthropic", model: "claude-opus-5-5" });
    expect(await ownKeyArgs()).toEqual({ ownKey: { provider: "anthropic", apiKey: KEY, model: "claude-opus-5-5" } });
    // Stored encrypted: the plain key is nowhere in localStorage.
    expect(JSON.stringify({ ...localStorage })).not.toContain("TESTKEY");
    await removeOwnKey("anthropic");
    expect(await hasOwnKey("anthropic")).toBe(false);
    expect(ownKeyChoice()).toBeNull();
    expect(await ownKeyArgs()).toEqual({});
  });

  test("an app that can hand the key back keeps it only in its keychain", async () => {
    const keychain = new Map<string, string>();
    (window as { __foleviTestShell?: unknown }).__foleviTestShell = {
      secrets: {
        has: async (n: string) => keychain.has(n),
        set: async (n: string, v: string) => void keychain.set(n, v),
        delete: async (n: string) => void keychain.delete(n),
        reveal: async (n: string) => keychain.get(n) ?? null,
      },
    };
    await saveOwnKey("gemini", "AIzaSyTESTKEY000000000000000000000");
    expect(keychain.get("ai.google")).toBe("AIzaSyTESTKEY000000000000000000000");
    setOwnKeyChoice({ provider: "gemini", model: "gemini-3.8-flash" });
    expect(await ownKeyArgs()).toEqual({ ownKey: { provider: "gemini", apiKey: "AIzaSyTESTKEY000000000000000000000", model: "gemini-3.8-flash" } });
    // The page kept no copy of its own.
    delete (window as { __foleviTestShell?: unknown }).__foleviTestShell;
    expect(await hasOwnKey("gemini")).toBe(false);
  });
});
