// Property tests: N devices make random concurrent edits and exchange files through a faulty cloud folder
// (late, duplicated, stale and partial deliveries, conflict copies, conflict versions, lost updates). After the
// faults stop and every device has synced, all replicas and the folder must be identical (convergence), and
// every content edit must be live, in history, or knowingly superseded by a later edit (no loss).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { noteSum, type CopyStyle } from "../src";
import { scenario } from "./sim";

describe("convergence and no loss through a faulty cloud folder", () => {
  it("3 devices, every kind of conflict copy (fast-check seeds)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 2 ** 31 - 1 }), async (seed) => {
        await scenario(seed, 3, 120, ["dropbox", "icloud", "numbered", "versions"]);
      }),
      { numRuns: 100 },
    );
  });

  it("2 to 4 devices, each provider's copy style", async () => {
    const styles: CopyStyle[][] = [
      ["dropbox"],
      ["icloud"],
      ["numbered"],
      ["onedrive"],
      ["versions"],
    ];
    let n = 0;
    for (const style of styles)
      for (const devices of [2, 4]) await scenario(1000 + n++, devices, 150, style);
  });

  it("through the encrypted folder", async () => {
    for (const seed of [11, 12, 13]) {
      const sim = await scenario(seed, 3, 80, ["dropbox", "versions"], true);
      // On disk: envelopes under HMAC names only.
      for (const path of sim.cloud.cloudPaths()) {
        expect(path).not.toMatch(/01J9ZDOC/);
        const bytes = sim.cloud.cloudFile(path)!;
        expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("FLV1");
      }
    }
  });

  it("faults actually happen in these runs", async () => {
    const sim = await scenario(424242, 3, 200, ["dropbox", "icloud", "numbered", "versions"]);
    const s = sim.cloud.stats;
    expect(s.copies + s.conflictVersions).toBeGreaterThan(0);
    expect(s.lostUpdates).toBeGreaterThan(0);
    expect(s.truncated).toBeGreaterThan(0);
    expect(s.stale).toBeGreaterThan(0);
    expect(s.duplicates).toBeGreaterThan(0);
    expect(sim.edits.length).toBeGreaterThan(50);
    expect(sim.replicas.some((r) => r.losses.length > 0)).toBe(true);
  });

  it("is deterministic for a seed", async () => {
    const a = await scenario(777, 3, 150, ["dropbox", "versions"]);
    const b = await scenario(777, 3, 150, ["dropbox", "versions"]);
    const sums = (sim: typeof a) =>
      [...sim.replicas[0]!.notes.values()].map((n) => noteSum(n)).sort();
    expect(sums(a)).toEqual(sums(b));
  });

  it("permanent deletes happen and resolve", async () => {
    let stubs = 0;
    for (let seed = 500; seed < 530; seed++)
      stubs += (await scenario(seed, 3, 150, ["dropbox", "icloud", "versions"])).stubs;
    expect(stubs).toBeGreaterThan(0);
  });
});
