// The Vault on a device (lib/vault/keys.ts) with real cryptography against a small fake of convex/vaultKeys.ts:
// set up, lock, unlock by passcode or recovery key, a wrong passcode, a reset, auto-lock after idle.
import { afterEach, describe, expect, test, vi } from "vitest";
import { getFunctionName, type FunctionReference } from "convex/server";
import { deriveAccountKeys, randomBytes } from "@folevi/local-store/e2ee";
import { resetVaultSessionsForTests, vaultSessions, type VaultClient } from "@/lib/vault/keys";

type Grant = { version: number; epoch: number; wrapped: ArrayBuffer; salt?: ArrayBuffer; kdf?: { m: number; t: number; p: number } };

/** Just enough of the server: the grants, the check value, wrong-passcode reports and the log's events. */
function fakeServer() {
  const s = { check: null as ArrayBuffer | null, passcode: [] as Grant[], recovery: [] as Grant[], custodian: [] as Grant[], log: [] as string[] };
  const client: VaultClient = {
    async query() {
      throw new Error("no queries in this test");
    },
    async mutation(ref: FunctionReference<"mutation">, args: Record<string, unknown>) {
      const name = getFunctionName(ref);
      const a = args as { check?: ArrayBuffer; passcode?: Grant; recovery?: Grant; way?: string; ok?: boolean; grants?: Grant[]; reason?: string; how?: string };
      switch (name) {
        case "vaultKeys:setUp":
          s.check = a.check!;
          s.passcode = [{ ...a.passcode! }];
          s.recovery = [a.recovery!];
          s.log.push("setUp");
          return null;
        case "vaultKeys:unlock":
          s.log.push(`unlock:${a.way}`);
          return {
            locked: false,
            keyVersion: 1,
            keys: [{ version: 1, check: s.check }],
            grants: (a.way === "passcode" ? s.passcode : s.recovery).map((g) => ({ version: g.version, epoch: g.epoch, wrapped: g.wrapped, salt: g.salt ?? null, kdf: g.kdf ?? null })),
            fromCustodian: s.custodian,
            autoLockMinutes: 5,
            role: "owner",
          };
        case "vaultKeys:unlockResult":
          s.log.push(`result:${a.ok ? "ok" : "wrong"}`);
          return { lockedUntil: null };
        case "vaultKeys:setPasscode":
          s.passcode = a.grants!.map((g) => ({ ...g }));
          s.log.push(`setPasscode:${a.reason}`);
          return null;
        case "vaultKeys:lock":
          s.log.push(`lock:${a.how}`);
          return null;
        default:
          throw new Error(`unexpected ${name}`);
      }
    },
  } as unknown as VaultClient;
  return { s, client };
}

afterEach(() => {
  resetVaultSessionsForTests();
  vi.useRealTimers();
});

describe("the Vault on this device", { timeout: 60_000 }, () => {
  test("set up, lock, unlock with the passcode, a wrong one, the recovery key, then a reset with it", async () => {
    const { s, client } = fakeServer();
    const account = await deriveAccountKeys(randomBytes(32));
    const v = vaultSessions();
    v.bind(client, { profileId: "p1", epoch: 1, account: account.x25519, deviceId: "dev-1" });

    await expect(v.setUp("vault-1", "short")).rejects.toThrow(/at least 8/);
    const { recoveryText } = await v.setUp("vault-1", "a good passcode");
    expect(recoveryText.length).toBeGreaterThan(20);
    expect(v.isOpen("vault-1")).toBe(true);
    const check = v.keys("vault-1").check;

    await v.lock("vault-1", "manual");
    expect(v.isOpen("vault-1")).toBe(false);
    expect(() => v.keys("vault-1")).toThrow(/locked/);

    expect(await v.unlock("vault-1", { passcode: "not the passcode" })).toEqual({ status: "wrong" });
    expect(v.isOpen("vault-1")).toBe(false);
    expect(await v.unlock("vault-1", { passcode: "a good passcode" })).toEqual({ status: "ok" });
    expect(Array.from(v.keys("vault-1").check)).toEqual(Array.from(check));
    await v.lock("vault-1", "manual");

    expect(await v.unlock("vault-1", { recoveryText: "not a recovery key" })).toEqual({ status: "wrong" });
    expect(await v.unlock("vault-1", { recoveryText })).toEqual({ status: "ok" });
    await v.lock("vault-1", "manual");

    // Forgot the passcode: the recovery key proves it, a new passcode replaces the old one.
    expect(await v.changePasscode("vault-1", { recoveryText }, "a brand new passcode")).toEqual({ status: "ok" });
    await v.lock("vault-1", "manual");
    expect(await v.unlock("vault-1", { passcode: "a good passcode" })).toEqual({ status: "wrong" });
    expect(await v.unlock("vault-1", { passcode: "a brand new passcode" })).toEqual({ status: "ok" });

    expect(s.log).toEqual([
      "setUp",
      "lock:manual",
      "unlock:passcode",
      "result:wrong",
      "unlock:passcode",
      "result:ok",
      "lock:manual",
      "unlock:recovery",
      "result:ok",
      "lock:manual",
      "unlock:recovery",
      "setPasscode:reset",
      "unlock:passcode",
      "result:ok",
      "lock:manual",
      "unlock:passcode",
      "result:wrong",
      "unlock:passcode",
      "result:ok",
    ]);
  });

  test("auto-lock: idle past the Vault's limit locks it and reports it as idle", async () => {
    const { s, client } = fakeServer();
    const account = await deriveAccountKeys(randomBytes(32));
    const v = vaultSessions();
    v.bind(client, { profileId: "p1", epoch: 1, account: account.x25519 });
    await v.setUp("vault-2", "a good passcode");
    vi.useFakeTimers();
    vi.advanceTimersByTime(4 * 60_000);
    expect(v.isOpen("vault-2")).toBe(true);
    // Using the Vault keeps it open.
    v.touch("vault-2");
    vi.advanceTimersByTime(4 * 60_000);
    expect(v.isOpen("vault-2")).toBe(true);
    vi.advanceTimersByTime(2 * 60_000);
    expect(v.isOpen("vault-2")).toBe(false);
    await vi.runOnlyPendingTimersAsync();
    expect(s.log.at(-1)).toBe("lock:idle");
  });
});
