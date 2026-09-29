// Seats: who a paid workspace plan is billed for. One place decides it, and one hook keeps the payment
// provider's quantity in step.
//
//   Billable (one seat each): active members — owner, admin and member roles. Today's member roles
//     (editor, commenter, viewer) are all Members, so every membership role counts.
//   Free (no seat): guests (page grants without a membership), pending invitations, removed people, and
//     members whose account is suspended or deleted.
//   Suspended workspaces: seats are counted as usual. Suspension is a temporary platform action that
//     limits access without changing who belongs to the workspace, so the bill isn't changed behind the
//     owner's back; an admin who wants billing stopped cancels or changes the plan (admin console).
//
// Whenever a membership starts, ends or changes billable status, call `seatsChanged`. It stores the new
// count at once for plans without a payment provider (test and manual plans), and for Stripe plans marks
// the workspace (seatSyncScheduledAt) and schedules one `workspaceBilling.syncSeatQuantity`, which reads the *current* count
// and sets Stripe's quantity only if it differs. Duplicate or racing triggers therefore converge.
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { WorkspaceRole } from "./auth";
import { workspaceSubscriptionOf } from "./billing";
import { isPaidPlan } from "./plans";

type Ctx = QueryCtx | MutationCtx;

/** Membership roles that take a seat (Phase D renames editor/commenter/viewer to Member; all stay billable). */
const BILLABLE_ROLES: Record<WorkspaceRole, boolean> = { owner: true, admin: true, editor: true, commenter: true, viewer: true };
export const isBillableRole = (role: WorkspaceRole) => BILLABLE_ROLES[role];

/** How long seat changes are gathered before Stripe is updated (a burst of accepts → one update). */
export const SEAT_SYNC_DELAY_MS = 5_000;
/** A scheduled sync that hasn't run by now is assumed lost, and a new one may be scheduled. */
const SEAT_SYNC_STALE_MS = 15 * 60_000;

async function takesSeat(ctx: Ctx, m: Doc<"workspaceMembers">): Promise<boolean> {
  if (!isBillableRole(m.role)) return false;
  const p = await ctx.db.get(m.profileId);
  // An account being deleted still works until it's gone; suspended and deleted accounts don't.
  return p !== null && (p.status === "active" || p.status === "pending_deletion");
}

async function countSeats(ctx: Ctx, members: Doc<"workspaceMembers">[]): Promise<number> {
  let seats = 0;
  for (const m of members) if (await takesSeat(ctx, m)) seats++;
  return seats;
}

const membersOf = (ctx: Ctx, workspaceId: Id<"workspaces">) =>
  ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();

/** Seats a paid plan bills this workspace for right now. */
export async function billableSeatCount(ctx: Ctx, workspaceId: Id<"workspaces">): Promise<number> {
  return await countSeats(ctx, await membersOf(ctx, workspaceId));
}

export interface SeatSummary {
  /** Billed seats (see the rules above). */
  seats: number;
  /** People with page access here who aren't members (not billed). */
  guests: number;
  /** Invitations not yet accepted (not billed until accepted). */
  pendingInvites: number;
}

export async function seatSummary(ctx: Ctx, workspaceId: Id<"workspaces">, now = Date.now()): Promise<SeatSummary> {
  const members = await membersOf(ctx, workspaceId);
  const seats = await countSeats(ctx, members);
  const memberIds = new Set(members.map((m) => m.profileId as string));
  const grants = await ctx.db
    .query("documentPermissions")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  const guests = new Set(grants.map((g) => g.profileId as string).filter((id) => !memberIds.has(id)));
  const invites = await ctx.db
    .query("workspaceInvites")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  return { seats, guests: guests.size, pendingInvites: invites.filter((i) => i.status === "pending" && i.expiresAt > now).length };
}

/**
 * Call after any change to who takes a seat in a workspace (accept, remove, leave, role change, ownership
 * transfer, account suspension or deletion). Cheap when nothing is billed.
 */
export async function seatsChanged(ctx: MutationCtx, workspaceId: Id<"workspaces">): Promise<void> {
  const sub = await workspaceSubscriptionOf(ctx, workspaceId);
  if (!sub || !isPaidPlan(sub.planId) || sub.status === "canceled") return;
  if (sub.provider !== "stripe") {
    // Test and manual plans have no provider to tell: the stored quantity is the bill.
    const seats = await billableSeatCount(ctx, workspaceId);
    if (sub.quantity !== seats) await ctx.db.patch(sub._id, { quantity: seats, updatedAt: Date.now() });
    return;
  }
  const now = Date.now();
  if (sub.seatSyncScheduledAt !== undefined && now - sub.seatSyncScheduledAt < SEAT_SYNC_STALE_MS) return;
  await ctx.db.patch(sub._id, { seatSyncScheduledAt: now });
  await ctx.scheduler.runAfter(SEAT_SYNC_DELAY_MS, internal.workspaceBilling.syncSeatQuantity, { workspaceId });
}
