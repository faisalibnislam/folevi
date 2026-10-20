import { describe, expect, test } from "vitest";
import type { WireScope } from "@folevi/editor-schema";
import type { OutboxEntry, OutboxName, OutboxArgs } from "@/lib/sync/outbox";
import { overlayCollection, overlaySidebar, overlayThreads, pendingNoteFolders, waitingRowPage, type CollectionData, type SidebarData, type ThreadsData } from "@/lib/sync/overlays";

const PERSONAL: WireScope = { kind: "personal" };
const TEAM: WireScope = { kind: "workspace", workspaceId: "W1" };
const me = { id: "me", name: "Ann", avatarUrl: null };

let n = 0;
function entry<N extends OutboxName>(name: N, args: OutboxArgs<N>, failed = false): OutboxEntry {
  n++;
  return { id: `e${String(n).padStart(4, "0")}`, name, args, keys: [], label: name, createdAt: 1_000 + n, attempts: 0, ...(failed ? { failed: { code: "forbidden", message: "No" } } : {}) } as OutboxEntry;
}

const sidebar = (folders: { id: string; parentFolderId?: string | null }[]): SidebarData => ({
  folders: folders.map((f, i) => ({ id: f.id, name: f.id, color: null, parentFolderId: f.parentFolderId ?? null, rank: String(i) })),
  tags: [],
});

describe("folders waiting to be sent", () => {
  test("a folder made offline shows (in its own Personal or workspace only), renamed, moved and deleted as queued", () => {
    const base = sidebar([{ id: "Work" }, { id: "Clients", parentFolderId: "Work" }]);
    const entries = [
      entry("organization.createFolder", { scope: PERSONAL, name: "Trips", id: "Trips" }),
      entry("organization.createFolder", { scope: PERSONAL, name: "Japan", id: "Japan", parentFolderId: "Trips" }),
      entry("organization.createFolder", { scope: TEAM, name: "Team only", id: "Team" }),
      entry("organization.renameFolder", { folderId: "Trips", name: "Travel" }),
      entry("organization.moveFolder", { folderId: "Clients", parentFolderId: null }),
      entry("organization.deleteFolder", { folderId: "Work" }),
    ];
    const out = overlaySidebar(base, entries, PERSONAL);
    expect(out.folders.map((f) => [f.name, f.parentFolderId])).toEqual([
      ["Clients", null],
      ["Travel", null],
      ["Japan", "Trips"],
    ]);
    // New folders show only where they were made (changes to existing ones go by id, which is unique everywhere).
    expect(overlaySidebar(sidebar([{ id: "Shared" }]), entries, TEAM).folders.map((f) => f.name)).toEqual(["Shared", "Team only"]);
  });

  test("once the server has the folder, it isn't added twice; a move it would refuse isn't shown", () => {
    const base = sidebar([{ id: "Trips" }, { id: "A" }, { id: "B", parentFolderId: "A" }]);
    const out = overlaySidebar(base, [entry("organization.createFolder", { scope: PERSONAL, name: "Trips", id: "Trips" }), entry("organization.moveFolder", { folderId: "A", parentFolderId: "B" })], PERSONAL);
    expect(out.folders.map((f) => [f.id, f.parentFolderId])).toEqual([
      ["Trips", null],
      ["A", null],
      ["B", "A"],
    ]);
    expect(overlaySidebar(base, [], PERSONAL)).toBe(base);
  });

  test("notes moved while offline are placed in their new folder", () => {
    const moved = pendingNoteFolders([
      entry("documents.bulkUpdate", { documentIds: ["n1", "n2"], action: { kind: "move", folderId: "Trips" } }),
      entry("documents.bulkUpdate", { documentIds: ["n3"], action: { kind: "star", starred: true } }),
      entry("documents.move", { documentId: "n2", folderId: null }),
    ]);
    expect([...moved]).toEqual([
      ["n1", "Trips"],
      ["n2", null],
    ]);
  });
});

const threadsData = (): ThreadsData => ({
  threads: [
    {
      id: "T0",
      blockId: "b1",
      blockExists: true,
      blockText: "Line",
      status: "open",
      createdAt: 1,
      lastActivityAt: 1,
      resolvedBy: null,
      resolvedAt: null,
      unread: false,
      canResolve: true,
      canDelete: true,
      comments: [{ id: "C0", authorId: "you", authorName: "Bo", authorAvatarUrl: null, body: [{ type: "text", text: "Hi" }], deleted: false, createdAt: 1, editedAt: null, mine: false, canEdit: false, canDelete: false, reactions: [] }],
    },
  ],
  blocks: [{ blockId: "b1", threads: 1, comments: 1, lastActivityAt: 1, unread: false, authors: [{ name: "Bo", avatarUrl: null }] }],
  canComment: true,
  canManage: false,
});

describe("comments waiting to be sent", () => {
  test("a new thread, a reply to it, a reaction and a resolve show at once, marked as waiting", () => {
    const body = [{ type: "text", text: "On the train" }];
    const out = overlayThreads(
      threadsData(),
      [
        entry("comments.create", { documentId: "D", blockId: "b2", body, threadId: "T1", commentId: "C1" }),
        entry("comments.reply", { threadId: "T1", body, commentId: "C2" }),
        entry("comments.react", { commentId: "C0", kind: "heart", on: true }),
        entry("comments.setResolved", { threadId: "T0", resolved: true }),
        entry("comments.create", { documentId: "Other", body, threadId: "T9", commentId: "C9" }),
      ],
      "D",
      me,
    );
    expect(out.threads.map((t) => [t.id, t.status, t.waiting ?? null, t.comments.map((c) => [c.id, c.waiting ?? null])])).toEqual([
      ["T1", "open", "queued", [["C1", "queued"], ["C2", "queued"]]],
      ["T0", "resolved", null, [["C0", null]]],
    ]);
    expect(out.threads[1]!.comments[0]!.reactions).toEqual([{ kind: "heart", count: 1, mine: true, names: [] }]);
    expect(out.blocks.map((b) => [b.blockId, b.threads, b.comments])).toEqual([["b2", 1, 2]]);
  });

  test("a refused comment stays, marked failed with its outbox entry; one the server has is shown once", () => {
    const body = [{ type: "text", text: "Kept" }];
    const create = entry("comments.create", { documentId: "D", body, threadId: "T0", commentId: "C0" }, true);
    expect(overlayThreads(threadsData(), [create], "D", me).threads).toHaveLength(1);
    const refused = entry("comments.reply", { threadId: "T0", body, commentId: "C5" }, true);
    const out = overlayThreads(threadsData(), [refused], "D", me);
    expect(out.threads[0]!.comments.map((c) => [c.id, c.waiting ?? null, c.entryId ?? null])).toEqual([
      ["C0", null, null],
      ["C5", "failed", refused.id],
    ]);
  });

  test("deleting the last comment of a thread takes the thread; reactions are set, not toggled", () => {
    const off = overlayThreads(threadsData(), [entry("comments.react", { commentId: "C0", kind: "heart", on: false })], "D", me);
    expect(off.threads[0]!.comments[0]!.reactions).toEqual([]);
    const gone = overlayThreads(threadsData(), [entry("comments.remove", { commentId: "C0" })], "D", me);
    expect(gone.threads).toEqual([]);
    expect(gone.blocks).toEqual([]);
  });
});

describe("read marks waiting to be sent", () => {
  const unreadData = (): ThreadsData => {
    const d = threadsData();
    return { ...d, threads: d.threads.map((t) => ({ ...t, unread: true, lastActivityAt: 50 })), blocks: d.blocks.map((b) => ({ ...b, unread: true })) };
  };

  test("a thread read offline shows read, and its line's summary too", () => {
    const out = overlayThreads(unreadData(), [entry("comments.markThreadRead", { threadId: "T0", upTo: 50 })], "D", me);
    expect(out.threads[0]!.unread).toBe(false);
    expect(out.blocks[0]!.unread).toBe(false);
  });

  test("activity after what was read stays unread; marking unread again wins when it comes later", () => {
    expect(overlayThreads(unreadData(), [entry("comments.markThreadRead", { threadId: "T0", upTo: 20 })], "D", me).threads[0]!.unread).toBe(true);
    const out = overlayThreads(unreadData(), [entry("comments.markThreadRead", { threadId: "T0", upTo: 50 }), entry("comments.markThreadUnread", { threadId: "T0" })], "D", me);
    expect(out.threads[0]!.unread).toBe(true);
    expect(out.blocks[0]!.unread).toBe(true);
    // Nothing to change: the same answer comes back.
    const read = threadsData();
    expect(overlayThreads(read, [entry("comments.markThreadRead", { threadId: "T0", upTo: 1 }), entry("comments.markThreadRead", { threadId: "Gone", upTo: 1 })], "D", me)).toBe(read);
  });
});

const collection = (): CollectionData => ({
  id: "K",
  name: "Reading",
  workspaceId: null,
  isMember: true,
  people: [],
  hostDocumentId: "H",
  canEdit: true,
  properties: [{ id: "status", name: "Status", type: "select", options: [], formula: null, numberFormat: null }],
  views: [{ id: "V", name: "Table", type: "table", config: { filters: [], sorts: [], visibleProperties: ["status"], cardPreview: "none", cardSize: "medium" } }],
  rows: [
    { id: "R1", documentId: "P1", title: "Dune", icon: null, cover: { kind: "none" }, excerpt: "", rank: "a", values: {}, updatedAt: 1 },
    { id: "R2", documentId: "P2", title: "Emma", icon: null, cover: { kind: "none" }, excerpt: "", rank: "b", values: { status: "doing" }, updatedAt: 1 },
  ],
});

describe("collection changes waiting to be sent", () => {
  test("a new row (with its values), edited cells, a delete and a view change all show", () => {
    const out = overlayCollection(
      collection(),
      [
        entry("collections.addRow", { collectionId: "K", title: "", values: { status: "done", empty: "" }, id: "R3", documentId: "P3" }),
        entry("collections.setValue", { collectionId: "K", rowId: "R3", propertyId: "status", value: "doing" }),
        entry("collections.setValue", { collectionId: "K", rowId: "R2", propertyId: "status", value: null }),
        entry("collections.renameRow", { collectionId: "K", rowId: "R3", title: "Middlemarch" }),
        entry("collections.deleteRow", { collectionId: "K", rowId: "R1" }),
        entry("collections.updateView", { collectionId: "K", viewId: "V", name: "All books" }),
        entry("collections.setValue", { collectionId: "Other", rowId: "R2", propertyId: "status", value: "done" }),
      ],
      "K",
    );
    expect(out.rows.map((r) => [r.id, r.documentId, r.title, r.values, r.waiting ?? null])).toEqual([
      ["R2", "P2", "Emma", {}, null],
      ["R3", "P3", "Middlemarch", { status: "doing" }, "queued"],
    ]);
    expect(out.views[0]!.name).toBe("All books");
  });

  test("a row moved on a board lands after the row named, in its new column", () => {
    const out = overlayCollection(collection(), [entry("collections.moveRow", { collectionId: "K", rowId: "R1", afterRowId: "R2", groupPropertyId: "status", groupValue: "done" })], "K");
    expect(out.rows.map((r) => [r.id, r.values.status ?? null])).toEqual([
      ["R2", "doing"],
      ["R1", "done"],
    ]);
  });
});

describe("properties and views waiting to be sent", () => {
  test("a property added offline shows in every view, with its options, and a row can use it", () => {
    const out = overlayCollection(
      collection(),
      [
        entry("collections.addProperty", { collectionId: "K", name: " Genre ", type: "select", id: "genre" }),
        entry("collections.updateProperty", { collectionId: "K", propertyId: "genre", options: [{ id: "o1", name: "Sci-fi", color: "plum" }, { id: "o2", name: "Classic " }] }),
        entry("collections.setValue", { collectionId: "K", rowId: "R1", propertyId: "genre", value: "o1" }),
        entry("collections.updateProperty", { collectionId: "K", propertyId: "status", name: "Stage" }),
      ],
      "K",
    );
    expect(out.properties.map((p) => [p.id, p.name, p.type, p.options])).toEqual([
      ["status", "Stage", "select", []],
      ["genre", "Genre", "select", [{ id: "o1", name: "Sci-fi", color: "plum" }, { id: "o2", name: "Classic", color: "moss" }]],
    ]);
    expect(out.views[0]!.config.visibleProperties).toEqual(["status", "genre"]);
    expect(out.rows[0]!.values).toEqual({ genre: "o1" });
  });

  test("a formula property added offline keeps its formula and format; a rename follows into formulas", () => {
    const out = overlayCollection(
      collection(),
      [
        entry("collections.addProperty", { collectionId: "K", name: "Label", type: "formula", id: "f", formula: ' CONCAT(Status, "!") ', numberFormat: { format: "percent" } }),
        entry("collections.updateProperty", { collectionId: "K", propertyId: "status", name: "Stage now" }),
        entry("collections.addProperty", { collectionId: "K", name: "Total", type: "formula", id: "t", formula: "1" }),
        entry("collections.updateProperty", { collectionId: "K", propertyId: "t", formula: "LEN(Label)", numberFormat: { format: "number", decimals: 1 } }),
      ],
      "K",
    );
    expect(out.properties.map((p) => [p.id, p.name, p.formula, p.numberFormat])).toEqual([
      ["status", "Stage now", null, null],
      ["f", "Label", 'CONCAT([Stage now], "!")', { format: "percent" }],
      ["t", "Total", "LEN(Label)", { format: "number", decimals: 1 }],
    ]);
  });

  test("once the server has the property it isn't added twice; a deleted one goes", () => {
    const base = collection();
    const add = entry("collections.addProperty", { collectionId: "K", name: "Status", type: "select", id: "status" });
    expect(overlayCollection(base, [add], "K").properties).toHaveLength(1);
    expect(overlayCollection(base, [entry("collections.deleteProperty", { collectionId: "K", propertyId: "status" })], "K").properties).toEqual([]);
  });

  test("a view added offline is made as the server makes it, renamed, set up and deleted as queued", () => {
    const out = overlayCollection(
      collection(),
      [
        entry("collections.addViewToCollection", { collectionId: "K", name: "Board", type: "board", id: "V2" }),
        entry("collections.updateView", { collectionId: "K", viewId: "V2", name: "By status" }),
        entry("collections.addViewToCollection", { collectionId: "K", name: "Calendar", type: "calendar", id: "V3" }),
        entry("collections.addViewToCollection", { collectionId: "K", name: "Gallery", type: "gallery", id: "V4" }),
        entry("collections.deleteView", { collectionId: "K", viewId: "V" }),
      ],
      "K",
    );
    // No date property: the calendar the server would refuse isn't shown.
    expect(out.views.map((v) => [v.id, v.name, v.type, v.config.groupBy ?? null, v.config.cardPreview])).toEqual([
      ["V2", "By status", "board", "status", "none"],
      ["V4", "Gallery", "gallery", null, "cover"],
    ]);
    // The last view stays.
    expect(overlayCollection(collection(), [entry("collections.deleteView", { collectionId: "K", viewId: "V" })], "K").views).toHaveLength(1);
  });

  test("a row added offline has a page that opens here, titled as last named, until it's deleted", () => {
    const add = entry("collections.addRow", { collectionId: "K", title: "", id: "R3", documentId: "P3" });
    expect(waitingRowPage([add], "P3")).toEqual({ collectionId: "K", rowId: "R3", title: "", waiting: "queued" });
    expect(waitingRowPage([add, entry("collections.renameRow", { collectionId: "K", rowId: "R3", title: "Middlemarch" })], "P3")?.title).toBe("Middlemarch");
    expect(waitingRowPage([add, entry("collections.deleteRow", { collectionId: "K", rowId: "R3" })], "P3")).toBeUndefined();
    expect(waitingRowPage([add], "P1")).toBeUndefined();
  });
});
