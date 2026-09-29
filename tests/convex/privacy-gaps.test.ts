// What members and guests may learn about pages they can't open (docs/ACCOUNT_MODEL_PLAN.md §3d): counts
// never include restricted pages they can't open, guests get no folder or parent ids for what they can't
// open, and links never show a restricted page's title to someone who can't open it.
import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { SCHEMA_VERSION, type WireBlock } from "@folevi/editor-schema";
import { HIDDEN_PAGE_LABEL } from "../../convex/lib/linkLabels";
import { inWorkspace, join, person, setup, teamWorkspace, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

const TODAY = "2026-09-29";

async function page(p: Person, workspaceId: string, title: string, extra: { parentDocumentId?: string; folderId?: string } = {}) {
  return (await p.as.mutation(api.documents.create, { scope: inWorkspace(workspaceId), title, ...extra })).id;
}

async function write(p: Person, workspaceId: string, documentId: string, blocks: WireBlock[]) {
  const results = await p.as.mutation(api.sync.push, {
    scope: inWorkspace(workspaceId),
    deviceId: "device-privacy",
    ops: blocks.map((block) => ({ opId: ulid(), kind: "block.upsert" as const, documentId, block, baseRevision: null, fields: ["content" as const, "position" as const] })),
  });
  for (const r of results) expect(r.status).toBe("applied");
  return results;
}

const todo = (text: string, rank = "V"): WireBlock => ({ id: ulid(), type: "todo", parentId: null, rank, schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text }], props: { checked: false } });

/**
 * A workspace with an owner, an editing member, a view-only member and a guest. The owner keeps a
 * restricted page ("Secret plan", in the Projects folder, tagged, with a task and a child page granted to
 * the member) next to an open page in the same folder; a restricted draft and a restricted page in Trash.
 */
async function world(t: T, prefix: string) {
  const owner = await person(t, `${prefix}-owner@example.com`);
  const member = await person(t, `${prefix}-member@example.com`);
  const viewer = await person(t, `${prefix}-viewer@example.com`);
  const guest = await person(t, `${prefix}-guest@example.com`);
  const { workspaceId } = await teamWorkspace(owner, `${prefix} team`);
  await join(t, owner, member, `${prefix}-member@example.com`, workspaceId, "editor");
  await join(t, owner, viewer, `${prefix}-viewer@example.com`, workspaceId, "viewer");
  const scope = inWorkspace(workspaceId);
  const { id: folderId } = await owner.as.mutation(api.organization.createFolder, { scope, name: "Projects" });
  const { id: tagId } = await owner.as.mutation(api.organization.createTag, { scope, name: "plans" });

  const open = await page(owner, workspaceId, "Open notes", { folderId });
  const secret = await page(owner, workspaceId, "Secret plan", { folderId });
  const child = await page(owner, workspaceId, "Secret child", { parentDocumentId: secret });
  const draft = await page(owner, workspaceId, "Secret draft");
  const trashed = await page(owner, workspaceId, "Secret trash");
  await write(owner, workspaceId, open, [todo("Open task")]);
  await write(owner, workspaceId, secret, [todo("Secret task")]);
  await owner.as.mutation(api.organization.setDocumentTags, { documentId: open, tagIds: [tagId] });
  await owner.as.mutation(api.organization.setDocumentTags, { documentId: secret, tagIds: [tagId] });
  for (const id of [secret, draft, trashed]) await owner.as.mutation(api.sharing.setAccessMode, { documentId: id, mode: "restricted" });
  await owner.as.mutation(api.documents.moveToTrash, { documentId: trashed });
  // The member may open the child page (and so nothing above it).
  await owner.as.mutation(api.sharing.grant, { documentId: child, email: `${prefix}-member@example.com`, role: "viewer" });
  return { owner, member, viewer, guest, workspaceId, scope, folderId, tagId, open, secret, child, draft, trashed, guestEmail: `${prefix}-guest@example.com` };
}

describe("counts shown to members never include restricted pages they can't open", () => {
  test("tasks, folders, tags, drafts and trash", async () => {
    const t = setup();
    const w = await world(t, "counts");
    for (const p of [w.member, w.viewer]) {
      const tasks = await p.as.query(api.tasks.counts, { scope: w.scope, today: TODAY });
      expect(tasks.all).toBe(1);
      const index = await p.as.query(api.organization.index, { scope: w.scope });
      const folder = index.folders.find((f) => f.id === w.folderId)!;
      expect(folder.documentCount).toBe(1);
      expect(folder.previews.map((x) => x.title)).toEqual(["Open notes"]);
      expect(index.tags.find((x) => x.id === w.tagId)!.documentCount).toBe(1);
      // Drafts: the seeded pages live in Personal; here only the member-visible drafts count (none).
      expect(await p.as.query(api.organization.draftCount, { scope: w.scope })).toBe(0);
      const trash = await p.as.query(api.documents.trashSummary, { scope: w.scope });
      expect(trash.total).toBe(0);
      expect(trash.deletable).toBe(0);
    }
    // The owner opens everything.
    expect((await w.owner.as.query(api.tasks.counts, { scope: w.scope, today: TODAY })).all).toBe(2);
    const ownerIndex = await w.owner.as.query(api.organization.index, { scope: w.scope });
    expect(ownerIndex.folders.find((f) => f.id === w.folderId)!.documentCount).toBe(2);
    expect(ownerIndex.tags.find((x) => x.id === w.tagId)!.documentCount).toBe(2);
    expect(await w.owner.as.query(api.organization.draftCount, { scope: w.scope })).toBe(1);
    expect((await w.owner.as.query(api.documents.trashSummary, { scope: w.scope })).total).toBe(1);
    // A grant opens a restricted page to the member, and the counts follow.
    await w.owner.as.mutation(api.sharing.grant, { documentId: w.secret, email: "counts-member@example.com", role: "viewer" });
    expect((await w.member.as.query(api.tasks.counts, { scope: w.scope, today: TODAY })).all).toBe(2);
    expect((await w.member.as.query(api.organization.index, { scope: w.scope })).folders.find((f) => f.id === w.folderId)!.documentCount).toBe(2);
    expect((await w.viewer.as.query(api.tasks.counts, { scope: w.scope, today: TODAY })).all).toBe(1);
  });
});

describe("no folder or parent ids for what the reader can't open", () => {
  test("a guest gets no folder ids and no parent they can't open (get, children, sync results)", async () => {
    const t = setup();
    const w = await world(t, "ids");
    // A shared page in the folder, under an open page the guest isn't given, with a filed child page.
    const shared = await page(w.owner, w.workspaceId, "Shared", { parentDocumentId: w.open, folderId: w.folderId });
    const kid = await page(w.owner, w.workspaceId, "Kid", { parentDocumentId: shared, folderId: w.folderId });
    await w.owner.as.mutation(api.sharing.grant, { documentId: shared, email: w.guestEmail, role: "editor" });

    const got = (await w.guest.as.query(api.documents.get, { documentId: shared }))!;
    expect(got.isMember).toBe(false);
    expect(got.document.folderId).toBeNull();
    expect(got.document.parentDocumentId).toBeNull();
    const kids = await w.guest.as.query(api.documents.children, { documentId: shared });
    expect(kids.map((k) => [k.id, k.folderId, k.parentDocumentId])).toEqual([[kid, null, shared]]);
    // An edit through sync answers with the same view of the page.
    const [r] = await w.guest.as.mutation(api.sync.push, {
      scope: inWorkspace(w.workspaceId),
      deviceId: "device-privacy",
      ops: [{ opId: ulid(), kind: "document.update", documentId: shared, patch: { title: "Shared (edited)" }, baseRevision: got.document.revision }],
    });
    expect(r!.status).toBe("applied");
    expect(r!.document!.folderId).toBeNull();
    expect(r!.document!.parentDocumentId).toBeNull();
    // A member of the workspace sees both.
    const asMember = (await w.member.as.query(api.documents.get, { documentId: shared }))!;
    expect(asMember.document.folderId).toBe(w.folderId);
    expect(asMember.document.parentDocumentId).toBe(w.open);
  });

  test("a member given only a page under a restricted page gets no id of the page above (get, pull)", async () => {
    const t = setup();
    const w = await world(t, "parent");
    const got = (await w.member.as.query(api.documents.get, { documentId: w.child }))!;
    expect(got.access).toBe("read");
    expect(got.document.parentDocumentId).toBeNull();
    expect(got.breadcrumbs).toEqual([]);
    const pulled = await w.member.as.query(api.sync.pull, { scope: w.scope, cursor: 0 });
    const ids = pulled.documents.map((d) => d.id);
    expect(ids).toContain(w.child);
    expect(ids).not.toContain(w.secret);
    expect(pulled.documents.find((d) => d.id === w.child)!.parentDocumentId).toBeNull();
    // The owner, who can open it, gets the parent.
    expect((await w.owner.as.query(api.documents.get, { documentId: w.child }))!.document.parentDocumentId).toBe(w.secret);
  });
});

describe("links never show a restricted page's title to someone who can't open it", () => {
  test("blocks, pull, derived text and renames", async () => {
    const t = setup();
    const w = await world(t, "links");
    const other = await page(w.owner, w.workspaceId, "Roadmap");
    const note = await page(w.owner, w.workspaceId, "Index");
    const inline: WireBlock = {
      id: ulid(),
      type: "paragraph",
      parentId: null,
      rank: "V",
      schemaVersion: SCHEMA_VERSION,
      text: [
        { type: "text", text: "See " },
        { type: "pageLink", documentId: w.secret, label: "Secret plan" },
        { type: "text", text: " and " },
        { type: "pageLink", documentId: other, label: "Old roadmap name" },
      ],
      props: {},
    };
    const card: WireBlock = { id: ulid(), type: "page", parentId: null, rank: "W", schemaVersion: SCHEMA_VERSION, text: [], props: { documentId: w.secret, display: "card", titleCache: "Secret plan", iconCache: "🔒" } };
    await write(w.owner, w.workspaceId, note, [inline, card]);
    await w.owner.as.mutation(api.sharing.grant, { documentId: note, email: w.guestEmail, role: "viewer" });

    const labels = (blocks: WireBlock[]) => {
      const b = blocks.find((x) => x.id === inline.id)!;
      const c = blocks.find((x) => x.id === card.id)!;
      return {
        inline: b.text.filter((n) => n.type === "pageLink").map((n) => (n as { label: string }).label),
        card: [(c.props as { titleCache?: string }).titleCache, (c.props as { iconCache?: string }).iconCache ?? null],
      };
    };
    // The owner sees current titles; the member the restricted one hidden; the guest (who opens neither) both hidden.
    const icon = (await w.owner.as.query(api.documents.get, { documentId: w.secret }))!.document.icon;
    expect(labels((await w.owner.as.query(api.blocks.list, { documentId: note }))!.blocks)).toEqual({ inline: ["Secret plan", "Roadmap"], card: ["Secret plan", icon] });
    expect(labels((await w.member.as.query(api.blocks.list, { documentId: note }))!.blocks)).toEqual({ inline: [HIDDEN_PAGE_LABEL, "Roadmap"], card: [HIDDEN_PAGE_LABEL, null] });
    expect(labels((await w.viewer.as.query(api.blocks.list, { documentId: note }))!.blocks)).toEqual({ inline: [HIDDEN_PAGE_LABEL, "Roadmap"], card: [HIDDEN_PAGE_LABEL, null] });
    expect(labels((await w.guest.as.query(api.blocks.list, { documentId: note }))!.blocks)).toEqual({ inline: [HIDDEN_PAGE_LABEL, HIDDEN_PAGE_LABEL], card: [HIDDEN_PAGE_LABEL, null] });
    // The sync feed, too.
    const pulled = await w.member.as.query(api.sync.pull, { scope: w.scope, cursor: 0 });
    expect(labels(pulled.blocks.filter((b) => b.documentId === note).map((b) => b.block)).inline).toEqual([HIDDEN_PAGE_LABEL, "Roadmap"]);

    // Text derived from the page (excerpt, card preview, search) never carries it, for anyone.
    const summary = (await w.member.as.query(api.documents.get, { documentId: note }))!.document;
    expect(JSON.stringify([summary.excerpt, summary.preview])).not.toContain("Secret");
    expect(JSON.stringify([summary.excerpt, summary.preview])).toContain("Roadmap");
    const stored = await t.run(async (ctx) => (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", note)).unique())!);
    expect(stored.searchText).not.toMatch(/secret/i);

    // Renaming the restricted page never writes its new title into the linking page; renaming an open
    // one does.
    await w.owner.as.mutation(api.sync.push, {
      scope: w.scope,
      deviceId: "device-privacy",
      ops: [
        { opId: ulid(), kind: "document.update", documentId: w.secret, patch: { title: "Secret merger" }, baseRevision: null },
        { opId: ulid(), kind: "document.update", documentId: other, patch: { title: "Roadmap 2027" }, baseRevision: null },
      ],
    });
    const raw = await t.run(async (ctx) => (await ctx.db.query("blocks").withIndex("by_block_id", (q) => q.eq("blockId", inline.id)).unique())!);
    expect(JSON.stringify(raw.text)).not.toContain("Secret merger");
    expect(JSON.stringify(raw.text)).toContain("Roadmap 2027");
    const after = (await w.member.as.query(api.documents.get, { documentId: note }))!.document;
    expect(JSON.stringify([after.excerpt, after.preview])).not.toContain("Secret");
    // The owner still sees the current title.
    expect(labels((await w.owner.as.query(api.blocks.list, { documentId: note }))!.blocks).inline).toEqual(["Secret merger", "Roadmap 2027"]);
    expect(labels((await w.member.as.query(api.blocks.list, { documentId: note }))!.blocks).inline).toEqual([HIDDEN_PAGE_LABEL, "Roadmap 2027"]);

    // A task's title is derived text too.
    const taskDoc = await page(w.owner, w.workspaceId, "Tasks");
    const task: WireBlock = { ...todo(""), text: [{ type: "text", text: "Read " }, { type: "pageLink", documentId: w.secret, label: "Secret merger" }] };
    await write(w.owner, w.workspaceId, taskDoc, [task]);
    const tasks = await w.member.as.query(api.tasks.list, { scope: w.scope, view: "all", today: TODAY });
    expect(tasks.find((x) => x.blockId === task.id)!.title).toBe(`Read ${HIDDEN_PAGE_LABEL}`);

    // The one-off migration recomputes text derived before this change.
    await t.run(async (ctx) => {
      await ctx.db.patch(stored._id, { excerpt: "See Secret plan", searchText: "see secret plan" });
    });
    await t.mutation(internal.migrations.refreshLinkingPages, {});
    const fixed = await t.run(async (ctx) => (await ctx.db.get(stored._id))!);
    expect(fixed.excerpt).not.toContain("Secret");
    expect(fixed.searchText).not.toMatch(/secret/i);
  });
});
