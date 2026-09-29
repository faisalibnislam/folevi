// Organization, collections, tasks, sharing and workspace membership (gap list: Agent O).
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { inWorkspace, para, person, setup, ulid, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

async function newDoc(p: Person, title = "Doc", extra: Record<string, unknown> = {}) {
  const id = ulid();
  const [r] = await p.as.mutation(api.sync.push, {
    scope: p.scope,
    deviceId: "device-org-1",
    ops: [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null, ...extra } as never }],
  });
  expect(r!.status).toBe("applied");
  return id;
}

async function upsert(p: Person, documentId: string, block: unknown) {
  const [r] = await p.as.mutation(api.sync.push, {
    scope: p.scope,
    deviceId: "device-org-1",
    ops: [{ opId: ulid(), kind: "block.upsert", documentId, block: block as never, baseRevision: null, fields: ["content", "position"] }],
  });
  return r!;
}

async function team(t: T, owner: Person, member: Person, email: string, role: "editor" | "admin" | "viewer" = "editor") {
  const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Team" });
  await owner.as.mutation(api.workspaces.invite, { workspaceId: id, email, role });
  const invite = (await member.as.query(api.notifications.list, {})).find((n) => n.kind === "invite")!;
  await member.as.mutation(api.workspaces.acceptInvite, { inviteId: invite.inviteId! });
  void t;
  return id;
}

describe("workspace membership", () => {
  test("invites go to team workspaces only and respect the platform flag", async () => {
    const t = setup();
    const a = await person(t, "ws-a@example.com");
    // Personal has no members: there's no workspace to invite to (a stray id reads as not found).
    await expect(a.as.mutation(api.workspaces.invite, { workspaceId: ulid(), email: "x@example.com", role: "editor" })).rejects.toThrow(/Workspace not found/);
    const { id: teamId } = await a.as.mutation(api.workspaces.createTeamWorkspace, { name: "Crew" });
    await t.run(async (ctx) => {
      await ctx.db.insert("featureFlags", { key: "workspace_invites", enabled: false, description: "", updatedAt: Date.now() });
    });
    await expect(a.as.mutation(api.workspaces.invite, { workspaceId: teamId, email: "x@example.com", role: "editor" })).rejects.toThrow(/turned off/);
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("featureFlags").collect())[0]!;
      await ctx.db.patch(row._id, { enabled: true });
    });
    await a.as.mutation(api.workspaces.invite, { workspaceId: teamId, email: "x@example.com", role: "editor" });
  });

  test("invitation emails to existing accounts go through their profile (preferences apply)", async () => {
    const t = setup();
    const a = await person(t, "ws-b@example.com");
    const b = await person(t, "ws-b2@example.com");
    const { id: teamId } = await a.as.mutation(api.workspaces.createTeamWorkspace, { name: "Crew" });
    await a.as.mutation(api.workspaces.invite, { workspaceId: teamId, email: "ws-b2@example.com", role: "editor" });
    await a.as.mutation(api.workspaces.invite, { workspaceId: teamId, email: "newcomer@example.com", role: "viewer" });
    const jobs = await t.run(async (ctx) => await ctx.db.system.query("_scheduled_functions").collect());
    const invites = jobs.map((j) => j.args[0] as { key?: string; profileId?: string; to?: string }).filter((x) => x.key === "workspace_invite");
    expect(invites).toHaveLength(2);
    expect(invites.find((x) => x.profileId === b.profileId)).toBeTruthy();
    expect(invites.find((x) => x.to === "newcomer@example.com")).toBeTruthy();
  });

  test("members can leave; owners can hand the workspace over and stay as admin", async () => {
    const t = setup();
    const owner = await person(t, "ws-owner@example.com");
    const member = await person(t, "ws-member@example.com");
    const teamId = await team(t, owner, member, "ws-member@example.com");
    await expect(member.as.mutation(api.workspaces.transferOwnership, { workspaceId: teamId, profileId: owner.profileId })).rejects.toThrow(/forbidden/);
    await owner.as.mutation(api.workspaces.transferOwnership, { workspaceId: teamId, profileId: member.profileId });
    const roster = await member.as.query(api.workspaces.members, { workspaceId: teamId });
    expect(roster.yourRole).toBe("owner");
    expect(roster.members.find((m) => m.profileId === owner.profileId)?.role).toBe("admin");
    // The former owner can now leave; the new owner can't.
    await expect(member.as.mutation(api.workspaces.removeMember, { workspaceId: teamId, profileId: member.profileId })).rejects.toThrow(/owner/);
    await owner.as.mutation(api.workspaces.removeMember, { workspaceId: teamId, profileId: owner.profileId });
    expect((await owner.as.query(api.workspaces.mine, {})).map((w) => w.id)).not.toContain(teamId);
    await expect(owner.as.mutation(api.workspaces.transferOwnership, { workspaceId: teamId, profileId: member.profileId })).rejects.toThrow();
  });
});

describe("document lists", () => {
  test("sorting is server-side across pages, and manual arranging doesn't count as an edit", async () => {
    const t = setup();
    const a = await person(t, "lists@example.com");
    const titles = ["Mango", "apple", "Kiwi", "Banana", "Cherry"];
    const ids: string[] = [];
    for (const title of titles) ids.push(await newDoc(a, title));
    const all = async (sort: "created" | "title" | "manual" | "updated", numItems: number) => {
      const out: { id: string; title: string; updatedAt: number }[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 20; i++) {
        const page: { page: { id: string; title: string; updatedAt: number }[]; isDone: boolean; continueCursor: string } = await a.as.query(api.documents.list, {
          scope: a.scope,
          view: "all",
          sort,
          paginationOpts: { numItems, cursor },
        });
        out.push(...page.page);
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
      return out;
    };
    const created = (await all("created", 2)).map((d) => d.id);
    // Newest first even when paging two at a time (the seed documents come after ours).
    expect(created.slice(0, 5)).toEqual([...ids].reverse());
    const byTitle = (await all("title", 2)).map((d) => d.title).filter((x) => titles.includes(x));
    expect(byTitle).toEqual(["Banana", "Cherry", "Kiwi", "Mango", "apple"]); // index order across pages
    const byTitleOnePage = (await all("title", 100)).map((d) => d.title).filter((x) => titles.includes(x));
    expect(byTitleOnePage).toEqual(["apple", "Banana", "Cherry", "Kiwi", "Mango"]); // whole list: case-insensitive

    const before = (await all("updated", 100)).find((d) => d.id === ids[0])!;
    const manual = (await all("manual", 100)).map((d) => d.id);
    // Move the first of ours to the very top.
    await a.as.mutation(api.documents.reorder, { documentId: ids[0]!, afterDocumentId: null, beforeDocumentId: manual[0]! });
    const after = await all("manual", 2);
    expect(after[0]!.id).toBe(ids[0]);
    expect(after.find((d) => d.id === ids[0])!.updatedAt).toBe(before.updatedAt);
  });

  test("tags can be renamed and recolored, but not onto another tag's name", async () => {
    const t = setup();
    const a = await person(t, "tags@example.com");
    const { id: one } = await a.as.mutation(api.organization.createTag, { scope: a.scope, name: "garden" });
    await a.as.mutation(api.organization.createTag, { scope: a.scope, name: "kitchen" });
    await a.as.mutation(api.organization.updateTag, { tagId: one, name: "Garden plans", color: "moss" });
    await expect(a.as.mutation(api.organization.updateTag, { tagId: one, name: "#Kitchen" })).rejects.toThrow(/already a tag/);
    await expect(a.as.mutation(api.organization.updateTag, { tagId: one, color: "neon" })).rejects.toThrow(/color/);
    const tags = (await a.as.query(api.organization.sidebar, { scope: a.scope })).tags;
    expect(tags.find((x) => x.id === one)).toMatchObject({ name: "Garden plans", color: "moss" });
  });

  test("a page can be created from a user template", async () => {
    const t = setup();
    const a = await person(t, "tpl@example.com");
    const tpl = await newDoc(a, "Weekly review", { kind: "template" });
    await upsert(a, tpl, para(ulid(), "What went well?"));
    const fromTpl = await newDoc(a, "Week 39", { templateId: tpl });
    const blocks = (await a.as.query(api.blocks.list, { documentId: fromTpl }))!.blocks;
    expect(blocks.map((b) => (b.text[0] as { text?: string } | undefined)?.text)).toContain("What went well?");
  });
});

describe("tasks", () => {
  test("in Personal unassigned tasks are mine; canceled tasks are closed", async () => {
    const t = setup();
    const a = await person(t, "mytasks@example.com");
    const r = await a.as.mutation(api.tasks.quickAdd, { scope: a.scope, title: "Call the plumber", today: "2026-09-25", priority: "high" });
    const mine = await a.as.query(api.tasks.list, { scope: a.scope, view: "mine", today: "2026-09-25" });
    expect(mine.map((x) => x.title)).toContain("Call the plumber");
    expect(mine.find((x) => x.blockId === r.blockId)?.priority).toBe("high");
    const counts = await a.as.query(api.tasks.counts, { scope: a.scope, today: "2026-09-25" });
    expect(counts.mine).toBeGreaterThan(0);

    await a.as.mutation(api.tasks.update, { blockId: r.blockId, canceled: true });
    expect((await a.as.query(api.tasks.list, { scope: a.scope, view: "all", today: "2026-09-25" })).map((x) => x.blockId)).not.toContain(r.blockId);
    const closed = await a.as.query(api.tasks.list, { scope: a.scope, view: "completed", today: "2026-09-25" });
    expect(closed.find((x) => x.blockId === r.blockId)?.status).toBe("canceled");
    await a.as.mutation(api.tasks.update, { blockId: r.blockId, canceled: false, dueDate: "2026-09-20" });
    const today = await a.as.query(api.tasks.list, { scope: a.scope, view: "today", today: "2026-09-25" });
    expect(today.find((x) => x.blockId === r.blockId)?.status).toBe("open");
    await expect(a.as.mutation(api.tasks.update, { blockId: r.blockId, dueDate: "tomorrow" })).rejects.toThrow(/Invalid date/);
  });

  test("in a team workspace only assigned tasks are mine", async () => {
    const t = setup();
    const owner = await person(t, "team-tasks@example.com");
    const member = await person(t, "team-tasks2@example.com");
    const teamId = await team(t, owner, member, "team-tasks2@example.com");
    const r = await owner.as.mutation(api.tasks.quickAdd, { scope: inWorkspace(teamId), title: "Unassigned", today: "2026-09-25" });
    expect((await owner.as.query(api.tasks.list, { scope: inWorkspace(teamId), view: "mine", today: "2026-09-25" })).map((x) => x.blockId)).not.toContain(r.blockId);
    await owner.as.mutation(api.tasks.update, { blockId: r.blockId, assigneeId: owner.profileId });
    expect((await owner.as.query(api.tasks.list, { scope: inWorkspace(teamId), view: "mine", today: "2026-09-25" })).map((x) => x.blockId)).toContain(r.blockId);
  });
});

describe("collections", () => {
  test("rows are renamed inline, expose their properties on their own page, and appear read-only on public pages", async () => {
    const t = setup();
    const a = await person(t, "coll@example.com");
    const host = await newDoc(a, "Reading list");
    const { collectionId, viewId } = await a.as.mutation(api.collections.create, { documentId: host });
    await upsert(a, host, { id: ulid(), type: "collection", parentId: null, rank: "V", schemaVersion: para("x", "").schemaVersion, text: [], props: { collectionId, viewId } });
    const row = await a.as.mutation(api.collections.addRow, { collectionId, title: "" });
    await a.as.mutation(api.collections.renameRow, { collectionId, rowId: row.id, title: "Middlemarch" });
    const data = await a.as.query(api.collections.get, { collectionId });
    expect(data!.rows.find((r) => r.id === row.id)?.title).toBe("Middlemarch");
    expect(data!.people.map((p) => p.id)).toContain(a.profileId);
    const status = data!.properties.find((p) => p.type === "select")!;
    await a.as.mutation(api.collections.setValue, { collectionId, rowId: row.id, propertyId: status.id, value: "doing" });

    const info = await a.as.query(api.collections.rowForDocument, { documentId: row.documentId });
    expect(info?.collection.id).toBe(collectionId);
    expect(info?.row.values[status.id]).toBe("doing");
    expect(await a.as.query(api.collections.rowForDocument, { documentId: host })).toBeNull();

    const { token } = await a.as.mutation(api.sharing.createPublicLink, { documentId: host });
    const pub = await t.mutation(api.sharing.openPublicLink, { token, serverSecret: "a".repeat(64), clientKey: "coll-client" });
    if (pub.status !== "ok") throw new Error(pub.status);
    expect(pub.blocks.some((b) => b.type === "collection")).toBe(true);
    const snapshot = pub.collections[collectionId]!;
    expect(snapshot.rows.map((r) => r.title)).toEqual(["Middlemarch"]);
    expect(snapshot.rows[0]!.values[status.id]).toBe("doing");
  });
});
