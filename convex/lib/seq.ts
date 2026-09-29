import type { MutationCtx, QueryCtx } from "../_generated/server";
import { fail } from "./errors";
import { scopeKey, type Scope } from "./scope";

/**
 * Allocates the next change sequence number of a scope: a workspace's `changeSeq`, or the owner's
 * `personalChangeSeq` for Personal. Reading and writing that row inside the mutation makes Convex
 * serialize concurrent writers, so `seq` order equals commit order within the scope.
 */
export async function nextSeq(ctx: MutationCtx, scope: Scope): Promise<number> {
  if (scope.kind === "personal") {
    const owner = await ctx.db.get(scope.profileId);
    if (!owner) fail("not_found", "Not found.");
    const seq = (owner.personalChangeSeq ?? 0) + 1;
    await ctx.db.patch(owner._id, { personalChangeSeq: seq });
    return seq;
  }
  const ws = await ctx.db.get(scope.workspaceId);
  if (!ws) fail("not_found", "Workspace not found.");
  const seq = ws.changeSeq + 1;
  await ctx.db.patch(ws._id, { changeSeq: seq, updatedAt: Date.now() });
  return seq;
}

/** The latest `seq` handed out in a scope (what a client that has pulled everything is at). */
export async function headSeq(ctx: QueryCtx, scope: Scope): Promise<number> {
  if (scope.kind === "personal") return (await ctx.db.get(scope.profileId))?.personalChangeSeq ?? 0;
  return (await ctx.db.get(scope.workspaceId))?.changeSeq ?? 0;
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
