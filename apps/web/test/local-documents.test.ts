// Local mode's documents.* where it can't be compared with the server in the parity harness
// (tests/parity): Trash's 30 days (the server's cron, a clock here), which device edited what, and synced
// content following the notes that show it in and out of Trash.
import { describe, expect, test } from "vitest";
import { ulid, type SyncOp, type WireBlock } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { LocalBackend, LocalClient, MemoryStore } from "@/lib/local";
import { TRASH_RETENTION_MS } from "@/lib/local/functions/documents";

const DAY = 24 * 60 * 60 * 1000;

async function library() {
  let clock = Date.UTC(2026, 9, 1);
  const backend = new LocalBackend(new MemoryStore(), { deviceId: "dev_here", now: () => clock });
  const client = new LocalClient(backend);
  await client.local.setup({ timeZone: "UTC", locale: "en", displayName: "Sam", seed: false });
  const push = (ops: SyncOp[]) => client.mutation(api.sync.push, { scope: { kind: "personal" }, deviceId: "engine-device-1", ops: ops as never });
  const note = async (title: string, extra: Partial<Extract<SyncOp, { kind: "document.create" }>["document"]> = {}) => {
    const id = ulid();
    await push([{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: "📝", ...extra } }]);
    return id;
  };
  const upsert = (documentId: string, block: WireBlock) => push([{ opId: ulid(), kind: "block.upsert", documentId, block, baseRevision: null, fields: ["content", "position"] }]);
  return { client, push, note, upsert, advance: (ms: number) => (clock += ms) };
}

const paragraph = (id: string, text: string, rank = "V"): WireBlock => ({ id, type: "paragraph", parentId: null, rank, schemaVersion: 1, text: [{ type: "text", text }], props: {} });

describe("local documents", () => {
  test("a note in Trash for more than 30 days is deleted for good, with the pages inside it", async () => {
    const { client, note, advance } = await library();
    const old = await note("Old");
    const inside = await note("Inside", { parentDocumentId: old });
    const recent = await note("Recent");
    const open = await note("Open");
    await client.mutation(api.documents.moveToTrash, { documentId: old });
    advance(20 * DAY);
    await client.mutation(api.documents.moveToTrash, { documentId: recent });
    advance(TRASH_RETENTION_MS - 20 * DAY + 2 * 60 * 60 * 1000);
    // Opening any note is when the library looks (at most once an hour).
    await client.mutation(api.documents.recordView, { documentId: open });
    expect(await client.query(api.documents.get, { documentId: old })).toBeNull();
    expect(await client.query(api.documents.get, { documentId: inside })).toBeNull();
    expect((await client.query(api.documents.get, { documentId: recent }))?.inTrash).toBe(true);
    expect(await client.query(api.documents.trashSummary, { scope: { kind: "personal" } })).toEqual({ total: 1, deletable: 1, more: false });
    client.close();
  });

  test("version history names the device that made each change", async () => {
    const { client, note, upsert } = await library();
    const id = await note("Plan");
    const p = ulid();
    await upsert(id, paragraph(p, "First line"));
    const saved = await client.mutation(api.documents.createSnapshot, { documentId: id, reason: "manual" });
    const authors = await client.query(api.documents.blockAuthors, { documentId: id });
    expect(authors.authors.map(([block, key]) => [block, key])).toEqual([[p, "dev_here"]]);
    expect(authors.people).toEqual({ dev_here: { key: "dev_here", name: "This device", color: expect.any(String), avatarUrl: null } });
    const versions = await client.query(api.documents.versions, { documentId: id });
    expect(versions.versions.map((v) => ({ id: v.id, editors: v.editors }))).toEqual([{ id: saved.id, editors: ["dev_here"] }]);
    expect(versions.people.dev_here?.name).toBe("This device");
    client.close();
  });

  test("synced content goes to Trash with the last note showing it, and comes back with it", async () => {
    const { client, note, upsert } = await library();
    const source = await note("", { kind: "synced", icon: null });
    await upsert(source, paragraph(ulid(), "Shared text"));
    const host = await note("Host");
    const block: WireBlock = { id: ulid(), type: "synced", parentId: null, rank: "V", schemaVersion: 1, text: [], props: { sourceId: source } };
    await upsert(host, block);
    expect((await client.query(api.documents.get, { documentId: source }))?.inTrash).toBe(false);
    await client.mutation(api.documents.moveToTrash, { documentId: host });
    expect((await client.query(api.documents.get, { documentId: source }))?.inTrash).toBe(true);
    // Not a page of its own: Trash doesn't list it.
    const trash = await client.query(api.documents.list, { scope: { kind: "personal" }, view: "trash", paginationOpts: { numItems: 10, cursor: null } });
    expect(trash.page.map((d) => d.id)).toEqual([host]);
    await client.mutation(api.documents.restoreFromTrash, { documentId: host });
    expect((await client.query(api.documents.get, { documentId: source }))?.inTrash).toBe(false);
    client.close();
  });
});
