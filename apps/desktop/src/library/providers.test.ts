// Libraries in a Dropbox and a Google Drive folder (~/Library/CloudStorage, simulated in a temporary home):
// the copies those apps make when two Macs write one note are merged into the note through NodeFs and
// local-store's NoteReplica, then deleted only after the merged note is written; in an encrypted library too.
// Also: which folders count as iCloud Drive or File Provider ones, and how they're shown.
import { copyFileSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { HybridClock, NoteReplica, createNote, decodeNoteFile, encodeNoteFile, notePath, upsertBlock, type LocalFs as RefLocalFs, type NoteFile } from "../../../../packages/local-store/src";
import { para, textOf } from "../../../../packages/local-store/test/helpers";
import { cleanupTemps, tempDir } from "../../test/library-kit";
import { hmacName } from "./crypto";
import { EncryptedNodeFs } from "./encryptedFs";
import { NodeFs } from "./fs";
import { defaultLocation, displayPath, iCloudContainerDocuments, iCloudLocation, providerFor, providerOf } from "./locations";

afterAll(cleanupTemps);

const DOC = "01J9ZDOC000000000000000001";
function note(dev: string, now: number, text: string): NoteFile {
  const c = new HybridClock(dev, { now: () => now });
  return upsertBlock(createNote(DOC, { createdAt: 1, title: "Trip" }, c), para("B1", text), ["content", "position"], c);
}

function fakeHome() {
  const home = tempDir("folevi-home-");
  const dropbox = join(home, "Library", "CloudStorage", "Dropbox", "Folevi Library");
  const drive = join(home, "Library", "CloudStorage", "GoogleDrive-someone@example.com", "My Drive", "Folevi");
  const icloud = defaultLocation("icloud", home);
  for (const d of [dropbox, drive, icloud]) mkdirSync(join(d, "notes"), { recursive: true });
  return { home, dropbox, drive, icloud };
}

describe("conflict copies from cloud folders", () => {
  test.each([
    ["Dropbox", "dropbox", `${DOC} (Faisal's MacBook Air's conflicted copy 2026-10-20).fnote`],
    ["Google Drive", "drive", `${DOC}(1).fnote`],
    ["Google Drive (spaced)", "drive", `${DOC} (1).fnote`],
    ["iCloud Drive on the Mac", "icloud", `${DOC} 2.fnote`],
  ] as const)("%s: the copy is merged in, then removed", async (_name, where, copyName) => {
    const places = fakeHome();
    const root = places[where];
    // Mac A wrote the note; Mac B's concurrent version arrived as the provider's copy.
    writeFileSync(join(root, notePath(DOC)), encodeNoteFile(note("A", 1000, "from A")));
    writeFileSync(join(root, "notes", copyName), encodeNoteFile(note("B", 2000, "from B")));
    const fs = new NodeFs({ root }) as unknown as RefLocalFs;
    const replica = new NoteReplica(fs, new HybridClock("C", { now: () => 3000 }));
    const report = await replica.sync();
    expect(report.copiesMerged).toEqual([`notes/${copyName}`]);
    expect(readdirSync(join(root, "notes"))).toEqual([`${DOC}.fnote`]);
    const merged = decodeNoteFile((await fs.read(notePath(DOC)) as { bytes: Uint8Array }).bytes) as NoteFile;
    expect(Object.keys(merged.seen).sort()).toEqual(["A", "B"]);
    // B's edit was newer and wins; A's is kept in history with a notice.
    expect(textOf(merged, "B1")).toBe("from B");
    expect(Object.values(merged.notices).length).toBe(1);
    expect(readdirSync(join(root, "history", DOC)).length).toBe(1);
  });

  test("a copy that hasn't fully arrived is left alone, and the note isn't overwritten", async () => {
    const { dropbox: root } = fakeHome();
    const full = encodeNoteFile(note("A", 1000, "from A"));
    writeFileSync(join(root, notePath(DOC)), full);
    const copy = `${DOC} (B's conflicted copy 2026-10-20).fnote`;
    writeFileSync(join(root, "notes", copy), encodeNoteFile(note("B", 2000, "from B")).slice(0, 30));
    const replica = new NoteReplica(new NodeFs({ root }) as unknown as RefLocalFs, new HybridClock("C", { now: () => 3000 }));
    const report = await replica.sync();
    expect(report.copiesMerged).toEqual([]);
    expect(readdirSync(join(root, "notes")).sort()).toEqual([`${DOC} (B's conflicted copy 2026-10-20).fnote`, `${DOC}.fnote`]);
  });

  test("an encrypted library in Dropbox: the copy keeps its HMAC name and is still recognised", async () => {
    const { dropbox: root } = fakeHome();
    const key = new Uint8Array(32).fill(11);
    const a = new EncryptedNodeFs(new NodeFs({ root }), key);
    await a.write(notePath(DOC), encodeNoteFile(note("A", 1000, "from A")), {});
    // Dropbox keeps B's upload beside A's, under the same (HMAC) name with its suffix.
    const name = hmacName(key, "note", DOC);
    const b = new EncryptedNodeFs(new NodeFs({ root: tempDir() }), key);
    await b.write(notePath(DOC), encodeNoteFile(note("B", 2000, "from B")), {});
    copyFileSync(join(b.inner instanceof NodeFs ? b.inner.root : "", "notes", `${name}.fnote`), join(root, "notes", `${name} (B's conflicted copy 2026-10-20).fnote`));
    const replica = new NoteReplica(a as unknown as RefLocalFs, new HybridClock("C", { now: () => 3000 }));
    const report = await replica.sync();
    expect(report.copiesMerged).toEqual([`notes/${DOC} (B's conflicted copy 2026-10-20).fnote`]);
    expect(readdirSync(join(root, "notes"))).toEqual([`${name}.fnote`]);
    const merged = decodeNoteFile((await a.read(notePath(DOC)) as { bytes: Uint8Array }).bytes) as NoteFile;
    expect(Object.keys(merged.seen).sort()).toEqual(["A", "B"]);
  });
});

describe("cloud folder kinds", () => {
  test("iCloud Drive and File Provider folders are told apart from plain ones", async () => {
    const { home, dropbox, drive, icloud } = fakeHome();
    expect(providerFor(icloud, home)).toBe("icloud");
    expect(providerFor(dropbox, home)).toBe("fileprovider");
    expect(providerFor(drive, home)).toBe("fileprovider");
    expect(providerFor(join(home, "Documents", "Folevi Library"), home)).toBe("plain");
    // ~/Dropbox is a link into CloudStorage on current Dropbox: links are followed.
    symlinkSync(join(home, "Library", "CloudStorage", "Dropbox"), join(home, "Dropbox"));
    expect(await providerOf(join(home, "Dropbox", "Folevi Library"), home)).toBe("fileprovider");
    expect(await providerOf(join(home, "Dropbox", "Not there yet", "Library"), home)).toBe("fileprovider");
  });

  test("names for people", () => {
    const home = "/Users/someone";
    expect(displayPath(defaultLocation("icloud", home), home)).toBe("iCloud Drive › Folevi");
    expect(displayPath(defaultLocation("device", home), home)).toBe("~/Documents/Folevi Library");
    expect(displayPath(`${home}/Library/CloudStorage/Dropbox/Notes`, home)).toBe("Dropbox › Notes");
    expect(displayPath(`${home}/Library/CloudStorage/GoogleDrive-a@b.com/My Drive/Folevi`, home)).toBe("Google Drive › My Drive › Folevi");
    expect(displayPath(`${home}/Library/CloudStorage/OneDrive-Personal/Folevi`, home)).toBe("OneDrive › Folevi");
    expect(displayPath("/Volumes/Disk/Folevi", home)).toBe("/Volumes/Disk/Folevi");
  });

  test("Sync with iCloud uses the iPhone's container once it's on this Mac", async () => {
    const home = tempDir();
    {
      expect(await iCloudLocation(home)).toBe(defaultLocation("icloud", home));
      mkdirSync(join(home, "Library", "Mobile Documents", "iCloud~com~folevi"), { recursive: true });
      expect(await iCloudLocation(home)).toBe(iCloudContainerDocuments(home));
      expect(displayPath(iCloudContainerDocuments(home), home)).toBe("iCloud Drive › Folevi");
      expect(providerFor(iCloudContainerDocuments(home), home)).toBe("icloud");
    }
  });

  test("Sync with iCloud makes the container when the helper app can (FoleviFiles.app), and does without", async () => {
    const home = tempDir();
    const container = join(home, "Library", "Mobile Documents", "iCloud~com~folevi");
    // The bare helper (no entitlement) or iCloud signed out: the iCloud Drive folder.
    expect(await iCloudLocation(home, { container: async () => null })).toBe(defaultLocation("icloud", home));
    expect(await iCloudLocation(home, { container: async () => Promise.reject(new Error("helper stopped")) })).toBe(defaultLocation("icloud", home));
    // The helper app makes it (with its Documents folder): the container from then on, without asking again.
    let asked = 0;
    const make = async () => {
      asked++;
      mkdirSync(join(container, "Documents"), { recursive: true });
      return container;
    };
    expect(await iCloudLocation(home, { container: make })).toBe(join(container, "Documents"));
    expect(await iCloudLocation(home, { container: make })).toBe(iCloudContainerDocuments(home));
    expect(asked).toBe(1);
  });
});
