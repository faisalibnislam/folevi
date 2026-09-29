// Workspace plans, seats and billing (docs/ACCOUNT_MODEL_PLAN.md, Phase C). Numbers in test names are the
// specification's scenarios.
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { insertPayment, insertSubscription } from "../../convex/lib/billing";
import { inWorkspace, para, person, PERSONAL, setup, ulid, type T } from "./helpers";
import { fakePolar, order, postEvent, product, subscription, withPolar, withoutPolar } from "./polar";

const GB = 1024 ** 3;
const DAY = 86_400_000;
const REASON = "Customer support ticket 4321";
type Person = Awaited<ReturnType<typeof person>>;

async function endTrial(t: T, p: Person) {
  await t.run(async (ctx) => {
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_profile", (q) => q.eq("profileId", p.profileId as Id<"profiles">))
      .unique();
    await ctx.db.patch(sub!._id, { trialEndsAt: Date.now() - 1 });
  });
}

async function workspaceDbId(t: T, publicId: string): Promise<Id<"workspaces">> {
  return await t.run(async (ctx) => (await ctx.db.query("workspaces").withIndex("by_public_id", (q) => q.eq("publicId", publicId)).unique())!._id);
}

async function workspaceSub(t: T, publicId: string) {
  const id = await workspaceDbId(t, publicId);
  return await t.run(async (ctx) => ctx.db.query("subscriptions").withIndex("by_workspace", (q) => q.eq("workspaceId", id)).first());
}

/** Sends an invitation and returns its id (not yet accepted: a pending invitation). */
async function invite(t: T, from: Person, workspaceId: string, email: string, role: "admin" | "editor" | "commenter" | "viewer" = "editor") {
  await from.as.mutation(api.workspaces.invite, { workspaceId, email, role });
  return await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("workspaceInvites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    return rows.find((r) => r.status === "pending")!.publicId;
  });
}

async function join(t: T, owner: Person, who: Person, email: string, workspaceId: string, role: "admin" | "editor" | "commenter" | "viewer" = "editor") {
  const inviteId = await invite(t, owner, workspaceId, email, role);
  await who.as.mutation(api.workspaces.acceptInvite, { inviteId });
}

async function newDoc(p: Person, workspaceId: string) {
  const id = ulid();
  await p.as.mutation(api.sync.push, {
    scope: inWorkspace(workspaceId),
    deviceId: "device-ws-billing",
    ops: [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title: "Doc", icon: null } }],
  });
  return id;
}

const summary = (p: Person, workspaceId: string) => p.as.query(api.workspaceBilling.summary, { workspaceId });
const seats = async (p: Person, workspaceId: string) => {
  const s = await summary(p, workspaceId);
  return { seats: s.seats, guests: s.guests, pending: s.pendingInvites };
};

afterEach(() => {
  withoutPolar();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("billing rows have exactly one owner", () => {
  test("the write helpers refuse a row for the wrong kind of owner", async () => {
    const t = setup();
    const a = await person(t, "xor@example.com");
    const { id } = await a.as.mutation(api.workspaces.createTeamWorkspace, { name: "Xor" });
    const wid = await workspaceDbId(t, id);
    const pid = a.profileId as Id<"profiles">;
    await t.run(async (ctx) => {
      const now = Date.now();
      await expect(insertSubscription(ctx, { kind: "user", profileId: pid }, { planId: "workspace_pro_monthly", status: "active", provider: "none", createdAt: now, updatedAt: now })).rejects.toThrow(/personal tier/);
      await expect(insertSubscription(ctx, { kind: "workspace", workspaceId: wid }, { plan: "pro", status: "active", provider: "none", createdAt: now, updatedAt: now })).rejects.toThrow(/workspace plan id/);
      await expect(insertPayment(ctx, { kind: "workspace", workspaceId: wid }, { amountCents: 500, currency: "usd", plan: "pro", interval: "month", status: "paid", provider: "test", createdAt: now })).rejects.toThrow(/owner's kind/);
      const sid = await insertSubscription(ctx, { kind: "workspace", workspaceId: wid }, { planId: "workspace_free", status: "active", provider: "none", createdAt: now, updatedAt: now });
      const row = (await ctx.db.get(sid))!;
      expect(row).toMatchObject({ ownerType: "workspace", workspaceId: wid });
      expect(row.profileId).toBeUndefined();
    });
    // Every row in the database has exactly one owner.
    const rows = await t.run(async (ctx) => ctx.db.query("subscriptions").collect());
    for (const r of rows) expect(Boolean(r.profileId) !== Boolean(r.workspaceId)).toBe(true);
  });
});

describe("workspace plans and entitlements", () => {
  test("Pro and Pro AI: credits and storage per member; Free: the owner's pool and members' own personal credits", async () => {
    const t = setup();
    const owner = await person(t, "plans-owner@example.com");
    const member = await person(t, "plans-member@example.com");
    await endTrial(t, member);
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Plans" });
    await join(t, owner, member, "plans-member@example.com", id);
    let s = await summary(owner, id);
    expect(s.entitlements).toMatchObject({ planId: "workspace_free", ai: true, monthlyCredits: 0, storageBytes: 1 * GB, storageRule: "shared_free" });
    expect(s).toMatchObject({ credits: null, pool: { workspaces: 1, includesPersonal: false } });
    // On Free the member's own personal credits apply (their trial is over: Free's 25).
    expect(await member.as.query(api.billing.credits, { scope: inWorkspace(id) })).toMatchObject({ account: "personal", allowance: 25 });

    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_pro_monthly" });
    s = await summary(owner, id);
    expect(s.entitlements).toMatchObject({ planId: "workspace_pro_monthly", paid: true, ai: true, monthlyCredits: 180, storageBytes: 20 * GB, storageRule: "per_person" });
    expect(s.plan).toMatchObject({ tier: "pro", name: "Pro", interval: "month", seatPriceCents: 499 });
    expect(s).toMatchObject({ seats: 2, estimatedChargeCents: 998, storagePerMemberBytes: 20 * GB, yourStorageUsedBytes: 0, pool: null });
    expect(s.credits).toMatchObject({ allowance: 180, canBuy: true });
    expect(s.subscription).toMatchObject({ provider: "test", status: "active", quantity: 2 });
    expect(s.payments[0]).toMatchObject({ amountCents: 998, plan: "pro", quantity: 2, status: "paid" });
    // A Free (trial over) member gets the workspace's own credits inside it.
    expect(await member.as.query(api.billing.credits, { scope: inWorkspace(id) })).toMatchObject({ account: "seat", allowance: 180 });
    await member.as.mutation(internal.ai.begin, { scope: inWorkspace(id) });

    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_pro_ai_yearly" });
    s = await summary(owner, id);
    expect(s.entitlements).toMatchObject({ planId: "workspace_pro_ai_yearly", ai: true, aiFairUse: "high", monthlyCredits: 550, storageBytes: 50 * GB });
    expect(s.estimatedChargeCents).toBe(2 * 14900);
    // The switcher reads the plan's short name.
    expect((await member.as.query(api.workspaces.mine, {})).find((w) => w.id === id)!.plan).toMatchObject({ shortName: "Pro AI", tier: "pro_ai" });
  });

  test("an owner upgrading a workspace leaves their Personal unchanged (7)", async () => {
    const t = setup();
    const owner = await person(t, "upgrader@example.com");
    await endTrial(t, owner);
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Upgrade" });
    const before = await owner.as.query(api.billing.mine, {});
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_pro_ai_monthly" });
    const after = await owner.as.query(api.billing.mine, {});
    expect(after.entitlements).toEqual(before.entitlements);
    expect(after.entitlements).toMatchObject({ planId: "personal_free", monthlyCredits: 25, storageBytes: 1 * GB });
    // Personal billing history has none of the workspace's payments, and the other way round.
    expect(after.payments).toHaveLength(0);
    await owner.as.mutation(api.billing.testPurchase, { plan: "core", interval: "month" });
    expect((await owner.as.query(api.billing.mine, {})).payments).toHaveLength(1);
    expect((await summary(owner, id)).payments).toHaveLength(1);
    expect((await summary(owner, id)).payments[0]!.plan).toBe("pro_ai");
    // Their Core Personal has no AI, whatever the workspace has.
    await expect(owner.as.mutation(internal.ai.begin, { scope: PERSONAL })).rejects.toThrow(/Core/);
  });

  test("test purchases are refused in production", async () => {
    const t = setup();
    const owner = await person(t, "prod-ws@example.com");
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Prod" });
    process.env.FOLEVI_ENV = "production";
    try {
      await expect(owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_pro_monthly" })).rejects.toThrow(/only available in development/);
      expect((await summary(owner, id)).testPurchases).toBe(false);
    } finally {
      process.env.FOLEVI_ENV = "test";
    }
  });
});

describe("seats (10–17)", () => {
  test("guests and pending invitations are free; accepting adds a seat; removing takes one away (10–13)", async () => {
    const t = setup();
    const owner = await person(t, "seat-owner@example.com");
    await person(t, "seat-guest@example.com");
    const joiner = await person(t, "seat-joiner@example.com");
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Seats" });
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_pro_monthly" });
    expect(await seats(owner, id)).toEqual({ seats: 1, guests: 0, pending: 0 });
    // 10: a guest (a page shared with someone who isn't a member) takes no seat.
    const note = await newDoc(owner, id);
    await owner.as.mutation(api.sharing.grant, { documentId: note, email: "seat-guest@example.com", role: "editor" });
    expect(await seats(owner, id)).toEqual({ seats: 1, guests: 1, pending: 0 });
    // 11: a pending invitation takes no seat.
    const inviteId = await invite(t, owner, id, "seat-joiner@example.com");
    expect(await seats(owner, id)).toEqual({ seats: 1, guests: 1, pending: 1 });
    expect((await workspaceSub(t, id))!.quantity).toBe(1);
    // 12: accepting takes one, and the billed quantity follows.
    await joiner.as.mutation(api.workspaces.acceptInvite, { inviteId });
    expect(await seats(owner, id)).toEqual({ seats: 2, guests: 1, pending: 0 });
    expect((await workspaceSub(t, id))!.quantity).toBe(2);
    // 13: removing gives it back.
    await owner.as.mutation(api.workspaces.removeMember, { workspaceId: id, profileId: joiner.profileId });
    expect(await seats(owner, id)).toEqual({ seats: 1, guests: 1, pending: 0 });
    expect((await workspaceSub(t, id))!.quantity).toBe(1);
  });

  test("member → admin and admin → member don't change seats (14, 15)", async () => {
    const t = setup();
    const owner = await person(t, "role-owner@example.com");
    const m = await person(t, "role-member@example.com");
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Roles" });
    await join(t, owner, m, "role-member@example.com", id, "commenter");
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_pro_yearly" });
    expect((await seats(owner, id)).seats).toBe(2);
    await owner.as.mutation(api.workspaces.changeRole, { workspaceId: id, profileId: m.profileId, role: "admin" });
    expect((await seats(owner, id)).seats).toBe(2);
    await owner.as.mutation(api.workspaces.changeRole, { workspaceId: id, profileId: m.profileId, role: "viewer" });
    expect((await seats(owner, id)).seats).toBe(2);
    expect((await workspaceSub(t, id))!.quantity).toBe(2);
  });

  test("member → guest takes a seat away; guest → member adds one once they accept (16, 17)", async () => {
    const t = setup();
    const owner = await person(t, "conv-owner@example.com");
    const m = await person(t, "conv-member@example.com");
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Convert" });
    await join(t, owner, m, "conv-member@example.com", id);
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_pro_monthly" });
    expect(await seats(owner, id)).toEqual({ seats: 2, guests: 0, pending: 0 });
    // 16 (until Phase D adds a one-step conversion): remove the member, share one page with them.
    const note = await newDoc(owner, id);
    await owner.as.mutation(api.workspaces.removeMember, { workspaceId: id, profileId: m.profileId });
    await owner.as.mutation(api.sharing.grant, { documentId: note, email: "conv-member@example.com", role: "commenter" });
    expect(await seats(owner, id)).toEqual({ seats: 1, guests: 1, pending: 0 });
    expect((await workspaceSub(t, id))!.quantity).toBe(1);
    // 17: invite the guest back as a member: no seat while pending, one once accepted.
    const inviteId = await invite(t, owner, id, "conv-member@example.com");
    expect(await seats(owner, id)).toEqual({ seats: 1, guests: 1, pending: 1 });
    await m.as.mutation(api.workspaces.acceptInvite, { inviteId });
    expect(await seats(owner, id)).toEqual({ seats: 2, guests: 0, pending: 0 });
    expect((await workspaceSub(t, id))!.quantity).toBe(2);
  });

  test("a suspended account takes no seat until it's unsuspended", async () => {
    const t = setup();
    const owner = await person(t, "susp-owner@example.com");
    const m = await person(t, "susp-member@example.com");
    const staff = await person(t, "susp-staff@example.com");
    await t.run(async (ctx) => ctx.db.patch(staff.profileId as Id<"profiles">, { platformRole: "ops_admin" }));
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Susp" });
    await join(t, owner, m, "susp-member@example.com", id);
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_pro_monthly" });
    await staff.as.mutation(api.admin.suspendUser, { profileId: m.profileId, suspend: true, confirmEmail: "susp-member@example.com", reason: REASON });
    expect((await seats(owner, id)).seats).toBe(1);
    expect((await workspaceSub(t, id))!.quantity).toBe(1);
    await staff.as.mutation(api.admin.suspendUser, { profileId: m.profileId, suspend: false, confirmEmail: "susp-member@example.com", reason: REASON });
    expect((await workspaceSub(t, id))!.quantity).toBe(2);
  });

  test("two members accepting at the same moment: the quantity is right (35)", async () => {
    const t = setup();
    const owner = await person(t, "race-owner@example.com");
    const b = await person(t, "race-b@example.com");
    const c = await person(t, "race-c@example.com");
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Race" });
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_pro_monthly" });
    const [ib, ic] = [await invite(t, owner, id, "race-b@example.com"), await invite(t, owner, id, "race-c@example.com")];
    await Promise.all([b.as.mutation(api.workspaces.acceptInvite, { inviteId: ib }), c.as.mutation(api.workspaces.acceptInvite, { inviteId: ic })]);
    expect((await workspaceSub(t, id))!.quantity).toBe(3);
    expect((await summary(owner, id)).estimatedChargeCents).toBe(3 * 499);
  });

  test("with Polar: accepts are gathered into one sync that sets the subscription's seats to the current count; repeats are harmless (35)", async () => {
    vi.useFakeTimers();
    const t = setup();
    const owner = await person(t, "polar-race@example.com");
    const b = await person(t, "polar-b@example.com");
    const c = await person(t, "polar-c@example.com");
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "PolarRace" });
    const wid = await workspaceDbId(t, id);
    await t.run(async (ctx) => {
      const now = Date.now();
      await insertSubscription(ctx, { kind: "workspace", workspaceId: wid }, { planId: "workspace_pro_monthly", status: "active", provider: "polar", quantity: 1, polarSubscriptionId: "sub_ws", polarCustomerId: "cus_ws", currentPeriodEnd: now + 30 * DAY, createdAt: now, updatedAt: now });
    });
    withPolar();
    let polarSeats = 1;
    const calls = fakePolar((method, _path, body) => {
      if (method === "PATCH" && typeof body?.seats === "number") polarSeats = body.seats;
      return { id: "sub_ws", seats: polarSeats };
    });
    const [ib, ic] = [await invite(t, owner, id, "polar-b@example.com"), await invite(t, owner, id, "polar-c@example.com")];
    await Promise.all([b.as.mutation(api.workspaces.acceptInvite, { inviteId: ib }), c.as.mutation(api.workspaces.acceptInvite, { inviteId: ic })]);
    // One sync is scheduled for both accepts.
    const pending = await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((f) => f.name.includes("syncSeatQuantity") && f.state.kind === "pending"));
    expect(pending).toHaveLength(1);
    expect((await workspaceSub(t, id))!.seatSyncScheduledAt).toBeTypeOf("number");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const patches = calls.filter((x) => x.method === "PATCH" && x.path === "subscriptions/sub_ws");
    expect(patches).toHaveLength(1);
    expect(patches[0]!.body).toEqual({ seats: 3, proration_behavior: "prorate" });
    expect(polarSeats).toBe(3);
    expect(await workspaceSub(t, id)).toMatchObject({ quantity: 3 });
    expect((await workspaceSub(t, id))!.seatSyncScheduledAt).toBeUndefined();
    // A duplicate sync (or one racing another) reads the current count, sees Polar agrees, changes nothing.
    expect(await t.action(internal.workspaceBilling.syncSeatQuantity, { workspaceId: wid })).toEqual({ status: "unchanged", seats: 3 });
    expect(calls.filter((x) => x.method === "PATCH")).toHaveLength(1);
    // A member leaving syncs again (guests and pending invitations never count).
    await owner.as.mutation(api.workspaces.removeMember, { workspaceId: id, profileId: c.profileId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(calls.filter((x) => x.method === "PATCH").at(-1)!.body).toEqual({ seats: 2, proration_behavior: "prorate" });
  });

  test("a failed seat sync is retried", async () => {
    vi.useFakeTimers();
    const t = setup();
    const owner = await person(t, "retry@example.com");
    const b = await person(t, "retry-b@example.com");
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Retry" });
    const wid = await workspaceDbId(t, id);
    await t.run(async (ctx) => {
      const now = Date.now();
      await insertSubscription(ctx, { kind: "workspace", workspaceId: wid }, { planId: "workspace_pro_monthly", status: "active", provider: "polar", quantity: 1, polarSubscriptionId: "sub_r", currentPeriodEnd: now + 30 * DAY, createdAt: now, updatedAt: now });
    });
    withPolar();
    let failures = 2;
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { method: string }) => {
        seen.push(init.method);
        if (failures > 0) {
          failures--;
          return new Response("{}", { status: 503 });
        }
        return new Response(JSON.stringify({ id: "sub_r", seats: init.method === "GET" ? 1 : 2 }), { status: 200 });
      }),
    );
    await join(t, owner, b, "retry-b@example.com", id);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(seen).toEqual(["GET", "GET", "GET", "PATCH"]);
    expect(await workspaceSub(t, id)).toMatchObject({ quantity: 2 });
  });
});

describe("who can see and change workspace billing (25)", () => {
  test("the owner, and admins the owner allows; never members or guests", async () => {
    const t = setup();
    const owner = await person(t, "auth-owner@example.com");
    const admin = await person(t, "auth-admin@example.com");
    const member = await person(t, "auth-member@example.com");
    const guest = await person(t, "auth-guest@example.com");
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Auth" });
    await join(t, owner, admin, "auth-admin@example.com", id, "admin");
    await join(t, owner, member, "auth-member@example.com", id, "editor");
    const note = await newDoc(owner, id);
    await owner.as.mutation(api.sharing.grant, { documentId: note, email: "auth-guest@example.com", role: "editor" });

    expect((await summary(owner, id)).seats).toBe(3);
    await expect(summary(admin, id)).rejects.toThrow(/forbidden/);
    await expect(summary(member, id)).rejects.toThrow(/forbidden/);
    await expect(summary(guest, id)).rejects.toThrow(/not_found/);
    for (const p of [admin, member]) await expect(p.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_pro_monthly" })).rejects.toThrow(/forbidden/);
    await expect(guest.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_pro_monthly" })).rejects.toThrow(/not_found/);
    // Polar actions check the same thing before anything is sent.
    withPolar();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(member.as.action(api.workspaceBilling.checkout, { workspaceId: id, planId: "workspace_pro_monthly" })).rejects.toThrow(/forbidden/);
    await expect(admin.as.action(api.workspaceBilling.portal, { workspaceId: id })).rejects.toThrow(/forbidden/);
    await expect(guest.as.action(api.workspaceBilling.cancel, { workspaceId: id })).rejects.toThrow(/not_found/);
    expect(fetchSpy).not.toHaveBeenCalled();
    // The switcher and Members page mirror it.
    expect((await owner.as.query(api.workspaces.mine, {})).find((w) => w.id === id)!.canManageBilling).toBe(true);
    expect((await member.as.query(api.workspaces.mine, {})).find((w) => w.id === id)!.canManageBilling).toBe(false);

    // Only the owner can let an admin manage billing, and only an admin.
    await expect(admin.as.mutation(api.workspaces.setBillingManager, { workspaceId: id, profileId: admin.profileId, allowed: true })).rejects.toThrow(/forbidden/);
    await expect(owner.as.mutation(api.workspaces.setBillingManager, { workspaceId: id, profileId: member.profileId, allowed: true })).rejects.toThrow(/Only admins/);
    await owner.as.mutation(api.workspaces.setBillingManager, { workspaceId: id, profileId: admin.profileId, allowed: true });
    expect((await summary(admin, id)).seats).toBe(3);
    await admin.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_pro_monthly" });
    // Stepping down from admin ends it.
    await owner.as.mutation(api.workspaces.changeRole, { workspaceId: id, profileId: admin.profileId, role: "editor" });
    await expect(summary(admin, id)).rejects.toThrow(/forbidden/);
    await owner.as.mutation(api.workspaces.changeRole, { workspaceId: id, profileId: admin.profileId, role: "admin" });
    await expect(summary(admin, id)).rejects.toThrow(/forbidden/);
    // Members see the seat count and the price of a seat only if they can invite (owners and admins).
    expect((await member.as.query(api.workspaces.members, { workspaceId: id })).seats).toBeNull();
    expect((await admin.as.query(api.workspaces.members, { workspaceId: id })).seats).toMatchObject({ billable: 3, paid: true, seatPriceCents: 499, interval: "month" });
  });
});

describe("cancellation, ownership and the end of a period (28–30)", () => {
  test("canceling a Personal plan leaves workspace plans and memberships alone (28)", async () => {
    const t = setup();
    const owner = await person(t, "c28-owner@example.com");
    const m = await person(t, "c28-member@example.com");
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "C28" });
    await join(t, owner, m, "c28-member@example.com", id);
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_pro_monthly" });
    await m.as.mutation(api.billing.testPurchase, { plan: "pro", interval: "month" });
    await m.as.mutation(api.billing.cancelPlan, {});
    await t.run(async (ctx) => {
      const sub = await ctx.db.query("subscriptions").withIndex("by_profile", (q) => q.eq("profileId", m.profileId as Id<"profiles">)).unique();
      await ctx.db.patch(sub!._id, { currentPeriodEnd: Date.now() - 1, trialEndsAt: Date.now() - 1 });
    });
    await t.mutation(internal.billing.settleExpiredPlans, {});
    expect((await m.as.query(api.billing.mine, {})).entitlements.paidPlan).toBe("free");
    expect((await m.as.query(api.workspaces.mine, {})).find((w) => w.id === id)).toMatchObject({ plan: { id: "workspace_pro_monthly" }, aiIncluded: true });
    expect((await summary(owner, id)).seats).toBe(2);
  });

  test("canceling a workspace plan ends it at the period's end, and leaves Personal alone (29)", async () => {
    const t = setup();
    const owner = await person(t, "c29@example.com");
    await owner.as.mutation(api.billing.testPurchase, { plan: "pro", interval: "year" });
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "C29" });
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_pro_monthly" });
    await owner.as.action(api.workspaceBilling.cancel, { workspaceId: id });
    let s = await summary(owner, id);
    expect(s.subscription).toMatchObject({ cancelAtPeriodEnd: true });
    expect(s.entitlements.planId).toBe("workspace_pro_monthly");
    await owner.as.action(api.workspaceBilling.resume, { workspaceId: id });
    expect((await summary(owner, id)).subscription!.cancelAtPeriodEnd).toBe(false);
    await owner.as.action(api.workspaceBilling.cancel, { workspaceId: id });
    const sub = (await workspaceSub(t, id))!;
    await t.run(async (ctx) => ctx.db.patch(sub._id, { currentPeriodEnd: Date.now() - 1 }));
    await t.mutation(internal.billing.settleExpiredPlans, {});
    s = await summary(owner, id);
    expect(s.entitlements).toMatchObject({ planId: "workspace_free", storageBytes: 1 * GB });
    // Nothing deleted; the payment history stays.
    expect(s.payments).toHaveLength(1);
    expect((await owner.as.query(api.billing.mine, {})).entitlements).toMatchObject({ paidPlan: "pro", ai: true });
  });

  test("a workspace whose paid plan ends while it holds more than Free allows keeps everything; only growth is blocked (19)", async () => {
    const t = setup();
    const owner = await person(t, "c19-owner@example.com");
    const m = await person(t, "c19-member@example.com");
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "C19" });
    await join(t, owner, m, "c19-member@example.com", id);
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_pro_monthly" });
    const note = await newDoc(owner, id);
    const wid = await workspaceDbId(t, id);
    await t.run(async (ctx) => ctx.db.patch(wid, { storageUsedBytes: 40 * GB }));
    const upload = (p: Person) => p.as.mutation(api.files.generateUploadUrl, { documentId: note, filename: "a.png", size: 1024 * 1024, mimeType: "image/png", kind: "image" });
    expect((await upload(m)).uploadUrl).toBeTruthy();
    // The Pro plan is canceled and its period ends: Workspace Free (the owner's 1 GB pool) with 40 GB stored.
    await owner.as.action(api.workspaceBilling.cancel, { workspaceId: id });
    const sub = (await workspaceSub(t, id))!;
    await t.run(async (ctx) => ctx.db.patch(sub._id, { currentPeriodEnd: Date.now() - 1 }));
    await t.mutation(internal.billing.settleExpiredPlans, {});
    const s = await summary(owner, id);
    expect(s.entitlements).toMatchObject({ planId: "workspace_free", storageBytes: 1 * GB });
    expect(s.storageUsedBytes).toBe(40 * GB);
    // Growth is refused for everyone, with the reason…
    for (const p of [owner, m]) await expect(upload(p)).rejects.toThrow(/is over its owner's free storage \(40 GB of 1 GB, shared by the owner's Personal and the free workspaces they own\)\. Everything already stored stays available/);
    // …but nothing was removed and the work goes on: reading, writing text, organizing and exporting.
    expect((await m.as.query(api.documents.get, { documentId: note }))!.access).toBe("write");
    const [edit] = await m.as.mutation(api.sync.push, {
      scope: inWorkspace(id),
      deviceId: "device-c19",
      ops: [{ opId: ulid(), kind: "block.upsert", documentId: note, block: para(ulid(), "Still writing"), baseRevision: null, fields: ["content", "position"] }],
    });
    expect(edit!.status).toBe("applied");
    const { id: folderId } = await m.as.mutation(api.organization.createFolder, { scope: inWorkspace(id), name: "Archive" });
    await m.as.mutation(api.documents.move, { documentId: note, folderId });
    expect((await owner.as.action(api.exports.exportScope, { scope: inWorkspace(id) })).documents).toBeGreaterThan(0);
    expect((await summary(owner, id)).storageUsedBytes).toBe(40 * GB);
    // Freeing room below the limit lets uploads through again.
    await t.run(async (ctx) => ctx.db.patch(wid, { storageUsedBytes: 500 * 1024 * 1024 }));
    expect((await upload(m)).uploadUrl).toBeTruthy();
  });

  test("the hourly job renews test plans and ends manual plans whose date has passed", async () => {
    const t = setup();
    const owner = await person(t, "settle@example.com");
    const staff = await person(t, "settle-staff@example.com");
    await t.run(async (ctx) => ctx.db.patch(staff.profileId as Id<"profiles">, { platformRole: "ops_admin" }));
    const a = (await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Renews" })).id;
    const b = (await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Manual" })).id;
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: a, planId: "workspace_pro_monthly" });
    await staff.as.mutation(api.adminBilling.setWorkspacePlan, { workspaceId: b, planId: "workspace_pro_ai_monthly", until: Date.now() + DAY, reason: REASON });
    for (const w of [a, b]) {
      const sub = (await workspaceSub(t, w))!;
      await t.run(async (ctx) => ctx.db.patch(sub._id, { currentPeriodEnd: Date.now() - 1 }));
    }
    await t.mutation(internal.billing.settleExpiredPlans, {});
    expect((await summary(owner, a)).entitlements.planId).toBe("workspace_pro_monthly");
    expect((await workspaceSub(t, a))!.currentPeriodEnd).toBeGreaterThan(Date.now());
    expect((await summary(owner, b)).entitlements.planId).toBe("workspace_free");
  });

  test("transferring ownership keeps the subscription on the workspace (30)", async () => {
    const t = setup();
    const owner = await person(t, "c30-owner@example.com");
    const heir = await person(t, "c30-heir@example.com");
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "C30" });
    await join(t, owner, heir, "c30-heir@example.com", id, "admin");
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_pro_ai_monthly" });
    const before = (await workspaceSub(t, id))!;
    await owner.as.mutation(api.workspaces.transferOwnership, { workspaceId: id, profileId: heir.profileId });
    const after = (await workspaceSub(t, id))!;
    expect(after._id).toBe(before._id);
    expect(after).toMatchObject({ workspaceId: before.workspaceId, planId: "workspace_pro_ai_monthly", quantity: 2 });
    expect(after.profileId).toBeUndefined();
    expect((await summary(heir, id)).entitlements.planId).toBe("workspace_pro_ai_monthly");
    // The previous owner is now an admin without billing access (the new owner can grant it).
    await expect(summary(owner, id)).rejects.toThrow(/forbidden/);
    // Neither person's Personal plan changed.
    for (const p of [owner, heir]) expect((await p.as.query(api.billing.mine, {})).payments).toHaveLength(0);
  });
});

describe("Polar workspace billing", () => {
  test("checkout: seats are counted on the server, the buyer's own customer pays, and only billing managers may start it", async () => {
    const t = setup();
    const owner = await person(t, "ws-checkout@example.com");
    const m = await person(t, "ws-checkout-m@example.com");
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Checkout" });
    await join(t, owner, m, "ws-checkout-m@example.com", id);
    await invite(t, owner, id, "pending@example.com");
    const wid = await workspaceDbId(t, id);
    withPolar();
    const calls = fakePolar(() => ({ url: "https://sandbox.polar.sh/checkout/ws" }));
    await expect(m.as.action(api.workspaceBilling.checkout, { workspaceId: id, planId: "workspace_pro_monthly" })).rejects.toThrow(/forbidden/);
    expect(calls).toHaveLength(0);
    expect(await owner.as.action(api.workspaceBilling.checkout, { workspaceId: id, planId: "workspace_core_yearly" })).toEqual({ url: "https://sandbox.polar.sh/checkout/ws" });
    // Two members (the pending invitation isn't billed).
    expect(calls[0]!.body).toMatchObject({ products: [product("workspace_core_yearly")], seats: 2, external_customer_id: owner.profileId, metadata: { kind: "workspace", workspaceId: wid, profileId: owner.profileId } });
    expect(String(calls[0]!.body!.success_url)).toContain("/settings/workspace-billing?checkout=success");
  });

  test("subscription and orders land on the workspace; a redelivered event applies once; only the payer gets the portal (34)", async () => {
    const t = setup();
    const owner = await person(t, "ws-polar@example.com");
    const admin = await person(t, "ws-polar-admin@example.com");
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Hooked" });
    await join(t, owner, admin, "ws-polar-admin@example.com", id, "admin");
    await owner.as.mutation(api.workspaces.setBillingManager, { workspaceId: id, profileId: admin.profileId, allowed: true });
    const wid = await workspaceDbId(t, id);
    withPolar();
    const meta = { kind: "workspace", workspaceId: wid as string, profileId: owner.profileId };
    const start = Date.now();
    const sub = (extra: Partial<Parameters<typeof subscription>[0]> = {}) => subscription({ id: "sub_w", productKey: "workspace_pro_yearly", metadata: meta, seats: 2, start, end: start + 365 * DAY, ...extra });
    // Nothing is granted until Polar says so.
    expect((await summary(owner, id)).entitlements.planId).toBe("workspace_free");
    expect((await postEvent(t, "subscription.created", sub(), { at: start })).status).toBe(202);
    let s = await summary(owner, id);
    expect(s.entitlements).toMatchObject({ planId: "workspace_pro_yearly", ai: true, storageBytes: 20 * GB });
    expect(s.subscription).toMatchObject({ provider: "polar", status: "active", quantity: 2, currentPeriodEnd: start + 365 * DAY, youPay: true });
    expect((await summary(admin, id)).subscription).toMatchObject({ youPay: false });
    const paid = order({ id: "ord_w1", productKey: "workspace_pro_yearly", total: 9800, metadata: meta, subscriptionId: "sub_w", seats: 2 });
    const first = await postEvent(t, "order.paid", paid);
    expect(await t.mutation(internal.billing.applyPolarEvent, { eventId: first.id, type: "order.paid", at: Date.now(), data: paid })).toEqual({ status: "duplicate" });
    await postEvent(t, "order.paid", paid);
    s = await summary(owner, id);
    expect(s.payments).toHaveLength(1);
    expect(s.payments[0]).toMatchObject({ amountCents: 9800, plan: "pro", planId: "workspace_pro_yearly", interval: "year", quantity: 2, status: "paid" });
    // The owner's Personal has no subscription or payment from this.
    const personal = await owner.as.query(api.billing.mine, {});
    expect(personal.payments).toHaveLength(0);
    expect(personal.subscription).toMatchObject({ provider: "none" });
    // A plan change (Pro → Pro AI) arrives as an update; an older event delivered late is ignored.
    await postEvent(t, "subscription.updated", sub({ productKey: "workspace_pro_ai_yearly" }), { at: start + 5000 });
    await postEvent(t, "subscription.updated", sub(), { at: start + 3000 });
    expect((await summary(owner, id)).entitlements.planId).toBe("workspace_pro_ai_yearly");
    // Past due keeps the plan while Polar retries.
    await postEvent(t, "subscription.past_due", sub({ productKey: "workspace_pro_ai_yearly", status: "past_due" }), { at: start + 6000 });
    s = await summary(owner, id);
    expect(s.subscription!.status).toBe("past_due");
    expect(s.entitlements.planId).toBe("workspace_pro_ai_yearly");
    // Portal: the payer only (their own Polar customer); other billing managers change the plan here instead.
    const calls = fakePolar(() => ({ customer_portal_url: "https://sandbox.polar.sh/portal/ws" }));
    await expect(admin.as.action(api.workspaceBilling.portal, { workspaceId: id })).rejects.toThrow(/Only the person who started this subscription/);
    expect(await owner.as.action(api.workspaceBilling.portal, { workspaceId: id })).toEqual({ url: "https://sandbox.polar.sh/portal/ws" });
    expect(calls.at(-1)).toMatchObject({ path: "customer-sessions/", body: { external_customer_id: owner.profileId } });
    await admin.as.action(api.workspaceBilling.changePlan, { workspaceId: id, planId: "workspace_core_yearly" });
    expect(calls.at(-1)).toMatchObject({ method: "PATCH", path: "subscriptions/sub_w", body: { product_id: product("workspace_core_yearly"), proration_behavior: "prorate" } });
    await admin.as.action(api.workspaceBilling.cancel, { workspaceId: id });
    expect(calls.at(-1)).toMatchObject({ method: "PATCH", path: "subscriptions/sub_w", body: { cancel_at_period_end: true } });
    // Polar ends it (revoked): the workspace is on Free; nothing else changes.
    await postEvent(t, "subscription.revoked", sub({ productKey: "workspace_core_yearly", status: "canceled" }), { at: start + 9000 });
    s = await summary(owner, id);
    expect(s.entitlements).toMatchObject({ planId: "workspace_free" });
    expect(s.payments).toHaveLength(1);
    expect(await t.run(async (ctx) => (await ctx.db.query("subscriptions").collect()).filter((r) => r.workspaceId === wid).length)).toBe(1);
  });

  test("a subscription whose seats don't match the members schedules a seat sync", async () => {
    const t = setup();
    const owner = await person(t, "mismatch@example.com");
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Mismatch" });
    const wid = await workspaceDbId(t, id);
    withPolar();
    await postEvent(t, "subscription.created", subscription({ id: "sub_m", productKey: "workspace_pro_monthly", seats: 4, metadata: { kind: "workspace", workspaceId: wid, profileId: owner.profileId } }));
    expect(await workspaceSub(t, id)).toMatchObject({ quantity: 4 });
    expect((await workspaceSub(t, id))!.seatSyncScheduledAt).toBeTypeOf("number");
  });
});

describe("admin: workspace plans", () => {
  test("admins set a workspace's plan by hand (audited); support staff can't; Polar plans are changed in Polar", async () => {
    const t = setup();
    const owner = await person(t, "comp-owner@example.com");
    const ops = await person(t, "comp-ops@example.com");
    const support = await person(t, "comp-support@example.com");
    await t.run(async (ctx) => {
      await ctx.db.patch(ops.profileId as Id<"profiles">, { platformRole: "ops_admin" });
      await ctx.db.patch(support.profileId as Id<"profiles">, { platformRole: "support_admin" });
    });
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Comped" });
    await expect(support.as.mutation(api.adminBilling.setWorkspacePlan, { workspaceId: id, planId: "workspace_pro_monthly", reason: REASON })).rejects.toThrow(/not_found/);
    await expect(owner.as.mutation(api.adminBilling.setWorkspacePlan, { workspaceId: id, planId: "workspace_pro_monthly", reason: REASON })).rejects.toThrow(/not_found/);
    await expect(ops.as.mutation(api.adminBilling.setWorkspacePlan, { workspaceId: id, planId: "workspace_pro_monthly", reason: "short" })).rejects.toThrow(/reason/);
    await ops.as.mutation(api.adminBilling.setWorkspacePlan, { workspaceId: id, planId: "workspace_pro_monthly", reason: REASON });
    let s = await summary(owner, id);
    expect(s.entitlements).toMatchObject({ planId: "workspace_pro_monthly", ai: true });
    expect(s.subscription).toMatchObject({ provider: "manual", quantity: 1, currentPeriodEnd: null });
    // The owner's Personal plan is untouched.
    expect((await owner.as.query(api.billing.mine, {})).subscription).toMatchObject({ plan: "free", provider: "none" });
    const view = await ops.as.mutation(api.admin.viewWorkspace, { workspaceId: id });
    expect(view.billing).toMatchObject({ planId: "workspace_pro_monthly", paid: true, seats: 1, subscription: { provider: "manual" } });
    const log = await ops.as.query(api.admin.auditLog, {});
    expect(log.entries.map((e) => e.action)).toContain("billing.set_workspace_plan");
    // Back to Free.
    await ops.as.mutation(api.adminBilling.setWorkspacePlan, { workspaceId: id, planId: "workspace_free", reason: REASON });
    s = await summary(owner, id);
    expect(s.entitlements.planId).toBe("workspace_free");
    // The workspaces list shows each workspace's plan (so it can be changed from the list).
    const listed = async () => (await ops.as.mutation(api.admin.listWorkspaces, {})).workspaces.find((w) => w.id === id)!;
    expect(await listed()).toMatchObject({ planId: "workspace_free", planEndsAt: null, polarBilled: false });
    const until = Date.now() + 10 * DAY;
    await ops.as.mutation(api.adminBilling.setWorkspacePlan, { workspaceId: id, planId: "workspace_pro_ai_yearly", until, reason: REASON });
    expect(await listed()).toMatchObject({ planId: "workspace_pro_ai_yearly", planEndsAt: until, polarBilled: false });
    // A live Polar plan is flagged in the list and the detail, and refused.
    const sub = (await workspaceSub(t, id))!;
    await t.run(async (ctx) => ctx.db.patch(sub._id, { provider: "polar", planId: "workspace_pro_monthly", status: "active", currentPeriodEnd: Date.now() + DAY }));
    expect(await listed()).toMatchObject({ planId: "workspace_pro_monthly", polarBilled: true });
    expect((await ops.as.mutation(api.admin.viewWorkspace, { workspaceId: id })).billing.polarBilled).toBe(true);
    await expect(ops.as.mutation(api.adminBilling.setWorkspacePlan, { workspaceId: id, planId: "workspace_pro_ai_monthly", reason: REASON })).rejects.toThrow(/billed through Polar/);
  });
});
