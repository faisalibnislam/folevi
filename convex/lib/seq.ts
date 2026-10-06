import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { fail } from "./errors";
import { scopeKey, type Scope } from "./scope";

/**
 * A scope's change counter lives in its own `scopeCounters` row. It used to be a field on the profile
 * (`personalChangeSeq`) or workspace (`changeSeq`), but those rows are read by nearly every query
 * (requireProfile, requireWorkspace), so bumping them on every sync push re-ran every live query of the
 * person and of every workspace member. Scopes that haven't allocated since the move have no row yet:
 * their counter is still the old field, which the first allocation copies over (and never touches again).
 */
async function counterRow(ctx: QueryCtx, scope: Scope): Promise<Doc<"scopeCounters"> | null> {
  return await ctx.db
    .query("scopeCounters")
    .withIndex("by_key", (q) => q.eq("key", scopeKey(scope)))
    .unique();
}

/** The counter as last stored on the profile or workspace row; null when that row is gone. */
async function legacySeq(ctx: QueryCtx, scope: Scope): Promise<number | null> {
  if (scope.kind === "personal") {
    const owner = await ctx.db.get(scope.profileId);
    return owner ? (owner.personalChangeSeq ?? 0) : null;
  }
  const ws = await ctx.db.get(scope.workspaceId);
  return ws ? ws.changeSeq : null;
}

/** Advances the counter; null (and nothing written) when the scope's profile or workspace is gone. */
async function advance(ctx: MutationCtx, scope: Scope): Promise<number | null> {
  const row = await counterRow(ctx, scope);
  if (row) {
    const seq = row.seq + 1;
    await ctx.db.patch(row._id, { seq });
    return seq;
  }
  const legacy = await legacySeq(ctx, scope);
  if (legacy === null) return null;
  const seq = legacy + 1;
  await ctx.db.insert("scopeCounters", { key: scopeKey(scope), seq });
  return seq;
}

/**
 * Allocates the next change sequence number of a scope (a workspace, or someone's Personal). Reading and
 * writing the counter row inside the mutation makes Convex serialize concurrent writers (two first
 * allocations conflict on the empty index range they both read), so `seq` order equals commit order
 * within the scope.
 */
export async function nextSeq(ctx: MutationCtx, scope: Scope): Promise<number> {
  const seq = await advance(ctx, scope);
  if (seq === null) fail("not_found", scope.kind === "personal" ? "Not found." : "Workspace not found.");
  return seq;
}

/** Advances a scope's change counter so clients re-pull; a scope already gone is left alone. */
export async function bumpSeq(ctx: MutationCtx, scope: Scope): Promise<void> {
  await advance(ctx, scope);
}

/** Drops a scope's counter row (its workspace is being deleted with it). */
export async function deleteSeq(ctx: MutationCtx, scope: Scope): Promise<void> {
  const row = await counterRow(ctx, scope);
  if (row) await ctx.db.delete(row._id);
}

/** The latest `seq` handed out in a scope (what a client that has pulled everything is at). */
export async function headSeq(ctx: QueryCtx, scope: Scope): Promise<number> {
  const row = await counterRow(ctx, scope);
  if (row) return row.seq;
  return (await legacySeq(ctx, scope)) ?? 0;
}

/** Allocates one seq per scope per mutation and reuses it for every row touched (cheaper, same guarantees). */
export class SeqAllocator {
  private cache = new Map<string, number>();
  constructor(private ctx: MutationCtx) {}
  async for(scope: Scope): Promise<number> {
    const key = scopeKey(scope);
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const seq = await nextSeq(this.ctx, scope);
    this.cache.set(key, seq);
    return seq;
  }
}
