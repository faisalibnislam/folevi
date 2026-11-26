// Signing out of an account clears the account's data on this device, never a local library's copy.
import { describe, expect, it, vi } from "vitest";
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

// What a tab or the browser kept of an account outside its database: Home's "Catch me up" brief (an AI summary of
// its notes, in sessionStorage), the changes still queued for it, and the words it taught the spelling checker.
describe("what is kept of an account outside its database", () => {
  it("a brief is kept under the account it was written for, never a name two accounts share", async () => {
    const { catchUpKey } = await import("@/lib/ai/catchUpStore");
    expect(catchUpKey("profA", "personal")).toBe("folevi:catchup:profA:personal");
    expect(catchUpKey("profA", "personal")).not.toBe(catchUpKey("profB", "personal"));
  });

  it("signing out of one account, or of the last one, forgets every brief in the tab (old keys too)", async () => {
    const { clearAccountData } = await import("@/lib/sync/db");
    const fill = () => {
      sessionStorage.setItem("folevi:catchup:profA:personal", '{"answer":"A week"}');
      sessionStorage.setItem("folevi:catchup:personal", '{"answer":"kept by an earlier build"}');
      sessionStorage.setItem("folevi:tab-id", "t1");
    };
    fill();
    await clearAccountData("profA");
    expect(Object.keys(sessionStorage).filter((k) => k.startsWith("folevi:catchup:"))).toEqual([]);
    expect(sessionStorage.getItem("folevi:tab-id")).toBe("t1");
    fill();
    await clearAllLocalData();
    expect(Object.keys(sessionStorage).filter((k) => k.startsWith("folevi:catchup:"))).toEqual([]);
    expect(sessionStorage.getItem("folevi:tab-id")).toBe("t1");
  });

  it("moving the tab to another account forgets it too", async () => {
    const { openPlaceInTab } = await import("@/lib/places/web");
    sessionStorage.setItem("folevi:catchup:profA:personal", '{"answer":"A week"}');
    const assign = vi.fn();
    const real = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...real, assign } });
    try {
      openPlaceInTab("acct:userB");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: real });
    }
    expect(sessionStorage.getItem("folevi:catchup:profA:personal")).toBeNull();
    expect(assign).toHaveBeenCalledWith("/documents");
  });

  it("the last sign-out drops the accounts' queued changes, and a library's stay", async () => {
    localStorage.setItem("folevi:sync-journal:profA:tab1", '{"ops":[{"text":"private"}]}');
    localStorage.setItem("folevi:sync-journal:local-lib1:tab1", '{"ops":[]}');
    localStorage.setItem("folevi:sidebar-width", "280");
    await clearAllLocalData();
    expect(localStorage.getItem("folevi:sync-journal:profA:tab1")).toBeNull();
    expect(localStorage.getItem("folevi:sync-journal:local-lib1:tab1")).not.toBeNull();
    expect(localStorage.getItem("folevi:sidebar-width")).toBe("280");
    await clearAllLocalData({ library: true });
    expect(localStorage.getItem("folevi:sync-journal:local-lib1:tab1")).toBeNull();
  });

  it("the words the browser learnt are forgotten on request, nothing else", async () => {
    const { forgetLearntSpelling, LEARNT_KEY } = await import("@/lib/spelling/learnt");
    localStorage.setItem(LEARNT_KEY, '["Okonkwo"]');
    forgetLearntSpelling();
    expect(localStorage.getItem(LEARNT_KEY)).toBeNull();
    expect(localStorage.getItem("folevi:sidebar-width")).toBe("280");
  });
});
