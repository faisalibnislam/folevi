// Personal and workspace scopes never mix: plans, storage, AI credits and devices (docs/ACCOUNT_MODEL_PLAN.md,
// docs/BILLING.md). Numbers in test names are the specification's scenarios.
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { authSession, identity, inWorkspace, person, PERSONAL, setup, ulid, type T } from "./helpers";

const MB = 1024 ** 2;
const GB = 1024 ** 3;
type Person = Awaited<ReturnType<typeof person>>;
type ScopeArg = typeof PERSONAL | ReturnType<typeof inWorkspace>;

async function newDoc(p: Person, scope: ScopeArg = PERSONAL) {
  const id = ulid();
  await p.as.mutation(api.sync.push, {
    scope,
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

/** Sets the bytes stored in a team workspace (`workspacePublicId`) or in someone's Personal (a Person). */
async function setUsage(t: T, where: string | Person, bytes: number) {
  await t.run(async (ctx) => {
    if (typeof where !== "string") {
      await ctx.db.patch(where.profileId as Id<"profiles">, { personalStorageUsedBytes: bytes });
      return;
    }
    const w = await ctx.db
      .query("workspaces")
      .withIndex("by_public_id", (q) => q.eq("publicId", where))
      .unique();
    await ctx.db.patch(w!._id, { storageUsedBytes: bytes });
  });
}

/** An upload into a page: the file belongs to the page's scope and counts under that scope's storage rule. */
const upload = (p: Person, documentId: string, size: number) => p.as.mutation(api.files.generateUploadUrl, { documentId, filename: "a.png", size, mimeType: "image/png", kind: "image" });

/** A finished upload (as files.finalize would record it), returning the file's row. */
async function stored(t: T, p: Person, documentId: string, size: number) {
  const { intentId } = await upload(p, documentId, size);
  const storageId = await t.run(async (ctx) => ctx.storage.store(new Blob(["x"])));
  const fileId = await t.mutation(internal.files.commitFile, { intentId: intentId as Id<"uploadIntents">, profileId: p.profileId as Id<"profiles">, storageId, mimeType: "image/png", size, sha256: "0".repeat(64), kind: "image" });
  return await t.run(async (ctx) => (await ctx.db.query("files").withIndex("by_public_id", (q) => q.eq("publicId", fileId)).unique())!);
}

async function memberUsage(t: T, workspacePublicId: string, p: Person) {
  return await t.run(async (ctx) => {
    const w = await ctx.db
      .query("workspaces")
      .withIndex("by_public_id", (q) => q.eq("publicId", workspacePublicId))
      .unique();
    const row = await ctx.db
      .query("workspaceStorage")
      .withIndex("by_workspace_profile", (q) => q.eq("workspaceId", w!._id).eq("profileId", p.profileId as Id<"profiles">))
      .unique();
    return row?.usedBytes ?? 0;
  });
}

const mineEntry = async (p: Person, id: string) => (await p.as.query(api.workspaces.mine, {})).find((w) => w.id === id)!;
/** Starts an AI request (auth, access, abuse limit, credit hold) without calling Gemini. */
const beginAi = (p: Person, scope: ScopeArg, extra: { documentId?: string; noteOnly?: boolean } = {}) => p.as.mutation(internal.ai.begin, { scope, ...extra });
const credits = (p: Person, scope: ScopeArg, documentId?: string) => p.as.query(api.billing.credits, { scope, documentId });

describe("personal plans (1–3)", () => {
  test("Free: the 1 GB pool, 2 devices, 25 AI credits a month", async () => {
    const t = setup();
    const a = await person(t, "free@example.com");
    await endTrial(t, a);
    const mine = await a.as.query(api.billing.mine, {});
    expect(mine.entitlements).toMatchObject({ planId: "personal_free", ai: true, monthlyCredits: 25, creditPacks: false, storageBytes: 1 * GB, storageRule: "shared_free", devices: 2 });
    expect(mine).toMatchObject({ storageLimitBytes: 1 * GB, storageRule: "shared_free" });
    expect(mine.credits).toMatchObject({ allowance: 25, available: 25, canBuy: false, aiIncluded: true });
    await beginAi(a, a.scope);
  });

  test("Core: 20 GB of its own, unlimited devices, and no AI at all (refused on the server)", async () => {
    const t = setup();
    const a = await person(t, "core@example.com");
    await a.as.mutation(api.billing.testPurchase, { plan: "core", interval: "year" });
    const mine = await a.as.query(api.billing.mine, {});
    expect(mine.entitlements).toMatchObject({ planId: "personal_core_yearly", paid: true, ai: false, aiSource: null, monthlyCredits: 0, creditPacks: false, storageBytes: 20 * GB, storageRule: "per_person", devices: null });
    expect(mine.payments[0]).toMatchObject({ amountCents: 1900, plan: "core" });
    await expect(beginAi(a, a.scope)).rejects.toThrow(/AI isn't part of Core/);
    expect(await credits(a, a.scope)).toMatchObject({ aiIncluded: false, canBuy: false, allowance: 0 });
    await expect(a.as.mutation(api.billing.testBuyCredits, { pack: "credits_500", scope: PERSONAL })).rejects.toThrow(/Pro and Pro AI/);
    const me = await a.as.query(api.users.me, {});
    expect(me.state === "ready" && me.profile.entitlements).toMatchObject({ plan: "core", ai: false });
    // Nothing was held or recorded.
    expect(await t.run(async (ctx) => (await ctx.db.query("aiCreditHolds").collect()).length)).toBe(0);
  });

  test("Pro: 20 GB, 180 credits; Pro AI: 50 GB, 550 credits and the higher hourly limit", async () => {
    const t = setup();
    const a = await person(t, "pro@example.com");
    await a.as.mutation(api.billing.testPurchase, { plan: "pro", interval: "month" });
    let mine = await a.as.query(api.billing.mine, {});
    expect(mine.entitlements).toMatchObject({ planId: "personal_pro_monthly", ai: true, aiSource: "plan", monthlyCredits: 180, creditPacks: true, storageBytes: 20 * GB, devices: null, aiFairUse: "standard" });
    expect(mine.payments[0]).toMatchObject({ amountCents: 499, plan: "pro", interval: "month" });
    await a.as.mutation(api.billing.testPurchase, { plan: "pro_ai", interval: "year" });
    mine = await a.as.query(api.billing.mine, {});
    expect(mine.entitlements).toMatchObject({ planId: "personal_pro_ai_yearly", monthlyCredits: 550, storageBytes: 50 * GB, aiFairUse: "high" });
    expect(mine.storageLimitBytes).toBe(50 * GB);
    expect(mine.credits).toMatchObject({ allowance: 550, canBuy: true });
    await beginAi(a, a.scope);
  });
});

describe("a Personal plan never upgrades a workspace (4–6, 24)", () => {
  test("a Pro user joining a Free workspace: the workspace stays Free; AI there uses their own personal credits", async () => {
    const t = setup();
    const owner = await person(t, "ws-owner@example.com");
    const pro = await person(t, "ws-pro@example.com");
    await pro.as.mutation(api.billing.testPurchase, { plan: "pro", interval: "year" });
    const teamId = await team(owner, "Studio", { p: pro, email: "ws-pro@example.com" });
    expect(await mineEntry(pro, teamId)).toMatchObject({ plan: { scope: "workspace", id: "workspace_free", name: "Workspace Free" }, aiIncluded: true, storageQuotaBytes: 1 * GB, storageRule: "shared_free" });
    expect(await credits(pro, inWorkspace(teamId))).toMatchObject({ account: "personal", plan: "Pro", allowance: 180 });
    const { holdId } = await beginAi(pro, inWorkspace(teamId));
    await t.mutation(internal.ai.settle, { holdId, calls: [{ model: "gemini-3.8-flash", promptTokens: 2000, outputTokens: 500, thoughtsTokens: 0 }] });
    // Charged to their Personal (1 credit), recorded against the workspace.
    expect((await pro.as.query(api.billing.mine, {})).credits).toMatchObject({ used: 1, available: 179 });
    const usage = await t.run(async (ctx) => ctx.db.query("aiUsage").collect());
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ scope: "workspace", credits: 1, tokensIn: 2000, tokensOut: 500 });
  });

  test("a Pro user in ten workspaces: none become Pro", async () => {
    const t = setup();
    const pro = await person(t, "ten@example.com");
    const other = await person(t, "ten-other@example.com");
    await pro.as.mutation(api.billing.testPurchase, { plan: "pro", interval: "month" });
    for (let i = 0; i < 8; i++) await pro.as.mutation(api.workspaces.createTeamWorkspace, { name: `Team ${i}` });
    await team(other, "Joined A", { p: pro, email: "ten@example.com" });
    await team(other, "Joined B", { p: pro, email: "ten@example.com" });
    const teams = await pro.as.query(api.workspaces.mine, {});
    expect(teams).toHaveLength(10);
    for (const w of teams) expect(w).toMatchObject({ plan: { scope: "workspace", id: "workspace_free" }, storageQuotaBytes: 1 * GB });
    expect((await pro.as.query(api.billing.mine, {})).entitlements).toMatchObject({ planId: "personal_pro_monthly", ai: true });
  });

  test("a Free user in a Pro AI workspace: 550 credits of their own there, 25 in Personal (5)", async () => {
    const t = setup();
    const owner = await person(t, "biz-owner@example.com");
    const a = await person(t, "free-member@example.com");
    await endTrial(t, a);
    const teamId = await team(owner, "Biz", { p: a, email: "free-member@example.com" });
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: teamId, planId: "workspace_pro_ai_monthly" });
    expect(await mineEntry(a, teamId)).toMatchObject({ plan: { scope: "workspace", id: "workspace_pro_ai_monthly", shortName: "Pro AI" }, aiIncluded: true, storageQuotaBytes: 50 * GB, storageRule: "per_person" });
    expect(await credits(a, inWorkspace(teamId))).toMatchObject({ account: "seat", plan: "Workspace Pro AI", allowance: 550, canBuy: true });
    expect(await credits(owner, inWorkspace(teamId))).toMatchObject({ account: "seat", allowance: 550 });
    expect(await credits(a, PERSONAL)).toMatchObject({ account: "personal", allowance: 25 });
    expect((await a.as.query(api.billing.mine, {})).entitlements).toMatchObject({ planId: "personal_free", storageBytes: 1 * GB });
    // Their seat's credits are theirs alone: the owner's use doesn't touch them.
    const { holdId } = await beginAi(owner, inWorkspace(teamId));
    await t.mutation(internal.ai.settle, { holdId, calls: [{ model: "gemini-3.8-flash", promptTokens: 100_000, outputTokens: 2000, thoughtsTokens: 0 }] });
    expect(await credits(owner, inWorkspace(teamId))).toMatchObject({ used: 17 });
    expect(await credits(a, inWorkspace(teamId))).toMatchObject({ used: 0, available: 550 });
  });

  test("switching Personal → workspace → Personal leaks nothing either way (24)", async () => {
    const t = setup();
    const a = await person(t, "switch@example.com");
    const other = await person(t, "switch-other@example.com");
    const teamId = await team(other, "Switch", { p: a, email: "switch@example.com" });
    await other.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: teamId, planId: "workspace_pro_monthly" });
    // Trial: Pro AI in Personal; the team's own Pro seat inside it.
    expect(await credits(a, PERSONAL)).toMatchObject({ plan: "Pro AI trial", allowance: 100, trialing: true });
    expect(await credits(a, inWorkspace(teamId))).toMatchObject({ plan: "Workspace Pro", allowance: 180 });
    expect((await a.as.query(api.billing.mine, {})).storageLimitBytes).toBe(50 * GB);
    expect((await mineEntry(a, teamId)).storageQuotaBytes).toBe(20 * GB);
    // A request about a Personal note made from the team (the note decides) uses Personal credits.
    const note = await newDoc(a);
    const { holdId } = await beginAi(a, inWorkspace(teamId), { documentId: note, noteOnly: true });
    const hold = await t.run(async (ctx) => ctx.db.get(holdId));
    expect(hold).toMatchObject({ scope: "personal" });
    expect(hold!.workspaceId).toBeUndefined();
  });
});

describe("Core: no AI in its scope, for anyone (server-enforced)", () => {
  test("a Core workspace refuses AI to its owner, its members and its guests; its pages are never sent", async () => {
    const t = setup();
    const owner = await person(t, "core-ws-owner@example.com");
    const member = await person(t, "core-ws-member@example.com");
    const guest = await person(t, "core-ws-guest@example.com");
    await guest.as.mutation(api.billing.testPurchase, { plan: "pro_ai", interval: "month" });
    const teamId = await team(owner, "No AI here", { p: member, email: "core-ws-member@example.com" });
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: teamId, planId: "workspace_core_monthly" });
    const note = await newDoc(owner, inWorkspace(teamId));
    await owner.as.mutation(api.sharing.grant, { documentId: note, email: "core-ws-guest@example.com", role: "editor" });
    for (const p of [owner, member]) {
      expect(await mineEntry(p, teamId)).toMatchObject({ plan: { id: "workspace_core_monthly", shortName: "Core" }, aiIncluded: false, storageQuotaBytes: 20 * GB });
      await expect(beginAi(p, inWorkspace(teamId))).rejects.toThrow(/on Core, which doesn't include AI/);
      await expect(beginAi(p, inWorkspace(teamId), { documentId: note, noteOnly: true })).rejects.toThrow(/Core/);
    }
    // The guest's own Pro AI never covers a Core workspace's page…
    await expect(beginAi(guest, PERSONAL, { documentId: note, noteOnly: true })).rejects.toThrow(/Core/);
    // …nor pulls it into a question in their own Personal.
    await expect(beginAi(guest, PERSONAL, { documentId: note })).rejects.toThrow(/Core/);
    expect(await credits(guest, PERSONAL, note)).toMatchObject({ aiIncluded: false });
    // Their own Personal still works.
    await beginAi(guest, PERSONAL);
    // Nobody can buy credits for a Core workspace seat.
    await expect(owner.as.mutation(api.billing.testBuyCredits, { pack: "credits_500", scope: inWorkspace(teamId) })).rejects.toThrow(/personal credits|isn't included/);
  });

  test("a Core Personal: shared pages from it are never sent either, and its owner has no AI in free workspaces", async () => {
    const t = setup();
    const core = await person(t, "core-owner@example.com");
    const guest = await person(t, "core-guest@example.com");
    await core.as.mutation(api.billing.testPurchase, { plan: "core", interval: "month" });
    const note = await newDoc(core);
    await core.as.mutation(api.sharing.grant, { documentId: note, email: "core-guest@example.com", role: "editor" });
    await expect(beginAi(guest, PERSONAL, { documentId: note, noteOnly: true })).rejects.toThrow(/owner is on Core/);
    // In a free workspace AI uses personal credits, and Core has none.
    const free = (await core.as.mutation(api.workspaces.createTeamWorkspace, { name: "Free one" })).id;
    await expect(beginAi(core, inWorkspace(free))).rejects.toThrow(/personal plan is Core/);
    expect(await mineEntry(core, free)).toMatchObject({ aiIncluded: false });
  });

  test("guests use their own personal credits on pages they can open (not Core)", async () => {
    const t = setup();
    const owner = await person(t, "g-owner@example.com");
    const guest = await person(t, "g-guest@example.com");
    const teamId = (await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Guests" })).id;
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: teamId, planId: "workspace_pro_monthly" });
    const note = await newDoc(owner, inWorkspace(teamId));
    await owner.as.mutation(api.sharing.grant, { documentId: note, email: "g-guest@example.com", role: "editor" });
    const { holdId } = await beginAi(guest, PERSONAL, { documentId: note, noteOnly: true });
    expect(await t.run(async (ctx) => ctx.db.get(holdId))).toMatchObject({ scope: "workspace" });
    expect((await t.run(async (ctx) => ctx.db.get(holdId)))!.workspaceId).toBeUndefined();
    expect(await credits(guest, PERSONAL, note)).toMatchObject({ account: "personal", plan: "Pro AI trial" });
    // Someone else's Personal (not Core): the guest's own credits too.
    const personalNote = await newDoc(owner);
    await owner.as.mutation(api.sharing.grant, { documentId: personalNote, email: "g-guest@example.com", role: "editor" });
    await beginAi(guest, PERSONAL, { documentId: personalNote, noteOnly: true });
  });
});

describe("storage (18, 19, 22, 23)", () => {
  test("Free: the owner's Personal and every free workspace they own share 1 GB, members' uploads included", async () => {
    const t = setup();
    const owner = await person(t, "pool-owner@example.com");
    const member = await person(t, "pool-member@example.com");
    await endTrial(t, owner);
    await endTrial(t, member);
    const a = await team(owner, "Pool A", { p: member, email: "pool-member@example.com" });
    const b = (await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Pool B" })).id;
    const personalNote = await newDoc(owner);
    const aNote = await newDoc(owner, inWorkspace(a));
    await setUsage(t, owner, 400 * MB);
    await setUsage(t, a, 300 * MB);
    await setUsage(t, b, 300 * MB);
    const mine = await owner.as.query(api.billing.mine, {});
    expect(mine).toMatchObject({ storageUsedBytes: 1000 * MB, storageLimitBytes: 1 * GB, storageRule: "shared_free", poolWorkspaces: 2 });
    // 24 MB left in the pool: from Personal, and from the workspace by anyone in it.
    expect((await upload(owner, personalNote, 20 * MB)).uploadUrl).toBeTruthy();
    expect((await upload(member, aNote, 20 * MB)).uploadUrl).toBeTruthy();
    await setUsage(t, a, 310 * MB);
    await expect(upload(member, aNote, 15 * MB)).rejects.toThrow(/has used its owner's free storage \(1010 MB of 1 GB/);
    await expect(upload(owner, personalNote, 15 * MB)).rejects.toThrow(/shared by your Personal and the free workspaces you own/);
    // The member's own Personal isn't touched by any of it.
    expect((await member.as.query(api.billing.mine, {})).storageUsedBytes).toBe(0);
    // Real uploads count against the owner's pool.
    await stored(t, member, aNote, 10 * MB);
    expect((await owner.as.query(api.billing.mine, {})).storageUsedBytes).toBe(1020 * MB);
  });

  test("an owner on a paid Personal: their Personal has its own room; their free workspaces share the 1 GB", async () => {
    const t = setup();
    const owner = await person(t, "paid-owner@example.com");
    await owner.as.mutation(api.billing.testPurchase, { plan: "pro", interval: "month" });
    const ws = (await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Free WS" })).id;
    const note = await newDoc(owner, inWorkspace(ws));
    await setUsage(t, owner, 5 * GB);
    await setUsage(t, ws, 1 * GB - 5 * MB);
    expect((await owner.as.query(api.billing.mine, {})).storageLimitBytes).toBe(20 * GB);
    await expect(upload(owner, note, 10 * MB)).rejects.toThrow(/free storage/);
    expect((await upload(owner, await newDoc(owner), 10 * MB)).uploadUrl).toBeTruthy();
  });

  test("a paid workspace: each member has their own quota there; a guest's uploads count against the page owner's", async () => {
    const t = setup();
    const owner = await person(t, "pp-owner@example.com");
    const member = await person(t, "pp-member@example.com");
    const guest = await person(t, "pp-guest@example.com");
    const ws = await team(owner, "Per person", { p: member, email: "pp-member@example.com" });
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: ws, planId: "workspace_pro_monthly" });
    const ownersNote = await newDoc(owner, inWorkspace(ws));
    const membersNote = await newDoc(member, inWorkspace(ws));
    await owner.as.mutation(api.sharing.grant, { documentId: ownersNote, email: "pp-guest@example.com", role: "editor" });
    const file = await stored(t, member, membersNote, 15 * MB);
    expect(file.chargedTo).toBe(member.profileId);
    await stored(t, guest, ownersNote, 12 * MB);
    expect(await memberUsage(t, ws, member)).toBe(15 * MB);
    expect(await memberUsage(t, ws, owner)).toBe(12 * MB);
    expect(await memberUsage(t, ws, guest)).toBe(0);
    // Each quota is 20 GB, per person: the member being full doesn't stop the owner.
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("workspaceStorage").collect()).find((r) => r.profileId === member.profileId)!;
      await ctx.db.patch(row._id, { usedBytes: 20 * GB - MB });
    });
    await expect(upload(member, membersNote, 5 * MB)).rejects.toThrow(/You've used your storage in this workspace/);
    expect((await upload(owner, ownersNote, 5 * MB)).uploadUrl).toBeTruthy();
    expect((await mineEntry(member, ws)).storageUsedBytes).toBe(20 * GB - MB);
    // Deleting a file gives its bytes back to whoever it counted against.
    await t.run(async (ctx) => {
      const { releaseFileStorage } = await import("../../convex/lib/entitlements");
      const w = (await ctx.db.query("workspaces").withIndex("by_public_id", (q) => q.eq("publicId", ws)).unique())!;
      await releaseFileStorage(ctx, file, { kind: "workspace", workspaceId: w._id });
    });
    expect(await memberUsage(t, ws, member)).toBe(20 * GB - MB - 15 * MB);
  });

  test("Core with 8 GB moving to Free: files stay, uploads wait until under 1 GB (18)", async () => {
    const t = setup();
    const a = await person(t, "down@example.com");
    await a.as.mutation(api.billing.testPurchase, { plan: "core", interval: "month" });
    const note = await newDoc(a);
    await setUsage(t, a, 8 * GB);
    expect((await upload(a, note, 10 * MB)).uploadUrl).toBeTruthy();
    await a.as.mutation(api.billing.cancelPlan, {});
    await t.run(async (ctx) => {
      const sub = (await ctx.db.query("subscriptions").collect()).find((s) => s.profileId === a.profileId)!;
      await ctx.db.patch(sub._id, { currentPeriodEnd: Date.now() - 1, trialEndsAt: Date.now() - 1 });
    });
    await t.mutation(internal.billing.settleExpiredPlans, {});
    await expect(upload(a, note, 1 * MB)).rejects.toThrow(/free storage/);
    expect(await a.as.query(api.documents.get, { documentId: note })).not.toBeNull();
    expect((await a.as.query(api.billing.mine, {})).storageUsedBytes).toBe(8 * GB);
    await setUsage(t, a, 900 * MB);
    expect((await upload(a, note, 10 * MB)).uploadUrl).toBeTruthy();
  });

  test("an admin override gives a workspace its own total limit (19)", async () => {
    const t = setup();
    const owner = await person(t, "over@example.com");
    const admin = await person(t, "quota-admin@example.com");
    await t.run(async (ctx) => ctx.db.patch(admin.profileId as Id<"profiles">, { platformRole: "ops_admin" }));
    await endTrial(t, owner);
    const teamId = (await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Over" })).id;
    const note = await newDoc(owner, inWorkspace(teamId));
    await setUsage(t, teamId, 2 * GB);
    await expect(upload(owner, note, 1 * MB)).rejects.toThrow(/is over its owner's free storage/);
    expect(await owner.as.query(api.documents.get, { documentId: note })).not.toBeNull();
    // Changing only the member limit keeps the plan's rule (no accidental override).
    await admin.as.mutation(api.admin.setWorkspaceQuota, { workspaceId: teamId, storageQuotaBytes: 1 * GB, memberLimit: 60, reason: "Support ticket 1234 for this team" });
    expect(await t.run(async (ctx) => (await ctx.db.query("workspaces").collect()).find((w) => w.publicId === teamId)!.storageQuotaOverrideBytes ?? null)).toBeNull();
    await admin.as.mutation(api.admin.setWorkspaceQuota, { workspaceId: teamId, storageQuotaBytes: 50 * GB, memberLimit: 60, reason: "Support ticket 1234 for this team" });
    expect((await mineEntry(owner, teamId)).storageQuotaBytes).toBe(50 * GB);
    expect((await upload(owner, note, 10 * MB)).uploadUrl).toBeTruthy();
    await setUsage(t, teamId, 50 * GB - 5 * MB);
    await expect(upload(owner, note, 10 * MB)).rejects.toThrow(/\(50 GB of 50 GB\)\. Everything already stored stays available; free some up to add more/);
  });

  test("workspaces from before overrides had a field: an admin-set quota still counts as an override", async () => {
    const t = setup();
    const owner = await person(t, "legacy@example.com");
    const teamId = (await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Old quota" })).id;
    const note = await newDoc(owner, inWorkspace(teamId));
    // An admin once set this workspace to 8 GB the old way (the default stored was 5 GB).
    await t.run(async (ctx) => {
      const w = (await ctx.db.query("workspaces").collect()).find((x) => x.publicId === teamId)!;
      await ctx.db.patch(w._id, { storageQuotaBytes: 8 * GB, storageUsedBytes: 6 * GB });
    });
    expect((await upload(owner, note, 10 * MB)).uploadUrl).toBeTruthy();
    expect((await mineEntry(owner, teamId)).storageQuotaBytes).toBe(8 * GB);
  });

  test("a Personal storage override replaces the person's limit (on Free, the pool's)", async () => {
    const t = setup();
    const a = await person(t, "p-override@example.com");
    await endTrial(t, a);
    const note = await newDoc(a);
    await setUsage(t, a, 2 * GB);
    await expect(upload(a, note, MB)).rejects.toThrow(/free storage/);
    await t.run(async (ctx) => {
      const sub = (await ctx.db.query("subscriptions").collect()).find((s) => s.profileId === a.profileId)!;
      await ctx.db.patch(sub._id, { storageOverrideBytes: 3 * GB });
    });
    expect((await upload(a, note, MB)).uploadUrl).toBeTruthy();
    expect((await a.as.query(api.billing.mine, {})).storageLimitBytes).toBe(3 * GB);
  });
});

describe("AI usage is recorded per scope (20, 21)", () => {
  test("Personal requests are recorded as personal; workspace requests against their workspace (credits and tokens, no content)", async () => {
    const t = setup();
    const a = await person(t, "usage@example.com");
    const teamId = (await a.as.mutation(api.workspaces.createTeamWorkspace, { name: "Usage" })).id;
    const call = { model: "gemini-flash-lite-latest", promptTokens: 1000, outputTokens: 200, thoughtsTokens: 0 };
    for (const scope of [a.scope, a.scope]) {
      const { holdId } = await beginAi(a, scope);
      await t.mutation(internal.ai.settle, { holdId, calls: [call] });
    }
    await a.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: teamId, planId: "workspace_pro_monthly" });
    const { holdId } = await beginAi(a, inWorkspace(teamId));
    await t.mutation(internal.ai.settle, { holdId, calls: [call] });
    const teamDbId = await t.run(async (ctx) => (await ctx.db.query("workspaces").collect()).find((w) => w.publicId === teamId)!._id);
    const rows = await t.run(async (ctx) => ctx.db.query("aiUsage").collect());
    expect(rows.find((r) => r.scope === "personal")).toMatchObject({ count: 2, credits: 2, tokensIn: 2000, tokensOut: 400 });
    expect(rows.find((r) => r.scope === "personal")!.workspaceId).toBeUndefined();
    expect(rows.find((r) => r.scope === "workspace")).toMatchObject({ count: 1, credits: 1, workspaceId: teamDbId });
    expect(Object.keys(rows[0]!).sort()).toEqual(["_creationTime", "_id", "count", "credits", "day", "profileId", "scope", "tokensIn", "tokensOut"].sort());
    expect((await a.as.query(api.billing.mine, {})).aiRequestsThisMonth).toBe(2);
  });
});

describe("devices are per account, from the Personal plan (32, 33)", () => {
  async function anotherDevice(t: T, p: Person, email: string) {
    const sessionId = await authSession(t, p.userId, "Mozilla/5.0 (iPhone) Safari/18");
    return { as: t.withIdentity(identity(email, { subject: p.userId, tokenIdentifier: `https://test.folevi.local|${p.userId}`, sessionId })), sessionId };
  }

  test("Free allows 2 devices, and joining a workspace (even a paid Pro AI one) doesn't lift it", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const owner = await person(t, "dev-owner@example.com");
      const a = await person(t, "dev-member@example.com");
      await endTrial(t, a);
      const teamId = await team(owner, "Devices", { p: a, email: "dev-member@example.com" });
      await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: teamId, planId: "workspace_pro_ai_yearly" });
      expect((await a.as.query(api.billing.mine, {})).entitlements).toMatchObject({ planId: "personal_free", devices: 2 });
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
