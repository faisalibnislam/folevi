// Platform feature flags (admin console → Configuration → Feature flags).
//
// Rows in the `featureFlags` table only exist once an admin has flipped a flag;
// until then the flag's documented default applies. Every server-side check
// must go through `isFeatureEnabled` so the admin toggle and the enforcement
// always agree on the default.
import type { MutationCtx, QueryCtx } from "../_generated/server";

export interface KnownFlag {
  key: FlagKey;
  description: string;
  default: boolean;
}

export type FlagKey = "public_links" | "workspace_invites" | "new_signups" | "workspace_export";

export const KNOWN_FLAGS: readonly KnownFlag[] = [
  { key: "public_links", description: "Allow documents to be published with a public share link.", default: true },
  { key: "workspace_invites", description: "Allow inviting people to workspaces.", default: true },
  { key: "new_signups", description: "Allow new accounts to be created (existing accounts are unaffected).", default: true },
  { key: "workspace_export", description: "Allow workspace ZIP exports.", default: true },
];

export function knownFlag(key: string): KnownFlag | undefined {
  return KNOWN_FLAGS.find((f) => f.key === key);
}

/**
 * Whether a platform feature is currently enabled. Unknown keys are treated as
 * disabled (fail closed) so a typo can never silently enable something.
 */
export async function isFeatureEnabled(ctx: QueryCtx | MutationCtx, key: string): Promise<boolean> {
  const known = knownFlag(key);
  if (!known) return false;
  const row = await ctx.db
    .query("featureFlags")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  return row ? row.enabled : known.default;
}
