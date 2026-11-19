// Fair-use downloads (docs/PRICING_PROPOSAL.md, section 6; Terms, "Fair use"). Convex bills every GB it
// serves with no upper limit, so each storage account may download at most 3 times its plan's storage a
// month (at least 2 GB). Counted per UTC calendar month against the same account the storage counts against:
// a Personal (or its owner's free pool), a member's own quota in a paid workspace, or a workspace with an
// admin's storage override. Past the allowance, downloads are refused until the 1st; everything stays stored.
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { storageUsage } from "./entitlements";
import { downloadAllowance, sizeLabel } from "./plans";
import type { Scope } from "./scope";

export { DOWNLOAD_FLOOR_BYTES, DOWNLOAD_STORAGE_MULTIPLE, downloadAllowance } from "./plans";

/** The UTC calendar month ("2026-11") a time falls in. */
export const monthOf = (now: number) => new Date(now).toISOString().slice(0, 7);

/** When the month `now` falls in ends (the 1st of the next month, 00:00 UTC). */
export function monthResetsAt(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/** The message a refused download shows. */
export function downloadLimitMessage(allowanceBytes: number, now: number): string {
  const date = new Date(monthResetsAt(now)).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  return `This account has used this month's fair-use downloads (${sizeLabel(allowanceBytes)}). Files can be downloaded again on ${date}. Everything stays stored.`;
}

/**
 * Counts `bytes` served from a file in `scope` against its storage account, or refuses them when the
 * month's allowance would be passed. `chargedTo` is whom a workspace file counts against (its uploader or
 * page owner). A refused download adds nothing.
 */
export async function chargeDownload(
  ctx: MutationCtx,
  scope: Scope,
  bytes: number,
  chargedTo?: Id<"profiles">,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; message: string }> {
  const usage = await storageUsage(ctx, scope, chargedTo);
  const account =
    scope.kind === "workspace" && usage.rule === "override" ? `w:${scope.workspaceId}`
    : scope.kind === "workspace" && usage.rule === "per_person" ? `w:${scope.workspaceId}:${usage.profileId}`
    : `p:${usage.profileId ?? (scope.kind === "personal" ? scope.profileId : scope.workspaceId)}`;
  const allowance = downloadAllowance(usage.limitBytes);
  const month = monthOf(now);
  const row = await ctx.db
    .query("downloadUsage")
    .withIndex("by_account_month", (q) => q.eq("account", account).eq("month", month))
    .unique();
  const used = row?.bytes ?? 0;
  if (used + bytes > allowance) return { ok: false, message: downloadLimitMessage(allowance, now) };
  if (row) await ctx.db.patch(row._id, { bytes: used + bytes });
  else await ctx.db.insert("downloadUsage", { account, month, bytes });
  return { ok: true };
}
