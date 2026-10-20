// The persistent local store (lib/local/store, docs/LOCAL_MODE_PLAN.md §3): a library on "disk" (local-store's
// MemoryFs, or FaultyCloud mounts for several devices), this device's copy in a replica database, the journal.
import { afterEach, describe, expect, test } from "vitest";
import { NOTE_EMOJI, SCHEMA_VERSION, ulid, type SyncOp, type WireBlock } from "@folevi/editor-schema";
import { DEFAULT_FAULTS, FaultyCloud, MemoryFs, MemoryJournal, decodeNoteFile, notePath, type LocalFs } from "@folevi/local-store";
import { api } from "@/lib/convex/api";
import { LocalBackend } from "@/lib/local/backend";
import { LocalClient } from "@/lib/local/client";
import { IdbReplicaDb, LibraryStore, MemoryLibraryHost, MemoryReplicaDb, createEncryptedLibrary, type OpenReplicaDb } from "@/lib/local/store/index";

/** Each device's remembered library id (its localStorage). */
const remembered = new Map<string, string>();
afterEach(() => {
  MemoryReplicaDb.wipe();
  remembered.clear();
});

const para = (id: string, text: string, rank: string): WireBlock => ({ id, type: "paragraph", parentId: null, rank, schemaVersion: SCHEMA_VERSION, text: text ? [{ type: "text", text }] : [], props: {} });

interface Device {
  name: string;
  host: MemoryLibraryHost;
  store: LibraryStore;
  backend: LocalBackend;
  client: LocalClient;
}

/** One device's app on a library folder: its own replica database and journal (kept across "launches"). */
async function launch(name: string, fs: LocalFs, opts: { journal?: MemoryJournal; masterKey?: Uint8Array; host?: MemoryLibraryHost; openDb?: OpenReplicaDb } = {}): Promise<Device> {
  const host = opts.host ?? new MemoryLibraryHost({ fs, journal: opts.journal, masterKey: opts.masterKey });
  const store = await LibraryStore.open({
    host,
    deviceId: name,
    openDb: opts.openDb ?? (async (libraryId) => MemoryReplicaDb.open(`${name}:${libraryId}`)),
    page: null,
    scanMs: 0,
    libraryIds: { recall: () => remembered.get(name) ?? null, remember: (id) => void remembered.set(name, id) },
    device: { name: `${name}'s Mac` },
  });
  const backend = new LocalBackend(store, { deviceId: name });
  const client = new LocalClient(backend);
  await store.idle();
  return { name, host, store, backend, client };
}

async function quit(d: Device) {
  await d.client.close();
  await d.backend.close();
}

async function setUp(d: Device) {
  await d.client.local.setup({ timeZone: "UTC", locale: "en", displayName: "Test", seed: false });
}

async function push(d: Device, ops: SyncOp[]) {
  const results = (await d.client.mutation(api.sync.push, { scope: { kind: "personal" }, deviceId: d.name, ops: ops as never })) as { status: string }[];
  expect(results.map((r) => r.status)).toEqual(ops.map(() => "applied"));
  return results as unknown as { status: string; revision?: number }[];
}

async function newNote(d: Device, title: string, blocks: WireBlock[]): Promise<string> {
  const id = ulid();
  await push(d, [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: NOTE_EMOJI[0]! } } as SyncOp]);
  if (blocks.length) await push(d, blocks.map((block) => ({ opId: ulid(), kind: "block.upsert", documentId: id, block, baseRevision: null, fields: ["content", "position"] }) as SyncOp));
  return id;
}

async function edit(d: Device, docId: string, block: WireBlock, baseRevision: number | null) {
  return await push(d, [{ opId: ulid(), kind: "block.upsert", documentId: docId, block, baseRevision, fields: ["content"] } as SyncOp]);
}

const texts = async (d: Device, docId: string) => {
  const r = (await d.client.query(api.blocks.list, { documentId: docId })) as { blocks: WireBlock[] } | null;
  return (r?.blocks ?? []).map((b) => `${b.id.slice(-4)}:${(b.text as { text?: string }[]).map((t) => t.text ?? "").join("")}`).sort();
};

const revisionOf = async (d: Device, docId: string, blockId: string) => {
  const r = (await d.client.query(api.blocks.list, { documentId: docId })) as { blocks: WireBlock[] };
  return r.blocks.find((b) => b.id === blockId)!.revision!;
};

describe("the persistent local store", () => {
  test("a reload shows everything, read from this device's copy and the folder", async () => {
    const fs = new MemoryFs();
    const journal = new MemoryJournal();
    const a = await launch("macbookA", fs, { journal });
    await setUp(a);
    const x = ulid();
    const id = await newNote(a, "Trip", [para(x, "Pack the tent", "V")]);
    await a.client.mutation(api.organization.createFolder, { name: "Travel" } as never).catch(() => undefined);
    await quit(a);
    // The note is in the folder as a file, and the journal holds nothing the folder doesn't.
    const file = decodeNoteFile(fs.peek(notePath(id))!);
    expect("blocks" in file && file.doc.title?.v).toBe("Trip");
    expect(journal.records).toHaveLength(0);

    const again = await launch("macbookA", fs, { journal });
    const doc = (await again.client.query(api.documents.get, { documentId: id })) as { document: { title: string } } | null;
    expect(doc?.document.title).toBe("Trip");
    expect(await texts(again, id)).toEqual([`${x.slice(-4)}:Pack the tent`]);
    const me = (await again.client.query(api.users.me, {})) as { state: string };
    expect(me.state).toBe("ready");
    await quit(again);
  });

  test("a crash before the note reached the folder (or IndexedDB) loses nothing: the journal is replayed", async () => {
    const fs = new MemoryFs();
    const journal = new MemoryJournal();
    const a = await launch("macbookA", fs, { journal });
    await setUp(a);
    await a.store.library.flush();
    const x = ulid();
    const id = await newNote(a, "Unsaved", [para(x, "typed just before the crash", "V")]);
    // Acknowledged: in the journal. Not in the folder yet (it's written after a second of quiet).
    expect(journal.records.length).toBeGreaterThan(0);
    expect(fs.peek(notePath(id))).toBeUndefined();
    await a.store.crash();
    // The device's IndexedDB didn't keep it either.
    MemoryReplicaDb.wipe();

    const b = await launch("macbookA", fs, { journal });
    expect(await texts(b, id)).toEqual([`${x.slice(-4)}:typed just before the crash`]);
    await b.store.library.flush();
    const file = decodeNoteFile(fs.peek(notePath(id))!);
    expect("blocks" in file && Object.keys(file.blocks)).toEqual([x]);
    expect(journal.records).toHaveLength(0);
    await quit(b);
  });

  test("a crash in the middle of a flush: the note is written on the next launch", async () => {
    const inner = new MemoryFs();
    let failNotes = true;
    const fs: LocalFs = {
      list: (d) => inner.list(d),
      read: (p) => inner.read(p),
      write: async (p, bytes, o) => {
        if (failNotes && p.startsWith("notes/")) throw new Error("the app was killed");
        return await inner.write(p, bytes, o);
      },
      remove: (p, o) => inner.remove(p, o),
      conflictVersions: (p) => inner.conflictVersions(p),
      resolveConflicts: (p, ids) => inner.resolveConflicts(p, ids),
    };
    const journal = new MemoryJournal();
    const a = await launch("macbookA", fs, { journal });
    await setUp(a);
    const x = ulid();
    const id = await newNote(a, "Half written", [para(x, "safe anyway", "V")]);
    await a.store.library.flush();
    expect(a.store.library.status().error).toContain("killed");
    await a.store.crash();
    failNotes = false;
    const b = await launch("macbookA", fs, { journal });
    await b.store.library.flush();
    expect(inner.peek(notePath(id))).toBeDefined();
    expect(await texts(b, id)).toEqual([`${x.slice(-4)}:safe anyway`]);
    expect(journal.records).toHaveLength(0);
    await quit(b);
  });

  test.each([7, 13, 29])("two devices through a faulty cloud folder converge, and a block changed on both gets a notice (seed %i)", async (seed) => {
    const cloud = new FaultyCloud({ seed, faults: DEFAULT_FAULTS });
    const ma = cloud.mount("A");
    const mb = cloud.mount("B");
    const a = await launch("macbookA", ma);
    await setUp(a);
    const x = ulid();
    const y = ulid();
    const id = await newNote(a, "Shared", [para(x, "one", "V"), para(y, "two", "X")]);
    await a.store.library.flush();
    cloud.settle();
    const b = await launch("macbookB", mb);
    await b.store.library.syncNow();
    expect(((await b.client.query(api.users.me, {})) as { state: string }).state).toBe("ready");
    expect(await texts(b, id)).toEqual([`${x.slice(-4)}:one`, `${y.slice(-4)}:two`].sort());

    // Both edit block x without seeing each other; B also edits y. The cloud delays, duplicates, reorders,
    // truncates, makes conflict copies and loses updates meanwhile.
    cloud.faults = DEFAULT_FAULTS;
    await edit(a, id, para(x, "one, from A", "V"), await revisionOf(a, id, x));
    await edit(b, id, para(x, "one, from B", "V"), await revisionOf(b, id, x));
    await edit(b, id, para(y, "two, from B", "X"), await revisionOf(b, id, y));
    for (let round = 0; round < 12; round++) {
      await a.store.library.syncNow();
      await b.store.library.syncNow();
      for (let i = 0; i < 6; i++) cloud.step();
    }
    cloud.settle();
    for (let round = 0; round < 3; round++) {
      await a.store.library.syncNow();
      await b.store.library.syncNow();
      cloud.settle();
    }
    const ta = await texts(a, id);
    expect(ta).toEqual(await texts(b, id));
    expect(ta).toContain(`${y.slice(-4)}:two, from B`);
    const winner = ta.find((t) => t.startsWith(x.slice(-4)))!;
    expect(["one, from A", "one, from B"].map((t) => `${x.slice(-4)}:${t}`)).toContain(winner);
    // The other edit is in version history on both, with a notice on the block.
    for (const d of [a, b]) {
      const notices = await d.store.list("notices", id);
      const notice = notices.find((n) => n.blockId === x);
      expect(notice, `${d.name} has the notice`).toBeDefined();
      expect(notice!.kind).toBe("changed");
      expect(notice!.versionId).toBeTruthy();
      const version = await d.store.get("versions", notice!.versionId!, id);
      await d.store.idle();
      const kept = version ?? (await d.store.get("versions", notice!.versionId!, id));
      expect(kept?.conflict?.target).toBe(x);
      const lost = winner.endsWith("from A") ? "one, from B" : "one, from A";
      expect((kept!.blocks[0]!.text as { text: string }[])[0]!.text).toBe(lost);
    }
    expect(cloud.cloudPaths().some((p) => p.startsWith(`history/${id}/`) && p.includes("-conflict-"))).toBe(true);
    // Each device lists the other in Library settings.
    expect(a.store.library.status().devices.map((dv) => dv.name).sort()).toEqual(["macbookA's Mac", "macbookB's Mac"]);
    await quit(a);
    await quit(b);
  });

  test("an edit made without seeing another device's change wins, and the overwritten one is kept with a notice", async () => {
    const fs = new MemoryFs();
    const a = await launch("macbookA", fs);
    await setUp(a);
    const x = ulid();
    const id = await newNote(a, "Plan", [para(x, "draft", "V")]);
    await a.store.library.flush();
    const b = await launch("macbookB", fs);
    await b.store.library.syncNow();
    const seenByB = await revisionOf(b, id, x);
    // A changes the block; B reads it from the folder while its editor still has an edit based on the old one.
    await edit(a, id, para(x, "A's rewrite", "V"), await revisionOf(a, id, x));
    await a.store.library.flush();
    await b.store.library.syncNow();
    expect(await texts(b, id)).toEqual([`${x.slice(-4)}:A's rewrite`]);
    const results = await edit(b, id, para(x, "B's pending edit", "V"), seenByB);
    expect(results[0]!.status).toBe("applied");
    await b.store.idle();
    expect(await texts(b, id)).toEqual([`${x.slice(-4)}:B's pending edit`]);
    const [notice] = await b.store.list("notices", id);
    expect(notice).toMatchObject({ blockId: x, kind: "changed", other: "macbookA", from: "macbookB" });
    const kept = await b.store.get("versions", notice!.versionId!, id);
    expect((kept!.blocks[0]!.text as { text: string }[])[0]!.text).toBe("A's rewrite");
    // The other device gets B's edit and the same notice.
    await b.store.library.flush();
    await a.store.library.syncNow();
    expect(await texts(a, id)).toEqual([`${x.slice(-4)}:B's pending edit`]);
    expect((await a.store.list("notices", id)).map((n) => n.id)).toEqual([notice!.id]);
    await quit(a);
    await quit(b);
  });

  test("a new device shows the library from the catalogs before the notes have downloaded", async () => {
    const cloud = new FaultyCloud({ seed: 3 });
    const ma = cloud.mount("A");
    const mb = cloud.mount("B");
    const a = await launch("macbookA", ma);
    await setUp(a);
    const ids = [await newNote(a, "First", [para(ulid(), "1", "V")]), await newNote(a, "Second", [para(ulid(), "2", "V")])];
    await a.store.library.flush();
    cloud.settle();
    // On B the note files are placeholders still (iCloud hasn't downloaded them).
    for (const id of ids) mb.localFs.evict(notePath(id));
    const b = await launch("macbookB", mb);
    await b.store.library.syncNow();
    const titles = async () => {
      const page = (await b.client.query(api.documents.list, { scope: { kind: "personal" }, view: "all", paginationOpts: { numItems: 20, cursor: null } } as never)) as { page: { title: string }[] };
      return page.page.map((d) => d.title).sort();
    };
    expect(await titles()).toEqual(["First", "Second"]);
    const pending = await b.store.get("documents", ids[0]!);
    expect(pending?.pending).toBe("downloading");
    expect(b.store.library.status().health.downloading.map((h) => h.documentId).sort()).toEqual([...ids].sort());
    expect(b.host.downloads.sort()).toEqual(ids.map((id) => notePath(id)).sort());
    // They arrive.
    for (const id of ids) mb.localFs.put(notePath(id), cloud.cloudFile(notePath(id))!);
    await b.store.library.syncNow();
    expect((await b.store.get("documents", ids[0]!))?.pending).toBeUndefined();
    expect(await texts(b, ids[1]!)).toHaveLength(1);
    expect(b.store.library.status().health.downloading).toEqual([]);
    await quit(a);
    await quit(b);
  });

  test("an encrypted library stays locked until the passphrase is given, then opens", async () => {
    const fs = new MemoryFs();
    const key = await createEncryptedLibrary(fs, "lib_encrypted", "correct horse", { iterations: 1000 });
    const a = await launch("macbookA", fs, { masterKey: key });
    expect(a.store.library.status().state).toBe("ready");
    await setUp(a);
    const id = await newNote(a, "Secret", [para(ulid(), "hidden text", "V")]);
    await a.store.library.flush();
    // On disk: HMAC names and ciphertext only.
    expect(fs.paths().some((p) => p.includes(id))).toBe(false);
    expect(new TextDecoder().decode(fs.peek(fs.paths().find((p) => p.startsWith("notes/"))!)!)).not.toContain("hidden text");

    const b = await launch("macbookB", fs);
    expect(b.store.library.status().state).toBe("locked");
    await expect(setUp(b)).rejects.toThrow(/passphrase/);
    expect(await b.store.library.unlock("wrong")).toBe(false);
    expect(await b.store.library.unlock("correct horse")).toBe(true);
    expect(b.store.library.status().state).toBe("ready");
    const doc = (await b.client.query(api.documents.get, { documentId: id })) as { document: { title: string } } | null;
    expect(doc?.document.title).toBe("Secret");
    expect((await texts(b, id))[0]).toContain("hidden text");
    await quit(a);
    await quit(b);
  });

  test("every commit and every change from disk tells the queries that read it", async () => {
    const fs = new MemoryFs();
    const a = await launch("macbookA", fs);
    await setUp(a);
    const x = ulid();
    const id = await newNote(a, "Watched", [para(x, "v1", "V")]);
    await a.store.library.flush();
    const b = await launch("macbookB", fs);
    await b.store.library.syncNow();
    const seen: string[][] = [];
    b.backend.subscribe((keys) => seen.push([...keys]));
    await edit(a, id, para(x, "v2", "V"), await revisionOf(a, id, x));
    await a.store.library.flush();
    await b.store.library.syncNow();
    expect(seen.flat()).toEqual(expect.arrayContaining([`blocks:${id}`, `doc:${id}`, "catalog"]));
    await quit(a);
    await quit(b);
  });

  test("this device's copy lives in IndexedDB (folevi-local-<libraryId>) and is read back on launch", async () => {
    const fs = new MemoryFs();
    const journal = new MemoryJournal();
    const openDb: OpenReplicaDb = (libraryId) => IdbReplicaDb.open(`${libraryId}-idb-test`);
    const a = await launch("macbookA", fs, { journal, openDb });
    await setUp(a);
    const x = ulid();
    const id = await newNote(a, "Kept in IndexedDB", [para(x, "here", "V")]);
    await quit(a);
    // The folder is gone (say, a cloud provider is signed out): what the device kept still opens.
    const empty = new MemoryLibraryHost({ fs: new MemoryFs(), journal });
    empty.available = false;
    const b = await launch("macbookA", empty.inner, { journal, openDb, host: empty });
    expect(b.store.library.status().state).toBe("unavailable");
    expect(await texts(b, id)).toEqual([`${x.slice(-4)}:here`]);
    await quit(b);
  });

  test("folders, tags, stars and the profile reach the other device through the index", async () => {
    const fs = new MemoryFs();
    const a = await launch("macbookA", fs);
    await setUp(a);
    const id = await newNote(a, "Filed", []);
    const folder = (await a.client.mutation(api.organization.createFolder, { scope: { kind: "personal" }, name: "Projects" } as never)) as { id: string } | string;
    const folderId = typeof folder === "string" ? folder : folder.id;
    await a.client.mutation(api.organization.createTag, { scope: { kind: "personal" }, name: "travel" } as never);
    await a.client.mutation(api.documents.setStarred, { documentId: id, starred: true });
    await push(a, [{ opId: ulid(), kind: "document.update", documentId: id, patch: { folderId }, baseRevision: null } as SyncOp]);
    await a.store.library.flush();
    const b = await launch("macbookB", fs);
    await b.store.library.syncNow();
    const sidebar = (await b.client.query(api.organization.sidebar, { scope: { kind: "personal" } } as never)) as { folders: { name: string }[]; tags: { name: string }[] };
    expect(sidebar.folders.map((f) => f.name)).toEqual(["Projects"]);
    expect(sidebar.tags.map((t) => t.name)).toEqual(["travel"]);
    const doc = await b.store.get("documents", id);
    expect(doc).toMatchObject({ folderId, starred: true, title: "Filed" });
    const meA = (await a.client.query(api.users.me, {})) as { profile: { id: string } };
    const meB = (await b.client.query(api.users.me, {})) as { profile: { id: string } };
    expect(meB.profile.id).toBe(meA.profile.id);
    await quit(a);
    await quit(b);
  });

  test("to-dos and cards are found without reading every note's blocks, after commits and changes from disk", async () => {
    const fs = new MemoryFs();
    const a = await launch("macbookA", fs);
    await setUp(a);
    const todo = (id: string, text: string): WireBlock => ({ ...para(id, text, "X"), type: "todo", props: { checked: false } });
    const t1 = ulid();
    const id = await newNote(a, "Errands", [para(ulid(), "intro", "V"), todo(t1, "milk")]);
    expect((await a.store.blocksOfTypes(["todo"])).map((b) => b.id)).toEqual([t1]);
    await a.store.library.flush();
    const b = await launch("macbookB", fs);
    await b.store.library.syncNow();
    expect((await b.store.blocksOfTypes(["todo"])).map((x) => x.id)).toEqual([t1]);
    await push(a, [{ opId: ulid(), kind: "block.delete", documentId: id, blockId: t1, baseRevision: null } as SyncOp]);
    expect(await a.store.blocksOfTypes(["todo"])).toEqual([]);
    await a.store.library.flush();
    await b.store.library.syncNow();
    expect(await b.store.blocksOfTypes(["todo"])).toEqual([]);
    await quit(a);
    await quit(b);
  });
});
