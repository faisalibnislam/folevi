// Who is in a team Vault (docs/VAULT_PLAN.md §1, §3): adding and removing people, custodians and members, the access
// review, and the new key version a custodian's device makes when someone loses access. A Personal Vault has only
// its owner. Workspace admins have no access unless added; guests never.
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { assertWritable, membership, normalizeMembership, requireProfile } from "./lib/auth";
import { fail } from "./lib/errors";
import { activeAccount } from "./lib/e2ee/keyStore";
import { identityImageUrl } from "./lib/identityImages";
import { insertScoped, scopeOfRow } from "./lib/scope";
import { requireVault, vaultMemberRow, vaultRoleOf, type VaultRole } from "./lib/vault/access";
import { appendLog } from "./lib/vault/log";
import { notifyVaultChange, notifyVaultSecurity } from "./lib/vault/notify";
import { vVaultClient } from "./lib/vault/validators";
import { liveVersions } from "./vaultKeys";

type Ctx = QueryCtx | MutationCtx;

const vRole = v.union(v.literal("custodian"), v.literal("member"));

/** Whether `role` may name or unname custodians in this Vault: the owner, and custodians if the owner allows it. */
function canNameCustodians(vault: Doc<"vaults">, role: VaultRole): boolean {
  return role === "owner" || (role === "custodian" && vault.custodiansNameCustodians);
}

function teamOnly(vault: Doc<"vaults">) {
  if (!vault.workspaceId) fail("invalid_argument", "A Personal Vault is only yours.");
}

async function grantRows(ctx: Ctx, vaultId: Id<"vaults">, profileId: Id<"profiles">) {
  return await ctx.db
    .query("vaultGrants")
    .withIndex("by_vault_profile", (q) => q.eq("vaultId", vaultId).eq("profileId", profileId))
    .collect();
}

/** Everyone with access to a team Vault: the workspace owner and the people added. */
async function peopleOf(ctx: Ctx, vault: Doc<"vaults">): Promise<{ profile: Doc<"profiles">; role: VaultRole; row: Doc<"vaultMembers"> | null }[]> {
  const out: { profile: Doc<"profiles">; role: VaultRole; row: Doc<"vaultMembers"> | null }[] = [];
  if (vault.ownerProfileId) {
    const owner = await ctx.db.get(vault.ownerProfileId);
    if (owner) out.push({ profile: owner, role: "owner", row: null });
    return out;
  }
  const workspace = vault.workspaceId ? await ctx.db.get(vault.workspaceId) : null;
  if (workspace) {
    const owner = await ctx.db.get(workspace.ownerId);
    if (owner && (await vaultRoleOf(ctx, owner, vault)) === "owner") out.push({ profile: owner, role: "owner", row: null });
  }
  for (const row of await ctx.db
    .query("vaultMembers")
    .withIndex("by_vault", (q) => q.eq("vaultId", vault._id))
    .take(500)) {
    const p = await ctx.db.get(row.profileId);
    if (!p || out.some((o) => o.profile._id === p._id)) continue;
    const role = await vaultRoleOf(ctx, p, vault);
    if (role) out.push({ profile: p, role, row });
  }
  return out;
}

/** The People section: who has access, their role, whether they can open it yet. */
export const list = query({
  args: { vaultId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId);
    const custodianView = role !== "member";
    const people = [];
    for (const p of await peopleOf(ctx, vault)) {
      const grants = await grantRows(ctx, vault._id, p.profile._id);
      const pending = await ctx.db
        .query("vaultPendingGrants")
        .withIndex("by_vault_profile", (q) => q.eq("vaultId", vault._id).eq("profileId", p.profile._id))
        .first();
      people.push({
        profileId: p.profile._id as string,
        name: p.profile.displayName,
        avatarUrl: await identityImageUrl(ctx, p.profile.avatarFileId),
        email: custodianView ? p.profile.email : null,
        role: p.role,
        isYou: p.profile._id === profile._id,
        /** Can open it: they've set their passcode for the current key. */
        ready: grants.some((g) => g.layer === "passcode" && g.version === vault.keyVersion),
        waiting: pending !== null,
        addedAt: p.row?.createdAt ?? vault.createdAt,
      });
    }
    const custodians = people.filter((p) => p.role !== "member").length;
    return {
      people,
      canAdd: custodianView,
      canNameCustodians: canNameCustodians(vault, role),
      /** Only one person holds the team Vault's key as a custodian: losing their recovery key would lock it for good. */
      onlyOneCustodian: vault.workspaceId !== undefined && custodians <= 1,
      accessReviewedAt: vault.accessReviewedAt ?? null,
    };
  },
});

/**
 * Adds a workspace member to the team Vault (custodians; naming a custodian follows the owner's setting). They get
 * the key once a custodian's device shares it (vaultKeys.grant) and they choose their passcode.
 */
export const add = mutation({
  args: { vaultId: v.string(), profileId: v.string(), role: vRole, client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId, "custodian");
    teamOnly(vault);
    if (args.role === "custodian" && !canNameCustodians(vault, role)) fail("forbidden", "Only the owner names custodians.");
    const targetId = ctx.db.normalizeId("profiles", args.profileId);
    const target = targetId ? await ctx.db.get(targetId) : null;
    const m = target ? await membership(ctx, target._id, vault.workspaceId!) : null;
    if (!target || !m || target.status !== "active") fail("not_found", "Only members of this workspace can be added to its Vault.");
    if (normalizeMembership(m).role === "owner") fail("invalid_argument", "The owner is always in the Vault.");
    if (await vaultMemberRow(ctx, vault._id, target._id)) fail("conflict", "They're already in the Vault.");
    const now = Date.now();
    await insertScoped(ctx, "vaultMembers", scopeOfRow(vault), { vaultId: vault._id, profileId: target._id, role: args.role, addedBy: profile._id, createdAt: now });
    if (vault.keyVersion > 0) await insertScoped(ctx, "vaultPendingGrants", scopeOfRow(vault), { vaultId: vault._id, profileId: target._id, reason: "added", createdAt: now });
    await appendLog(ctx, vault, { event: "person.added", actor: { profile, role }, detail: { profileId: target._id, name: target.displayName, email: target.email, role: args.role } });
    await notifyVaultChange(ctx, vault, profile, { what: "person", verb: "added", personName: target.displayName });
    return null;
  },
});

/** Makes someone a custodian or a member (the owner; custodians too if the owner allows it). */
export const setRole = mutation({
  args: { vaultId: v.string(), profileId: v.string(), role: vRole, client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId, "custodian");
    teamOnly(vault);
    if (!canNameCustodians(vault, role)) fail("forbidden", "Only the owner names custodians.");
    const targetId = ctx.db.normalizeId("profiles", args.profileId);
    const row = targetId ? await vaultMemberRow(ctx, vault._id, targetId) : null;
    if (!row) fail("not_found", "They aren't in the Vault (the owner's role can't change).");
    if (row.role === args.role) return null;
    await ctx.db.patch(row._id, { role: args.role });
    const target = await ctx.db.get(row.profileId);
    await appendLog(ctx, vault, { event: "person.roleChanged", actor: { profile, role }, detail: { profileId: row.profileId, name: target?.displayName ?? "Someone", from: row.role, to: args.role }, client: args.client });
    return null;
  },
});

/**
 * Everything of someone's in a Vault goes: their row, grants, waiting grant and lockout counter. If they could open
 * it, the Vault needs a new key version (rotationNeeded) so they can't read what comes next.
 */
export async function dropFromVault(ctx: MutationCtx, vault: Doc<"vaults">, profileId: Id<"profiles">): Promise<boolean> {
  const row = await vaultMemberRow(ctx, vault._id, profileId);
  if (row) await ctx.db.delete(row._id);
  const grants = await grantRows(ctx, vault._id, profileId);
  for (const g of grants) await ctx.db.delete(g._id);
  for (const p of await ctx.db
    .query("vaultPendingGrants")
    .withIndex("by_vault_profile", (q) => q.eq("vaultId", vault._id).eq("profileId", profileId))
    .collect())
    await ctx.db.delete(p._id);
  const throttle = await ctx.db
    .query("vaultThrottles")
    .withIndex("by_vault_profile", (q) => q.eq("vaultId", vault._id).eq("profileId", profileId))
    .unique();
  if (throttle) await ctx.db.delete(throttle._id);
  if (grants.length) await ctx.db.patch(vault._id, { rotationNeeded: true });
  return row !== null || grants.length > 0;
}

/**
 * Removes someone from the team Vault (custodians remove members; removing a custodian follows the custodian-naming
 * rule; the owner can't be removed). Anyone may remove themselves (leave).
 */
export const remove = mutation({
  args: { vaultId: v.string(), profileId: v.string(), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const leaving = args.profileId === (profile._id as string);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId, leaving ? "member" : "custodian");
    teamOnly(vault);
    const targetId = ctx.db.normalizeId("profiles", args.profileId);
    const row = targetId ? await vaultMemberRow(ctx, vault._id, targetId) : null;
    if (!row) fail(leaving && role === "owner" ? "invalid_argument" : "not_found", leaving && role === "owner" ? "The owner can't leave their workspace's Vault." : "They aren't in the Vault.");
    if (!leaving && row.role === "custodian" && !canNameCustodians(vault, role)) fail("forbidden", "Only the owner removes custodians.");
    const target = await ctx.db.get(row.profileId);
    await dropFromVault(ctx, vault, row.profileId);
    await appendLog(ctx, vault, { event: leaving ? "person.left" : "person.removed", actor: { profile, role }, detail: { profileId: row.profileId, name: target?.displayName ?? "Someone", email: target?.email ?? null, role: row.role }, client: args.client });
    await notifyVaultChange(ctx, vault, profile, { what: "person", verb: "removed", personName: leaving ? "themselves" : (target?.displayName ?? "someone") });
    return null;
  },
});

/** A custodian confirms who has access (the 90-day review). */
export const reviewed = mutation({
  args: { vaultId: v.string(), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId, "custodian");
    await ctx.db.patch(vault._id, { accessReviewedAt: Date.now() });
    await appendLog(ctx, vault, { event: "access.reviewed", actor: { profile, role }, detail: { people: (await peopleOf(ctx, vault)).length }, client: args.client });
    return null;
  },
});

/** Everyone who holds the Vault's key, with the account public key a new key version is sealed to (custodians). */
export const keyHolders = query({
  args: { vaultId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { vault } = await requireVault(ctx, profile, args.vaultId, "custodian");
    const out = [];
    for (const p of await peopleOf(ctx, vault)) {
      if (!(await grantRows(ctx, vault._id, p.profile._id)).length) continue;
      const account = await activeAccount(ctx, p.profile._id);
      if (account) out.push({ profileId: p.profile._id as string, epoch: account.epoch, x25519Pub: account.x25519Pub });
    }
    return { keyVersion: vault.keyVersion, rotationNeeded: vault.rotationNeeded === true, people: out };
  },
});

/**
 * A new key version from a custodian's device: its check value and the key sealed to every key holder's account key
 * (the inner layer; each adds their passcode layer at their next unlock). New writes use it from now on.
 */
export const rotate = mutation({
  args: { vaultId: v.string(), version: v.number(), check: v.bytes(), grants: v.array(v.object({ profileId: v.string(), epoch: v.number(), wrapped: v.bytes() })), client: v.optional(vVaultClient) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { vault, role } = await requireVault(ctx, profile, args.vaultId, "custodian");
    if (args.version !== vault.keyVersion + 1) fail("conflict", "The Vault's key changed meanwhile. Open it again.");
    if (args.check.byteLength !== 16) fail("invalid_argument", "Invalid key data.");
    const holders = new Set<string>();
    for (const p of await peopleOf(ctx, vault)) if ((await grantRows(ctx, vault._id, p.profile._id)).length) holders.add(p.profile._id as string);
    const given = new Set(args.grants.map((g) => g.profileId));
    if (given.size !== args.grants.length || [...holders].some((h) => !given.has(h)) || [...given].some((g) => !holders.has(g))) fail("invalid_argument", "Seal the new key to everyone who holds the Vault's key.");
    const now = Date.now();
    await insertScoped(ctx, "vaultKeys", scopeOfRow(vault), { vaultId: vault._id, version: args.version, check: args.check, createdBy: profile._id, createdAt: now });
    for (const g of args.grants) {
      if (g.wrapped.byteLength < 32 || g.wrapped.byteLength > 4096) fail("invalid_argument", "Invalid key data.");
      const account = await activeAccount(ctx, g.profileId as Id<"profiles">);
      if (!account || account.epoch !== g.epoch) fail("conflict", "Someone's encryption key changed. Try again.");
      await insertScoped(ctx, "vaultGrants", scopeOfRow(vault), { vaultId: vault._id, profileId: g.profileId as Id<"profiles">, version: args.version, layer: "custodian", epoch: g.epoch, wrapped: g.wrapped, grantedBy: profile._id, createdAt: now });
    }
    // Anyone still waiting gets every version, the new one included, when a custodian's device shares it.
    await ctx.db.patch(vault._id, { keyVersion: args.version, rotationNeeded: false });
    await appendLog(ctx, vault, { event: "key.rotated", actor: { profile, role }, detail: { version: args.version, people: args.grants.length, versions: (await liveVersions(ctx, { ...vault, keyVersion: args.version })).length }, client: args.client });
    return null;
  },
});

/**
 * Someone stopped being a member of a workspace (removed or left): out of its Vault too, logged by the system, and
 * a new key version is due if they could open it. Called from workspaces.ts.
 */
export async function vaultMemberLeftWorkspace(ctx: MutationCtx, workspaceId: Id<"workspaces">, profileId: Id<"profiles">): Promise<void> {
  const vault = await ctx.db
    .query("vaults")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .first();
  if (!vault) return;
  const row = await vaultMemberRow(ctx, vault._id, profileId);
  const target = await ctx.db.get(profileId);
  if (!(await dropFromVault(ctx, vault, profileId))) return;
  await appendLog(ctx, vault, { event: "person.leftWorkspace", actor: { profile: null, role: "system", name: "Folevi" }, detail: { profileId, name: target?.displayName ?? "Someone", email: target?.email ?? null, role: row?.role ?? "member" } });
  await notifyVaultChange(ctx, vault, null, { what: "person", verb: "removed", personName: target?.displayName ?? "someone" });
}
