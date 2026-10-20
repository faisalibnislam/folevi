// Signing out of an account clears the account's data on this device, never a local library's copy.
import { describe, expect, it } from "vitest";
import { clearAllLocalData } from "@/lib/sync/db";

function open(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("s");
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

const names = async () => ((await indexedDB.databases()) ?? []).map((d) => d.name).sort();

describe("clearAllLocalData", () => {
  it("keeps a local library's copy unless asked to remove it", async () => {
    await open("folevi-account-x");
    await open("folevi-local-lib1");
    await open("other-app");
    await clearAllLocalData();
    expect(await names()).toEqual(expect.arrayContaining(["folevi-local-lib1", "other-app"]));
    expect(await names()).not.toContain("folevi-account-x");
    await clearAllLocalData({ library: true });
    expect(await names()).not.toContain("folevi-local-lib1");
    expect(await names()).toContain("other-app");
  });
});
