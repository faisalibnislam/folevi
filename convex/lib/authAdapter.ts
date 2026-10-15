// The database adapter Better Auth runs on (the Convex component's), with one correction.
//
// The OAuth provider rotates a connected app's refresh token with a guarded update: "set revoked on this
// row where revoked is null". The provider never writes `revoked` when it creates the row, so in Convex the
// field is missing, and the component's filter compares `undefined === null`: no match, so every refresh
// failed with invalid_grant and apps like Claude dropped the connection when their first hour was up.
// Here that one update goes to convex/betterAuth/refreshTokens.ts, which treats missing and null alike.
import type { GenericCtx } from "@convex-dev/better-auth";
import type { AdapterFactory } from "better-auth/adapters";
import type { BetterAuthOptions } from "better-auth";
import { components } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";

type Where = { field: string; value?: unknown; operator?: string; connector?: string };
type IncrementArgs = { model: string; where: Where[]; increment: Record<string, number>; set?: Record<string, unknown> };
type RunMutation = (fn: unknown, args: unknown) => Promise<unknown>;

/** The row id when `args` is the provider's "mark this refresh token used, if it isn't yet" update. */
export function refreshTokenRevokeTarget(args: IncrementArgs): { id: string; revoked: number } | null {
  if (args.model !== "oauthRefreshToken" || Object.keys(args.increment ?? {}).length > 0) return null;
  const set = args.set ?? {};
  if (Object.keys(set).length !== 1 || !(set.revoked instanceof Date || typeof set.revoked === "number")) return null;
  if (args.where.length !== 2 || args.where.some((w) => w.connector === "OR")) return null;
  const byId = args.where.find((w) => w.field === "id" && (w.operator ?? "eq") === "eq" && typeof w.value === "string");
  const unrevoked = args.where.find((w) => w.field === "revoked" && (w.operator ?? "eq") === "eq" && w.value === null);
  if (!byId || !unrevoked) return null;
  return { id: byId.value as string, revoked: set.revoked instanceof Date ? set.revoked.getTime() : (set.revoked as number) };
}

export function guardRefreshTokenRevoke(ctx: GenericCtx<DataModel>, factory: AdapterFactory<BetterAuthOptions>): AdapterFactory<BetterAuthOptions> {
  return (options) => {
    const adapter = factory(options);
    const runMutation = (ctx as { runMutation?: RunMutation }).runMutation;
    if (!runMutation) return adapter;
    const incrementOne = adapter.incrementOne.bind(adapter);
    return {
      ...adapter,
      incrementOne: (async (args: IncrementArgs) => {
        const target = refreshTokenRevokeTarget(args);
        if (!target) return await incrementOne(args as never);
        const row = (await runMutation(components.betterAuth.refreshTokens.markRevoked, target)) as ({ _id: string } & Record<string, unknown>) | null;
        if (!row) return null;
        const { _id, ...rest } = row;
        return { ...rest, id: _id };
      }) as typeof adapter.incrementOne,
    };
  };
}
