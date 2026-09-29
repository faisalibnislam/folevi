// Workspace plans, seats and billing (docs/ACCOUNT_MODEL_PLAN.md, Phase C). Numbers in test names are the
// specification's scenarios.
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { insertPayment, insertSubscription } from "../../convex/lib/billing";
import { inWorkspace, para, person, PERSONAL, setup, ulid, type T } from "./helpers";

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

const STRIPE_ENV = {
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_PRICE_WS_TEAM_MONTH: "price_team_m",
  STRIPE_PRICE_WS_TEAM_YEAR: "price_team_y",
  STRIPE_PRICE_WS_BUSINESS_MONTH: "price_biz_m",
  STRIPE_PRICE_WS_BUSINESS_YEAR: "price_biz_y",
};
function withStripe() {
  Object.assign(process.env, STRIPE_ENV);
}
afterEach(() => {
  for (const k of Object.keys(STRIPE_ENV)) delete process.env[k];
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
      await expect(insertSubscription(ctx, { kind: "user", profileId: pid }, { planId: "workspace_team_monthly", status: "active", provider: "none", createdAt: now, updatedAt: now })).rejects.toThrow(/personal tier/);
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
  test("Team and Business: AI for members, 100 GB and 1 TB; Free: 5 GB and no AI", async () => {
    const t = setup();
    const owner = await person(t, "plans-owner@example.com");
    const member = await person(t, "plans-member@example.com");
    await endTrial(t, member);
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Plans" });
    await join(t, owner, member, "plans-member@example.com", id);
    let s = await summary(owner, id);
    expect(s.entitlements).toMatchObject({ planId: "workspace_free", ai: false, storageBytes: 5 * GB });
    await expect(member.as.mutation(internal.ai.begin, { scope: inWorkspace(id) })).rejects.toThrow(/Team and Business/);

    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_team_monthly" });
    s = await summary(owner, id);
    expect(s.entitlements).toMatchObject({ planId: "workspace_team_monthly", paid: true, ai: true, storageBytes: 100 * GB });
    expect(s.plan).toMatchObject({ tier: "team", name: "Team", interval: "month", seatPriceCents: 500 });
    expect(s).toMatchObject({ seats: 2, estimatedChargeCents: 1000 });
    expect(s.subscription).toMatchObject({ provider: "test", status: "active", quantity: 2 });
    expect(s.payments[0]).toMatchObject({ amountCents: 1000, plan: "team", quantity: 2, status: "paid" });
    // A Free (trial over) member gets AI inside the Team workspace.
    await member.as.mutation(internal.ai.begin, { scope: inWorkspace(id) });

    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_business_yearly" });
    s = await summary(owner, id);
    expect(s.entitlements).toMatchObject({ planId: "workspace_business_yearly", ai: true, aiFairUse: "high", storageBytes: 1024 * GB });
    expect(s.estimatedChargeCents).toBe(2 * 9900);
    // The switcher reads the plan's short name.
    expect((await member.as.query(api.workspaces.mine, {})).find((w) => w.id === id)!.plan).toMatchObject({ shortName: "Business", tier: "business" });
  });

  test("an owner upgrading a workspace leaves their Personal unchanged (7)", async () => {
    const t = setup();
    const owner = await person(t, "upgrader@example.com");
    await endTrial(t, owner);
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Upgrade" });
    const before = await owner.as.query(api.billing.mine, {});
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_business_monthly" });
    const after = await owner.as.query(api.billing.mine, {});
    expect(after.entitlements).toEqual(before.entitlements);
    expect(after.entitlements).toMatchObject({ planId: "personal_free", ai: false, storageBytes: 1 * GB });
    // Personal billing history has none of the workspace's payments, and the other way round.
    expect(after.payments).toHaveLength(0);
    await owner.as.mutation(api.billing.testPurchase, { plan: "basic", interval: "month" });
    expect((await owner.as.query(api.billing.mine, {})).payments).toHaveLength(1);
    expect((await summary(owner, id)).payments).toHaveLength(1);
    expect((await summary(owner, id)).payments[0]!.plan).toBe("business");
    await expect(owner.as.mutation(internal.ai.begin, { scope: PERSONAL })).rejects.toThrow(/part of Pro/);
  });

  test("test purchases are refused in production", async () => {
    const t = setup();
    const owner = await person(t, "prod-ws@example.com");
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Prod" });
    process.env.FOLEVI_ENV = "production";
    try {
      await expect(owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_team_monthly" })).rejects.toThrow(/only available in development/);
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
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_team_monthly" });
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
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_team_yearly" });
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
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_team_monthly" });
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
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_team_monthly" });
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
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_team_monthly" });
    const [ib, ic] = [await invite(t, owner, id, "race-b@example.com"), await invite(t, owner, id, "race-c@example.com")];
    await Promise.all([b.as.mutation(api.workspaces.acceptInvite, { inviteId: ib }), c.as.mutation(api.workspaces.acceptInvite, { inviteId: ic })]);
    expect((await workspaceSub(t, id))!.quantity).toBe(3);
    expect((await summary(owner, id)).estimatedChargeCents).toBe(1500);
  });

  test("with Stripe: accepts are gathered into one sync that sets Stripe's quantity to the current count; repeats are harmless (35)", async () => {
    vi.useFakeTimers();
    const t = setup();
    const owner = await person(t, "stripe-race@example.com");
    const b = await person(t, "stripe-b@example.com");
    const c = await person(t, "stripe-c@example.com");
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "StripeRace" });
    const wid = await workspaceDbId(t, id);
    await t.run(async (ctx) => {
      const now = Date.now();
      await insertSubscription(ctx, { kind: "workspace", workspaceId: wid }, { planId: "workspace_team_monthly", status: "active", provider: "stripe", quantity: 1, stripeSubscriptionId: "sub_ws", stripeSubscriptionItemId: "si_ws", stripeCustomerId: "cus_ws", currentPeriodEnd: now + 30 * DAY, createdAt: now, updatedAt: now });
    });
    let stripeQuantity = 1;
    const calls: { method: string; url: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { method: string; body?: string }) => {
        calls.push({ method: init.method, url, body: init.body ?? "" });
        if (init.method === "POST") stripeQuantity = Number(new URLSearchParams(init.body).get("quantity"));
        return new Response(JSON.stringify({ id: "si_ws", object: "subscription_item", quantity: stripeQuantity }), { status: 200 });
      }),
    );
    withStripe();
    const [ib, ic] = [await invite(t, owner, id, "stripe-b@example.com"), await invite(t, owner, id, "stripe-c@example.com")];
    await Promise.all([b.as.mutation(api.workspaces.acceptInvite, { inviteId: ib }), c.as.mutation(api.workspaces.acceptInvite, { inviteId: ic })]);
    // One sync is scheduled for both accepts.
    const pending = await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((f) => f.name.includes("syncSeatQuantity") && f.state.kind === "pending"));
    expect(pending).toHaveLength(1);
    expect((await workspaceSub(t, id))!.seatSyncScheduledAt).toBeTypeOf("number");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const posts = calls.filter((x) => x.method === "POST" && x.url.includes("subscription_items/si_ws"));
    expect(posts).toHaveLength(1);
    expect(new URLSearchParams(posts[0]!.body).get("quantity")).toBe("3");
    expect(new URLSearchParams(posts[0]!.body).get("proration_behavior")).toBe("create_prorations");
    expect(stripeQuantity).toBe(3);
    expect(await workspaceSub(t, id)).toMatchObject({ quantity: 3 });
    expect((await workspaceSub(t, id))!.seatSyncScheduledAt).toBeUndefined();
    // A duplicate sync (or one racing another) reads the current count, sees Stripe agrees, changes nothing.
    expect(await t.action(internal.workspaceBilling.syncSeatQuantity, { workspaceId: wid })).toEqual({ status: "unchanged", seats: 3 });
    expect(calls.filter((x) => x.method === "POST")).toHaveLength(1);
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
    for (const p of [admin, member]) await expect(p.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_team_monthly" })).rejects.toThrow(/forbidden/);
    await expect(guest.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_team_monthly" })).rejects.toThrow(/not_found/);
    // Stripe actions check the same thing before anything is sent.
    withStripe();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(member.as.action(api.workspaceBilling.checkout, { workspaceId: id, planId: "workspace_team_monthly" })).rejects.toThrow(/forbidden/);
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
    await admin.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_team_monthly" });
    // Stepping down from admin ends it.
    await owner.as.mutation(api.workspaces.changeRole, { workspaceId: id, profileId: admin.profileId, role: "editor" });
    await expect(summary(admin, id)).rejects.toThrow(/forbidden/);
    await owner.as.mutation(api.workspaces.changeRole, { workspaceId: id, profileId: admin.profileId, role: "admin" });
    await expect(summary(admin, id)).rejects.toThrow(/forbidden/);
    // Members see the seat count and the price of a seat only if they can invite (owners and admins).
    expect((await member.as.query(api.workspaces.members, { workspaceId: id })).seats).toBeNull();
    expect((await admin.as.query(api.workspaces.members, { workspaceId: id })).seats).toMatchObject({ billable: 3, paid: true, seatPriceCents: 500, interval: "month" });
  });
});

describe("cancellation, ownership and the end of a period (28–30)", () => {
  test("canceling a Personal plan leaves workspace plans and memberships alone (28)", async () => {
    const t = setup();
    const owner = await person(t, "c28-owner@example.com");
    const m = await person(t, "c28-member@example.com");
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "C28" });
    await join(t, owner, m, "c28-member@example.com", id);
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_team_monthly" });
    await m.as.mutation(api.billing.testPurchase, { plan: "pro", interval: "month" });
    await m.as.mutation(api.billing.cancelPlan, {});
    await t.run(async (ctx) => {
      const sub = await ctx.db.query("subscriptions").withIndex("by_profile", (q) => q.eq("profileId", m.profileId as Id<"profiles">)).unique();
      await ctx.db.patch(sub!._id, { currentPeriodEnd: Date.now() - 1, trialEndsAt: Date.now() - 1 });
    });
    await t.mutation(internal.billing.settleExpiredPlans, {});
    expect((await m.as.query(api.billing.mine, {})).entitlements.paidPlan).toBe("free");
    expect((await m.as.query(api.workspaces.mine, {})).find((w) => w.id === id)).toMatchObject({ plan: { id: "workspace_team_monthly" }, aiIncluded: true });
    expect((await summary(owner, id)).seats).toBe(2);
  });

  test("canceling a workspace plan ends it at the period's end, and leaves Personal alone (29)", async () => {
    const t = setup();
    const owner = await person(t, "c29@example.com");
    await owner.as.mutation(api.billing.testPurchase, { plan: "pro", interval: "year" });
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "C29" });
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_team_monthly" });
    await owner.as.action(api.workspaceBilling.cancel, { workspaceId: id });
    let s = await summary(owner, id);
    expect(s.subscription).toMatchObject({ cancelAtPeriodEnd: true });
    expect(s.entitlements.planId).toBe("workspace_team_monthly");
    await owner.as.action(api.workspaceBilling.resume, { workspaceId: id });
    expect((await summary(owner, id)).subscription!.cancelAtPeriodEnd).toBe(false);
    await owner.as.action(api.workspaceBilling.cancel, { workspaceId: id });
    const sub = (await workspaceSub(t, id))!;
    await t.run(async (ctx) => ctx.db.patch(sub._id, { currentPeriodEnd: Date.now() - 1 }));
    await t.mutation(internal.billing.settleExpiredPlans, {});
    s = await summary(owner, id);
    expect(s.entitlements).toMatchObject({ planId: "workspace_free", ai: false, storageBytes: 5 * GB });
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
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_team_monthly" });
    const note = await newDoc(owner, id);
    const wid = await workspaceDbId(t, id);
    await t.run(async (ctx) => ctx.db.patch(wid, { storageUsedBytes: 40 * GB }));
    const upload = (p: Person) => p.as.mutation(api.files.generateUploadUrl, { documentId: note, filename: "a.png", size: 1024 * 1024, mimeType: "image/png", kind: "image" });
    expect((await upload(m)).uploadUrl).toBeTruthy();
    // The Team plan is canceled and its period ends: Workspace Free (5 GB) with 40 GB stored.
    await owner.as.action(api.workspaceBilling.cancel, { workspaceId: id });
    const sub = (await workspaceSub(t, id))!;
    await t.run(async (ctx) => ctx.db.patch(sub._id, { currentPeriodEnd: Date.now() - 1 }));
    await t.mutation(internal.billing.settleExpiredPlans, {});
    const s = await summary(owner, id);
    expect(s.entitlements).toMatchObject({ planId: "workspace_free", storageBytes: 5 * GB });
    expect(s.storageUsedBytes).toBe(40 * GB);
    // Growth is refused for everyone, with the reason…
    for (const p of [owner, m]) await expect(upload(p)).rejects.toThrow(/is over its storage limit \(40 GB of 5 GB on Workspace Free\)\. Everything already stored stays available/);
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
    await t.run(async (ctx) => ctx.db.patch(wid, { storageUsedBytes: 4 * GB }));
    expect((await upload(m)).uploadUrl).toBeTruthy();
  });

  test("the hourly job renews test plans and ends manual plans whose date has passed", async () => {
    const t = setup();
    const owner = await person(t, "settle@example.com");
    const staff = await person(t, "settle-staff@example.com");
    await t.run(async (ctx) => ctx.db.patch(staff.profileId as Id<"profiles">, { platformRole: "ops_admin" }));
    const a = (await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Renews" })).id;
    const b = (await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Manual" })).id;
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: a, planId: "workspace_team_monthly" });
    await staff.as.mutation(api.adminBilling.setWorkspacePlan, { workspaceId: b, planId: "workspace_business_monthly", until: Date.now() + DAY, reason: REASON });
    for (const w of [a, b]) {
      const sub = (await workspaceSub(t, w))!;
      await t.run(async (ctx) => ctx.db.patch(sub._id, { currentPeriodEnd: Date.now() - 1 }));
    }
    await t.mutation(internal.billing.settleExpiredPlans, {});
    expect((await summary(owner, a)).entitlements.planId).toBe("workspace_team_monthly");
    expect((await workspaceSub(t, a))!.currentPeriodEnd).toBeGreaterThan(Date.now());
    expect((await summary(owner, b)).entitlements.planId).toBe("workspace_free");
  });

  test("transferring ownership keeps the subscription on the workspace (30)", async () => {
    const t = setup();
    const owner = await person(t, "c30-owner@example.com");
    const heir = await person(t, "c30-heir@example.com");
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "C30" });
    await join(t, owner, heir, "c30-heir@example.com", id, "admin");
    await owner.as.mutation(api.workspaceBilling.testPurchase, { workspaceId: id, planId: "workspace_business_monthly" });
    const before = (await workspaceSub(t, id))!;
    await owner.as.mutation(api.workspaces.transferOwnership, { workspaceId: id, profileId: heir.profileId });
    const after = (await workspaceSub(t, id))!;
    expect(after._id).toBe(before._id);
    expect(after).toMatchObject({ workspaceId: before.workspaceId, planId: "workspace_business_monthly", quantity: 2 });
    expect(after.profileId).toBeUndefined();
    expect((await summary(heir, id)).entitlements.planId).toBe("workspace_business_monthly");
    // The previous owner is now an admin without billing access (the new owner can grant it).
    await expect(summary(owner, id)).rejects.toThrow(/forbidden/);
    // Neither person's Personal plan changed.
    for (const p of [owner, heir]) expect((await p.as.query(api.billing.mine, {})).payments).toHaveLength(0);
  });
});

describe("Stripe workspace events", () => {
  test("checkout, subscription and invoices land on the workspace; a redelivered event applies once (34)", async () => {
    const t = setup();
    const owner = await person(t, "ws-stripe@example.com");
    const m = await person(t, "ws-stripe-m@example.com");
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Hooked" });
    await join(t, owner, m, "ws-stripe-m@example.com", id);
    const wid = await workspaceDbId(t, id);
    withStripe();
    const sec = Math.floor(Date.now() / 1000);
    const end = sec + 30 * 86_400;
    const apply = (eventId: string, type: string, object: Record<string, unknown>, created = sec) => t.mutation(internal.billing.applyStripeEvent, { eventId, created, type, object });
    // Returning from Checkout grants nothing by itself.
    expect((await summary(owner, id)).entitlements.planId).toBe("workspace_free");
    await apply("evt_c", "checkout.session.completed", { object: "checkout.session", client_reference_id: `ws:${wid}`, metadata: { workspaceId: wid }, customer: "cus_w", subscription: "sub_w" });
    expect((await summary(owner, id)).entitlements.planId).toBe("workspace_free");
    const subscription = { object: "subscription", id: "sub_w", customer: "cus_w", status: "active", cancel_at_period_end: false, metadata: { workspaceId: wid }, items: { data: [{ id: "si_w", price: { id: "price_team_y" }, quantity: 2, current_period_start: sec, current_period_end: end }] } };
    expect(await apply("evt_s", "customer.subscription.created", subscription, sec + 1)).toEqual({ status: "applied" });
    let s = await summary(owner, id);
    expect(s.entitlements).toMatchObject({ planId: "workspace_team_yearly", ai: true, storageBytes: 100 * GB });
    expect(s.subscription).toMatchObject({ provider: "stripe", status: "active", quantity: 2, currentPeriodEnd: end * 1000 });
    const invoice = { object: "invoice", id: "in_w", subscription: "sub_w", customer: "cus_w", amount_paid: 9800, currency: "usd" };
    await apply("evt_i", "invoice.paid", invoice, sec + 2);
    expect(await apply("evt_i", "invoice.paid", invoice, sec + 2)).toEqual({ status: "duplicate" });
    await apply("evt_ch", "charge.succeeded", { object: "charge", customer: "cus_w", invoice: "in_w", payment_method_details: { card: { brand: "visa", last4: "4242" } } }, sec + 2);
    s = await summary(owner, id);
    expect(s.payments).toHaveLength(1);
    expect(s.payments[0]).toMatchObject({ amountCents: 9800, plan: "team", interval: "year", quantity: 2, status: "paid" });
    expect(s.subscription!.paymentMethod).toBe("Visa •••• 4242");
    // The owner's Personal has no Stripe customer, subscription or payment from this.
    const personal = await owner.as.query(api.billing.mine, {});
    expect(personal.payments).toHaveLength(0);
    expect(personal.subscription).toMatchObject({ provider: "none" });
    // A plan change (Team → Business) arrives as an update; an older event delivered late is ignored.
    await apply("evt_u", "customer.subscription.updated", { ...subscription, items: { data: [{ id: "si_w", price: { id: "price_biz_y" }, quantity: 2, current_period_end: end }] } }, sec + 5);
    expect(await apply("evt_old", "customer.subscription.updated", subscription, sec + 3)).toEqual({ status: "stale" });
    expect((await summary(owner, id)).entitlements.planId).toBe("workspace_business_yearly");
    // Failed payment: past due keeps the plan while Stripe retries.
    await apply("evt_f", "invoice.payment_failed", { ...invoice, id: "in_w2", amount_due: 19800 }, sec + 6);
    s = await summary(owner, id);
    expect(s.subscription!.status).toBe("past_due");
    expect(s.entitlements.planId).toBe("workspace_business_yearly");
    // Stripe gives up (or the period ends after a cancel): the workspace is on Free; nothing else changes.
    await apply("evt_d", "customer.subscription.deleted", { ...subscription, status: "canceled" }, sec + 7);
    s = await summary(owner, id);
    expect(s.entitlements).toMatchObject({ planId: "workspace_free", ai: false });
    expect(s.payments).toHaveLength(2);
    expect(await t.run(async (ctx) => (await ctx.db.query("subscriptions").collect()).filter((r) => r.workspaceId === wid).length)).toBe(1);
  });

  test("a subscription whose quantity doesn't match the members schedules a seat sync", async () => {
    const t = setup();
    const owner = await person(t, "mismatch@example.com");
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Mismatch" });
    const wid = await workspaceDbId(t, id);
    withStripe();
    const sec = Math.floor(Date.now() / 1000);
    await t.mutation(internal.billing.applyStripeEvent, {
      eventId: "evt_m",
      created: sec,
      type: "customer.subscription.created",
      object: { object: "subscription", id: "sub_m", customer: "cus_m", status: "active", metadata: { workspaceId: wid }, items: { data: [{ id: "si_m", price: { id: "price_team_m" }, quantity: 4, current_period_end: sec + 86_400 }] } },
    });
    expect(await workspaceSub(t, id)).toMatchObject({ quantity: 4 });
    expect((await workspaceSub(t, id))!.seatSyncScheduledAt).toBeTypeOf("number");
  });
});

describe("admin: workspace plans", () => {
  test("admins set a workspace's plan by hand (audited); support staff can't; Stripe plans are changed in Stripe", async () => {
    const t = setup();
    const owner = await person(t, "comp-owner@example.com");
    const ops = await person(t, "comp-ops@example.com");
    const support = await person(t, "comp-support@example.com");
    await t.run(async (ctx) => {
      await ctx.db.patch(ops.profileId as Id<"profiles">, { platformRole: "ops_admin" });
      await ctx.db.patch(support.profileId as Id<"profiles">, { platformRole: "support_admin" });
    });
    const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name: "Comped" });
    await expect(support.as.mutation(api.adminBilling.setWorkspacePlan, { workspaceId: id, planId: "workspace_team_monthly", reason: REASON })).rejects.toThrow(/not_found/);
    await expect(owner.as.mutation(api.adminBilling.setWorkspacePlan, { workspaceId: id, planId: "workspace_team_monthly", reason: REASON })).rejects.toThrow(/not_found/);
    await expect(ops.as.mutation(api.adminBilling.setWorkspacePlan, { workspaceId: id, planId: "workspace_team_monthly", reason: "short" })).rejects.toThrow(/reason/);
    await ops.as.mutation(api.adminBilling.setWorkspacePlan, { workspaceId: id, planId: "workspace_team_monthly", reason: REASON });
    let s = await summary(owner, id);
    expect(s.entitlements).toMatchObject({ planId: "workspace_team_monthly", ai: true });
    expect(s.subscription).toMatchObject({ provider: "manual", quantity: 1, currentPeriodEnd: null });
    // The owner's Personal plan is untouched.
    expect((await owner.as.query(api.billing.mine, {})).subscription).toMatchObject({ plan: "free", provider: "none" });
    const view = await ops.as.mutation(api.admin.viewWorkspace, { workspaceId: id });
    expect(view.billing).toMatchObject({ planId: "workspace_team_monthly", paid: true, seats: 1, subscription: { provider: "manual" } });
    const log = await ops.as.query(api.admin.auditLog, {});
    expect(log.entries.map((e) => e.action)).toContain("billing.set_workspace_plan");
    // Back to Free.
    await ops.as.mutation(api.adminBilling.setWorkspacePlan, { workspaceId: id, planId: "workspace_free", reason: REASON });
    s = await summary(owner, id);
    expect(s.entitlements.planId).toBe("workspace_free");
    // The workspaces list shows each workspace's plan (so it can be changed from the list).
    const listed = async () => (await ops.as.mutation(api.admin.listWorkspaces, {})).workspaces.find((w) => w.id === id)!;
    expect(await listed()).toMatchObject({ planId: "workspace_free", planEndsAt: null, stripeBilled: false });
    const until = Date.now() + 10 * DAY;
    await ops.as.mutation(api.adminBilling.setWorkspacePlan, { workspaceId: id, planId: "workspace_business_yearly", until, reason: REASON });
    expect(await listed()).toMatchObject({ planId: "workspace_business_yearly", planEndsAt: until, stripeBilled: false });
    // A live Stripe plan is flagged in the list and the detail, and refused.
    const sub = (await workspaceSub(t, id))!;
    await t.run(async (ctx) => ctx.db.patch(sub._id, { provider: "stripe", planId: "workspace_team_monthly", status: "active", currentPeriodEnd: Date.now() + DAY }));
    expect(await listed()).toMatchObject({ planId: "workspace_team_monthly", stripeBilled: true });
    expect((await ops.as.mutation(api.admin.viewWorkspace, { workspaceId: id })).billing.stripeBilled).toBe(true);
    await expect(ops.as.mutation(api.adminBilling.setWorkspacePlan, { workspaceId: id, planId: "workspace_business_monthly", reason: REASON })).rejects.toThrow(/billed through Stripe/);
  });
});
