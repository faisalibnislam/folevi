// local-store's convergence property tests (packages/local-store/test/sim.ts) with every device on the same
// fake provider: random concurrent edits, NoteReplica sync through DropboxFs or DriveFs (read-merge-write,
// conflict versions, numbered copies), rate limits, server errors, dropped connections, cut-off transfers,
// lagging listings and token refreshes along the way. After the faults stop and every device has synced, all
// replicas and the provider must hold the same notes, and no edit may be lost. With encryption, EncryptedFs
// sits on top of the provider exactly as it does on a folder.
//
// One provider per library: there is no run with one device on Dropbox and another on Drive.
import { describe, expect, test } from "vitest";
import { noteSum, seededRandom } from "../../local-store/src";
import { checkProperties, makeSimOn, randomEdit, scenarioOn, settle } from "../../local-store/test/sim";
import { FakeDropbox } from "./fakeDropbox";
import { FakeDrive } from "./fakeDrive";
import { FakeProviderCloud } from "./harness";

const PROVIDERS = {
  dropbox: (seed: number) => FakeProviderCloud.dropbox(seed),
  googleDrive: (seed: number) => FakeProviderCloud.drive(seed),
};

for (const [name, make] of Object.entries(PROVIDERS)) {
  describe(`${name}: convergence and no loss`, () => {
    test("3 devices, random edits and faults (40 seeds)", async () => {
      for (let seed = 1; seed <= 40; seed++) {
        const cloud = make(seed);
        await scenarioOn(await makeSimOn(cloud, 3, false), seed, 120);
      }
    });

    test("2 and 4 devices", async () => {
      for (const devices of [2, 4]) {
        const cloud = make(100 + devices);
        await scenarioOn(await makeSimOn(cloud, devices, false), 100 + devices, 150);
      }
    });

    test("through the encrypted library", async () => {
      for (const seed of [21, 22, 23, 24, 25]) {
        const cloud = make(seed);
        const sim = await scenarioOn(await makeSimOn(cloud, 3, true), seed, 80);
        for (const path of cloud.cloudPaths()) {
          expect(path).not.toMatch(/01J9ZDOC/);
          expect(new TextDecoder().decode(cloud.cloudFile(path)!.slice(0, 4))).toBe("FLV1");
        }
        expect(sim.replicas[0]!.notes.size).toBeGreaterThan(0);
      }
    });

    test("faults and token refreshes actually happen in these runs", async () => {
      const cloud = make(424242);
      const sim = await scenarioOn(await makeSimOn(cloud, 3, false), 424242, 200);
      const stats = cloud.devices.map((d) => d.injector.stats);
      const sum = (k: keyof (typeof stats)[number]) => stats.reduce((n, s) => n + s[k], 0);
      expect(sum("rateLimited")).toBeGreaterThan(0);
      expect(sum("serverErrors")).toBeGreaterThan(0);
      expect(sum("dropped")).toBeGreaterThan(0);
      expect(sum("partial")).toBeGreaterThan(0);
      expect((cloud.fake as FakeDropbox | FakeDrive).oauth.refreshes).toBeGreaterThan(0);
      expect(sim.edits.length).toBeGreaterThan(50);
      expect(sim.replicas.some((r) => r.losses.length > 0)).toBe(true);
    });
  });
}

describe("googleDrive: the check-then-upload race under real concurrency", () => {
  test("devices syncing at the same moment, requests interleaved at random", async () => {
    let raced = 0;
    for (const seed of [31, 32, 33, 34]) {
      const cloud = FakeProviderCloud.drive(seed, 70_000, { now: 0 }, 3);
      const sim = await makeSimOn(cloud, 3, false);
      const rnd = seededRandom(seed);
      // Everyone starts from the same note, as in the scenario.
      randomEdit(sim, 0, rnd);
      await sim.replicas[0]!.sync();
      for (const r of sim.replicas) await r.sync();
      cloud.faults = { delay: 0.2, duplicate: 0.05, stale: 0.05, truncate: 0, loseUpdate: 0 };
      for (let round = 0; round < 25; round++) {
        for (let i = 0; i < sim.replicas.length; i++) if (rnd() < 0.8) randomEdit(sim, i, rnd);
        // All devices flush at once: their checks and uploads interleave.
        await Promise.all(sim.replicas.map((r) => r.sync()));
        if (rnd() < 0.5) cloud.step();
      }
      await settle(sim);
      await checkProperties(sim);
      raced += cloud.messages.filter((m) => m.includes("landed during Folevi's upload")).length;
      const sums = sim.replicas.map((r) => [...r.notes.values()].map(noteSum).sort().join());
      expect(new Set(sums).size).toBe(1);
    }
    // The race window was actually hit (and recovered from) in these runs.
    expect(raced).toBeGreaterThan(0);
  });
});
