// Semantic search's plan rule and the hook that keeps the index current (convex/aiIndex.ts does the work).
//
// Eligible: Pro and Pro AI Personals (paid, not the trial) whose owner has AI on, and team workspaces on a
// paid Pro or Pro AI plan. Free, the trial and Core keep keyword search, and nothing of theirs is
// embedded. Folevi pays for embeddings; they're never charged to credits (lib/rateLimit.ts `aiIndex`
// limits them per account).
//
// The hook (`queueIndex`) runs inside the mutations that change a note's content (lib/syncEngine.ts,
// documents.restoreVersion, lib/create.ts, Trash). It is a single read while a job is already waiting;
// otherwise it checks the plan and schedules one job a little later, so a burst of edits is indexed once.
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { personalEntitlements, workspaceEntitlements } from "../entitlements";
import { PLAN_CATALOG, type PersonalEntitlements, type PlanTier, type WorkspaceEntitlements } from "../plans";
import { hasValidScope, insertScoped, scopeOfRow, type Scope } from "../scope";

type Ctx = QueryCtx | MutationCtx;

/** Edits are indexed this long after the first one (later ones in the meantime ride along). */
export const INDEX_DELAY_MS = 30_000;
/** A job that hasn't run this long after it was due is presumed lost, and the next edit schedules another. */
export const LOST_JOB_MS = 15 * 60_000;

const INDEXED_TIERS = new Set<PlanTier>(["pro", "pro_ai"]);

/** Whether a plan includes semantic search: paid Pro or Pro AI (never Free, the trial or Core). */
export function planIndexes(e: PersonalEntitlements | WorkspaceEntitlements): boolean {
  if (!e.paid) return false;
  if (e.scope === "personal") return !e.trialing && INDEXED_TIERS.has(e.paidPlan);
  return INDEXED_TIERS.has(PLAN_CATALOG[e.planId].tier);
}

/** Whether `scope`'s notes are embedded for semantic search (see the top of this file). */
export async function indexEligible(ctx: Ctx, scope: Scope, now = Date.now()): Promise<boolean> {
  if (scope.kind === "workspace") {
    const ws = await ctx.db.get(scope.workspaceId);
    if (!ws || ws.status === "deleting") return false;
    return planIndexes(await workspaceEntitlements(ctx, ws, now));
  }
  const owner = await ctx.db.get(scope.profileId);
  if (!owner || owner.aiEnabled === false) return false;
  return planIndexes(await personalEntitlements(ctx, scope.profileId, now));
}

/** Whether a note's text belongs in the index at all (its scope's plan aside). */
export const indexable = (doc: Doc<"documents">) => !doc.inTrash && doc.deletedAt === undefined && doc.kind !== "template";

export async function indexStateOf(ctx: Ctx, documentId: Id<"documents">): Promise<Doc<"aiIndexState"> | null> {
  return await ctx.db
    .query("aiIndexState")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .unique();
}

export async function indexScopeRow(ctx: Ctx, scope: Scope): Promise<Doc<"aiIndexScopes"> | null> {
  return scope.kind === "personal"
    ? await ctx.db
        .query("aiIndexScopes")
        .withIndex("by_owner", (q) => q.eq("ownerProfileId", scope.profileId))
        .first()
    : await ctx.db
        .query("aiIndexScopes")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId))
        .first();
}

/**
 * Starts indexing every note of an eligible scope (once: a scope already backfilling or ready is left
 * alone, one that was removing or off starts again).
 */
export async function startBackfill(ctx: MutationCtx, scope: Scope, force = false): Promise<void> {
  const row = await indexScopeRow(ctx, scope);
  const now = Date.now();
  if (row && !force && (row.status === "backfilling" || row.status === "ready")) return;
  if (row) await ctx.db.patch(row._id, { status: "backfilling", cursor: null, checkedAt: now, updatedAt: now });
  else await insertScoped(ctx, "aiIndexScopes", scope, { status: "backfilling", cursor: null, checkedAt: now, updatedAt: now });
  await ctx.scheduler.runAfter(0, internal.aiIndex.backfill, { scope });
}

/**
 * The hook: a note's content changed (or it moved to or from Trash), so its chunks may be out of date.
 * Schedules one index job unless one is already waiting. Ineligible scopes are skipped, unless the note
 * still has chunks (then the job removes them). `eligible` skips the plan check when the caller knows.
 */
export async function queueIndex(ctx: MutationCtx, doc: Doc<"documents">, opts: { delayMs?: number; eligible?: boolean } = {}): Promise<void> {
  if (!hasValidScope(doc)) return;
  const now = Date.now();
  const state = await indexStateOf(ctx, doc._id);
  if (state?.dueAt !== undefined && state.dueAt > now - LOST_JOB_MS) return;
  // A template, or a note in Trash, with nothing indexed: nothing to do.
  if (!indexable(doc) && !state?.chunks) return;
  const scope = scopeOfRow(doc);
  const eligible = opts.eligible ?? (await indexEligible(ctx, scope, now));
  if (!eligible && !state?.chunks) return;
  // The first edit after the plan allows it starts the scope's backfill too.
  if (eligible && opts.eligible === undefined) await startBackfill(ctx, scope);
  const delay = opts.delayMs ?? INDEX_DELAY_MS;
  if (state) await ctx.db.patch(state._id, { dueAt: now + delay, queuedAt: now });
  else await insertScoped(ctx, "aiIndexState", scope, { documentId: doc._id, indexedContentSeq: -1, chunks: 0, dueAt: now + delay, queuedAt: now });
  await ctx.scheduler.runAfter(delay, internal.aiIndex.indexDocument, { documentId: doc._id });
}
