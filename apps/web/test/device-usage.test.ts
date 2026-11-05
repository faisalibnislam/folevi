// QA F19: Settings > Offline & Sync's Notes kept and Space used always finish measuring. A storage estimate that
// never answers (as WebKit's can in the apps) no longer holds every reading back; what can't be read is shown as
// unavailable, with Retry.
import { afterEach, describe, expect, test } from "vitest";
import { measureDeviceUsage, settleWithin, usageIncomplete } from "@/lib/sync/deviceUsage";
import { storageSummary } from "@/components/views/settings/DeviceCopySettings";

const original = Object.getOwnPropertyDescriptor(navigator, "storage");
function setEstimate(estimate: (() => Promise<StorageEstimate>) | undefined) {
  Object.defineProperty(navigator, "storage", { configurable: true, value: estimate ? { estimate } : undefined });
}
afterEach(() => {
  if (original) Object.defineProperty(navigator, "storage", original);
  else delete (navigator as { storage?: unknown }).storage;
});

describe("device usage", () => {
  test("settleWithin: a value, a failure as null, a hang as null", async () => {
    expect(await settleWithin(async () => 3, 50)).toBe(3);
    expect(await settleWithin(async () => Promise.reject(new Error("no")), 50)).toBeNull();
    expect(
      await settleWithin(() => {
        throw new Error("sync");
      }, 50),
    ).toBeNull();
    expect(await settleWithin(() => new Promise<number>(() => undefined), 20)).toBeNull();
  });

  test("an estimate that never answers leaves the note count readable and Space used unknown", async () => {
    setEstimate(() => new Promise<StorageEstimate>(() => undefined));
    const started = Date.now();
    const u = await measureDeviceUsage(`acct-${Date.now()}`, 50);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(u.notes).toBe(0);
    expect(u.used).toBeNull();
    expect(u.budget).toBeGreaterThan(0);
    expect(usageIncomplete(u)).toBe(true);
  });

  test("with an estimate everything is measured", async () => {
    setEstimate(async () => ({ usage: 2_000_000, quota: 10_000_000 }));
    const u = await measureDeviceUsage(`acct2-${Date.now()}`, 1000);
    expect(u).toMatchObject({ notes: 0, files: { count: 0, bytes: 0 }, used: 2_000_000, free: 8_000_000 });
    expect(usageIncomplete(u)).toBe(false);
  });
});

describe("the storage line", () => {
  test("measuring, measured, and unavailable", () => {
    expect(storageSummary(null)).toEqual({ text: "Measuring storage…", unavailable: false });
    expect(storageSummary({ notes: 1530, files: { count: 1, bytes: 2048 }, used: 5 * 1024 * 1024, free: null, budget: 1 })).toEqual({
      text: "1,530 notes and 1 attachment (2 KB) kept here. Folevi uses 5.0 MB on this device.",
      unavailable: false,
    });
    expect(storageSummary({ notes: null, files: null, used: null, free: null, budget: 1 })).toEqual({ text: "Notes kept: unavailable. Space used: unavailable.", unavailable: true });
  });
});
