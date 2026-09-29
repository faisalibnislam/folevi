// Personal is not a workspace (docs/ACCOUNT_MODEL_PLAN.md, phase B): Personal content belongs to its
// owner; nobody else can list, search or open it except through a page grant (a guest), which reaches
// nested pages too. Deleting an account deletes its Personal, with the access given on it.
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { inWorkspace, para, person, PERSONAL, setup, teamWorkspace, ulid } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

async function create(p: Person, title: string, extra: Record<string, unknown> = {}) {
  const id = ulid();
  const [r] = await p.as.mutation(api.sync.push, {
    scope: PERSONAL,
    deviceId: "device-personal",
    ops: [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null, ...extra } as never }],
  });
  expect(r!.status).toBe("applied");
  return id;
}

async function write(p: Person, documentId: string, text: string) {
  const [r] = await p.as.mutation(api.sync.push, {
    scope: PERSONAL,
    deviceId: "device-personal",
    ops: [{ opId: ulid(), kind: "block.upsert", documentId, block: para(ulid(), text), baseRevision: null, fields: ["content", "position"] }],
  });
  return r!;
}

const listIds = async (p: Person) => (await p.as.query(api.documents.list, { scope: PERSONAL, view: "all", paginationOpts: { numItems: 200, cursor: null } })).page.map((d) => d.id);

describe("Personal content isolation", () => {
  test("nobody else can open, list, search, pull or change someone's Personal", async () => {
    const t = setup();
    const a = await person(t, "iso-a@example.com");
    const b = await person(t, "iso-b@example.com");
    const secret = await create(a, "Quarterly zeppelin budget");
    await write(a, secret, "zeppelin hangar costs");
    const { id: folderId } = await a.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "Private box" });
    const { id: tagId } = await a.as.mutation(api.organization.createTag, { scope: PERSONAL, name: "zeppelin" });

    // Opening by id reads as missing (never "forbidden", so existence doesn't leak).
    expect(await b.as.query(api.documents.get, { documentId: secret })).toBeNull();
    expect(await b.as.query(api.blocks.list, { documentId: secret })).toBeNull();
    await expect(b.as.query(api.documents.children, { documentId: secret })).rejects.toThrow(/not_found/);
    await expect(b.as.mutation(api.documents.setStarred, { documentId: secret, starred: true })).rejects.toThrow(/not_found/);
    await expect(b.as.mutation(api.documents.moveToTrash, { documentId: secret })).rejects.toThrow(/not_found/);
    expect(await b.as.query(api.documents.titles, { documentIds: [secret] })).toEqual({});

    // B's lists, search, sidebar, tasks and sync are B's own Personal only.
    expect(await listIds(b)).not.toContain(secret);
    expect(await b.as.query(api.search.documents, { scope: PERSONAL, query: "zeppelin" })).toEqual([]);
    expect((await a.as.query(api.search.documents, { scope: PERSONAL, query: "zeppelin" })).map((h) => h.id)).toContain(secret);
    const sidebar = await b.as.query(api.organization.sidebar, { scope: PERSONAL });
    expect(sidebar.folders.map((f) => f.id)).not.toContain(folderId);
    expect(sidebar.tags.map((x) => x.id)).not.toContain(tagId);
    expect((await b.as.query(api.sync.pull, { scope: PERSONAL, cursor: 0, limit: 500 })).documents.map((d) => d.id)).not.toContain(secret);

    // A's folders and tags can't be used or changed by B either.
    await expect(b.as.mutation(api.organization.renameFolder, { folderId, name: "Mine now" })).rejects.toThrow(/Folder not found/);
    await expect(b.as.mutation(api.organization.deleteTag, { tagId })).rejects.toThrow(/Tag not found/);
    await expect(b.as.query(api.documents.list, { scope: PERSONAL, view: "folder", folderId, paginationOpts: { numItems: 5, cursor: null } })).rejects.toThrow(/Folder not found/);
    const [intoFolder] = await b.as.mutation(api.sync.push, {
      scope: PERSONAL,
      deviceId: "device-personal",
      ops: [{ opId: ulid(), kind: "document.create", document: { id: ulid(), parentDocumentId: null, folderId, kind: "document", title: "x", icon: null } }],
    });
    expect(intoFolder!.status).toBe("rejected");
    // Writing into it is refused per operation, as missing.
    const w = await write(b, secret, "intrusion");
    expect(w.error?.code).toBe("not_found");
  });

  test("a page grant makes a guest: the page and its nested pages, nothing else", async () => {
    const t = setup();
    const a = await person(t, "guest-owner@example.com");
    const b = await person(t, "guest-b@example.com");
    const parent = await create(a, "Trip plan");
    const child = await create(a, "Packing list", { parentDocumentId: parent });
    const sibling = await create(a, "Diary");
    await a.as.mutation(api.sharing.grant, { documentId: parent, email: "guest-b@example.com", role: "viewer" });

    // Viewer: reads the page and the page under it; can't write; the unrelated page stays hidden.
    expect(await b.as.query(api.documents.get, { documentId: parent })).toMatchObject({ access: "read", isMember: false });
    expect(await b.as.query(api.documents.get, { documentId: child })).toMatchObject({ access: "read" });
    expect(await b.as.query(api.documents.get, { documentId: sibling })).toBeNull();
    expect((await write(b, child, "nope")).error?.code).toBe("forbidden");
    // A guest never browses the owner's Personal: not in lists or search, only "shared with me".
    expect(await listIds(b)).not.toContain(parent);
    expect((await b.as.query(api.search.documents, { scope: PERSONAL, query: "Trip plan" })).map((h) => h.id)).not.toContain(parent);
    expect((await b.as.query(api.sharing.sharedWithMe, {})).map((d) => d.id)).toEqual([parent]);

    // Editor: writes the page and its nested page; still can't add pages to the owner's Personal.
    await a.as.mutation(api.sharing.grant, { documentId: parent, email: "guest-b@example.com", role: "editor" });
    expect((await write(b, child, "socks")).status).toBe("applied");
    const [nested] = await b.as.mutation(api.sync.push, {
      scope: PERSONAL,
      deviceId: "device-personal",
      ops: [{ opId: ulid(), kind: "document.create", document: { id: ulid(), parentDocumentId: parent, folderId: null, kind: "document", title: "Sub", icon: null } }],
    });
    expect(nested!.error?.code).toBe("forbidden");
    await expect(b.as.mutation(api.documents.duplicate, { documentId: parent })).rejects.toThrow(/not found/i);
    // Only the owner manages sharing.
    await expect(b.as.mutation(api.sharing.grant, { documentId: parent, email: "guest-owner@example.com", role: "viewer" })).rejects.toThrow(/forbidden|permission/);
    // Revoking ends it everywhere below.
    await a.as.mutation(api.sharing.revoke, { documentId: parent, profileId: b.profileId });
    expect(await b.as.query(api.documents.get, { documentId: child })).toBeNull();
  });

  test("a user with no workspaces uses Personal normally (26)", async () => {
    const t = setup();
    const a = await person(t, "solo@example.com");
    expect(await a.as.query(api.workspaces.mine, {})).toEqual([]);
    const doc = await a.as.mutation(api.documents.create, { scope: PERSONAL, title: "Plans" });
    expect(doc).toMatchObject({ workspaceId: null, ownerProfileId: a.profileId });
    const { id: folderId } = await a.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "Box" });
    await a.as.mutation(api.documents.move, { documentId: doc.id, folderId });
    const { id: tagId } = await a.as.mutation(api.organization.createTag, { scope: PERSONAL, name: "soon" });
    await a.as.mutation(api.organization.setDocumentTags, { documentId: doc.id, tagIds: [tagId] });
    expect((await a.as.query(api.documents.list, { scope: PERSONAL, view: "tag", tagId, paginationOpts: { numItems: 5, cursor: null } })).page.map((d) => d.id)).toEqual([doc.id]);
    await a.as.mutation(api.tasks.quickAdd, { scope: PERSONAL, title: "Book tickets", today: "2026-09-29" });
    expect((await a.as.query(api.tasks.counts, { scope: PERSONAL, today: "2026-09-29" })).mine).toBeGreaterThan(0);
    await a.as.mutation(api.documents.moveToTrash, { documentId: doc.id });
    expect((await a.as.query(api.documents.trashSummary, { scope: PERSONAL })).deletable).toBe(1);
    expect((await a.as.mutation(api.imports.importText, { scope: PERSONAL, filename: "n.md", content: "# Hi\n\nThere", format: "markdown" })).document.ownerProfileId).toBe(a.profileId);
    // A Personal page can't be created in a workspace scope named by someone who isn't in it.
    await expect(a.as.mutation(api.documents.create, { scope: inWorkspace(ulid()), title: "x" })).rejects.toThrow(/Workspace not found/);
  });

  test("Personal and workspace rows never mix in lists (switching scopes)", async () => {
    const t = setup();
    const a = await person(t, "mix@example.com");
    const { workspaceId, scope } = await teamWorkspace(a, "Studio");
    const mine = await create(a, "Personal only");
    const [teamDoc] = await a.as.mutation(api.sync.push, {
      scope,
      deviceId: "device-personal",
      ops: [{ opId: ulid(), kind: "document.create", document: { id: ulid(), parentDocumentId: null, folderId: null, kind: "document", title: "Team only", icon: null } }],
    });
    const teamIds = (await a.as.query(api.documents.list, { scope, view: "all", paginationOpts: { numItems: 200, cursor: null } })).page.map((d) => d.id);
    expect(teamIds).toEqual([teamDoc!.document!.id]);
    expect(await listIds(a)).toContain(mine);
    expect(await listIds(a)).not.toContain(teamDoc!.document!.id);
    expect((await a.as.query(api.search.documents, { scope, query: "Personal only" })).map((h) => h.id)).not.toContain(mine);
    // Each scope has its own change feed.
    const personalHead = (await a.as.query(api.sync.head, { scope: PERSONAL })).seq;
    const teamHead = (await a.as.query(api.sync.head, { scope: inWorkspace(workspaceId) })).seq;
    await write(a, mine, "only Personal advances");
    expect((await a.as.query(api.sync.head, { scope: PERSONAL })).seq).toBeGreaterThan(personalHead);
    expect((await a.as.query(api.sync.head, { scope: inWorkspace(workspaceId) })).seq).toBe(teamHead);
  });
});

describe("exports", () => {
  test("a Personal export holds everything in Personal (and nothing of anyone else's)", async () => {
    const t = setup();
    const a = await person(t, "exp-a@example.com");
    const b = await person(t, "exp-b@example.com");
    const theirs = await create(b, "Not yours");
    await b.as.mutation(api.sharing.grant, { documentId: theirs, email: "exp-a@example.com", role: "viewer" });
    const mine = await create(a, "Export me");
    const page = await t.query(internal.exports.documentPage, { profileId: a.profileId as Id<"profiles">, scope: { kind: "personal", profileId: a.profileId as Id<"profiles"> }, cursor: null });
    const ids = page.docs.map((d) => d.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
    expect(page.docs.find((d) => d.id === mine)?.title).toBe("Export me");
  });

  test("support can prepare someone's Personal export, delivered only to them", async () => {
    const t = setup();
    const admin = await person(t, "exp-admin@example.com");
    const a = await person(t, "exp-target@example.com");
    await t.mutation(internal.admin.bootstrapSuperAdmin, { email: "exp-admin@example.com" });
    await admin.as.mutation(api.adminBilling.requestUserExport, { profileId: a.profileId, reason: "Asked for their data by email" });
    const jobs = await t.run(async (ctx) => await ctx.db.system.query("_scheduled_functions").collect());
    const job = jobs.find((j) => j.name.includes("exportForUser"))!;
    expect(job.args[0]).toEqual({ profileId: a.profileId, scope: { kind: "personal", profileId: a.profileId } });
  });
});

describe("account deletion", () => {
  test("deleting an account deletes its Personal: pages, grants on them, public links, files, folders and tags", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const a = await person(t, "del-a@example.com");
      const b = await person(t, "del-b@example.com");
      const shared = await create(a, "Shared with B");
      await a.as.mutation(api.sharing.grant, { documentId: shared, email: "del-b@example.com", role: "editor" });
      await a.as.mutation(api.sharing.createPublicLink, { documentId: shared });
      await a.as.mutation(api.comments.create, { documentId: shared, body: [{ type: "text", text: "hello" }] });
      const bOwn = await create(b, "B keeps this");
      // A had access to one of B's pages too; that grant goes, B's page stays.
      await b.as.mutation(api.sharing.grant, { documentId: bOwn, email: "del-a@example.com", role: "viewer" });

      await a.as.mutation(api.users.requestAccountDeletion, { confirmEmail: "del-a@example.com" });
      await t.run(async (ctx) => {
        for (const job of await ctx.db.query("deletionJobs").collect()) await ctx.db.patch(job._id, { scheduledFor: Date.now() - 1 });
      });
      for (let i = 0; i < 30; i++) await t.mutation(internal.maintenance.runDeletionJobs, {});
      await t.run(async (ctx) => {
        const owner = a.profileId as Id<"profiles">;
        for (const table of ["documents", "blocks", "folders", "tags", "documentTags", "documentPermissions", "publicLinks", "commentThreads", "comments", "collections", "tasks", "files", "recents"] as const) {
          const left = (await ctx.db.query(table).collect()).filter((r) => (r as { ownerProfileId?: Id<"profiles"> }).ownerProfileId === owner);
          expect(left, table).toEqual([]);
        }
        expect((await ctx.db.query("documentPermissions").collect()).filter((g) => g.profileId === owner)).toEqual([]);
        expect((await ctx.db.get(owner))?.status).toBe("deleted");
      });
      expect(await b.as.query(api.documents.get, { documentId: shared })).toBeNull();
      expect(await b.as.query(api.sharing.sharedWithMe, {})).toEqual([]);
      expect(await b.as.query(api.documents.get, { documentId: bOwn })).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
