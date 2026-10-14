// Copy to: a note (with its sub-pages) copied between your Personal and a workspace (convex/copies.ts).
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SCHEMA_VERSION } from "@folevi/editor-schema";
import { inWorkspace, join, para, person, PERSONAL, setup, teamWorkspace, ulid, type ScopeArg, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

afterEach(() => {
  vi.useRealTimers();
});

async function push(p: Person, scope: ScopeArg, ops: unknown[]) {
  const results = await p.as.mutation(api.sync.push, { scope, deviceId: "device-copy-to", ops: ops as never });
  for (const r of results) expect(r.status).toBe("applied");
}

async function newDoc(p: Person, title: string, scope: ScopeArg = PERSONAL, parentDocumentId: string | null = null) {
  const id = ulid();
  await push(p, scope, [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId, folderId: null, kind: "document", title, icon: null } }]);
  return id;
}

const block = (type: string, props: Record<string, unknown>, text: unknown[] = [], rank = "a") => ({ id: ulid(), type, parentId: null, rank, schemaVersion: SCHEMA_VERSION, text, props });
const link = (documentId: string, label: string) => ({ type: "pageLink", documentId, label });

async function addBlocks(p: Person, scope: ScopeArg, documentId: string, blocks: unknown[]) {
  await push(
    p,
    scope,
    blocks.map((b) => ({ opId: ulid(), kind: "block.upsert", documentId, block: b, baseRevision: null, fields: ["content", "position"] })),
  );
}

/** Stores bytes as a ready image of the note (as a finished upload would), counted toward its place. */
async function uploadInto(t: T, documentId: string, content: string) {
  const publicId = ulid();
  await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([content], { type: "image/png" }));
    const doc = (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", documentId)).unique())!;
    await ctx.db.insert("files", {
      publicId,
      storageId,
      ...(doc.ownerProfileId ? { ownerProfileId: doc.ownerProfileId } : { workspaceId: doc.workspaceId! }),
      documentId: doc._id,
      uploadedBy: doc.createdBy,
      filename: "photo.png",
      mimeType: "image/png",
      size: content.length,
      sha256: "x",
      kind: "image",
      width: 4,
      height: 3,
      status: "ready",
      createdAt: Date.now(),
    });
  });
  return publicId;
}

const blocksOf = async (p: Person, documentId: string) => (await p.as.query(api.blocks.list, { documentId }))!.blocks;

async function docRow(t: T, publicId: string) {
  return await t.run(async (ctx) => (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", publicId)).unique())!);
}

async function fileRow(t: T, publicId: string) {
  return await t.run(async (ctx) => (await ctx.db.query("files").withIndex("by_public_id", (q) => q.eq("publicId", publicId)).unique())!);
}

async function workspaceRow(t: T, workspaceId: string) {
  return await t.run(async (ctx) => (await ctx.db.query("workspaces").withIndex("by_public_id", (q) => q.eq("publicId", workspaceId)).unique())!);
}

const personalUsed = async (t: T, p: Person) => await t.run(async (ctx) => (await ctx.db.get(p.profileId as Id<"profiles">))!.personalStorageUsedBytes ?? 0);

const titlesIn = async (p: Person, scope: ScopeArg) =>
  (await p.as.query(api.documents.list, { scope, view: "all", paginationOpts: { numItems: 200, cursor: null } })).page.map((d) => d.title);

/** A Personal note "Plan" with a sub-page "Details", links between them and to a note outside, and an image. */
async function plan(t: T, a: Person) {
  const outside = await newDoc(a, "Elsewhere");
  const root = await newDoc(a, "Plan");
  const child = await newDoc(a, "Details", PERSONAL, root);
  const image = await uploadInto(t, root, "png-bytes!");
  await addBlocks(a, PERSONAL, root, [
    block("paragraph", {}, [{ type: "text", text: "See " }, link(child, "Details"), { type: "text", text: " and " }, link(outside, "Elsewhere")], "a"),
    block("page", { documentId: child, display: "link" }, [], "b"),
    block("image", { fileId: image, alt: "", caption: "" }, [], "c"),
  ]);
  await addBlocks(a, PERSONAL, child, [block("paragraph", {}, [{ type: "text", text: "Back to " }, link(root, "Plan")])]);
  await a.as.mutation(api.comments.create, { documentId: root, body: [{ type: "text", text: "A comment" }] });
  return { outside, root, child, image };
}

describe("copy a note to another place", () => {
  test("Personal to a workspace: sub-pages come along, links between them follow, files are the workspace's own", async () => {
    const t = setup();
    const a = await person(t, "copy-to-a@example.com");
    const { workspaceId, scope } = await teamWorkspace(a, "Acme Studio");
    const folder = (await a.as.mutation(api.organization.createFolder, { scope, name: "Projects" })).id;
    const src = await plan(t, a);
    const personalBefore = await personalUsed(t, a);
    const workspaceBefore = (await workspaceRow(t, workspaceId)).storageUsedBytes;

    const r = await a.as.mutation(api.copies.copyTo, { documentId: src.root, destination: scope, folderId: folder });
    expect(r).toMatchObject({ title: "Plan", pages: 2, place: "Acme Studio" });
    expect(r.id).not.toBe(src.root);

    // The copy lives in the workspace, in the folder chosen; its sub-page under it.
    const copy = await docRow(t, r.id);
    const ws = await workspaceRow(t, workspaceId);
    expect(copy.workspaceId).toBe(ws._id);
    expect(copy.ownerProfileId).toBeUndefined();
    const inFolder = await a.as.query(api.documents.list, { scope, view: "folder", folderId: folder, paginationOpts: { numItems: 10, cursor: null } });
    expect(inFolder.page.map((d) => d.title)).toEqual(["Plan"]);
    const children = await t.run(async (ctx) => await ctx.db.query("documents").withIndex("by_parent", (q) => q.eq("parentDocumentId", copy._id)).collect());
    expect(children.map((c) => c.title)).toEqual(["Details"]);
    const childCopy = children[0]!;
    expect(childCopy.workspaceId).toBe(ws._id);

    // Links: to the copied sub-page (inline and the page block) and back to the copy; outside links unchanged.
    const blocks = await blocksOf(a, r.id);
    const text = blocks.find((b) => b.type === "paragraph")!.text as { type: string; documentId?: string }[];
    expect(text.filter((n) => n.type === "pageLink").map((n) => n.documentId)).toEqual([childCopy.publicId, src.outside]);
    expect((blocks.find((b) => b.type === "page")!.props as { documentId: string }).documentId).toBe(childCopy.publicId);
    const back = (await blocksOf(a, childCopy.publicId)).find((b) => b.type === "paragraph")!.text as { type: string; documentId?: string }[];
    expect(back.find((n) => n.type === "pageLink")!.documentId).toBe(r.id);
    // Block ids are new.
    const originalIds = new Set((await blocksOf(a, src.root)).map((b) => b.id));
    expect(blocks.every((b) => !originalIds.has(b.id))).toBe(true);

    // The image is a file of the copy, in the workspace, counted there (not in Personal again).
    const fileId = (blocks.find((b) => b.type === "image")!.props as { fileId: string }).fileId;
    expect(fileId).not.toBe(src.image);
    const file = await fileRow(t, fileId);
    expect(file.workspaceId).toBe(ws._id);
    expect(file.documentId).toBe(copy._id);
    expect((await workspaceRow(t, workspaceId)).storageUsedBytes).toBe(workspaceBefore + "png-bytes!".length);
    expect(await personalUsed(t, a)).toBe(personalBefore);

    // Comments stay with the original; the original is untouched.
    const threads = await t.run(async (ctx) => await ctx.db.query("commentThreads").withIndex("by_document", (q) => q.eq("documentId", copy._id)).collect());
    expect(threads).toEqual([]);
    expect((await docRow(t, src.root)).ownerProfileId).toBe(a.profileId);
    expect(await titlesIn(a, PERSONAL)).toContain("Plan");
  });

  test("a workspace note back to Personal, without its sub-pages", async () => {
    const t = setup();
    const a = await person(t, "copy-back@example.com");
    const { scope } = await teamWorkspace(a, "Acme Studio");
    const root = await newDoc(a, "Team plan", scope);
    const child = await newDoc(a, "Team details", scope, root);
    await addBlocks(a, scope, root, [block("page", { documentId: child, display: "card" }), block("paragraph", {}, [{ type: "text", text: "Hello" }], "b")]);

    const r = await a.as.mutation(api.copies.copyTo, { documentId: root, destination: PERSONAL, includeSubpages: false });
    expect(r).toMatchObject({ title: "Team plan", pages: 1, place: "Personal" });
    const copy = await docRow(t, r.id);
    expect(copy.ownerProfileId).toBe(a.profileId);
    expect(copy.folderId).toBeUndefined();
    // No sub-page copied: the page block still points at the workspace's sub-page.
    const kids = await t.run(async (ctx) => await ctx.db.query("documents").withIndex("by_parent", (q) => q.eq("parentDocumentId", copy._id)).collect());
    expect(kids).toEqual([]);
    expect((((await blocksOf(a, r.id)).find((b) => b.type === "page"))!.props as { documentId: string }).documentId).toBe(child);
    // In Drafts in Personal.
    const drafts = await a.as.query(api.documents.list, { scope: PERSONAL, view: "unsorted", paginationOpts: { numItems: 100, cursor: null } });
    expect(drafts.page.map((d) => d.title)).toContain("Team plan");

    // A copy into the same place is marked as a copy.
    const same = await a.as.mutation(api.copies.copyTo, { documentId: root, destination: scope });
    expect(same.title).toBe("Team plan (copy)");
    expect(same.pages).toBe(2);
  });

  test("a collection in the note becomes a table of what it showed", async () => {
    const t = setup();
    const a = await person(t, "copy-table@example.com");
    const { scope } = await teamWorkspace(a, "Acme Studio");
    const root = await newDoc(a, "Reading list");
    const { collectionId, viewId } = await a.as.mutation(api.collections.create, { documentId: root, name: "Books" });
    const c = await a.as.query(api.collections.get, { collectionId });
    const status = c.properties.find((p) => p.type === "select")!;
    const date = c.properties.find((p) => p.type === "date")!;
    await a.as.mutation(api.collections.addRow, { collectionId, title: "Dune", values: { [status.id]: "done", [date.id]: "2026-10-01" } });
    await a.as.mutation(api.collections.addRow, { collectionId, title: "Emma", values: { [status.id]: "doing" } });
    await addBlocks(a, PERSONAL, root, [block("collection", { collectionId, viewId })]);

    const r = await a.as.mutation(api.copies.copyTo, { documentId: root, destination: scope });
    // The collection's row pages aren't copied as sub-pages.
    expect(r.pages).toBe(1);
    const table = (await blocksOf(a, r.id)).find((b) => b.type === "table")!;
    expect((await blocksOf(a, r.id)).some((b) => b.type === "collection")).toBe(false);
    const rows = (table.props as { rows: { text: string }[][][] }).rows.map((row) => row.map((cell) => cell.map((n) => n.text).join("")));
    expect(rows).toEqual([
      ["Name", "Status", "Date"],
      ["Dune", "Done", "2026-10-01"],
      ["Emma", "In progress", ""],
    ]);
  });

  test("needs read access to the note and the right to add pages where it goes", async () => {
    const t = setup();
    const owner = await person(t, "copy-owner@example.com");
    const viewer = await person(t, "copy-viewer@example.com");
    const outsider = await person(t, "copy-outsider@example.com");
    const { workspaceId, scope } = await teamWorkspace(owner, "Acme Studio");
    await join(t, owner, viewer, "copy-viewer@example.com", workspaceId, "viewer");
    const viewersNote = await newDoc(viewer, "Viewer's own");
    const teamNote = await newDoc(owner, "Team note", scope);
    const ownersPrivate = await newDoc(owner, "Owner's Personal");

    // A viewer can't add pages to the workspace.
    await expect(viewer.as.mutation(api.copies.copyTo, { documentId: viewersNote, destination: inWorkspace(workspaceId) })).rejects.toThrow(/permission/);
    // Someone who isn't in the workspace can't copy into it.
    const theirs = await newDoc(outsider, "Outsider's");
    await expect(outsider.as.mutation(api.copies.copyTo, { documentId: theirs, destination: inWorkspace(workspaceId) })).rejects.toThrow(/Workspace not found/);
    // A note you can't open can't be copied (it reads as not found).
    await expect(outsider.as.mutation(api.copies.copyTo, { documentId: ownersPrivate, destination: PERSONAL })).rejects.toThrow(/Document not found/);
    // A viewer can read the team note, so can copy it into their own Personal.
    const r = await viewer.as.mutation(api.copies.copyTo, { documentId: teamNote, destination: PERSONAL });
    expect((await docRow(t, r.id)).ownerProfileId).toBe(viewer.profileId);
    // A folder must be in the destination.
    const teamFolder = (await owner.as.mutation(api.organization.createFolder, { scope, name: "Team folder" })).id;
    await expect(owner.as.mutation(api.copies.copyTo, { documentId: ownersPrivate, destination: PERSONAL, folderId: teamFolder })).rejects.toThrow(/Folder not found/);
  });

  test("refused when the destination's storage is full, and nothing is left half made", async () => {
    const t = setup();
    const a = await person(t, "copy-full@example.com");
    const { workspaceId, scope } = await teamWorkspace(a, "Acme Studio");
    const src = await plan(t, a);
    await t.run(async (ctx) => {
      const w = (await ctx.db.query("workspaces").withIndex("by_public_id", (q) => q.eq("publicId", workspaceId)).unique())!;
      await ctx.db.patch(w._id, { storageUsedBytes: 10 * 1024 ** 4 });
    });
    await expect(a.as.mutation(api.copies.copyTo, { documentId: src.root, destination: scope })).rejects.toThrow(/storage/);
    expect(await titlesIn(a, scope)).not.toContain("Plan");
    expect(await titlesIn(a, scope)).not.toContain("Details");
    // A note without files still copies.
    const plain = await newDoc(a, "Just text");
    await addBlocks(a, PERSONAL, plain, [para(ulid(), "No files here")]);
    expect((await a.as.mutation(api.copies.copyTo, { documentId: plain, destination: scope })).title).toBe("Just text");
  });
});
