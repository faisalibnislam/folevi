// Typing costs (convex/lib/editSettle.ts, blocks.changes): while someone types, the note's own row is
// written about once per settle window instead of on every save, a version never misses an edit that's
// still waiting, and an open note re-reads only the blocks changed since it loaded.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { SETTLE_MS } from "../../convex/lib/editSettle";
import { snapshot } from "../../convex/documents";
import { para, person, setup, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

async function docRow(t: T, publicId: string) {
  return await t.run(async (ctx) => (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", publicId)).unique())!);
}

const pending = async (t: T) => await t.run(async (ctx) => await ctx.db.query("documentEdits").collect());

async function newNote(p: Person, title: string) {
  return (await p.as.mutation(api.documents.create, { scope: p.scope, title })).id;
}

/** Saves a line as an editor would: based on the revision it holds. */
async function write(p: Person, documentId: string, id: string, text: string, rank = "V") {
  const held = (await p.as.query(api.blocks.list, { documentId }))?.blocks.find((b) => b.id === id);
  const [result] = (await p.as.mutation(api.sync.push, {
    scope: p.scope,
    deviceId: "device-settle",
    ops: [{ opId: ulid(), kind: "block.upsert", documentId, block: para(id, text, rank), baseRevision: held?.revision ?? null, fields: ["content", "position"] }] as never,
  })) as { status: string }[];
  expect(result!.status).toBe("applied");
}

describe("the note's row while someone types", () => {
  test("the first save updates it at once; later saves wait for the window to end, then land together", async () => {
    const t = setup();
    const a = await person(t, "settle-typing@example.com");
    const id = await newNote(a, "Typing");
    const line = ulid();
    await write(a, id, line, "first words");
    const first = await docRow(t, id);
    expect(first.searchText).toContain("first words");
    expect(first.settleAt).toBeGreaterThan(Date.now());

    // Inside the window: the blocks are saved, the row isn't touched.
    vi.advanceTimersByTime(2_500);
    await write(a, id, line, "first words and more");
    vi.advanceTimersByTime(2_500);
    await write(a, id, line, "first words and more still");
    const during = await docRow(t, id);
    expect(during._creationTime).toBe(first._creationTime);
    expect({ updatedAt: during.updatedAt, contentSeq: during.contentSeq, searchText: during.searchText, seq: during.seq }).toEqual({
      updatedAt: first.updatedAt,
      contentSeq: first.contentSeq,
      searchText: first.searchText,
      seq: first.seq,
    });
    expect(await pending(t)).toHaveLength(1);
    const blocks = await a.as.query(api.blocks.list, { documentId: id });
    expect(blocks!.blocks.map((b) => b.text)).toEqual([[{ type: "text", text: "first words and more still" }]]);

    // The window ends: the waiting edit lands once, with the latest text.
    vi.advanceTimersByTime(SETTLE_MS);
    await t.finishInProgressScheduledFunctions();
    const after = await docRow(t, id);
    expect(after.searchText).toContain("first words and more still");
    expect(after.contentSeq).toBe(first.contentSeq + 1);
    expect(after.updatedAt).toBeGreaterThan(first.updatedAt);
    expect(await pending(t)).toHaveLength(0);

    // Nothing more waiting: the next window closes quietly, and the next save is written at once again.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await docRow(t, id)).contentSeq).toBe(after.contentSeq);
    await write(a, id, line, "a new burst");
    expect((await docRow(t, id)).searchText).toContain("a new burst");
  });

  test("a version saved while an edit waits includes it", async () => {
    const t = setup();
    const a = await person(t, "settle-version@example.com");
    const id = await newNote(a, "Versions");
    const line = ulid();
    await write(a, id, line, "one");
    vi.advanceTimersByTime(1_000);
    await write(a, id, line, "one two");
    expect(await pending(t)).toHaveLength(1);
    await t.run(async (ctx) => {
      const doc = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", id)).unique())!;
      await snapshot(ctx, doc, doc.lastEditedBy, "manual");
    });
    expect(await pending(t)).toHaveLength(0);
    expect((await docRow(t, id)).searchText).toContain("one two");
  });
});

describe("an open note's changes", () => {
  test("only blocks changed since it loaded, with the ids of those deleted", async () => {
    const t = setup();
    const a = await person(t, "settle-changes@example.com");
    const id = await newNote(a, "Changes");
    const [x, y, z] = [ulid(), ulid(), ulid()];
    await write(a, id, x, "x", "B");
    await write(a, id, y, "y", "C");
    await write(a, id, z, "z", "D");
    const loaded = (await a.as.query(api.blocks.list, { documentId: id }))!;
    expect(loaded.blocks).toHaveLength(3);
    expect(await a.as.query(api.blocks.changes, { documentId: id, since: loaded.head })).toMatchObject({ blocks: [], deleted: [], head: loaded.head, more: false });

    await write(a, id, y, "y changed", "C");
    await a.as.mutation(api.sync.push, { scope: a.scope, deviceId: "device-settle", ops: [{ opId: ulid(), kind: "block.delete", documentId: id, blockId: z, baseRevision: loaded.blocks.find((b) => b.id === z)!.revision }] as never });
    const changed = (await a.as.query(api.blocks.changes, { documentId: id, since: loaded.head }))!;
    expect(changed.blocks.map((b) => [b.id, b.text])).toEqual([[y, [{ type: "text", text: "y changed" }]]]);
    expect(changed.deleted).toEqual([z]);
    expect(changed.head).toBeGreaterThan(loaded.head);
    // From the newer head, nothing.
    expect(await a.as.query(api.blocks.changes, { documentId: id, since: changed.head })).toMatchObject({ blocks: [], deleted: [] });
  });

  test("someone who can't open the note gets nothing", async () => {
    const t = setup();
    const a = await person(t, "settle-owner@example.com");
    const b = await person(t, "settle-other@example.com");
    const id = await newNote(a, "Private");
    await write(a, id, ulid(), "secret");
    expect(await b.as.query(api.blocks.changes, { documentId: id, since: 0 })).toBeNull();
  });
});
