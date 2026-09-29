// The account-model migration (convex/migrations.ts, phase B): personal workspaces become Personal.
// Legacy data is made the way it existed before: a real Personal is turned back into a workspace of kind
// "personal" (rows keyed by workspaceId, counters on the workspace, members), then migrated.
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { SCOPED_TABLES } from "../../convex/lib/scope";
import { para, person, PERSONAL, setup, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;
const GB = 1024 ** 3;

async function create(p: Person, title: string, extra: Record<string, unknown> = {}) {
  const id = ulid();
  const [r] = await p.as.mutation(api.sync.push, {
    scope: PERSONAL,
    deviceId: "device-migration",
    ops: [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null, ...extra } as never }],
  });
  expect(r!.status).toBe("applied");
  return id;
}

async function write(p: Person, documentId: string, text: string) {
  const [r] = await p.as.mutation(api.sync.push, {
    scope: PERSONAL,
    deviceId: "device-migration",
    ops: [{ opId: ulid(), kind: "block.upsert", documentId, block: para(ulid(), text), baseRevision: null, fields: ["content", "position"] }],
  });
  return r!;
}

const docRow = (t: T, publicId: string) =>
  t.run(async (ctx) =>
    (await ctx.db
      .query("documents")
      .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
      .unique())!,
  );

/**
 * Turns `owner`'s Personal into a pre-migration personal workspace: every Personal row gets the
 * workspace's id instead of an owner, the counters move onto the workspace, and the owner (plus any
 * `members`) get membership rows. Returns the workspace's id.
 */
async function toLegacy(t: T, owner: Person, members: [Person, Doc<"workspaceMembers">["role"]][], extra: { quotaBytes?: number } = {}): Promise<Id<"workspaces">> {
  return await t.run(async (ctx) => {
    const ownerId = owner.profileId as Id<"profiles">;
    const profile = (await ctx.db.get(ownerId))!;
    const now = Date.now();
    const workspaceId = await ctx.db.insert("workspaces", {
      publicId: ulid(),
      name: "Personal",
      kind: "personal",
      ownerId,
      changeSeq: profile.personalChangeSeq ?? 0,
      status: "active",
      storageUsedBytes: profile.personalStorageUsedBytes ?? 0,
      storageQuotaBytes: extra.quotaBytes ?? 5 * GB,
      memberLimit: 10,
      documentCount: profile.personalDocumentCount ?? 0,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("workspaceMembers", { workspaceId, profileId: ownerId, role: "owner", joinedAt: now });
    for (const [m, role] of members) await ctx.db.insert("workspaceMembers", { workspaceId, profileId: m.profileId as Id<"profiles">, role, joinedAt: now });
    for (const table of SCOPED_TABLES) {
      for (const row of await ctx.db.query(table).collect()) {
        if ((row as { ownerProfileId?: Id<"profiles"> }).ownerProfileId !== ownerId) continue;
        await ctx.db.patch(row._id as Id<"folders">, { ownerProfileId: undefined, workspaceId });
      }
    }
    await ctx.db.patch(ownerId, { personalChangeSeq: undefined, personalStorageUsedBytes: undefined, personalDocumentCount: undefined, defaultWorkspaceId: workspaceId });
    return workspaceId;
  });
}

/** Everything that belongs to a scope field value, per table (for before/after comparisons). */
async function rowsByTable(t: T, field: "workspaceId" | "ownerProfileId", value: string) {
  return await t.run(async (ctx) => {
    const out: Record<string, string[]> = {};
    for (const table of SCOPED_TABLES) {
      out[table] = (await ctx.db.query(table).collect()).filter((r) => (r as Record<string, unknown>)[field] === value).map((r) => r._id as string).sort();
    }
    return out;
  });
}

async function migrate(t: T) {
  await t.mutation(internal.migrations.migratePersonalWorkspaces, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function guestGrants(t: T, who: Person) {
  return await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("documentPermissions")
      .withIndex("by_profile", (q) => q.eq("profileId", who.profileId as Id<"profiles">))
      .collect();
    const out: Record<string, string> = {};
    for (const g of rows) out[(await ctx.db.get(g.documentId))!.publicId] = g.role;
    return out;
  });
}

describe("migrating personal workspaces to Personal", () => {
  test("rows, counters, order and collaborators move; the workspace goes; running it again changes nothing", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const a = await person(t, "mig-owner@example.com");
      const editor = await person(t, "mig-editor@example.com");
      const viewer = await person(t, "mig-viewer@example.com");
      const outsider = await person(t, "mig-outsider@example.com");

      // Content of every kind in A's Personal: pages, nested and restricted pages, blocks, a folder, tags,
      // tasks, a comment, a star, a recent, a version, a public link, a file and an explicit grant.
      const plan = await create(a, "Garden plan");
      await write(a, plan, "Tomatoes by the fence");
      const child = await create(a, "Seed list", { parentDocumentId: plan });
      const locked = await create(a, "Private diary");
      await a.as.mutation(api.sharing.setAccessMode, { documentId: locked, mode: "restricted" });
      const mixed = await create(a, "Budget");
      const mixedSecret = await create(a, "Salaries", { parentDocumentId: mixed });
      await a.as.mutation(api.sharing.setAccessMode, { documentId: mixedSecret, mode: "restricted" });
      const byEditor = await create(a, "Editor's own page");
      await a.as.mutation(api.sharing.setAccessMode, { documentId: byEditor, mode: "restricted" });
      await t.run(async (ctx) => {
        const d = (await ctx.db
          .query("documents")
          .withIndex("by_public_id", (q) => q.eq("publicId", byEditor))
          .unique())!;
        await ctx.db.patch(d._id, { createdBy: editor.profileId as Id<"profiles"> });
      });
      const { id: folderId } = await a.as.mutation(api.organization.createFolder, { scope: PERSONAL, name: "Outdoors" });
      await a.as.mutation(api.documents.move, { documentId: plan, folderId });
      const { id: tagId } = await a.as.mutation(api.organization.createTag, { scope: PERSONAL, name: "summer" });
      await a.as.mutation(api.organization.setDocumentTags, { documentId: plan, tagIds: [tagId] });
      await a.as.mutation(api.tasks.quickAdd, { scope: PERSONAL, title: "Buy compost", today: "2026-09-29", documentId: plan });
      await a.as.mutation(api.comments.create, { documentId: plan, body: [{ type: "text", text: "Looks good" }] });
      await a.as.mutation(api.documents.setStarred, { documentId: plan, starred: true });
      await a.as.mutation(api.documents.recordView, { documentId: plan });
      await a.as.mutation(api.documents.createSnapshot, { documentId: plan, reason: "manual" });
      await a.as.mutation(api.sharing.createPublicLink, { documentId: plan });
      // The viewer could already comment on the diary (an explicit grant on a restricted page).
      await a.as.mutation(api.sharing.grant, { documentId: locked, email: "mig-viewer@example.com", role: "commenter" });
      await t.run(async (ctx) => {
        const storageId = await ctx.storage.store(new Blob(["png"], { type: "image/png" }));
        const d = (await ctx.db
          .query("documents")
          .withIndex("by_public_id", (q) => q.eq("publicId", plan))
          .unique())!;
        await ctx.db.insert("files", {
          publicId: ulid(), storageId, ownerProfileId: a.profileId as Id<"profiles">, documentId: d._id, uploadedBy: a.profileId as Id<"profiles">,
          filename: "p.png", mimeType: "image/png", size: 3 * 1024 * 1024, sha256: "", kind: "image", status: "ready", createdAt: Date.now(),
        });
        await ctx.db.patch(a.profileId as Id<"profiles">, { personalStorageUsedBytes: 3 * 1024 * 1024 });
      });

      const seqBefore = new Map((await t.run(async (ctx) => await ctx.db.query("documents").collect())).map((d) => [d.publicId, d.seq]));
      const blockSeqBefore = new Map((await t.run(async (ctx) => await ctx.db.query("blocks").collect())).map((b) => [b.blockId, b.seq]));
      const headBefore = (await a.as.query(api.sync.head, { scope: PERSONAL })).seq;

      // Back to the old model: a personal workspace with an editor and a viewer collaborator, a 3 GB
      // admin quota, a pending invitation (with its notification) and a notification tied to it.
      const ws = await toLegacy(t, a, [
        [editor, "editor"],
        [viewer, "viewer"],
      ], { quotaBytes: 3 * GB });
      await t.run(async (ctx) => {
        const now = Date.now();
        const inviteId = await ctx.db.insert("workspaceInvites", { publicId: ulid(), workspaceId: ws, email: "later@example.com", role: "viewer", tokenHash: "x", invitedBy: a.profileId as Id<"profiles">, status: "pending", expiresAt: now + 1e6, createdAt: now });
        await ctx.db.insert("notifications", { profileId: outsider.profileId as Id<"profiles">, workspaceId: ws, kind: "invite", inviteId, title: "Invited", createdAt: now });
        await ctx.db.insert("notifications", { profileId: editor.profileId as Id<"profiles">, workspaceId: ws, kind: "system", title: "Reminder", createdAt: now });
        await ctx.db.insert("aiUsage", { profileId: a.profileId as Id<"profiles">, day: "2026-09-01", count: 4, scope: "personal", workspaceId: ws });
      });
      const legacyRows = await rowsByTable(t, "workspaceId", ws);
      expect(legacyRows.documents!.length).toBeGreaterThan(8);
      expect(legacyRows.files).toHaveLength(1);

      const before = await t.action(internal.migrations.verifyAccountModel, {});
      expect(before.ok).toBe(false);
      expect(before).toMatchObject({ personalWorkspaces: 1, profilesWithDefaultWorkspace: 1 });
      expect(before.rowsInLegacyWorkspaces).toBeGreaterThan(0);

      await migrate(t);

      // Nothing of the old model is left, and every row is where it should be.
      const after = await t.action(internal.migrations.verifyAccountModel, {});
      expect(after).toMatchObject({ ok: true, rowsWithBothScopes: 0, rowsWithNoScope: 0, rowsInLegacyWorkspaces: 0, rowsOutOfTheirDocumentsScope: 0, orphanedGrants: 0, personalWorkspaces: 0, profilesWithDefaultWorkspace: 0 });
      const moved = await rowsByTable(t, "ownerProfileId", a.profileId);
      for (const table of SCOPED_TABLES) {
        // The same rows, now in A's Personal (grants: plus the new guest grants).
        if (table === "documentPermissions") expect(moved[table]).toEqual(expect.arrayContaining(legacyRows[table]!));
        else expect(moved[table], table).toEqual(legacyRows[table]);
      }
      await t.run(async (ctx) => {
        expect(await ctx.db.get(ws)).toBeNull();
        expect((await ctx.db.query("workspaceMembers").collect()).filter((m) => m.workspaceId === ws)).toEqual([]);
        expect((await ctx.db.query("workspaceInvites").collect()).filter((i) => i.workspaceId === ws)).toEqual([]);
        const notes = await ctx.db.query("notifications").collect();
        expect(notes.find((n) => n.kind === "invite" && n.title === "Invited")).toBeUndefined();
        expect(notes.find((n) => n.title === "Reminder")!.workspaceId).toBeUndefined();
        const usage = (await ctx.db.query("aiUsage").collect()).find((u) => u.day === "2026-09-01")!;
        expect(usage).toMatchObject({ scope: "personal", count: 4 });
        expect(usage.workspaceId).toBeUndefined();
        const profile = (await ctx.db.get(a.profileId as Id<"profiles">))!;
        expect(profile.defaultWorkspaceId).toBeUndefined();
        expect(profile.personalChangeSeq).toBe(headBefore);
        expect(profile.personalStorageUsedBytes).toBe(3 * 1024 * 1024);
        expect(profile.personalDocumentCount).toBe(legacyRows.documents!.length);
        // The admin quota on the old workspace became A's own override.
        const sub = (await ctx.db.query("subscriptions").collect()).find((s) => s.profileId === a.profileId)!;
        expect(sub.storageOverrideBytes).toBe(3 * GB);
        // Change order is kept: every row has the seq it had.
        for (const d of await ctx.db.query("documents").collect()) if (seqBefore.has(d.publicId)) expect(d.seq).toBe(seqBefore.get(d.publicId));
        for (const b of await ctx.db.query("blocks").collect()) if (blockSeqBefore.has(b.blockId)) expect(b.seq).toBe(blockSeqBefore.get(b.blockId));
      });

      // The owner works on in Personal: everything is there, the feed continues after the old head.
      const ids = (await a.as.query(api.documents.list, { scope: PERSONAL, view: "all", paginationOpts: { numItems: 200, cursor: null } })).page.map((d) => d.id);
      expect(ids).toEqual(expect.arrayContaining([plan, locked, mixed, byEditor]));
      expect(await a.as.query(api.workspaces.mine, {})).toEqual([]);
      expect((await a.as.query(api.sync.head, { scope: PERSONAL })).seq).toBe(headBefore);
      const edit = await write(a, plan, "Beans too");
      expect(edit.status).toBe("applied");
      const pulled = await a.as.query(api.sync.pull, { scope: PERSONAL, cursor: headBefore });
      expect(pulled.blocks.map((b) => b.block.id)).toContain(edit.block!.id);
      expect(pulled.head).toBeGreaterThan(headBefore);
      expect((await a.as.query(api.billing.mine, {})).storageLimitBytes).toBe(3 * GB);

      // Collaborators became guests on what they could open, never on more.
      const editorGrants = await guestGrants(t, editor);
      expect(editorGrants[plan]).toBe("editor"); // a normal page (its nested page comes with it)
      expect(editorGrants[byEditor]).toBe("editor"); // a restricted page they had created
      expect(editorGrants[locked]).toBeUndefined(); // restricted, not theirs
      expect(editorGrants[mixed]).toBeUndefined(); // it holds a page they couldn't open
      expect(await editor.as.query(api.documents.get, { documentId: child })).toMatchObject({ access: "write", isMember: false });
      expect(await editor.as.query(api.documents.get, { documentId: locked })).toBeNull();
      expect(await editor.as.query(api.documents.get, { documentId: mixedSecret })).toBeNull();
      const viewerGrants = await guestGrants(t, viewer);
      expect(viewerGrants[plan]).toBe("viewer");
      expect(viewerGrants[locked]).toBe("commenter"); // kept as it was
      expect(viewerGrants[byEditor]).toBeUndefined();
      expect(await viewer.as.query(api.documents.get, { documentId: plan })).toMatchObject({ access: "read" });
      expect((await write(viewer, plan, "nope")).error?.code).toBe("forbidden");
      // Guests don't browse A's Personal, and the outsider never had anything.
      expect(await editor.as.query(api.workspaces.mine, {})).toEqual([]);
      expect(await outsider.as.query(api.documents.get, { documentId: plan })).toBeNull();
      expect(Object.keys(await guestGrants(t, outsider))).toEqual([]);

      // Running it again (from the start, or any step of the finished workspace) changes nothing.
      const snapshot = async () =>
        await t.run(async (ctx) => ({
          grants: (await ctx.db.query("documentPermissions").collect()).map((g) => `${g.documentId}:${g.profileId}:${g.role}`).sort(),
          profile: await ctx.db.get(a.profileId as Id<"profiles">),
          docs: (await ctx.db.query("documents").collect()).map((d) => `${d._id}:${d.ownerProfileId}:${d.workspaceId}:${d.seq}`).sort(),
        }));
      const once = await snapshot();
      await migrate(t);
      await t.mutation(internal.migrations.migratePersonalWorkspace, { workspaceId: ws, phase: "finish", member: 0, cursor: null });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await snapshot()).toEqual(once);
      expect((await t.action(internal.migrations.verifyAccountModel, {})).ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("steps are idempotent even when run twice mid-way, and team workspaces are left alone", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const a = await person(t, "mig2-owner@example.com");
      const c = await person(t, "mig2-collab@example.com");
      const b = await person(t, "mig2-other@example.com");
      const page = await create(a, "Shared notes");
      const bPage = await create(b, "B's own");
      const { id: teamId } = await a.as.mutation(api.workspaces.createTeamWorkspace, { name: "Real team" });
      const [teamDoc] = await a.as.mutation(api.sync.push, {
        scope: { kind: "workspace", workspaceId: teamId },
        deviceId: "device-migration",
        ops: [{ opId: ulid(), kind: "document.create", document: { id: ulid(), parentDocumentId: null, folderId: null, kind: "document", title: "Team doc", icon: null } }],
      });
      const wsA = await toLegacy(t, a, [[c, "commenter"]]);
      const wsB = await toLegacy(t, b, []);

      // Two chains racing over the same workspace, each repeating the grants step.
      await t.mutation(internal.migrations.migratePersonalWorkspace, { workspaceId: wsA, phase: "grants", member: 0, cursor: null });
      await t.mutation(internal.migrations.migratePersonalWorkspace, { workspaceId: wsA, phase: "grants", member: 0, cursor: null });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      await migrate(t);

      const report = await t.action(internal.migrations.verifyAccountModel, {});
      expect(report.ok).toBe(true);
      expect((await guestGrants(t, c))[page]).toBe("commenter");
      // Exactly one grant per page for the collaborator, whatever ran twice.
      await t.run(async (ctx) => {
        const rows = (await ctx.db.query("documentPermissions").collect()).filter((g) => g.profileId === c.profileId);
        expect(new Set(rows.map((g) => g.documentId)).size).toBe(rows.length);
        expect(await ctx.db.get(wsB)).toBeNull();
      });
      expect(await b.as.query(api.documents.get, { documentId: bPage })).toMatchObject({ document: { ownerProfileId: b.profileId, workspaceId: null } });
      // The team workspace and its page are untouched.
      expect((await a.as.query(api.workspaces.mine, {})).map((w) => w.id)).toEqual([teamId]);
      expect((await docRow(t, teamDoc!.document!.id)).workspaceId).toBeDefined();
      expect(await c.as.query(api.documents.get, { documentId: page })).toMatchObject({ access: "comment" });
    } finally {
      vi.useRealTimers();
    }
  });

  test("the verification finds rows with both or neither owner field, and orphaned grants", async () => {
    const t = setup();
    const a = await person(t, "verify@example.com");
    const page = await create(a, "Checked");
    expect((await t.action(internal.migrations.verifyAccountModel, {})).ok).toBe(true);
    const d = await docRow(t, page);
    const { id: teamId } = await a.as.mutation(api.workspaces.createTeamWorkspace, { name: "T" });
    await t.run(async (ctx) => {
      const team = (await ctx.db.query("workspaces").collect()).find((w) => w.publicId === teamId)!;
      const tag = (await ctx.db.query("tags").collect())[0]!;
      await ctx.db.patch(tag._id, { workspaceId: team._id }); // both
      const folder = (await ctx.db.query("folders").collect())[0]!;
      await ctx.db.patch(folder._id, { ownerProfileId: undefined }); // neither
      const block = (await ctx.db.query("blocks").collect())[0]!;
      await ctx.db.patch(block._id, { ownerProfileId: undefined, workspaceId: team._id }); // out of its document's scope
      const other = (await ctx.db.query("documents").collect()).find((x) => x._id !== d._id && x._id !== block.documentId && !x.parentDocumentId)!;
      const grant = await ctx.db.insert("documentPermissions", { documentId: other._id, ownerProfileId: a.profileId as Id<"profiles">, profileId: a.profileId as Id<"profiles">, role: "viewer", grantedBy: a.profileId as Id<"profiles">, createdAt: Date.now() });
      await ctx.db.delete(other._id);
      void grant;
    });
    const report = await t.action(internal.migrations.verifyAccountModel, {});
    expect(report.ok).toBe(false);
    expect(report.rowsWithBothScopes).toBe(1);
    expect(report.rowsWithNoScope).toBe(1);
    expect(report.orphanedGrants).toBe(1);
    expect(report.rowsOutOfTheirDocumentsScope).toBeGreaterThanOrEqual(1);
    expect(report.tables.tags!.both).toBe(1);
    expect(report.tables.folders!.neither).toBe(1);
  });
});
