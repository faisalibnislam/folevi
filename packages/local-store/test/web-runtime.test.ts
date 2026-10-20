// @vitest-environment edge-runtime
// The package runs in a web runtime (the app's web view): WebCrypto, TextEncoder and fflate only. The eslint
// rules on src forbid Node modules and globals; this runs the main paths under the edge runtime.
import { describe, expect, it } from "vitest";
import {
  EncryptedFs,
  HybridClock,
  MemoryFs,
  NoteReplica,
  createEncryption,
  createNote,
  decodeVersionFile,
  encodeVersionFile,
  openStreamRange,
  sealStream,
  snapshotVersion,
  unlockMasterKey,
  upsertBlock,
  type NoteFile,
} from "../src";
import { DOC, para } from "./helpers";

describe("in a web runtime", () => {
  it("encrypts, merges, writes history and syncs", async () => {
    const { header, masterKey } = await createEncryption("passphrase", { iterations: 1000 });
    expect(await unlockMasterKey(header, "passphrase")).toEqual(masterKey);
    const bytes = new Uint8Array(70_000).map((_, i) => i % 7);
    const env = await sealStream(masterKey, "files/aa/x", bytes);
    expect(await openStreamRange(masterKey, "files/aa/x", env, 65_530, 65_540)).toEqual(
      bytes.slice(65_530, 65_540),
    );
    const clock = new HybridClock("A", { now: () => 1000 });
    const note = upsertBlock(
      createNote(DOC, { createdAt: 1, title: "Trip" }, clock),
      para("B1", "hi"),
      ["content", "position"],
      clock,
    );
    const v = snapshotVersion(note, "auto", clock.tick(), "A");
    expect(decodeVersionFile(encodeVersionFile(v.file)).docId).toBe(DOC);
    const disk = new MemoryFs();
    const r = new NoteReplica(new EncryptedFs(disk, masterKey), clock);
    r.edit(DOC, () => note);
    expect((await r.sync()).written.length).toBe(1);
    const r2 = new NoteReplica(
      new EncryptedFs(disk, masterKey),
      new HybridClock("B", { now: () => 2000 }),
    );
    await r2.sync();
    expect((r2.notes.get(DOC) as NoteFile).doc.title!.v).toBe("Trip");
  });
});
