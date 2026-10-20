// Moving between a library and an account, both ways (docs/LOCAL_MODE_PLAN.md §6, WP12): a library goes up
// into an account (Convex under convex-test) and the account comes down into a second library, and what the
// person had is still there, with the same note and block ids, the same attachments (by their bytes' SHA-256),
// collections, synced blocks, folders, tags, history and Inbox (which becomes the other side's Inbox).
// A move killed partway goes on from what the library kept and ends up the same as one that wasn't.
import { describe, expect, test } from "vitest";
import { blockFileIds, flowchart, inboxDocumentId, parseFlowchart, SCHEMA_VERSION, serializeFlowchart, ulid, type InlineNode, type WireBlock } from "@folevi/editor-schema";
import { api } from "../../convex/_generated/api";
import { exportToLocal, SERVER_ONLY_PATH } from "@/lib/migrate/exportToLocal";
import { parentsFirst } from "@/lib/migrate/remap";
import { clientSource } from "@/lib/migrate/source";
import { libraryCounts, markMigrated, migratedTo, preflightUpload, uploadLibrary, uploadState } from "@/lib/migrate/uploadLibrary";
import { openTestLibrary, reopenAfterKill, type TestLibrary } from "@/lib/migrate/testing";
import type { MigrationClient, SourceFile } from "@/lib/migrate/types";
import { person } from "../convex/helpers";
import { ConvexDriver } from "./drivers/convexDriver";
import { PDF, PNG } from "./scenarios/files";

const block = (id: string, type: string, props: Record<string, unknown>, rank: string, text: InlineNode[] = [], parentId: string | null = null): WireBlock => ({ id, type, parentId, rank, schemaVersion: SCHEMA_VERSION, text, props });
const words = (text: string): InlineNode[] => [{ type: "text", text }];

async function push(c: MigrationClient, deviceId: string, ops: unknown[]) {
  const results = (await c.mutation(api.sync.push, { scope: { kind: "personal" }, deviceId, ops: ops as never })) as { status: string }[];
  for (const r of results) expect(r.status, JSON.stringify(r)).toBe("applied");
}
const create = (id: string, title: string, o: { parent?: string | null; folder?: string | null; kind?: "document" | "synced" | "template"; icon?: string | null } = {}) => ({
  opId: ulid(),
  kind: "document.create",
  document: { id, parentDocumentId: o.parent ?? null, folderId: o.folder ?? null, kind: o.kind ?? "document", title, icon: o.icon === undefined ? "📄" : o.icon },
});
const upsert = (documentId: string, b: WireBlock) => ({ opId: ulid(), kind: "block.upsert", documentId, block: b, baseRevision: null, fields: ["content", "position"] });

/** What the library holds besides the welcome notes: every kind of thing a move has to carry. */
async function fill(lib: TestLibrary) {
  const c = lib.client;
  const dev = c.deviceId;
  const me = c.profileId;
  const ids = { trip: ulid(), child: ulid(), synced: ulid(), shows: ulid(), trashed: ulid(), trashedChild: ulid(), archived: ulid(), board: ulid(), files: ulid() };
  const { id: folder } = await c.mutation(api.organization.createFolder, { scope: { kind: "personal" }, name: "Travel" });
  const { id: sub } = await c.mutation(api.organization.createFolder, { scope: { kind: "personal" }, name: "Coast", parentFolderId: folder });
  await c.mutation(api.organization.setFolderColor, { folderId: sub, color: "sky" });
  // A Quick Add makes the library's Inbox, with a task in it.
  await c.mutation(api.tasks.quickAdd, { scope: { kind: "personal" }, title: "Book the ferry", today: "2026-10-20", deviceId: dev });
  const inbox = inboxDocumentId(me, "personal");
  await push(c, dev, [
    create(ids.trip, "Trip", { folder: sub }),
    create(ids.child, "Packing list", { parent: ids.trip }),
    create(ids.synced, "", { kind: "synced", icon: null }),
    create(ids.shows, "Shows the synced words"),
    create(ids.trashed, "Old plan"),
    create(ids.trashedChild, "Old detail", { parent: ids.trashed }),
    create(ids.archived, "Last year"),
    create(ids.board, "Reading board"),
    create(ids.files, "Attachments"),
  ]);
  const b = { h: ulid(), p: ulid(), nested: ulid(), todo: ulid(), card: ulid(), syncedLine: ulid(), syncedBlock: ulid(), link: ulid(), table: ulid() };
  await push(c, dev, [
    upsert(ids.trip, block(b.h, "heading", { level: 1 }, "a", words("Coast weekend"))),
    upsert(ids.trip, block(b.p, "bulleted", {}, "b", [{ type: "text", text: "Ask " }, { type: "mention", userId: me, label: "me" }, { type: "text", text: " about the " }, { type: "pageLink", documentId: inbox, label: "Inbox" }])),
    upsert(ids.trip, block(b.nested, "paragraph", {}, "a", words("A nested line"), b.p)),
    upsert(ids.trip, block(b.todo, "todo", { checked: false, assigneeId: me, dueDate: "2026-10-24" }, "c", words("Pack the tent"))),
    upsert(ids.trip, block(b.card, "page", { documentId: ids.child, display: "card" }, "d")),
    upsert(ids.trip, block(b.table, "table", { headerRow: true, rows: [[[{ type: "text", text: "Who" }], [{ type: "text", text: "What" }]], [[{ type: "mention", userId: me, label: "me" }], [{ type: "text", text: "Tent" }]]] }, "e")),
    upsert(ids.synced, block(b.syncedLine, "paragraph", {}, "a", words("Words kept in sync"))),
    upsert(ids.shows, block(b.syncedBlock, "synced", { sourceId: ids.synced }, "a")),
    upsert(ids.child, block(b.link, "paragraph", {}, "a", words("Socks"))),
    upsert(ids.trashedChild, block(ulid(), "paragraph", {}, "a", words("Gone but kept"))),
  ]);
  // Attachments: an image, a PDF with the words found in it, and a whiteboard's handwriting.
  const put = async (bytes: Uint8Array, name: string, mimeType: string, kind: string) => (await c.local.putFile(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType }), { name, mimeType, kind, documentId: ids.files })).fileId;
  const png = await put(PNG, "photo.png", "image/png", "image");
  const pdf = await put(PDF, "manual.pdf", "application/pdf", "file");
  const fb = { image: ulid(), file: ulid(), board: ulid() };
  await push(c, dev, [
    upsert(ids.files, block(fb.image, "image", { fileId: png, alt: "A pixel", caption: "" }, "a")),
    upsert(ids.files, block(fb.file, "file", { fileId: pdf, name: "manual.pdf", size: PDF.length, mimeType: "application/pdf" }, "b")),
    upsert(ids.files, block(fb.board, "whiteboard", { data: JSON.stringify({ v: 1, strokes: [{ points: [[1, 1], [20, 20]], color: "ink", width: 3 }] }), height: 420 }, "c")),
  ]);
  await c.mutation(api.fileText.save, { documentId: ids.files, blockId: fb.file, fileId: pdf, source: "pdf", text: "Assembly instructions", pageStarts: [0] });
  await c.mutation(api.fileText.save, { documentId: ids.files, blockId: fb.board, source: "handwriting", text: "buy milk", hash: "a".repeat(64) });
  // A collection with a property and view of its own, and rows.
  const { collectionId } = await c.mutation(api.collections.create, { documentId: ids.board, name: "Books" });
  const { id: pages } = await c.mutation(api.collections.addProperty, { collectionId, name: "Pages", type: "number" });
  const { id: who } = await c.mutation(api.collections.addProperty, { collectionId, name: "Reader", type: "person" });
  await c.mutation(api.collections.addViewToCollection, { collectionId, name: "Shelf", type: "gallery" });
  await push(c, dev, [upsert(ids.board, block(ulid(), "collection", { collectionId }, "a"))]);
  const r1 = await c.mutation(api.collections.addRow, { collectionId, title: "Dune", values: { [pages]: 412, [who]: me } });
  await c.mutation(api.collections.addRow, { collectionId, title: "Emma", values: { [pages]: 380 } });
  await push(c, dev, [upsert(r1.documentId, block(ulid(), "paragraph", {}, "a", words("Sand, mostly")))]);
  // Tags, a star, the Archive, Trash, and a named version.
  const { id: tag } = await c.mutation(api.organization.createTag, { scope: { kind: "personal" }, name: "coast" });
  await c.mutation(api.organization.setDocumentTags, { documentId: ids.trip, tagIds: [tag] });
  await c.mutation(api.documents.setStarred, { documentId: ids.trip, starred: true });
  await c.mutation(api.documents.setArchived, { documentId: ids.archived, archived: true });
  await c.mutation(api.documents.createSnapshot, { documentId: ids.trip, reason: "manual", name: "Before packing" });
  await push(c, dev, [upsert(ids.trip, block(ulid(), "paragraph", {}, "f", words("Added after the version")))]);
  await c.mutation(api.documents.moveToTrash, { documentId: ids.trashed });
  await c.backend.idle();
  return { ...ids, inbox, collectionId, png, pdf, folder, sub };
}

type Side = { client: MigrationClient; me: string; inbox: string; sha: (fileId: string) => Promise<string | null> };

const shaOf = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>))].map((x) => x.toString(16).padStart(2, "0")).join("");

function librarySide(lib: TestLibrary): Side {
  return {
    client: lib.client,
    me: lib.client.profileId,
    inbox: inboxDocumentId(lib.client.profileId, "personal"),
    sha: async (id) => (await lib.client.store.get("files", id))?.sha256 ?? null,
  };
}

async function accountSide(account: ConvexDriver): Promise<Side> {
  const client = account as unknown as MigrationClient;
  return {
    client,
    me: account.profileId,
    inbox: inboxDocumentId(account.profileId, "personal"),
    sha: async (id) => {
      const urls = await client.query(api.files.urls, { fileIds: [id], now: Date.now() });
      return urls[id] ? await shaOf(await account.download(urls[id]!.url)) : null;
    },
  };
}

/** A node with the person and the Inbox named the same on both sides. */
function nodeView(n: InlineNode, side: Side): unknown {
  if (n.type === "mention") return { ...n, userId: n.userId === side.me ? "<me>" : n.userId };
  if (n.type === "pageLink") return { ...n, documentId: n.documentId === side.inbox ? "<inbox>" : n.documentId };
  return n;
}

/** A note as the person sees it, with what differs by side (file ids, the person, the Inbox) named. */
async function noteView(side: Side, id: string, o: { ranks?: boolean } = {}) {
  const c = side.client;
  const doc = (await clientSource(c, { readFile: async () => null }).notes()).find((n) => n.id === id);
  if (!doc) return null;
  const list = await c.query(api.blocks.list, { documentId: id });
  const blocks = [];
  for (const b of parentsFirst((list?.blocks ?? []) as WireBlock[])) {
    const props: Record<string, unknown> = { ...b.props };
    if (typeof props.fileId === "string") props.fileId = `sha:${await side.sha(props.fileId)}`;
    if (props.assigneeId === side.me) props.assigneeId = "<me>";
    if (b.type === "page" && props.documentId === side.inbox) props.documentId = "<inbox>";
    delete props.titleCache;
    delete props.iconCache;
    if (b.type === "table") props.rows = (props.rows as InlineNode[][][]).map((row) => row.map((cell) => cell.map((n) => nodeView(n, side))));
    blocks.push({ id: b.id, type: b.type, parentId: b.parentId, ...(o.ranks === false ? {} : { rank: b.rank }), text: b.text.map((n) => nodeView(n, side)), props });
  }
  return {
    id: doc.id,
    kind: doc.kind,
    title: doc.title,
    icon: doc.icon,
    parent: doc.parentDocumentId === side.inbox ? "<inbox>" : doc.parentDocumentId,
    folder: doc.folderId,
    starred: doc.starred,
    archived: doc.archivedAt !== null,
    inTrash: doc.inTrash,
    tags: doc.tagIds.length,
    blocks,
  };
}

async function collectionView(side: Side, id: string) {
  const c = await side.client.query(api.collections.get, { collectionId: id });
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    host: c.hostDocumentId,
    properties: c.properties.map((p) => ({ id: p.id, name: p.name, type: p.type, options: p.options, formula: p.formula ?? null })),
    views: c.views.map((v) => ({ id: v.id, name: v.name, type: v.type, config: v.config })),
    rows: c.rows.map((r) => ({ id: r.id, documentId: r.documentId, title: r.title, values: Object.fromEntries(Object.entries(r.values).map(([k, v]) => [k, v === side.me ? "<me>" : v])) })),
  };
}

async function folderView(side: Side) {
  const index = await side.client.query(api.organization.index, { scope: { kind: "personal" } });
  return {
    folders: index.folders.map((f) => ({ id: f.id, name: f.name, color: f.color, parent: f.parentFolderId })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    tags: index.tags.map((t) => t.name).sort(),
  };
}

/** Uploads through convex-test's storage (it has no HTTP upload address), as the parity driver does. */
const accountPutFile = (account: ConvexDriver) => async (file: SourceFile, documentId: string) =>
  await account.upload({ bytes: new Uint8Array(await file.blob.arrayBuffer()), filename: file.name, mimeType: file.mimeType, kind: file.kind, documentId });

async function upload(lib: TestLibrary, account: ConvexDriver, client: MigrationClient = account as unknown as MigrationClient) {
  return await uploadLibrary({
    library: { client: lib.client, backend: lib.client.backend },
    account: client,
    deviceId: account.deviceId,
    putFile: accountPutFile(account),
    sleep: async () => {},
  });
}

const ranksOff = { ranks: false };

describe("local → account → local", () => {
  test("keeps ids, attachments by their bytes, collections, synced blocks, history and the Inbox", async () => {
    const a = await openTestLibrary({ seed: true, deviceId: "mac_one_device", today: "2026-10-20" });
    const ids = await fill(a);
    const local = librarySide(a);
    const notes = await clientSource(a.client, { readFile: async () => null }).notes();
    expect(notes.length).toBeGreaterThan(15);

    // ---- up ---------------------------------------------------------------------------------------
    const account = await ConvexDriver.open();
    const accountView = await accountSide(account);
    const counts = await libraryCounts(a.client.backend);
    expect(counts).toMatchObject({ files: 2, fileBytes: PNG.length + PDF.length, downloading: 0 });
    const pre = await preflightUpload(accountView.client, counts);
    expect(pre.fits).toBe(true);
    const up = await upload(a, account);
    expect(up.finishedAt).not.toBeNull();
    expect(up.problems).toEqual([]);
    expect(await uploadState(a.client.backend)).toMatchObject({ finishedAt: expect.any(Number) });

    // Every note is in the account under its own id, as it was (the Inbox's lines in the account's Inbox).
    for (const n of notes) {
      if (n.id === ids.inbox) continue;
      expect(await noteView(accountView, n.id), n.title).toEqual(await noteView(local, n.id));
    }
    const localInbox = (await noteView(local, ids.inbox, ranksOff))!;
    expect(localInbox.blocks.map((x) => x.text)).toEqual([[{ type: "text", text: "Book the ferry" }]]);
    expect((await noteView(accountView, ids.files))!.blocks.map((x) => x.props.fileId).filter(Boolean)).toEqual([`sha:${await shaOf(PNG)}`, `sha:${await shaOf(PDF)}`]);
    const accountInbox = (await noteView(accountView, accountView.inbox, ranksOff))!;
    expect(accountInbox.blocks).toEqual(expect.arrayContaining(localInbox.blocks));
    expect(await collectionView(accountView, ids.collectionId)).toEqual(await collectionView(local, ids.collectionId));
    expect((await folderView(accountView)).folders).toEqual(expect.arrayContaining((await folderView(local)).folders));
    expect((await folderView(accountView)).tags).toEqual(expect.arrayContaining((await folderView(local)).tags));
    // Synced content shows where it did; found text and the named version came along.
    expect(await accountView.client.query(api.synced.info, { sourceId: ids.synced })).toMatchObject({ status: "ok", noteCount: 1 });
    const texts = await accountView.client.query(api.migration.fileTexts, { documentId: ids.files });
    expect(texts.map((t) => t.text).sort()).toEqual(["Assembly instructions", "buy milk"]);
    const history = await accountView.client.query(api.documents.versions, { documentId: ids.trip });
    expect(history.versions.filter((v) => v.reason === "import").map((v) => v.name)).toContain("Before packing");

    // The library says where it went, and is otherwise as it was.
    const before = (await a.host.inner.list("")).filter((e) => e.path !== "folevi-library.json").map((e) => `${e.path}:${e.etag}`).sort();
    await markMigrated(a.host, account.profileId);
    expect(await migratedTo(a.host)).toBe(account.profileId);
    expect((await a.host.inner.list("")).filter((e) => e.path !== "folevi-library.json").map((e) => `${e.path}:${e.etag}`).sort()).toEqual(before);

    // ---- and down again, into a new library on another Mac ------------------------------------------
    const b = await openTestLibrary({ seed: false, deviceId: "mac_two_device" });
    const down = await exportToLocal({
      account: accountView.client,
      library: { client: b.client, backend: b.client.backend },
      fs: b.host,
      deviceId: b.client.deviceId,
      versions: true,
      fetchBytes: async (url) => new Blob([(await account.download(url)) as Uint8Array<ArrayBuffer>]),
      sleep: async () => {},
    });
    expect(down.personal.problems).toEqual([]);
    await b.client.backend.idle();
    const second = librarySide(b);
    for (const n of notes) {
      if (n.id === ids.inbox) continue;
      expect(await noteView(second, n.id), n.title).toEqual(await noteView(local, n.id));
    }
    // The Inbox is the second library's own, holding the first library's lines.
    expect(second.inbox).not.toBe(local.inbox);
    expect((await noteView(second, second.inbox, ranksOff))!.blocks).toEqual(expect.arrayContaining(localInbox.blocks));
    expect(await collectionView(second, ids.collectionId)).toEqual(await collectionView(local, ids.collectionId));
    expect((await folderView(second)).folders).toEqual(expect.arrayContaining((await folderView(local)).folders));
    expect(await second.client.query(api.synced.info, { sourceId: ids.synced })).toMatchObject({ status: "ok", noteCount: 1 });
    // The same bytes, stored once each by their SHA-256.
    const shas = (await noteView(second, ids.files))!.blocks.map((x) => x.props.fileId).filter(Boolean);
    expect(shas).toEqual([`sha:${await shaOf(PNG)}`, `sha:${await shaOf(PDF)}`]);
    const downTexts = await second.client.query(api.migration.fileTexts, { documentId: ids.files });
    expect(downTexts.map((t) => t.text).sort()).toEqual(["Assembly instructions", "buy milk"]);
    const downHistory = await second.client.query(api.documents.versions, { documentId: ids.trip });
    expect(downHistory.versions.map((v) => v.name)).toContain("Before packing");
    // The account's own notes came down too, and what only the server keeps is written down.
    const accountOwn = (await clientSource(accountView.client, { readFile: async () => null }).notes()).filter((n) => !notes.some((x) => x.id === n.id) && n.id !== accountView.inbox);
    expect(accountOwn.length).toBeGreaterThan(0);
    for (const n of accountOwn.slice(0, 3)) expect(await noteView(second, n.id)).toEqual(await noteView(accountView, n.id));
    const record = await b.host.read(SERVER_ONLY_PATH);
    expect("bytes" in record && JSON.parse(new TextDecoder().decode(record.bytes))).toMatchObject({ format: "folevi-server-only", notes: [], workspaces: [] });

    // Done is done: running it again changes nothing.
    const again = await upload(a, account);
    expect(again.finishedAt).toBe(up.finishedAt);
  });
});

describe("a move killed partway", () => {
  // The calls to the account where the app is killed: before a call is sent, or after the account did it but
  // before the answer arrived. Spread over folders, notes, uploads, collections and history.
  const points = [
    { at: 3, when: "before" },
    { at: 9, when: "after" },
    { at: 21, when: "before" },
    { at: 34, when: "after" },
    { at: 52, when: "after" },
    { at: 77, when: "before" },
  ] as const;

  test.each(points)("at call $at ($when it ran) goes on from the library's record and ends the same", async ({ at, when }) => {
    const b = await openTestLibrary({ seed: true, deviceId: "mac_three_device", today: "2026-10-20" });
    const bIds = await fill(b);
    const bNotes = await clientSource(b.client, { readFile: async () => null }).notes();
    const account = await ConvexDriver.open();
    let calls = 0;
    const dies = (): never => {
      throw new Error("killed");
    };
    const real = account as unknown as MigrationClient;
    const fatal = {
      query: ((ref: never, args: never) => real.query(ref, args)) as MigrationClient["query"],
      mutation: (async (ref: never, args: never) => {
        calls++;
        if (calls === at && when === "before") dies();
        const out = await real.mutation(ref, args);
        if (calls === at && when === "after") dies();
        return out;
      }) as MigrationClient["mutation"],
      action: (async (ref: never, args: never) => {
        calls++;
        if (calls === at && when === "before") dies();
        const out = await real.action(ref, args);
        if (calls === at && when === "after") dies();
        return out;
      }) as MigrationClient["action"],
    } satisfies MigrationClient;
    await expect(
      uploadLibrary({ library: { client: b.client, backend: b.client.backend }, account: fatal, deviceId: account.deviceId, putFile: async (file, doc) => {
        calls++;
        if (calls === at && when === "before") dies();
        const id = await accountPutFile(account)(file, doc);
        if (calls === at && when === "after") dies();
        return id;
      }, sleep: async () => {} }),
    ).rejects.toThrow("killed");

    // The app starts again from what the library had kept, and the move goes on.
    const restarted = await reopenAfterKill(b);
    const partly = await uploadState(restarted.client.backend);
    expect(partly).not.toBeNull();
    expect(partly!.finishedAt).toBeNull();
    const done = await upload(restarted, account);
    expect(done.finishedAt).not.toBeNull();
    expect(done.problems).toEqual([]);

    // Everything the library had is there once, as it is after a move that never stopped.
    const side = await accountSide(account);
    const local = librarySide(restarted);
    for (const n of bNotes) {
      if (n.id === bIds.inbox) continue;
      expect(await noteView(side, n.id), n.title).toEqual(await noteView(local, n.id));
    }
    const inboxLines = (await noteView(side, side.inbox, ranksOff))!.blocks;
    expect(new Set(inboxLines.map((x) => x.id)).size).toBe(inboxLines.length);
    expect(inboxLines).toEqual(expect.arrayContaining((await noteView(local, bIds.inbox, ranksOff))!.blocks));
    expect(await collectionView(side, bIds.collectionId)).toEqual(await collectionView(local, bIds.collectionId));
    const folders = await folderView(side);
    expect(folders.folders.filter((f) => f.name === "Travel")).toHaveLength(1);
    expect(folders.tags.filter((t) => t === "coast")).toHaveLength(1);
    const history = await side.client.query(api.documents.versions, { documentId: bIds.trip });
    expect(history.versions.filter((v) => v.reason === "import")).toHaveLength(1);
    // Every note once.
    const all = await clientSource(side.client, { readFile: async () => null }).notes();
    expect(new Set(all.map((n) => n.id)).size).toBe(all.length);
  });
});

describe("copy rules", () => {
  test("a move started with one account doesn't go on into another", async () => {
    const a = await openTestLibrary({ seed: false, deviceId: "mac_one_device" });
    const first = await ConvexDriver.open();
    await upload(a, first);
    // Another person signed in on the same deployment.
    const someone = await person(first.t, "someone-else@example.com");
    const as = someone.as as unknown as { query: (r: unknown, a: unknown) => Promise<never>; mutation: (r: unknown, a: unknown) => Promise<never>; action: (r: unknown, a: unknown) => Promise<never> };
    const other = { query: (r: unknown, x: unknown) => as.query(r, x), mutation: (r: unknown, x: unknown) => as.mutation(r, x), action: (r: unknown, x: unknown) => as.action(r, x) } as unknown as MigrationClient;
    await expect(upload(a, first, other)).rejects.toThrow(/another account/);
  });

  test("images inside a flowchart's shapes go along both ways, by their bytes", async () => {
    const a = await openTestLibrary({ seed: false, deviceId: "mac_one_device" });
    const c = a.client;
    const note = ulid();
    await push(c, c.deviceId, [create(note, "Process map")]);
    const png = (await c.local.putFile(new Blob([PNG as Uint8Array<ArrayBuffer>], { type: "image/png" }), { name: "shape.png", mimeType: "image/png", kind: "image", documentId: note })).fileId;
    const chart = serializeFlowchart(
      flowchart({
        nodes: [
          { id: "a1", shape: "process", x: 0, y: 0, w: 160, h: 120, text: "Photo", color: "neutral", image: { fileId: png } },
          { id: "b2", shape: "process", x: 0, y: 200, w: 160, h: 64, text: "Next", color: "neutral" },
        ],
      }),
    );
    const chartId = ulid();
    await push(c, c.deviceId, [upsert(note, block(chartId, "flowchart", { data: chart, height: 440 }, "a"))]);
    expect((await libraryCounts(c.backend)).files).toBe(1);

    const account = await ConvexDriver.open();
    const up = await upload(a, account);
    expect(up.problems).toEqual([]);
    const accountView = await accountSide(account);
    const shapeFiles = async (side: Side) => {
      const list = await side.client.query(api.blocks.list, { documentId: note });
      const b = (list?.blocks ?? []).find((x) => x.id === chartId)!;
      const ids = blockFileIds(b);
      return { ids, shas: await Promise.all(ids.map((id) => side.sha(id))), texts: parseFlowchart((b.props as { data: string }).data).nodes.map((n) => n.text) };
    };
    const there = await shapeFiles(accountView);
    expect(there.ids).toHaveLength(1);
    expect(there.ids[0]).not.toBe(png);
    expect(there.shas).toEqual([await shaOf(PNG)]);
    expect(there.texts).toEqual(["Photo", "Next"]);

    const b = await openTestLibrary({ seed: false, deviceId: "mac_two_device" });
    const down = await exportToLocal({
      account: accountView.client,
      library: { client: b.client, backend: b.client.backend },
      fs: b.host,
      deviceId: b.client.deviceId,
      versions: false,
      fetchBytes: async (url) => new Blob([(await account.download(url)) as Uint8Array<ArrayBuffer>]),
      sleep: async () => {},
    });
    expect(down.personal.problems).toEqual([]);
    await b.client.backend.idle();
    const back = await shapeFiles(librarySide(b));
    expect(back.shas).toEqual([await shaOf(PNG)]);
  });

  test("a flowchart shape whose image doesn't fit loses the image, and the move says so", async () => {
    const a = await openTestLibrary({ seed: false, deviceId: "mac_one_device" });
    const c = a.client;
    const note = ulid();
    await push(c, c.deviceId, [create(note, "Process map")]);
    const png = (await c.local.putFile(new Blob([PNG as Uint8Array<ArrayBuffer>], { type: "image/png" }), { name: "shape.png", mimeType: "image/png", kind: "image", documentId: note })).fileId;
    const chart = serializeFlowchart(flowchart({ nodes: [{ id: "a1", shape: "process", x: 0, y: 0, w: 160, h: 120, text: "Photo", color: "neutral", image: { fileId: png } }] }));
    const chartId = ulid();
    await push(c, c.deviceId, [upsert(note, block(chartId, "flowchart", { data: chart, height: 440 }, "a"))]);
    const account = await ConvexDriver.open();
    await account.t.run(async (ctx) => {
      const p = (await ctx.db.query("profiles").collect())[0]!;
      await ctx.db.patch(p._id, { personalStorageUsedBytes: 10 * 1024 * 1024 * 1024 * 1024 });
    });
    const done = await upload(a, account);
    expect(done.problems.filter((p) => p.kind === "file").map((p) => p.problem)).toEqual(["space"]);
    const list = await (await accountSide(account)).client.query(api.blocks.list, { documentId: note });
    const b = (list?.blocks ?? []).find((x) => x.id === chartId)!;
    expect(blockFileIds(b)).toEqual([]);
    expect(parseFlowchart((b.props as { data: string }).data).nodes.map((n) => n.text)).toEqual(["Photo"]);
  });

  test("files that don't fit become a line saying so, and are reported", async () => {
    const a = await openTestLibrary({ seed: false, deviceId: "mac_one_device" });
    const ids = await fill(a);
    const account = await ConvexDriver.open();
    await account.t.run(async (ctx) => {
      const p = (await ctx.db.query("profiles").collect())[0]!;
      await ctx.db.patch(p._id, { personalStorageUsedBytes: 10 * 1024 * 1024 * 1024 * 1024 });
    });
    const counts = await libraryCounts(a.client.backend);
    const pre = await preflightUpload(account as unknown as MigrationClient, counts);
    expect(pre.fits).toBe(false);
    expect(pre.shortByBytes).toBeGreaterThan(0);
    const done = await upload(a, account);
    expect(done.problems.filter((p) => p.kind === "file").map((p) => [p.name, p.problem])).toEqual([
      ["photo.png", "space"],
      ["manual.pdf", "space"],
    ]);
    const view = (await noteView(await accountSide(account), ids.files))!;
    expect(view.blocks.slice(0, 2).map((x) => [x.type, (x.text[0] as { text: string }).text])).toEqual([
      ["paragraph", "“photo.png” didn’t fit in the storage there. It’s still where it was before the move."],
      ["paragraph", "“manual.pdf” didn’t fit in the storage there. It’s still where it was before the move."],
    ]);
  });

  test("waits out the account's rate limit and goes on", async () => {
    const a = await openTestLibrary({ seed: false, deviceId: "mac_one_device" });
    await fill(a);
    const account = await ConvexDriver.open();
    await account.t.run(async (ctx) => {
      await ctx.db.insert("systemSettings", { key: "rate_limits", value: { upload: { limit: 1, windowMs: 60 * 60_000 } }, updatedAt: Date.now() } as never);
    });
    const waits: number[] = [];
    let cleared = false;
    const done = await uploadLibrary({
      library: { client: a.client, backend: a.client.backend },
      account: account as unknown as MigrationClient,
      deviceId: account.deviceId,
      putFile: accountPutFile(account),
      sleep: async (ms) => {
        waits.push(ms);
        // The hour passes.
        if (!cleared) {
          cleared = true;
          await account.t.run(async (ctx) => {
            for (const r of await ctx.db.query("rateLimits").collect()) await ctx.db.delete(r._id);
          });
        }
      },
    });
    expect(done.problems).toEqual([]);
    expect(waits.length).toBeGreaterThan(0);
  });
});
