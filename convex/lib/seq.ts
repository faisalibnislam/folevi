import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { fail } from "./errors";

/**
 * Allocates the next workspace change sequence number. Reading and writing the workspace row inside
 * the mutation makes Convex serialize concurrent writers, so `seq` order equals commit order.
 */
export async function nextSeq(ctx: MutationCtx, workspaceId: Id<"workspaces">): Promise<number> {
  const ws = await ctx.db.get(workspaceId);
  if (!ws) fail("not_found", "Workspace not found.");
  const seq = ws.changeSeq + 1;
  await ctx.db.patch(workspaceId, { changeSeq: seq, updatedAt: Date.now() });
  return seq;
}

/** Allocates one seq per mutation and reuses it for every row touched (cheaper, same guarantees). */
export class SeqAllocator {
  private cache = new Map<string, number>();
  constructor(private ctx: MutationCtx) {}
  async for(workspaceId: Id<"workspaces">): Promise<number> {
    const hit = this.cache.get(workspaceId);
    if (hit !== undefined) return hit;
    const seq = await nextSeq(this.ctx, workspaceId);
    this.cache.set(workspaceId, seq);
    return seq;
  }
}
