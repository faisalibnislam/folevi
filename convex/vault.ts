// The Vault (docs/VAULT_PLAN.md): passwords, API keys and sensitive files, always end-to-end encrypted, opened
// with each person's own passcode, with a log nobody can remove. This module is the Vault itself (finding it,
// making it, its settings); keys and unlocking are in vaultKeys.ts, people in vaultPeople.ts, items in
// vaultItems.ts, the log in vaultLog.ts. Access is decided in lib/vault/access.ts.
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ulid } from "@folevi/editor-schema";
import { assertWritable, requireProfile, resolveScope } from "./lib/auth";
import { fail } from "./lib/errors";
import { insertScoped, vScopeArg } from "./lib/scope";
import { isFeatureEnabled } from "./lib/flags";
import { AUTO_LOCK_RANGE, isScopeOwner, newVaultFields, requireVault, vaultOfScope, vaultRoleOf, type VaultRole } from "./lib/vault/access";
import { appendLog, genesisHash } from "./lib/vault/log";
import { vVaultClient } from "./lib/vault/validators";

/**
 * The Vault of a place as the caller sees it, for the sidebar and the Vault page: null when they have no
 * access (a team Vault they weren't added to looks exactly like one that doesn't exist).
 */
export const get = query({
  args: { scope: vScopeArg },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    // Held back until the outside security review (the "vault" flag).
    if (!(await isFeatureEnabled(ctx, "vault"))) return null;
    const { scope, workspace } = await resolveScope(ctx, profile, args.scope);
    const vault = await vaultOfScope(ctx, scope);
    if (!vault) {
      // Not made yet: its owner can make it (a Personal's owner, a workspace's owner).
      if (!(await isScopeOwner(ctx, profile._id, scope))) return null;
      return { exists: false as const, personal: workspace === null, role: "owner" as VaultRole };
    }
    const role = await vaultRoleOf(ctx, profile, vault);
    if (!role) return null;
    const grants = await ctx.db
      .query("vaultGrants")
      .withIndex("by_vault_profile", (q) => q.eq("vaultId", vault._id).eq("profileId", profile._id).eq("version", vault.keyVersion))
      .collect();
    const grant = grants.find((g) => g.layer === "passcode") ?? null;
    const fromCustodian = grants.some((g) => g.layer === "custodian");
    const pending = await ctx.db
      .query("vaultPendingGrants")
      .withIndex("by_vault_profile", (q) => q.eq("vaultId", vault._id).eq("profileId", profile._id))
      .first();
    return {
      exists: true as const,
      id: vault.publicId,
      personal: workspace === null,
      role,
      /** 0 until the first person sets up the Vault's key. */
      keyVersion: vault.keyVersion,
      /** This person can unlock now (they have a grant for the current key). */
      hasAccessKey: grant !== null,
      /** A custodian shared the key: they choose their passcode to finish (vaultKeys.setPasscode). */
      needsPasscode: grant === null && fromCustodian,
      /** Waiting for a custodian's device to share the key with them. */
      waitingForKey: pending !== null && grant === null && !fromCustodian,
      /** They have a recovery key for this Vault. */
      hasRecovery: grants.some((g) => g.layer === "recovery"),
      /** Their recovery key predates a new key version: they should save a new one. */
      recoveryOutdated: !grants.some((g) => g.layer === "recovery") && (await ctx.db
        .query("vaultGrants")
        .withIndex("by_vault_profile_layer", (q) => q.eq("vaultId", vault._id).eq("profileId", profile._id).eq("layer", "recovery"))
        .first()) !== null,
      /** Custodians only: someone lost access, and this device should make a new key version when it opens the Vault. */
      rotationNeeded: role !== "member" && vault.rotationNeeded === true,
      /** Custodians only: it's been 90 days since anyone confirmed who has access. */
      accessReviewDue: role !== "member" && workspace !== null && Date.now() - (vault.accessReviewedAt ?? vault.createdAt) > 90 * 24 * 60 * 60 * 1000,
      autoLockMinutes: vault.autoLockMinutes,
      custodiansNameCustodians: vault.custodiansNameCustodians,
    };
  },
});

/** Makes a place's Vault (its owner only; once). The key comes next, from the owner's device (vaultKeys.setUp). */
export const create = mutation({
  args: { scope: vScopeArg, client: v.optional(vVaultClient) },
  handler: async (ctx, args): Promise<{ id: string }> => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    if (!(await isFeatureEnabled(ctx, "vault"))) fail("forbidden", "The Vault isn't available yet.");
    const { scope } = await resolveScope(ctx, profile, args.scope);
    if (!(await isScopeOwner(ctx, profile._id, scope))) fail("forbidden", "Only the owner can set up this Vault.");
    const existing = await vaultOfScope(ctx, scope);
    if (existing) return { id: existing.publicId };
    const publicId = ulid();
    const now = Date.now();
    const id = await insertScoped(ctx, "vaults", scope, newVaultFields(scope, publicId, profile._id, await genesisHash(publicId), now));
    const vault = (await ctx.db.get(id))!;
    await appendLog(ctx, vault, { event: "vault.created", actor: { profile, role: "owner" }, client: args.client });
    return { id: publicId };
  },
});

/**
 * The Vault's settings: auto-lock minutes (custodians, team Vault; the owner of a Personal one) and who names
 * custodians (the owner only). Every change is logged with its old and new value.
 */
export const updateSettings = mutation({
  args: { vaultId: v.string(), autoLockMinutes: v.optional(v.number()), custodiansNameCustodians: v.optional(v.boolean()), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId, "custodian");
    const patch: { autoLockMinutes?: number; custodiansNameCustodians?: boolean } = {};
    if (args.autoLockMinutes !== undefined) {
      const [min, max] = AUTO_LOCK_RANGE;
      if (!Number.isInteger(args.autoLockMinutes) || args.autoLockMinutes < min || args.autoLockMinutes > max) fail("invalid_argument", `Choose ${min} to ${max} minutes.`);
      if (args.autoLockMinutes !== vault.autoLockMinutes) patch.autoLockMinutes = args.autoLockMinutes;
    }
    if (args.custodiansNameCustodians !== undefined) {
      if (role !== "owner") fail("forbidden", "Only the owner chooses who names custodians.");
      if (args.custodiansNameCustodians !== vault.custodiansNameCustodians) patch.custodiansNameCustodians = args.custodiansNameCustodians;
    }
    if (!Object.keys(patch).length) return null;
    await ctx.db.patch(vault._id, patch);
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, vault[k as keyof typeof patch]]));
    await appendLog(ctx, vault, { event: "vault.settings", actor: { profile, role }, detail: { before, after: patch }, client: args.client });
    return null;
  },
});
