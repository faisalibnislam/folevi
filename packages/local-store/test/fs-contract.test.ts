// The shared LocalFs contract (fixtures/fs-contract.json) against the reference file layers. The Mac app
// runs the same fixture in apps/mac/FoleviTests/LibraryTests.swift.
import { describe, expect, it } from "vitest";
import { EncryptedFs, MemoryFs } from "../src";
import { loadContract, runFsContract } from "./fsContract";

describe("the LocalFs contract fixture", () => {
  it("MemoryFs passes every case, provider hooks included", async () => {
    const result = await runFsContract(async () => {
      const fs = new MemoryFs();
      return {
        fs,
        hooks: {
          evict: async (p) => fs.evict(p),
          put: async (p, b) => void fs.put(p, b),
          addConflictVersion: async (p, b) => void fs.addConflictVersion(p, b),
        },
      };
    });
    expect(result.skipped).toEqual([]);
    expect(result.ran.length).toBe(loadContract().cases.length);
  });

  it("EncryptedFs around MemoryFs passes the cases that need no hooks", async () => {
    const result = await runFsContract(async () => ({ fs: new EncryptedFs(new MemoryFs(), new Uint8Array(32).fill(7)) }));
    expect(result.ran.length + result.skipped.length).toBe(loadContract().cases.length);
    expect(result.skipped.length).toBe(3);
  });
});
