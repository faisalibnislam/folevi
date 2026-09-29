// Removing the old account model's leftovers (docs/ACCOUNT_MODEL_PLAN.md §3b): the clean-up migrations and
// the integrity check that stays.
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { REPORTS_KEPT } from "../../convex/migrations";
import { person, setup, teamWorkspace, verifyAccountModel } from "./helpers";

afterEach(() => {
  vi.useRealTimers();
});

describe("account model clean-up", () => {
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
