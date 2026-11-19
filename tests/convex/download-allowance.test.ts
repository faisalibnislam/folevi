// Fair-use downloads (convex/lib/downloads.ts): each storage account may download 3 times its storage a
// month, at least 2 GB; past that a download is refused until the 1st, and a refused one adds nothing.
import { describe, expect, test } from "vitest";
import { downloadAllowance, downloadLimitMessage, chargeDownload, monthOf, monthResetsAt } from "../../convex/lib/downloads";
import { storageUsage } from "../../convex/lib/entitlements";
import { GB, MB } from "../../convex/lib/plans";
import { personalScope } from "../../convex/lib/scope";
import { person, setup } from "./helpers";

describe("download allowance", () => {
  test("3 times the storage, at least 2 GB", () => {
    expect(downloadAllowance(500 * MB)).toBe(2 * GB);
    expect(downloadAllowance(10 * GB)).toBe(30 * GB);
    expect(downloadAllowance(50 * GB)).toBe(150 * GB);
  });

  test("months are UTC and reset on the 1st", () => {
    const late = Date.UTC(2026, 11, 31, 23, 59);
    expect(monthOf(late)).toBe("2026-12");
    expect(monthResetsAt(late)).toBe(Date.UTC(2027, 0, 1));
    expect(downloadLimitMessage(30 * GB, late)).toContain("30 GB");
    expect(downloadLimitMessage(30 * GB, late)).toContain("January 1");
  });

  test("counts per account and month, and refuses past the allowance", async () => {
    const t = setup();
    await person(t, "downloads@example.com");
    const now = Date.UTC(2026, 10, 19);
    await t.run(async (ctx) => {
      const profile = (await ctx.db.query("profiles").first())!;
      const scope = personalScope(profile._id);
      const allowance = downloadAllowance((await storageUsage(ctx, scope)).limitBytes);
      expect(await chargeDownload(ctx, scope, allowance - 10, undefined, now)).toEqual({ ok: true });
      expect(await chargeDownload(ctx, scope, 10, undefined, now)).toEqual({ ok: true });
      const refused = await chargeDownload(ctx, scope, 1, undefined, now);
      expect(refused.ok).toBe(false);
      // Refused bytes are not counted, and the next month starts again.
      const row = (await ctx.db.query("downloadUsage").first())!;
      expect(row.bytes).toBe(allowance);
      expect(await chargeDownload(ctx, scope, 1, undefined, Date.UTC(2026, 11, 1))).toEqual({ ok: true });
    });
  });
});
