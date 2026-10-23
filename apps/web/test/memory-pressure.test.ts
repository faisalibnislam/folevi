// Memory pressure in the page (lib/memoryPressure.ts): what's registered lets go when the Mac warns, one failing
// part doesn't stop the others, and the decrypted files cache keeps only what the page still shows.
import { describe, expect, it, vi } from "vitest";
import { onMemoryPressure, relieveMemory } from "@/lib/memoryPressure";
import { FileCache } from "@/lib/e2ee/files";

describe("memory pressure", () => {
  it("runs every relief with the level, and stops one that's let go", () => {
    const a = vi.fn();
    const b = vi.fn(() => {
      throw new Error("no");
    });
    const c = vi.fn();
    const offA = onMemoryPressure(a);
    const offB = onMemoryPressure(b);
    const offC = onMemoryPressure(c);
    relieveMemory("critical");
    expect(a).toHaveBeenCalledWith("critical");
    expect(c).toHaveBeenCalledWith("critical");
    offA();
    relieveMemory();
    expect(a).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenLastCalledWith("warning");
    offB();
    offC();
  });

  it("is what the Mac app calls", () => {
    const relief = vi.fn();
    const off = onMemoryPressure(relief);
    const call = (window as unknown as { __foleviMemoryPressure: (level: string) => number }).__foleviMemoryPressure;
    expect(call("critical")).toBeGreaterThanOrEqual(1);
    call("anything");
    expect(relief.mock.calls.map((c) => c[0])).toEqual(["critical", "warning"]);
    off();
  });

  it("keeps the decrypted files still shown and lets the rest go", () => {
    const revoked: string[] = [];
    const cache = new FileCache(() => {
      throw new Error("not used");
    }, { revokeUrl: (u) => void revoked.push(u) });
    const entries = (cache as unknown as { entries: Map<string, { url: string; bytes: number }> }).entries;
    entries.set("f1", { url: "blob:one", bytes: 100 });
    entries.set("f2", { url: "blob:two", bytes: 50 });
    (cache as unknown as { total: number }).total = 150;
    expect(cache.trim((url) => url === "blob:two")).toBe(100);
    expect(revoked).toEqual(["blob:one"]);
    expect(cache.size).toBe(50);
    expect([...entries.keys()]).toEqual(["f2"]);
  });
});
