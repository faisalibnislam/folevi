import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { ulid } from "@folevi/editor-schema";

/**
 * Appends an immutable admin audit record. There is intentionally no update or delete path for
 * `adminAuditLogs` anywhere in the backend (enforced by tests/convex/static/invariants.test.ts).
 */
export async function recordAudit(
  ctx: MutationCtx,
  actor: Doc<"profiles">,
  entry: {
    action: string;
    targetType: string;
    targetId: string;
    reason?: string;
    before?: unknown;
    after?: unknown;
    requestId?: string;
    clientHash?: string;
  },
): Promise<void> {
  if (!actor.platformRole) throw new Error("audit actor must be a platform admin");
  await ctx.db.insert("adminAuditLogs", {
    actorId: actor._id,
    actorRole: actor.platformRole,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    reason: entry.reason,
    before: entry.before,
    after: entry.after,
    requestId: entry.requestId ?? ulid(),
    clientHash: entry.clientHash,
    createdAt: Date.now(),
  });
}

/**
 * A person's own action worth a trail (an AI agent's changes being applied or undone): a structured log
 * entry with who, what and counts, never content. The admin audit log above is for the admin console's
 * actions only; the record itself (an `aiRuns` row) keeps the details while its conversation exists.
 */
export function recordUserAction(actor: Pick<Doc<"profiles">, "_id">, entry: { action: string; targetType: string; targetId: string; counts?: Record<string, number> }): void {
  console.log(JSON.stringify({ event: "audit.user", action: entry.action, actorId: actor._id, targetType: entry.targetType, targetId: entry.targetId, ...(entry.counts ?? {}), at: Date.now() }));
}
