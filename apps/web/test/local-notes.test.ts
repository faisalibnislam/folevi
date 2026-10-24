import { describe, expect, test } from "vitest";
import { DEFAULT_COVER, sync, ulid, type SyncOp, type SyncState, type WireBlock, type WireScope } from "@folevi/editor-schema";
import { localNotes, localTitle, overlayNotes, sameLocalNotes, searchLocalNotes, ulidTime, type NoteRow } from "@/lib/sync/localNotes";

const PERSONAL: WireScope = { kind: "personal" };
const TEAM: WireScope = { kind: "workspace", workspaceId: "W1" };

const at = (ms: number) => ulid(ms);

function create(id: string, ms: number, extra: Partial<Extract<SyncOp, { kind: "document.create" }>["document"]> = {}): SyncOp {
  return { opId: at(ms), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title: "", icon: "🌿", cover: DEFAULT_COVER, scope: PERSONAL, ...extra } };
}
const rename = (id: string, ms: number, title: string): SyncOp => ({ opId: at(ms), kind: "document.update", documentId: id, patch: { title }, baseRevision: null });
const move = (id: string, ms: number, folderId: string | null): SyncOp => ({ opId: at(ms), kind: "document.update", documentId: id, patch: { folderId }, baseRevision: 3 });
const line = (documentId: string, id: string, rank: string, text: string, parentId: string | null = null): SyncState["blocks"][string] => ({
  documentId,
  serverRevision: null,
  deleted: false,
  block: { id, type: "paragraph", parentId, rank, text: [{ type: "text", text }], props: {} } as unknown as WireBlock,
});

function state(ops: SyncOp[], blocks: SyncState["blocks"] = {}, inflight: SyncOp[] = []): SyncState {
  return { ...sync.emptySyncState(), pending: ops, inflight, blocks };
}

const row = (id: string, updatedAt: number, title = id, folderId: string | null = null): NoteRow & { folderId: string | null } => ({ id, title, icon: null, updatedAt, folderId });

describe("notes known only on this device", () => {
  test("a note made offline, then named and written in, is known with its latest title and first words", () => {
    const s = state([create("N1", 1_000), rename("N1", 2_000, "Offline test")], {
      b2: line("N1", "b2", "b", "working offline now"),
      b1: line("N1", "b1", "a", "I'm"),
      nested: line("N1", "nested", "c", "not in the excerpt", "b1"),
      other: line("N2", "other", "a", "another note"),
    });
    const notes = localNotes(s);
    const n1 = notes.get("N1")!;
    expect(n1).toMatchObject({ isNew: true, title: "Offline test", scopeKey: "personal", folderId: null, excerpt: "I'm working offline now", waiting: "queued" });
    expect(n1.createdAt).toBe(1_000);
    expect(n1.updatedAt).toBe(2_000);
    expect(localTitle(s, "N1")).toBe("Offline test");
    // Ops in flight count as on this device too.
    expect(localNotes(state([], {}, [create("N3", 5)])).get("N3")?.isNew).toBe(true);
  });

  test("a note the server has, renamed or moved offline, carries the change but isn't new", () => {
    const notes = localNotes(state([rename("OLD", 3_000, "New name"), move("OLD", 4_000, "F1")]));
    expect(notes.get("OLD")).toMatchObject({ isNew: false, title: "New name", folderId: "F1", updatedAt: 4_000 });
  });

  test("a refused change marks its note", () => {
    const op = rename("OLD", 3_000, "Nope");
    const s = { ...state([op]), errors: [{ opId: op.opId, code: "forbidden" }] };
    expect(localNotes(s).get("OLD")?.waiting).toBe("failed");
  });

  test("ulidTime reads the time an op was made", () => {
    expect(ulidTime(ulid(1_726_000_000_123))).toBe(1_726_000_000_123);
    expect(ulidTime("not-a-ulid")).toBe(0);
  });

  test("the same notes compare equal, a changed title doesn't", () => {
    const a = localNotes(state([create("N1", 1_000)]));
    const b = localNotes(state([create("N1", 1_000)]));
    expect(sameLocalNotes(a, b)).toBe(true);
    expect(sameLocalNotes(a, localNotes(state([create("N1", 1_000), rename("N1", 1_500, "x")])))).toBe(false);
  });
});

describe("lists with this device's notes laid over them", () => {
  const s = state([
    create("NEW", 9_000, { title: "Offline test" }),
    create("NEWF", 9_100, { title: "In a folder", folderId: "F1" }),
    create("TEAMNOTE", 9_200, { title: "Team", scope: TEAM }),
    create("PAGE", 9_300, { title: "Nested", parentDocumentId: "A" }),
    rename("A", 9_400, "A renamed"),
    move("B", 9_500, "F1"),
  ]);
  const locals = localNotes(s);
  const server = [row("A", 5_000), row("B", 4_000), row("C", 3_000)];

  test("recent notes: the new note first, renames applied, other places' and nested pages left out", () => {
    const out = overlayNotes(server, locals, { scope: PERSONAL, include: "recent", byUpdated: true, limit: 10 });
    // Newest change first: B was moved last, then A renamed, then the two notes made here.
    expect(out.map((d) => d.id)).toEqual(["B", "A", "NEWF", "NEW", "C"]);
    expect(out.find((d) => d.id === "A")!.title).toBe("A renamed");
    expect(out.find((d) => d.id === "NEW")).toMatchObject({ title: "Offline test", waiting: "queued", excerpt: "" });
    expect(out.some((d) => d.id === "TEAMNOTE" || d.id === "PAGE")).toBe(false);
    // Unchanged rows are the same objects.
    expect(out.find((d) => d.id === "C")).toBe(server[2]);
    expect(overlayNotes(server, locals, { scope: PERSONAL, include: "recent", limit: 2 })).toHaveLength(2);
  });

  test("a workspace's list shows the notes made for it only", () => {
    const out = overlayNotes<NoteRow>([], locals, { scope: TEAM, include: "all" });
    expect(out.map((d) => d.id)).toEqual(["TEAMNOTE"]);
  });

  test("a folder's list gains the notes made or moved into it and loses those moved out; Drafts the reverse", () => {
    const inFolder = overlayNotes([row("X", 1, "X", "F1"), row("A", 5_000, "A", "F1")], localNotes(state([move("X", 10, "F2"), create("NEWF", 20, { folderId: "F1" })])), {
      scope: PERSONAL,
      include: "folder",
      folderId: "F1",
    });
    expect(inFolder.map((d) => d.id)).toEqual(["NEWF", "A"]);
    const drafts = overlayNotes([row("B", 4_000)], locals, { scope: PERSONAL, include: "drafts" });
    expect(drafts.map((d) => d.id)).toEqual(["NEW"]);
  });

  test("Starred and the like only take the renames", () => {
    const out = overlayNotes([row("A", 5_000)], locals, { scope: PERSONAL, include: "none" });
    expect(out.map((d) => [d.id, d.title])).toEqual([["A", "A renamed"]]);
  });

  test("nothing waiting: the very same list", () => {
    expect(overlayNotes(server, new Map(), { scope: PERSONAL, include: "all" })).toBe(server);
  });

  test("search finds the notes made here by title and first words, in their own place", () => {
    const withWords = localNotes(state([create("NEW", 1, { title: "Train notes" })], { b: line("NEW", "b", "a", "tunnel thoughts") }));
    expect(searchLocalNotes(withWords, "TUNNEL", PERSONAL).map((n) => n.id)).toEqual(["NEW"]);
    expect(searchLocalNotes(withWords, "train", TEAM)).toEqual([]);
    expect(searchLocalNotes(withWords, "  ", PERSONAL)).toEqual([]);
  });
});
