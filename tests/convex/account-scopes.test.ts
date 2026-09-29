// Personal and workspace scopes never mix: plans, storage, AI and devices (docs/ACCOUNT_MODEL_PLAN.md).
// Numbers in test names are the specification's scenarios.
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { recordAiUsage } from "../../convex/lib/entitlements";
import { authSession, identity, person, setup, ulid, type T } from "./helpers";

const MB = 1024 ** 2;
const GB = 1024 ** 3;
type Person = Awaited<ReturnType<typeof person>>;

async function newDoc(p: Person, workspaceId = p.workspaceId) {
  const id = ulid();
  await p.as.mutation(api.sync.push, {
    workspaceId,
    deviceId: "device-scopes",
    ops: [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title: "Doc", icon: null } }],
  });
  return id;
}

async function endTrial(t: T, p: Person) {
  await t.run(async (ctx) => {
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_profile", (q) => q.eq("profileId", p.profileId as Id<"profiles">))
      .unique();
    await ctx.db.patch(sub!._id, { trialEndsAt: Date.now() - 1 });
  });
}

/** A team workspace owned by `owner`, with `members` joined through invitations. */
async function team(owner: Person, name: string, ...members: { p: Person; email: string }[]) {
  const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name });
  for (const m of members) {
    await owner.as.mutation(api.workspaces.invite, { workspaceId: id, email: m.email, role: "editor" });
    const invite = (await m.p.as.query(api.notifications.list, {})).find((n) => n.kind === "invite" && n.title.includes(name))!;
    await m.p.as.mutation(api.workspaces.acceptInvite, { inviteId: invite.inviteId! });
  }
  return id;
}

async function setUsage(t: T, workspacePublicId: string, bytes: number) {
  await t.run(async (ctx) => {
    const w = await ctx.db
      .query("workspaces")
      .withIndex("by_public_id", (q) => q.eq("publicId", workspacePublicId))
      .unique();
    await ctx.db.patch(w!._id, { storageUsedBytes: bytes });
  });
}

const upload = (p: Person, workspaceId: string, documentId: string, size: number) =>
  p.as.mutation(api.files.generateUploadUrl, { workspaceId, documentId, filename: "a.png", size, mimeType: "image/png", kind: "image" });

const inWorkspace = async (p: Person, id: string) => (await p.as.query(api.workspaces.mine, {})).find((w) => w.id === id)!;

describe("personal plans (1–3)", () => {
  test("Free: 1 GB personal storage, 2 devices, no AI", async () => {
    const t = setup();
    const a = await person(t, "free@example.com");
    await endTrial(t, a);
    const mine = await a.as.query(api.billing.mine, {});
    expect(mine.entitlements).toMatchObject({ planId: "personal_free", ai: false, storageBytes: 1 * GB, devices: 2 });
    expect(mine.storageLimitBytes).toBe(1 * GB);
    await expect(a.as.mutation(internal.ai.begin, { workspaceId: a.workspaceId })).rejects.toThrow(/part of Pro/);
  });

  test("Basic: 20 GB personal storage, unlimited devices, no AI", async () => {
    const t = setup();
    const a = await person(t, "basic@example.com");
    await a.as.mutation(api.billing.testPurchase, { plan: "basic", interval: "year" });
    const mine = await a.as.query(api.billing.mine, {});
    expect(mine.entitlements).toMatchObject({ planId: "personal_basic_yearly", paid: true, ai: false, storageBytes: 20 * GB, devices: null });
    expect(mine.payments[0]).toMatchObject({ amountCents: 900 });
    await expect(a.as.mutation(internal.ai.begin, { workspaceId: a.workspaceId })).rejects.toThrow(/part of Pro/);
  });

  test("Pro: 100 GB personal storage, unlimited devices, AI in Personal", async () => {
    const t = setup();
    const a = await person(t, "pro@example.com");
    await a.as.mutation(api.billing.testPurchase, { plan: "pro", interval: "month" });
    const mine = await a.as.query(api.billing.mine, {});
    expect(mine.entitlements).toMatchObject({ planId: "personal_pro_monthly", ai: true, aiSource: "plan", storageBytes: 100 * GB, devices: null });
    await a.as.mutation(internal.ai.begin, { workspaceId: a.workspaceId });
    const personal = await inWorkspace(a, a.workspaceId);
    expect(personal).toMatchObject({ plan: { scope: "personal", id: "personal_pro_monthly", name: "Pro" }, aiIncluded: true, storageQuotaBytes: 100 * GB });
  });
});

describe("a Personal plan never upgrades a workspace (4–6, 24)", () => {
  test("a Pro user joining a Free workspace: the workspace stays Free, with no AI and 5 GB", async () => {
    const t = setup();
    const owner = await person(t, "ws-owner@example.com");
    const pro = await person(t, "ws-pro@example.com");
    await pro.as.mutation(api.billing.testPurchase, { plan: "pro", interval: "year" });
    const teamId = await team(owner, "Studio", { p: pro, email: "ws-pro@example.com" });
    expect(await inWorkspace(pro, teamId)).toMatchObject({ plan: { scope: "workspace", id: "workspace_free", name: "Workspace Free" }, aiIncluded: false, storageQuotaBytes: 5 * GB });
    await expect(pro.as.mutation(internal.ai.begin, { workspaceId: teamId })).rejects.toThrow(/Team and Business workspace plans/);
    // …and the owner (on a trial with AI) doesn't get AI there either.
    await expect(owner.as.mutation(internal.ai.begin, { workspaceId: teamId })).rejects.toThrow(/Team and Business/);
  });

  test("a Pro user in ten workspaces: none become Pro", async () => {
    const t = setup();
    const pro = await person(t, "ten@example.com");
    const other = await person(t, "ten-other@example.com");
    await pro.as.mutation(api.billing.testPurchase, { plan: "pro", interval: "month" });
    // Eight of their own (with Personal, the most one person can own) and two they joined.
    for (let i = 0; i < 8; i++) await pro.as.mutation(api.workspaces.createTeamWorkspace, { name: `Team ${i}` });
    await team(other, "Joined A", { p: pro, email: "ten@example.com" });
    await team(other, "Joined B", { p: pro, email: "ten@example.com" });
    const all = await pro.as.query(api.workspaces.mine, {});
    const teams = all.filter((w) => w.kind === "team");
    expect(teams).toHaveLength(10);
    for (const w of teams) expect(w).toMatchObject({ plan: { id: "workspace_free" }, aiIncluded: false, storageQuotaBytes: 5 * GB });
    expect(all.find((w) => w.kind === "personal")).toMatchObject({ plan: { id: "personal_pro_monthly" }, aiIncluded: true });
  });

  test("a Free user in a workspace with a paid plan keeps Free in Personal (5)", async () => {
    // Workspace plans can't be bought yet; the resolver keeps them apart either way.
    const t = setup();
    const a = await person(t, "free-member@example.com");
    await endTrial(t, a);
    const teamId = await a.as.mutation(api.workspaces.createTeamWorkspace, { name: "Paid later" });
    expect((await a.as.query(api.billing.mine, {})).entitlements).toMatchObject({ planId: "personal_free", ai: false });
    expect(await inWorkspace(a, teamId.id)).toMatchObject({ plan: { scope: "workspace" } });
  });

  test("switching Personal → workspace → Personal leaks nothing either way (24)", async () => {
    const t = setup();
    const a = await person(t, "switch@example.com");
    const teamId = (await a.as.mutation(api.workspaces.createTeamWorkspace, { name: "Switch" })).id;
    // Trial Pro: AI in Personal, not in the team; then Personal again.
    await a.as.mutation(internal.ai.begin, { workspaceId: a.workspaceId });
    await expect(a.as.mutation(internal.ai.begin, { workspaceId: teamId })).rejects.toThrow(/Team and Business/);
    await a.as.mutation(internal.ai.begin, { workspaceId: a.workspaceId });
    const personal = await inWorkspace(a, a.workspaceId);
    const teamWs = await inWorkspace(a, teamId);
    expect(personal.storageQuotaBytes).toBe(100 * GB);
    expect(teamWs.storageQuotaBytes).toBe(5 * GB);
    // A request about a Personal note made from the team (the note decides) uses Personal…
    const note = await newDoc(a);
    await a.as.mutation(internal.ai.begin, { workspaceId: teamId, documentId: note, noteOnly: true });
    // …but a question across the team that also reads it needs AI in the team too.
    await expect(a.as.mutation(internal.ai.begin, { workspaceId: teamId, documentId: note })).rejects.toThrow(/Team and Business/);
    // A team note asked about from Personal: the team's plan decides.
    const teamNote = await newDoc(a, teamId);
    await expect(a.as.mutation(internal.ai.begin, { workspaceId: a.workspaceId, documentId: teamNote, noteOnly: true })).rejects.toThrow(/Team and Business/);
    const usage = await t.run(async (ctx) => ctx.db.query("aiUsage").collect());
    expect(usage.every((u) => u.scope === "personal" && u.workspaceId === undefined)).toBe(true);
    expect(usage.reduce((n, u) => n + u.count, 0)).toBe(3);
  });

  test("AI in someone else's Personal isn't covered by either person's plan", async () => {
    const t = setup();
    const owner = await person(t, "p-owner@example.com");
    const guest = await person(t, "p-guest@example.com");
    await guest.as.mutation(api.billing.testPurchase, { plan: "pro", interval: "month" });
    await owner.as.mutation(api.workspaces.invite, { workspaceId: owner.workspaceId, email: "p-guest@example.com", role: "editor" });
    const invite = (await guest.as.query(api.notifications.list, {})).find((n) => n.kind === "invite")!;
    await guest.as.mutation(api.workspaces.acceptInvite, { inviteId: invite.inviteId! });
    await expect(guest.as.mutation(internal.ai.begin, { workspaceId: owner.workspaceId })).rejects.toThrow(/someone else's Personal/);
    const theirs = await inWorkspace(guest, owner.workspaceId);
    expect(theirs).toMatchObject({ plan: null, aiIncluded: false });
  });
});

describe("storage is separate per scope (18, 19, 22, 23)", () => {
  test("personal storage excludes workspace storage, and workspace storage excludes personal", async () => {
    const t = setup();
    const a = await person(t, "sep@example.com");
    await endTrial(t, a);
    const teamId = (await a.as.mutation(api.workspaces.createTeamWorkspace, { name: "Sep" })).id;
    const personalNote = await newDoc(a);
    const teamNote = await newDoc(a, teamId);
    // The team is full (5 GB); Personal (Free, 1 GB) has 100 MB in it.
    await setUsage(t, teamId, 5 * GB);
    await setUsage(t, a.workspaceId, 100 * MB);
    expect((await upload(a, a.workspaceId, personalNote, 10 * MB)).uploadUrl).toBeTruthy();
    await expect(upload(a, teamId, teamNote, 10 * MB)).rejects.toThrow(/This workspace has used all of its 5 GB of storage on Workspace Free/);
    expect((await a.as.query(api.billing.mine, {})).storageUsedBytes).toBe(100 * MB);
    // Personal full, the team with 3 GB in it: the team still has room, though its owner is out of personal storage.
    await setUsage(t, teamId, 3 * GB);
    await setUsage(t, a.workspaceId, 1 * GB);
    await expect(upload(a, a.workspaceId, personalNote, 1 * MB)).rejects.toThrow(/personal storage on your Free plan/);
    expect((await upload(a, teamId, teamNote, 10 * MB)).uploadUrl).toBeTruthy();
    // A Pro owner doesn't lift the team's limit.
    await a.as.mutation(api.billing.testPurchase, { plan: "pro", interval: "month" });
    await setUsage(t, teamId, 5 * GB - 5 * MB);
    await expect(upload(a, teamId, teamNote, 10 * MB)).rejects.toThrow(/Workspace Free/);
    expect((await upload(a, a.workspaceId, personalNote, 10 * MB)).uploadUrl).toBeTruthy();
  });

  test("a member's uploads count toward the workspace, not anyone's personal storage", async () => {
    const t = setup();
    const owner = await person(t, "up-owner@example.com");
    const member = await person(t, "up-member@example.com");
    await endTrial(t, owner);
    await endTrial(t, member);
    const teamId = await team(owner, "Uploads", { p: member, email: "up-member@example.com" });
    const note = await newDoc({ ...owner, workspaceId: teamId });
    // Both are on Free with full personal storage; the team has room.
    await setUsage(t, owner.workspaceId, 1 * GB);
    await setUsage(t, member.workspaceId, 1 * GB);
    expect((await upload(member, teamId, note, 20 * MB)).uploadUrl).toBeTruthy();
  });

  test("Basic with 8 GB moving to Free: files stay, uploads wait until under 1 GB (18)", async () => {
    const t = setup();
    const a = await person(t, "down@example.com");
    await a.as.mutation(api.billing.testPurchase, { plan: "basic", interval: "month" });
    const note = await newDoc(a);
    await setUsage(t, a.workspaceId, 8 * GB);
    expect((await upload(a, a.workspaceId, note, 10 * MB)).uploadUrl).toBeTruthy();
    // The plan ends.
    await a.as.mutation(api.billing.cancelPlan, {});
    await t.run(async (ctx) => {
      const sub = (await ctx.db.query("subscriptions").collect()).find((s) => s.profileId === a.profileId)!;
      await ctx.db.patch(sub._id, { currentPeriodEnd: Date.now() - 1, trialEndsAt: Date.now() - 1 });
    });
    await t.mutation(internal.billing.settleExpiredPlans, {});
    await expect(upload(a, a.workspaceId, note, 1 * MB)).rejects.toThrow(/Free plan/);
    // Nothing was removed: the note and the usage are still there.
    expect(await a.as.query(api.documents.get, { documentId: note })).not.toBeNull();
    expect((await a.as.query(api.billing.mine, {})).storageUsedBytes).toBe(8 * GB);
    // Freeing room (under 1 GB) lets uploads through again.
    await setUsage(t, a.workspaceId, 900 * MB);
    expect((await upload(a, a.workspaceId, note, 10 * MB)).uploadUrl).toBeTruthy();
  });

  test("a workspace over its storage keeps its content; growth is blocked; an admin override replaces the limit (19)", async () => {
    const t = setup();
    const owner = await person(t, "over@example.com");
    const admin = await person(t, "quota-admin@example.com");
    await t.run(async (ctx) => ctx.db.patch(admin.profileId as Id<"profiles">, { platformRole: "ops_admin" }));
    const teamId = (await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Over" })).id;
    const note = await newDoc(owner, teamId);
    await setUsage(t, teamId, 6 * GB);
    await expect(upload(owner, teamId, note, 1 * MB)).rejects.toThrow(/Workspace Free/);
    expect(await owner.as.query(api.documents.get, { documentId: note })).not.toBeNull();
    // Changing only the member limit keeps the plan's storage (no accidental override).
    await admin.as.mutation(api.admin.setWorkspaceQuota, { workspaceId: teamId, storageQuotaBytes: 5 * GB, memberLimit: 60, reason: "Support ticket 1234 for this team" });
    expect((await inWorkspace(owner, teamId)).storageQuotaBytes).toBe(5 * GB);
    expect(await t.run(async (ctx) => (await ctx.db.query("workspaces").collect()).find((w) => w.publicId === teamId)!.storageQuotaOverrideBytes ?? null)).toBeNull();
    // A different value is an override: it replaces the plan's.
    await admin.as.mutation(api.admin.setWorkspaceQuota, { workspaceId: teamId, storageQuotaBytes: 50 * GB, memberLimit: 60, reason: "Support ticket 1234 for this team" });
    expect((await inWorkspace(owner, teamId)).storageQuotaBytes).toBe(50 * GB);
    expect((await upload(owner, teamId, note, 10 * MB)).uploadUrl).toBeTruthy();
    await setUsage(t, teamId, 50 * GB - 5 * MB);
    await expect(upload(owner, teamId, note, 10 * MB)).rejects.toThrow(/50 GB of storage\. Free/);
  });

  test("workspaces from before overrides had a field: an admin-set quota still counts as an override", async () => {
    const t = setup();
    const owner = await person(t, "legacy@example.com");
    await endTrial(t, owner);
    const note = await newDoc(owner);
    // Personal on Free (1 GB), but an admin once set this workspace to 3 GB the old way.
    await t.run(async (ctx) => {
      const w = (await ctx.db.query("workspaces").collect()).find((x) => x.publicId === owner.workspaceId)!;
      await ctx.db.patch(w._id, { storageQuotaBytes: 3 * GB, storageUsedBytes: 2 * GB });
    });
    expect((await upload(owner, owner.workspaceId, note, 10 * MB)).uploadUrl).toBeTruthy();
    expect((await owner.as.query(api.billing.mine, {})).storageLimitBytes).toBe(3 * GB);
  });
});

describe("AI usage is recorded per scope (20, 21)", () => {
  test("Personal requests are recorded as personal; workspace requests against their workspace", async () => {
    const t = setup();
    const a = await person(t, "usage@example.com");
    const teamId = (await a.as.mutation(api.workspaces.createTeamWorkspace, { name: "Usage" })).id;
    await a.as.mutation(internal.ai.begin, { workspaceId: a.workspaceId });
    await a.as.mutation(internal.ai.begin, { workspaceId: a.workspaceId });
    // No workspace plan includes AI yet, so record a workspace request the way ai.begin would.
    const teamDbId = await t.run(async (ctx) => (await ctx.db.query("workspaces").collect()).find((w) => w.publicId === teamId)!._id);
    await t.run(async (ctx) => recordAiUsage(ctx, a.profileId as Id<"profiles">, { kind: "workspace", workspaceId: teamDbId }));
    const rows = await t.run(async (ctx) => ctx.db.query("aiUsage").collect());
    expect(rows.find((r) => r.scope === "personal")).toMatchObject({ count: 2 });
    expect(rows.find((r) => r.scope === "personal")!.workspaceId).toBeUndefined();
    expect(rows.find((r) => r.scope === "workspace")).toMatchObject({ count: 1, workspaceId: teamDbId });
    // The Personal billing page counts Personal only (and older rows without a scope, which were all Personal).
    await t.run(async (ctx) => ctx.db.insert("aiUsage", { profileId: a.profileId as Id<"profiles">, day: new Date().toISOString().slice(0, 10), count: 5 }));
    expect((await a.as.query(api.billing.mine, {})).aiRequestsThisMonth).toBe(7);
  });
});

describe("devices are per account, from the Personal plan (32, 33)", () => {
  async function anotherDevice(t: T, p: Person, email: string) {
    const sessionId = await authSession(t, p.userId, "Mozilla/5.0 (iPhone) Safari/18");
    return { as: t.withIdentity(identity(email, { subject: p.userId, tokenIdentifier: `https://test.folevi.local|${p.userId}`, sessionId })), sessionId };
  }

  test("Free allows 2 devices, and joining a workspace doesn't lift it", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const owner = await person(t, "dev-owner@example.com");
      const a = await person(t, "dev-member@example.com");
      await endTrial(t, a);
      await team(owner, "Devices", { p: a, email: "dev-member@example.com" });
      vi.advanceTimersByTime(1000);
      const second = await anotherDevice(t, a, "dev-member@example.com");
      vi.advanceTimersByTime(1000);
      const third = await anotherDevice(t, a, "dev-member@example.com");
      expect((await second.as.query(api.users.me, {})).state).toBe("ready");
      expect(await third.as.query(api.users.me, {})).toMatchObject({ state: "device_limit", limit: 2, active: 3 });
      await expect(third.as.query(api.workspaces.mine, {})).rejects.toThrow(/device_limit/);
    } finally {
      vi.useRealTimers();
    }
  });
});
