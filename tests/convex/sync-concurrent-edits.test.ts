// Concurrent edits the server has to referee: deleting a block whose nested lines changed meanwhile, and a
// toggle opened or closed while someone edits its text.
import { describe, expect, test } from "vitest";
import { SCHEMA_VERSION, type SyncOp, type WireBlock } from "@folevi/editor-schema";
import { api } from "../../convex/_generated/api";
import { para, person, PERSONAL, setup, ulid } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

async function push(p: Person, ops: SyncOp[]) {
  return await p.as.mutation(api.sync.push, { scope: PERSONAL, deviceId: "device-concurrent", ops: ops as never });
}

async function newPage(p: Person) {
  const id = ulid();
  await push(p, [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title: "Plan", icon: null } as never }]);
  return id;
}

const upsert = (documentId: string, block: WireBlock, baseRevision: number | null, fields: ("content" | "position" | "collapsed")[] = ["content", "position"]): SyncOp => ({
  opId: ulid(),
  kind: "block.upsert",
  documentId,
  block,
  baseRevision,
  fields,
});
const del = (documentId: string, blockId: string, baseRevision: number | null): SyncOp => ({ opId: ulid(), kind: "block.delete", documentId, blockId, baseRevision });

async function live(p: Person, documentId: string) {
  return (await p.as.query(api.blocks.list, { documentId }))!.blocks;
}

describe("deleting a block with nested lines", () => {
  test("a line someone added under it meanwhile keeps the block (the deleting device is asked)", async () => {
    const t = setup();
    const a = await person(t, "concurrent-a@example.com");
    const doc = await newPage(a);
    const parent = para(ulid(), "Parent");
    const [created] = await push(a, [upsert(doc, parent, null)]);
    // Someone else (here the same account from another device) nests a new line under it.
    const child = para(ulid(), "Written meanwhile", "V", parent.id);
    await push(a, [upsert(doc, child, null)]);
    // The first device, which never saw that line, deletes the parent.
    const [r] = await push(a, [del(doc, parent.id, created!.revision!)]);
    expect(r!.status).toBe("conflict");
    expect(r!.conflict?.reason).toBe("content");
    expect((await live(a, doc)).map((b) => b.id).sort()).toEqual([child.id, parent.id].sort());
  });

  test("lines the device deletes in the same batch (parent first) or earlier (deepest first) go with it", async () => {
    const t = setup();
    const a = await person(t, "concurrent-b@example.com");
    const doc = await newPage(a);
    const parent = para(ulid(), "Parent");
    const child = para(ulid(), "Child", "V", parent.id);
    const grandchild = para(ulid(), "Grandchild", "V", child.id);
    const [p1, c1, g1] = await push(a, [upsert(doc, parent, null), upsert(doc, child, null), upsert(doc, grandchild, null)]);
    const parentFirst = await push(a, [del(doc, parent.id, p1!.revision!), del(doc, child.id, c1!.revision!), del(doc, grandchild.id, g1!.revision!)]);
    expect(parentFirst.map((r) => r.status)).toEqual(["applied", "applied", "applied"]);
    expect(await live(a, doc)).toEqual([]);

    const doc2 = await newPage(a);
    const [q1, d1] = await push(a, [upsert(doc2, { ...parent, id: ulid() }, null), upsert(doc2, { ...child, id: ulid(), parentId: null }, null)]);
    const p2 = q1!.block!;
    const c2 = { ...d1!.block!, parentId: p2.id };
    const [moved] = await push(a, [upsert(doc2, c2, d1!.revision!, ["position"])]);
    // Deepest first, in separate batches (a flush larger than one batch).
    expect((await push(a, [del(doc2, c2.id, moved!.revision!)]))[0]!.status).toBe("applied");
    expect((await push(a, [del(doc2, p2.id, q1!.revision!)]))[0]!.status).toBe("applied");
    expect(await live(a, doc2)).toEqual([]);
  });

  test("a nested line edited after the version its own delete was based on is kept too", async () => {
    const t = setup();
    const a = await person(t, "concurrent-c@example.com");
    const doc = await newPage(a);
    const parent = para(ulid(), "Parent");
    const child = para(ulid(), "Child", "V", parent.id);
    const [p1, c1] = await push(a, [upsert(doc, parent, null), upsert(doc, child, null)]);
    await push(a, [upsert(doc, { ...child, text: [{ type: "text", text: "Child, edited elsewhere" }] }, c1!.revision!, ["content"])]);
    const results = await push(a, [del(doc, parent.id, p1!.revision!), del(doc, child.id, c1!.revision!)]);
    expect(results.map((r) => r.status)).toEqual(["conflict", "conflict"]);
    expect((await live(a, doc)).find((b) => b.id === child.id)?.text).toEqual([{ type: "text", text: "Child, edited elsewhere" }]);
  });
});

describe("toggles opened and closed", () => {
  const toggle = (id: string, text: string, collapsed: boolean): WireBlock => ({
    id,
    type: "toggle",
    parentId: null,
    rank: "V",
    schemaVersion: SCHEMA_VERSION,
    text: [{ type: "text", text }],
    props: { collapsed },
  });

  test("closing a toggle and editing its text at the same time keep both, in either order", async () => {
    const t = setup();
    const a = await person(t, "concurrent-d@example.com");
    const doc = await newPage(a);
    const id = ulid();
    const [created] = await push(a, [upsert(doc, toggle(id, "Details", false), null)]);
    const base = created!.revision!;

    // Text first, then the close (based on the version before the text edit).
    const [edit] = await push(a, [upsert(doc, toggle(id, "Details, more", false), base, ["content"])]);
    expect(edit!.status).toBe("applied");
    const [close] = await push(a, [upsert(doc, toggle(id, "Details", true), base, ["collapsed"])]);
    expect(close!.status).toBe("applied");
    let row = (await live(a, doc)).find((b) => b.id === id)!;
    expect(row.text).toEqual([{ type: "text", text: "Details, more" }]);
    expect(row.props.collapsed).toBe(true);

    // The close doesn't count as an edit of the content: a text edit based on the version before it applies,
    // and doesn't open the toggle again (the device that wrote it hadn't seen it closed).
    const [again] = await push(a, [upsert(doc, toggle(id, "Details, more and more", false), edit!.revision!, ["content"])]);
    expect(again!.status).toBe("applied");
    expect(again!.normalized).toBe(true);
    row = (await live(a, doc)).find((b) => b.id === id)!;
    expect(row.text).toEqual([{ type: "text", text: "Details, more and more" }]);
    expect(row.props.collapsed).toBe(true);

    // A device that had seen everything (older clients open and close as a content change) is taken whole.
    const [open] = await push(a, [upsert(doc, toggle(id, "Details, more and more", false), again!.revision!, ["content"])]);
    expect(open!.status).toBe("applied");
    expect((await live(a, doc)).find((b) => b.id === id)!.props.collapsed).toBe(false);
  });
});
