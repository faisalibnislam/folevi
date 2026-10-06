// Narrow reads for always-mounted queries and lists (counts, folders, lists, collections, comments) and
// background jobs that can't be held up by rows they skip. Each list or count is checked against what
// the slower, row-by-row way gives.
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { accessAtLeast, documentAccess, PageAudience } from "../../convex/lib/auth";
import { inWorkspace, join, person, setup, teamWorkspace, type ScopeArg, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

const TODAY = "2026-10-06";

afterEach(() => {
  vi.useRealTimers();
});

async function page(p: Person, scope: ScopeArg, title: string, extra: { folderId?: string; parentDocumentId?: string; kind?: "template" } = {}) {
  return (await p.as.mutation(api.documents.create, { scope, title, ...extra })).id;
}

async function workspaceRow(t: T, publicId: string) {
  return await t.run(async (ctx) => (await ctx.db.query("workspaces").withIndex("by_public_id", (q) => q.eq("publicId", publicId)).unique())!);
}

async function docRow(t: T, publicId: string) {
  return await t.run(async (ctx) => (await ctx.db.query("documents").withIndex("by_public_id", (q) => q.eq("publicId", publicId)).unique())!);
}

/** Every page of a documents.list view (following its cursor to the end). */
async function listAll(p: Person, args: Omit<Parameters<typeof api.documents.list>[0] extends never ? never : Record<string, unknown>, "paginationOpts">, numItems = 2) {
  const out: { id: string; title: string; starred: boolean; tags: { id: string }[] }[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 100; i++) {
    const r = await p.as.query(api.documents.list, { ...(args as never), paginationOpts: { numItems, cursor } });
    out.push(...r.page);
    if (r.isDone) return out;
    cursor = r.continueCursor;
  }
  throw new Error("the list never ended");
}

/**
 * A team with an owner and an editing member, folders (one nested), pages in and out of folders (one
 * restricted to the owner, one nested, one archived, one trashed, a template), tags and starred pages.
 */
async function world(t: T) {
  const owner = await person(t, "reads-owner@example.com");
  const member = await person(t, "reads-member@example.com");
  const { workspaceId, scope } = await teamWorkspace(owner, "Reads");
  await join(t, owner, member, "reads-member@example.com", workspaceId, "editor");
  const f1 = (await owner.as.mutation(api.organization.createFolder, { scope, name: "Projects" })).id;
  const f2 = (await owner.as.mutation(api.organization.createFolder, { scope, name: "Empty" })).id;
  const f3 = (await owner.as.mutation(api.organization.createFolder, { scope, name: "Sub", parentFolderId: f1 })).id;
  const inF1 = await page(owner, scope, "In projects", { folderId: f1 });
  const secretInF1 = await page(owner, scope, "Secret project", { folderId: f1 });
  await owner.as.mutation(api.sharing.setAccessMode, { documentId: secretInF1, mode: "restricted" });
  const archivedInF1 = await page(owner, scope, "Old project", { folderId: f1 });
  await owner.as.mutation(api.documents.setArchived, { documentId: archivedInF1, archived: true });
  const trashedInF1 = await page(owner, scope, "Binned project", { folderId: f1 });
  await owner.as.mutation(api.documents.moveToTrash, { documentId: trashedInF1 });
  const inF3 = await page(member, scope, "Sub note", { folderId: f3 });
  const draftA = await page(owner, scope, "alpha draft");
  const draftB = await page(member, scope, "Beta draft");
  const secretDraft = await page(owner, scope, "Secret draft");
  await owner.as.mutation(api.sharing.setAccessMode, { documentId: secretDraft, mode: "restricted" });
  const nested = await page(owner, scope, "Nested", { parentDocumentId: draftA });
  const archivedDraft = await page(owner, scope, "Shelved draft");
  await owner.as.mutation(api.documents.setArchived, { documentId: archivedDraft, archived: true });
  const trashedDraft = await page(owner, scope, "Binned draft");
  await owner.as.mutation(api.documents.moveToTrash, { documentId: trashedDraft });
  const templateA = await page(owner, scope, "Meeting template", { kind: "template" });
  const templateB = await page(member, scope, "agenda template", { kind: "template" });
  const tagX = (await owner.as.mutation(api.organization.createTag, { scope, name: "x" })).id;
  const tagY = (await owner.as.mutation(api.organization.createTag, { scope, name: "y" })).id;
  await owner.as.mutation(api.organization.setDocumentTags, { documentId: draftA, tagIds: [tagX, tagY] });
  await owner.as.mutation(api.organization.setDocumentTags, { documentId: draftB, tagIds: [tagY] });
  await owner.as.mutation(api.organization.setDocumentTags, { documentId: secretDraft, tagIds: [tagY] });
  for (const p of [owner, member]) for (const d of [draftA, inF1, inF3]) await p.as.mutation(api.documents.setStarred, { documentId: d, starred: true });
  return { owner, member, workspaceId, scope, f1, f2, f3, inF1, secretInF1, inF3, draftA, draftB, secretDraft, nested, archivedDraft, archivedInF1, templateA, templateB, tagX, tagY };
}

describe("counts and folders read only what they show", () => {
  test("draftCount matches the Drafts list for the owner, a member and in Personal", async () => {
    const t = setup();
    const w = await world(t);
    for (const p of [w.owner, w.member]) {
      const drafts = await listAll(p, { scope: w.scope, view: "unsorted" });
      expect(await p.as.query(api.organization.draftCount, { scope: w.scope })).toBe(drafts.length);
    }
    // The member can't open the owner's restricted draft.
    expect(await w.member.as.query(api.organization.draftCount, { scope: w.scope })).toBe((await w.owner.as.query(api.organization.draftCount, { scope: w.scope })) - 1);
    const personal = await listAll(w.owner, { scope: w.owner.scope, view: "unsorted" }, 50);
    expect(await w.owner.as.query(api.organization.draftCount, { scope: w.owner.scope })).toBe(personal.length);
  });

  test("folder counts and previews match each folder's list; Home's recent folders are the same rows", async () => {
    const t = setup();
    const w = await world(t);
    for (const p of [w.owner, w.member]) {
      const all = await p.as.query(api.organization.index, { scope: w.scope });
      expect(all.folders.map((f) => f.name).sort()).toEqual(["Empty", "Projects", "Sub"]);
      for (const f of all.folders) {
        const docs = await listAll(p, { scope: w.scope, view: "folder", folderId: f.id, sort: "updated" });
        expect(f.documentCount).toBe(docs.length);
        expect(f.previews.map((x) => x.title)).toEqual(docs.slice(0, 3).map((d) => d.title));
      }
      const projects = all.folders.find((f) => f.name === "Projects")!;
      expect(projects.documentCount).toBe(p === w.owner ? 2 : 1);

      // Each half on its own is the same as in the full answer.
      const folders = await p.as.query(api.organization.index, { scope: w.scope, only: "folders" });
      const tags = await p.as.query(api.organization.index, { scope: w.scope, only: "tags" });
      expect(folders).toEqual({ folders: all.folders, tags: [] });
      expect(tags).toEqual({ folders: [], tags: all.tags });

      // Home: the most recently changed folders first, exactly as the full rows (plus the parent's name).
      const names = new Map(all.folders.map((f) => [f.id, f.name]));
      const expected = [...all.folders].sort((a, b) => b.updatedAt - a.updatedAt);
      for (const limit of [1, 2, 12]) {
        const recent = await p.as.query(api.organization.recentFolders, { scope: w.scope, limit });
        expect(recent.total).toBe(all.folders.length);
        expect(recent.folders).toEqual(expected.slice(0, limit).map((f) => ({ ...f, parentName: f.parentFolderId ? names.get(f.parentFolderId)! : null })));
      }
    }
  });

  test("tag counts: everything for whoever opens every page; only what a member can open when a page is restricted", async () => {
    const t = setup();
    const w = await world(t);
    const count = async (p: Person) => Object.fromEntries((await p.as.query(api.organization.index, { scope: w.scope, only: "tags" })).tags.map((x) => [x.name, x.documentCount]));
    expect(await count(w.owner)).toEqual({ x: 1, y: 3 });
    expect(await count(w.member)).toEqual({ x: 1, y: 2 });
    // Without any restricted page in the workspace, the member's numbers are the owner's.
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: w.secretDraft, mode: "workspace" });
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: w.secretInF1, mode: "workspace" });
    expect(await count(w.member)).toEqual({ x: 1, y: 3 });
  });

  test("task counts match the task lists, with and without restricted pages", async () => {
    const t = setup();
    const w = await world(t);
    const add = async (documentId: string, title: string, dueDate?: string) => (await w.owner.as.mutation(api.tasks.quickAdd, { scope: w.scope, title, today: TODAY, documentId, dueDate })).blockId;
    await add(w.draftA, "inbox one");
    await add(w.draftB, "due today", TODAY);
    await add(w.inF1, "due later", "2026-12-01");
    await add(w.secretDraft, "secret overdue", "2026-10-01");
    const mine = await add(w.secretInF1, "secret mine");
    await w.owner.as.mutation(api.tasks.update, { blockId: mine, assigneeId: w.member.profileId });
    const assigned = await add(w.inF3, "assigned to member");
    await w.owner.as.mutation(api.tasks.update, { blockId: assigned, assigneeId: w.member.profileId });
    await add(w.archivedDraft, "on an archived page");
    const binned = await page(w.owner, w.scope, "Binned with a task");
    await add(binned, "in trash");
    await w.owner.as.mutation(api.documents.moveToTrash, { documentId: binned });

    const check = async (p: Person, scope: ScopeArg) => {
      const counts = await p.as.query(api.tasks.counts, { scope, today: TODAY });
      for (const view of ["inbox", "today", "upcoming", "all", "mine"] as const) {
        expect([view, counts[view]]).toEqual([view, (await p.as.query(api.tasks.list, { scope, view, today: TODAY })).length]);
      }
      return counts;
    };
    const ownerCounts = await check(w.owner, w.scope);
    const memberCounts = await check(w.member, w.scope);
    expect(ownerCounts.all).toBe(7);
    expect(memberCounts.all).toBe(5);
    // The member was given a task on a page they can't open: it isn't theirs to count.
    expect(memberCounts.mine).toBe(1);
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: w.secretDraft, mode: "workspace" });
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: w.secretInF1, mode: "workspace" });
    expect((await check(w.member, w.scope)).all).toBe(7);
    await check(w.owner, w.owner.scope);
  });
});

describe("document lists", () => {
  test("templates and the Archive come out as walking the scope's sort index did", async () => {
    const t = setup();
    const w = await world(t);
    const ws = await workspaceRow(t, w.workspaceId);
    // Times far enough apart to sort the same way whichever field is used.
    await page(w.owner, w.scope, "Zebra template", { kind: "template" });
    const restrictedTemplate = await page(w.owner, w.scope, "Owner template", { kind: "template" });
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: restrictedTemplate, mode: "restricted" });
    const archivedSecret = await page(w.owner, w.scope, "archived secret");
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: archivedSecret, mode: "restricted" });
    await w.owner.as.mutation(api.documents.setArchived, { documentId: archivedSecret, archived: true });
    const archivedChild = await page(w.owner, w.scope, "Archived child", { parentDocumentId: w.draftB });
    await w.owner.as.mutation(api.documents.setArchived, { documentId: archivedChild, archived: true });

    const indexes = {
      updated: { index: "by_workspace_trash", order: "desc" },
      created: { index: "by_workspace_trash_created", order: "desc" },
      title: { index: "by_workspace_trash_title", order: "asc" },
      manual: { index: "by_workspace_trash_rank", order: "asc" },
    } as const;
    for (const p of [w.owner, w.member]) {
      for (const sort of ["updated", "created", "title", "manual"] as const) {
        const walked = await t.run(async (ctx) => {
          const profile = (await ctx.db.get(p.profileId as Id<"profiles">))!;
          const { index, order } = indexes[sort];
          const rows = (await ctx.db
            .query("documents")
            .withIndex(index as "by_workspace_trash", (q) => q.eq("workspaceId", ws._id).eq("inTrash", false))
            .order(order)
            .collect()) as Doc<"documents">[];
          const out: Record<"templates" | "archive", string[]> = { templates: [], archive: [] };
          for (const d of rows) {
            if (!accessAtLeast(await documentAccess(ctx, profile, d), "read")) continue;
            if (d.kind === "template") out.templates.push(d.publicId);
            if (d.archivedAt !== undefined && d.parentDocumentId === undefined) out.archive.push(d.publicId);
          }
          return out;
        });
        for (const view of ["templates", "archive"] as const) {
          // Paged (index order across pages) and in one page (titles then ordered case-insensitively).
          expect((await listAll(p, { scope: w.scope, view, sort }, 2)).map((d) => d.id)).toEqual(walked[view]);
          const whole = (await listAll(p, { scope: w.scope, view, sort }, 100)).map((d) => d.id);
          if (sort !== "title") expect(whole).toEqual(walked[view]);
          else expect(new Set(whole)).toEqual(new Set(walked[view]));
        }
      }
      const templates = await listAll(p, { scope: w.scope, view: "templates", sort: "title" }, 100);
      expect(templates.map((d) => d.title)).toEqual(
        p === w.owner ? ["agenda template", "Meeting template", "Owner template", "Zebra template"] : ["agenda template", "Meeting template", "Zebra template"],
      );
    }
  });

  test("stars and tags on list pages are the ones each page has on its own", async () => {
    const t = setup();
    const w = await world(t);
    for (const p of [w.owner, w.member]) {
      for (const args of [
        { view: "all" },
        { view: "starred" },
        { view: "unsorted" },
        { view: "folder", folderId: w.f1 },
        { view: "tag", tagId: w.tagY },
        { view: "archive" },
        { view: "templates" },
      ]) {
        const rows = await listAll(p, { scope: w.scope, sort: "updated", ...args }, 3);
        for (const row of rows) {
          const single = await p.as.query(api.documents.get, { documentId: row.id });
          expect({ id: row.id, starred: row.starred, tags: row.tags }).toEqual({ id: row.id, starred: single!.document.starred, tags: single!.document.tags });
        }
      }
      const all = await listAll(p, { scope: w.scope, view: "all" }, 50);
      expect(all.filter((d) => d.starred).map((d) => d.title).sort()).toEqual(["In projects", "Sub note", "alpha draft"]);
      expect(all.find((d) => d.id === w.draftA)!.tags.map((x) => x.id).sort()).toEqual([w.tagX, w.tagY].sort());
      const recent = await p.as.query(api.documents.recentNotes, { scope: w.scope, limit: 10 });
      expect(recent.find((d) => d.id === w.draftA)?.starred).toBe(true);
    }
  });

  test("nested pages: a member and a guest see exactly the ones they can open", async () => {
    const t = setup();
    const w = await world(t);
    const guest = await person(t, "reads-guest@example.com");
    const kidA = await page(w.owner, w.scope, "Kid A", { parentDocumentId: w.draftB });
    const kidB = await page(w.owner, w.scope, "Kid B", { parentDocumentId: w.draftB });
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: kidB, mode: "restricted" });
    await w.owner.as.mutation(api.sharing.grant, { documentId: w.draftB, email: "reads-guest@example.com", role: "viewer" });
    const ids = async (p: Person) => (await p.as.query(api.documents.children, { documentId: w.draftB })).map((d) => d.id).sort();
    expect(await ids(w.owner)).toEqual([kidA, kidB].sort());
    expect(await ids(w.member)).toEqual([kidA]);
    // The guest's grant on the parent reaches the restricted page under it too.
    expect(await ids(guest)).toEqual([kidA, kidB].sort());
  });
});

describe("collections and comments", () => {
  test("a collection's rows and values; a restricted row stays hidden from a member", async () => {
    const t = setup();
    const w = await world(t);
    const { collectionId } = await w.owner.as.mutation(api.collections.create, { documentId: w.draftB });
    const first = await w.owner.as.query(api.collections.get, { collectionId });
    const status = first!.properties.find((p) => p.type === "select")!;
    const rows = [];
    for (const title of ["One", "Two", "Three"]) rows.push(await w.owner.as.mutation(api.collections.addRow, { collectionId, title }));
    await w.owner.as.mutation(api.collections.setValue, { collectionId, rowId: rows[0]!.id, propertyId: status.id, value: "doing" });
    await w.owner.as.mutation(api.collections.setValue, { collectionId, rowId: rows[2]!.id, propertyId: status.id, value: "done" });
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: rows[1]!.documentId, mode: "restricted" });
    const forOwner = (await w.owner.as.query(api.collections.get, { collectionId }))!;
    const forMember = (await w.member.as.query(api.collections.get, { collectionId }))!;
    expect(forOwner.rows.map((r) => [r.title, r.values[status.id] ?? null])).toEqual([
      ["One", "doing"],
      ["Two", null],
      ["Three", "done"],
    ]);
    expect(forMember.rows.map((r) => r.title)).toEqual(["One", "Three"]);
    expect(forMember.rows.map((r) => r.values)).toEqual([forOwner.rows[0]!.values, forOwner.rows[2]!.values]);
    expect(forOwner.hostDocumentId).toBe(w.draftB);
  });

  test("unread state per thread, from one read of this person's states on the page", async () => {
    const t = setup();
    const w = await world(t);
    const text = (s: string) => [{ type: "text" as const, text: s }];
    const { threadId: a } = await w.member.as.mutation(api.comments.create, { documentId: w.draftB, body: text("first") });
    await w.member.as.mutation(api.comments.create, { documentId: w.draftB, body: text("second") });
    await w.owner.as.mutation(api.comments.markThreadRead, { threadId: a });
    const threads = (await w.owner.as.query(api.comments.threads, { documentId: w.draftB })).threads;
    expect(Object.fromEntries(threads.map((x) => [x.id, x.unread]))).toEqual(Object.fromEntries(threads.map((x) => [x.id, x.id !== a])));
    expect((await w.owner.as.query(api.comments.unreadCount, { documentId: w.draftB })).unread).toBe(1);
  });

  test("PageAudience gives everyone the access documentAccess gives them", async () => {
    const t = setup();
    const w = await world(t);
    const viewer = await person(t, "reads-viewer@example.com");
    await join(t, w.owner, viewer, "reads-viewer@example.com", w.workspaceId, "viewer");
    const guest = await person(t, "reads-guest2@example.com");
    const outsider = await person(t, "reads-outsider@example.com");
    const restrictedParent = await page(w.member, w.scope, "Member's restricted");
    await w.owner.as.mutation(api.sharing.setAccessMode, { documentId: restrictedParent, mode: "restricted" });
    const under = await page(w.member, w.scope, "Under it", { parentDocumentId: restrictedParent });
    await w.owner.as.mutation(api.sharing.grant, { documentId: restrictedParent, email: "reads-guest2@example.com", role: "commenter" });
    await w.owner.as.mutation(api.sharing.grant, { documentId: w.draftA, email: "reads-guest2@example.com", role: "editor" });
    const personalNote = await page(w.owner, w.owner.scope, "Personal note");
    const personalChild = await page(w.owner, w.owner.scope, "Personal child", { parentDocumentId: personalNote });
    await w.owner.as.mutation(api.sharing.grant, { documentId: personalNote, email: "reads-guest2@example.com", role: "viewer" });
    const people = [w.owner, w.member, viewer, guest, outsider].map((p) => p.profileId as Id<"profiles">);
    const pages = [w.draftA, w.nested, w.secretDraft, restrictedParent, under, personalNote, personalChild];
    const compare = async () => {
      for (const publicId of pages) {
        const doc = await docRow(t, publicId);
        const [expected, actual] = await t.run(async (ctx) => {
          const audience = await PageAudience.load(ctx, doc);
          const want: string[] = [];
          const got: string[] = [];
          for (const id of people) {
            want.push(await documentAccess(ctx, (await ctx.db.get(id))!, doc));
            got.push(await audience.access(id));
          }
          return [want, got];
        });
        expect([publicId, actual]).toEqual([publicId, expected]);
      }
    };
    await compare();
    // A suspended workspace and a suspended Personal owner change what everyone gets.
    const ws = await workspaceRow(t, w.workspaceId);
    await t.run(async (ctx) => {
      await ctx.db.patch(ws._id, { status: "suspended" });
      await ctx.db.patch(w.owner.profileId as Id<"profiles">, { status: "suspended" });
    });
    await compare();
    // The mention list keeps whoever can read the page (the restricted page's guest, not the viewer).
    await t.run(async (ctx) => {
      await ctx.db.patch(ws._id, { status: "active" });
      await ctx.db.patch(w.owner.profileId as Id<"profiles">, { status: "active" });
    });
    const names = (await w.member.as.query(api.comments.mentionable, { documentId: restrictedParent })).map((m) => [m.profileId, m.guest]);
    expect(names.sort()).toEqual(
      [
        [w.owner.profileId, false],
        [w.member.profileId, false],
        [guest.profileId, true],
      ].sort(),
    );
  });
});

describe("background jobs get past the rows they skip", () => {
  test("reminders still to send are found however many were sent already", async () => {
    const t = setup();
    const a = await person(t, "reads-reminders@example.com");
    const { blockId } = await a.as.mutation(api.tasks.quickAdd, { scope: a.scope, title: "Call back", today: TODAY });
    const now = Date.now();
    const pendingId = await t.run(async (ctx) => {
      const task = (await ctx.db.query("tasks").withIndex("by_block", (q) => q.eq("blockId", blockId)).unique())!;
      const { _id, _creationTime, ...base } = task;
      void _id;
      void _creationTime;
      // 250 reminders already sent in the last day, all due before the one still to send.
      for (let i = 0; i < 250; i++) await ctx.db.insert("tasks", { ...base, blockId: `sent-${i}`, reminderAt: now - 60 * 60 * 1000 - i, reminderSentAt: now - 1000 });
      // Closed or trashed tasks don't get reminders either.
      await ctx.db.insert("tasks", { ...base, blockId: "closed", status: "done", reminderAt: now - 1000 });
      await ctx.db.insert("tasks", { ...base, blockId: "trashed", documentInTrash: true, reminderAt: now - 1000 });
      await ctx.db.patch(task._id, { reminderAt: now - 1000 });
      return task._id;
    });
    expect(await t.mutation(internal.tasks.processReminders, {})).toBe(1);
    const notes = await t.run(async (ctx) => await ctx.db.query("notifications").withIndex("by_profile_created", (q) => q.eq("profileId", a.profileId as Id<"profiles">)).collect());
    expect(notes.filter((n) => n.title === "Reminder: Call back")).toHaveLength(1);
    expect((await t.run(async (ctx) => await ctx.db.get(pendingId)))!.reminderSentAt).toBeDefined();
    // Sent stays sent, and the task still shows when its reminder was.
    expect(await t.mutation(internal.tasks.processReminders, {})).toBe(0);
    const listed = (await a.as.query(api.tasks.list, { scope: a.scope, view: "all", today: TODAY })).find((x) => x.blockId === blockId);
    expect(listed?.reminderAt).toBe(now - 1000);
  });

  test("snapshot retention walks past old snapshots it keeps", async () => {
    vi.useFakeTimers();
    const t = setup();
    const a = await person(t, "reads-snapshots@example.com");
    const ids = [];
    for (let i = 0; i < 7; i++) ids.push(await page(a, a.scope, `Doc ${i}`));
    const docs = await Promise.all(ids.map((id) => docRow(t, id)));
    const old = Date.now() - 60 * 24 * 60 * 60 * 1000;
    await t.run(async (ctx) => {
      const snap = async (doc: Doc<"documents">, createdAt: number) =>
        await ctx.db.insert("documentSnapshots", {
          documentId: doc._id,
          ownerProfileId: doc.ownerProfileId,
          publicId: `snap-${doc._id}-${createdAt}`,
          reason: "idle",
          title: doc.title,
          content: "[]",
          blockCount: 0,
          sizeBytes: 2,
          contentSeq: 0,
          createdBy: doc.createdBy,
          createdAt,
        });
      // The oldest 240: six pages with 40 old snapshots each, all kept (fewer than 50 per page).
      let at = old;
      for (const doc of docs.slice(0, 6)) for (let i = 0; i < 40; i++) await snap(doc, at++);
      // Then one page with 60 old snapshots: its 10 oldest go.
      for (let i = 0; i < 60; i++) await snap(docs[6]!, at++);
    });
    await t.mutation(internal.documents.purgeSnapshots, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const left = await t.run(async (ctx) => {
      const out: Record<string, number> = {};
      for (const doc of docs) out[doc.title] = (await ctx.db.query("documentSnapshots").withIndex("by_document", (q) => q.eq("documentId", doc._id)).collect()).length;
      return out;
    });
    expect(left).toEqual({ "Doc 0": 40, "Doc 1": 40, "Doc 2": 40, "Doc 3": 40, "Doc 4": 40, "Doc 5": 40, "Doc 6": 50 });
  });
});
