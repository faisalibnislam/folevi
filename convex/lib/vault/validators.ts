// Argument shapes shared by the Vault's modules (docs/VAULT_PLAN.md).
import { v } from "convex/values";

/** Where an action came from, as the device reports it, for the log (never used for access decisions). */
export const vVaultClient = v.object({
  deviceId: v.optional(v.string()),
  deviceLabel: v.optional(v.string()),
  deviceKind: v.optional(v.string()),
  timeZone: v.optional(v.string()),
  sessionId: v.optional(v.string()),
});
