// Removing the old account model's leftovers (docs/ACCOUNT_MODEL_PLAN.md §3b): the clean-up migrations and
// the integrity check that stays.
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { REPORTS_KEPT } from "../../convex/migrations";
import { person, setup, teamWorkspace, verifyAccountModel } from "./helpers";

afterEach(() => {
  vi.useRealTimers();
});

describe("account model clean-up", () => {
  test("new workspaces have no kind; dropWorkspaceKind unsets it on older rows, in batches, idempotently", async () => {
    const t = setup();
    const owner = await person(t, "kind-owner@example.com");
    const { workspaceId } = await teamWorkspace(owner, "New");
    const fresh = await t.run(async (ctx) => (await ctx.db.query("workspaces").withIndex("by_public_id", (q) => q.eq("publicId", workspaceId)).unique())!);
    expect(fresh.kind).toBeUndefined();
    // Rows as production holds them today.
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < 205; i++) {
        await ctx.db.insert("workspaces", { publicId: `old-${i}`, name: `Old ${i}`, kind: "team", ownerId: fresh.ownerId, changeSeq: 0, status: "active", storageUsedBytes: 0, storageQuotaBytes: 1, memberLimit: 50, documentCount: 0, createdAt: now, updatedAt: now });
      }
    });
    vi.useFakeTimers();
    const first = await t.mutation(internal.migrations.dropWorkspaceKind, {});
    expect(first.done).toBe(false);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
    expect(await t.run(async (ctx) => (await ctx.db.query("workspaces").collect()).filter((w) => w.kind !== undefined).length)).toBe(0);
    const again = await t.mutation(internal.migrations.dropWorkspaceKind, {});
    expect(again).toEqual({ updated: 0, done: false });
    // The workspace still works as before.
    expect((await owner.as.query(api.workspaces.mine, {})).map((w) => w.id)).toContain(workspaceId);
  });

  test("backfillAccountDefaults writes out ownerType and aiUsage scope on older rows", async () => {
    const t = setup();
    const owner = await person(t, "defaults-owner@example.com");
    const { workspaceId } = await teamWorkspace(owner, "Billing");
    const ids = await t.run(async (ctx) => {
      const ws = (await ctx.db.query("workspaces").withIndex("by_public_id", (q) => q.eq("publicId", workspaceId)).unique())!;
      const profileId = owner.profileId as Id<"profiles">;
      // Older rows: no ownerType, no scope.
      const personal = (await ctx.db.query("subscriptions").withIndex("by_profile", (q) => q.eq("profileId", profileId)).unique())!;
      await ctx.db.patch(personal._id, { ownerType: undefined });
      const team = (await ctx.db.query("subscriptions").collect()).find((s) => s.workspaceId === ws._id);
      if (team) await ctx.db.patch(team._id, { ownerType: undefined });
      const usage = await ctx.db.insert("aiUsage", { profileId, day: "2026-01-01", count: 3 });
      const wsUsage = await ctx.db.insert("aiUsage", { profileId, day: "2026-01-01", count: 1, workspaceId: ws._id });
      return { personal: personal._id, team: team?._id ?? null, usage, wsUsage };
    });
    vi.useFakeTimers();
    await t.mutation(internal.migrations.backfillAccountDefaults, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
    await t.run(async (ctx) => {
      expect((await ctx.db.get(ids.personal))!.ownerType).toBe("user");
      if (ids.team) expect((await ctx.db.get(ids.team))!.ownerType).toBe("workspace");
      expect((await ctx.db.get(ids.usage))!.scope).toBe("personal");
      expect((await ctx.db.get(ids.wsUsage))!.scope).toBe("workspace");
      for (const s of await ctx.db.query("subscriptions").collect()) expect(s.ownerType).toBeDefined();
      for (const u of await ctx.db.query("aiUsage").collect()) expect(u.scope).toBeDefined();
    });
    // Idempotent.
    const again = await t.mutation(internal.migrations.backfillAccountDefaults, { table: "aiUsage", cursor: null });
    expect(again.updated).toBe(0);
  });

  test("the integrity check passes on clean data, finds a row whose workspace is gone, and keeps only the latest reports", async () => {
    const t = setup();
    const owner = await person(t, "check-owner@example.com");
    const { workspaceId } = await teamWorkspace(owner, "Checked");
    await owner.as.mutation(api.documents.create, { scope: { kind: "workspace", workspaceId }, title: "Page" });
    const clean = await verifyAccountModel(t, { pageSize: 3, pagesPerRun: 2 });
    expect(clean.ok).toBe(true);
    expect(clean.runs).toBeGreaterThan(1);
    expect(clean.rowsInMissingWorkspaces).toBe(0);

    // A tag left behind by a workspace that no longer exists.
    await t.run(async (ctx) => {
      const ws = (await ctx.db.query("workspaces").withIndex("by_public_id", (q) => q.eq("publicId", workspaceId)).unique())!;
      const gone = await ctx.db.insert("workspaces", { ...(({ _id, _creationTime, ...rest }) => rest)(ws), publicId: "gone" });
      await ctx.db.insert("tags", { publicId: "orphan-tag", name: "orphan", normalizedName: "orphan", color: "muted", createdAt: 0, seq: 0, workspaceId: gone });
      await ctx.db.delete(gone);
    });
    const dirty = await verifyAccountModel(t);
    expect(dirty.ok).toBe(false);
    expect(dirty.rowsInMissingWorkspaces).toBe(1);
    expect(dirty.tables.tags!.missingWorkspace).toBe(1);

    for (let i = 0; i < REPORTS_KEPT + 2; i++) await verifyAccountModel(t);
    const reports = await t.run(async (ctx) => await ctx.db.query("migrationReports").collect());
    expect(reports.length).toBe(REPORTS_KEPT);
    expect(reports.every((r) => r.done)).toBe(true);
  });
});
