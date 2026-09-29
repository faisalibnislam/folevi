// Device limits. A device is one signed-in browser or app (one live session). Free allows a few at once
// (lib/plans.ts); Basic, Pro and the Pro trial have no limit.
//
// When someone is over the limit, the sessions that signed in first keep working and the newest ones are
// held at a "device limit" screen (users.me → state "device_limit"), where they can sign another device
// out or upgrade. Every other backend call refuses them (requireProfile), so a held device can't read or
// sync notes. Nothing is signed out automatically: dropping to Free after a trial just holds the newest.
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { listUserSessions } from "./authStore";
import { personalEntitlements } from "./entitlements";

type Ctx = QueryCtx | MutationCtx;

export interface DeviceStatus {
  /** null = unlimited. */
  limit: number | null;
  /** Devices signed in right now. */
  active: number;
  /** Whether this session is one of the ones allowed to use the account. */
  allowed: boolean;
}

export async function deviceStatus(ctx: Ctx, profile: Doc<"profiles">, sessionId: string | null): Promise<DeviceStatus> {
  // Devices are per account, from the Personal plan; workspace membership never changes the limit.
  const { devices: limit } = await personalEntitlements(ctx, profile._id);
  // Unlimited plans skip the session scan entirely (it runs on every backend call).
  if (limit === null) return { limit: null, active: 0, allowed: true };
  const sessions = (await listUserSessions(ctx, profile.authSubject)).sort((a, b) => a.createdAt - b.createdAt || a._id.localeCompare(b._id));
  const rank = sessionId ? sessions.findIndex((s) => s._id === sessionId) : -1;
  return { limit, active: sessions.length, allowed: rank >= 0 && rank < limit };
}
