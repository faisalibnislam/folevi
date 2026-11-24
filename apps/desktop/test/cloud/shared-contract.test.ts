// The shared LocalFs contract fixture (packages/local-store/fixtures/fs-contract.json, the one every file
// layer runs: MemoryFs, the Mac's NodeFs, later iOS) against DropboxFs and DriveFs, plain and under
// EncryptedFs. Placeholders and NSFileVersion conflict versions don't exist on these providers, so the cases
// needing those hooks are skipped; a provider writing behind Folevi's back is the `put` hook.
import { describe, expect, test } from "vitest";
import { EncryptedFs } from "../../../../packages/local-store/src";
import { loadContract, runFsContract, type Contract } from "../../../../packages/local-store/test/fsContract";
import { FakeDropbox } from "./fakeDropbox";
import { FakeDrive } from "./fakeDrive";
import { dropboxDevice, driveDevice, SMALL_UPLOADS } from "./harness";
import type { LocalFs as StoreFs } from "../../../../packages/local-store/src";

const KEY = new Uint8Array(32).fill(7);

/**
 * Dropbox's documented WriteMode rule: "If the target path refers to a file with identical contents, nothing
 * gets written; no conflict." So rewriting the same bytes keeps the rev, and the fixture's one step that
 * expects a fresh etag for an identical rewrite is relaxed for Dropbox (only that `etagNot`; every other
 * check stands). Nothing relies on it: read-merge-write never rewrites identical bytes, and an unchanged
 * file needs no new etag for anyone to notice it.
 */
function forDropbox(): Contract {
  const c = loadContract();
  for (const k of c.cases)
    for (const step of k.steps)
      if (k.name === "the etag changes even when the size doesn't" && step.op === "write" && !("ifMatch" in step) && step.etagNot === "$b") delete step.etagNot;
  return c;
}

describe("the shared LocalFs contract fixture", () => {
  test("DropboxFs", async () => {
    const result = await runFsContract(async () => {
      const fake = new FakeDropbox({ pageSize: 2 });
      return { fs: dropboxDevice(fake, SMALL_UPLOADS.dropbox).fs as unknown as StoreFs, hooks: { put: async (p, b) => void fake.put(p, b) } };
    }, forDropbox());
    expect(result.skipped.sort()).toEqual(["a placeholder isn't downloaded", "conflict versions are listed, read and resolved"]);
    expect(result.ran.length).toBe(loadContract().cases.length - 2);
  });

  test("DriveFs", async () => {
    const result = await runFsContract(async () => {
      const fake = new FakeDrive({ pageSize: 2, chunkMultiple: 1024 });
      return { fs: driveDevice(fake, SMALL_UPLOADS.drive).fs as unknown as StoreFs, hooks: { put: async (p, b) => fake.putPath(p, b) } };
    });
    expect(result.ran.length).toBe(loadContract().cases.length - 2);
  });

  test("EncryptedFs over each provider", async () => {
    const providers = [
      { make: () => dropboxDevice(new FakeDropbox(), SMALL_UPLOADS.dropbox).fs, contract: forDropbox() },
      { make: () => driveDevice(new FakeDrive({ chunkMultiple: 1024 }), SMALL_UPLOADS.drive).fs, contract: loadContract() },
    ];
    for (const { make, contract } of providers) {
      const result = await runFsContract(async () => ({ fs: new EncryptedFs(make() as unknown as StoreFs, KEY) }), contract);
      expect(result.ran.length).toBe(loadContract().cases.length - 3);
    }
  });
});
