// End-to-end encryption per space (a Personal or a workspace): its level, state and feature switches, its
// space key versions and who holds them (docs/E2EE_DESIGN.md §4.9, §5.3, §7.1, §8). Only a Personal's owner
// and a workspace's owner and admins change any of it (§8.5); members read it. WP2.
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { mutation, query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { assertWritable, requireProfile, resolveScope, type ScopeAccess } from "../lib/auth";
import { fail } from "../lib/errors";
import { MANAGER_ONLY } from "../lib/permissions";
import { inScope, insertScoped, personalScope, scopeKey, vScopeArg, workspaceScope, type Scope, type ScopeArg } from "../lib/scope";
import { nextSeq } from "../lib/seq";
import {
  activeAccount,
  addPending,
  checkBytes,
  checkPublicKey,
  grantsOf,
  requireAccount,
  requireE2eeFlag,
  requireSpace,
  requireTwoMethods,
  scopeMembers,
  spaceKeys,
  spaceKeyVersion,
  startSpaceMigration,
  storeGrants,
  touchSpace,
} from "../lib/e2ee/keyStore";
import { e2eeScopeId, failE2ee, isE2eeActive, spaceE2ee, switchesOf } from "../lib/e2ee/state";
import {
  DEFAULT_SELECTED_SWITCHES,
  E2EE_LIMITS,
  FULL_SWITCHES,
  vE2eeEnabledLevel,
  vE2eeLevel,
  vE2eeSwitches,
  vNoteKeyWrapInput,
  vSpaceGrantInput,
  vSpaceKeyInput,
  type MirrorPurpose,
  type NoteKeyWrapInput,
  type Switches,
} from "../lib/e2ee/validators";

/** A recovery method must have been re-checked this recently to lower a space's level (§5.3 lower). */
export const RECHECK_WINDOW_MS = 10 * 60_000;

/** WP5's purge of a switch's readable copies (`e2ee.mirrors.purge`), called by name so this module doesn't depend on it. */
const purgeMirrors = makeFunctionReference<"mutation", { scope: Scope; purpose: MirrorPurpose }>("e2ee/mirrors:purge");

/** The switch behind each kind of readable copy. */
const PURPOSE_OF: Partial<Record<keyof Switches, MirrorPurpose>> = { searchEverywhere: "search", backgroundAi: "ai", apps: "apps" };

const LEVEL_RANK = { standard: 0, selected: 1, full: 2 } as const;

/** The scope, refusing anyone but a Personal's owner or a workspace's owner and admins. */
async function managerScope(ctx: QueryCtx, profile: Doc<"profiles">, arg: ScopeArg): Promise<ScopeAccess> {
  const access = await resolveScope(ctx, profile, arg, "view");
  if (access.role !== "owner" && access.role !== "admin") fail("forbidden", MANAGER_ONLY);
  if (access.workspace?.deletionScheduledFor !== undefined) fail("forbidden", "This workspace is scheduled for deletion.");
  return access;
}

/** The scope as clients name it. */
async function scopeArgOf(ctx: QueryCtx, scope: Scope): Promise<ScopeArg> {
  if (scope.kind === "personal") return { kind: "personal" };
  const ws = await ctx.db.get(scope.workspaceId);
  return { kind: "workspace", workspaceId: ws!.publicId };
}

/** The current (newest non-retired) key version's public inbox key. */
async function currentInboxPub(ctx: QueryCtx, scope: Scope, version: number): Promise<ArrayBuffer | null> {
  if (version < 1) return null;
  return (await spaceKeyVersion(ctx, scope, version))?.inboxPub ?? null;
}

/** How many people hold the current key version (at their current account epoch). */
async function keyHolderCount(ctx: QueryCtx, scope: Scope, version: number): Promise<number> {
  if (version < 1) return 0;
  let n = 0;
  for (const m of await scopeMembers(ctx, scope)) {
    const account = await activeAccount(ctx, m.profileId);
    if (account && (await grantsOf(ctx, scope, m.profileId)).some((g) => g.version === version && g.epoch === account.epoch)) n++;
  }
  return n;
}

/** Schedules the purge of every readable copy whose switch goes from on to off. */
async function schedulePurges(ctx: MutationCtx, scope: Scope, before: Switches, after: Switches): Promise<MirrorPurpose[]> {
  const purged: MirrorPurpose[] = [];
  for (const [name, purpose] of Object.entries(PURPOSE_OF) as [keyof Switches, MirrorPurpose][]) {
    if (before[name] && !after[name]) {
      await ctx.scheduler.runAfter(0, purgeMirrors, { scope, purpose });
      purged.push(purpose);
    }
  }
  return purged;
}

/** Switches as stored for a level: Fully encrypted turns everything off; Foli AI's agent-free modes stay as picked. */
function switchesFor(level: "selected" | "full", picked: Switches): Switches {
  return level === "full" ? FULL_SWITCHES : { ...picked };
}

/** A space's encryption, for Settings > Privacy and the router. Standard spaces with no row read as Standard. */
export const get = query({
  args: { scope: vScopeArg },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    const space = await spaceE2ee(ctx, scope);
    const scopeId = await e2eeScopeId(ctx, scope);
    if (!space) {
      return { scopeId, setUp: false, level: "standard" as const, state: "off" as const, switches: switchesOf(null), currentKeyVersion: 0, inboxPub: null, lockedCount: 0, active: false, migration: null, keyHolders: 0 };
    }
    const migration = space.migrationId ? await ctx.db.get(space.migrationId) : null;
    return {
      scopeId,
      setUp: space.currentKeyVersion > 0,
      level: space.level,
      state: space.state,
      switches: switchesOf(space),
      currentKeyVersion: space.currentKeyVersion,
      inboxPub: await currentInboxPub(ctx, scope, space.currentKeyVersion),
      lockedCount: space.lockedCount,
      active: isE2eeActive(space),
      migration: migration
        ? { id: migration._id as string, direction: migration.direction, phase: migration.phase, total: migration.total, done: migration.done, failed: migration.failed, finishedAt: migration.finishedAt ?? null }
        : null,
      keyHolders: await keyHolderCount(ctx, scope, space.currentKeyVersion),
    };
  },
});

/**
 * Every space the caller belongs to that is e2ee-active (encrypted, or Standard with locks), with the
 * caller's own grants of its key versions (what the device's key ring opens).
 */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const account = await activeAccount(ctx, profile._id);
    const scopes: Scope[] = [personalScope(profile._id)];
    const memberships = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .take(500);
    for (const m of memberships) {
      const ws = await ctx.db.get(m.workspaceId);
      if (ws && ws.status !== "deleting" && (ws.deletionScheduledFor === undefined || m.role === "owner")) scopes.push(workspaceScope(ws._id));
    }
    const out = [];
    for (const scope of scopes) {
      const space = await spaceE2ee(ctx, scope);
      if (!space || !isE2eeActive(space)) continue;
      const grants = await grantsOf(ctx, scope, profile._id);
      out.push({
        scope: await scopeArgOf(ctx, scope),
        scopeId: await e2eeScopeId(ctx, scope),
        level: space.level,
        state: space.state,
        switches: switchesOf(space),
        currentKeyVersion: space.currentKeyVersion,
        lockedCount: space.lockedCount,
        seq: space.seq,
        grants: grants
          .filter((g) => !account || g.epoch === account.epoch)
          .sort((a, b) => a.version - b.version)
          .map((g) => ({ version: g.version, epoch: g.epoch, wrapped: g.wrapped, statement: g.statement, grantedBy: g.grantedBy as string })),
      });
    }
    return out;
  },
});

/**
 * Gives a space its first key (version 1) and grants it to the people given. Members of a workspace who
 * get no grant now (no keys yet, or not included) wait as "joined" pending grants. The space stays
 * Standard: this is the first step of encrypting it, or of locking a folder or note in it.
 */
export const setUp = mutation({
  args: { scope: vScopeArg, key: vSpaceKeyInput, grants: v.array(vSpaceGrantInput) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { scope } = await managerScope(ctx, profile, args.scope);
    await requireAccount(ctx, profile._id);
    const existing = await spaceE2ee(ctx, scope);
    if (existing && existing.currentKeyVersion > 0) fail("conflict", "This space already has a key.");
    if (args.key.version !== 1) fail("invalid_argument", "A space's first key is version 1.");
    checkPublicKey(args.key.inboxPub, "The inbox key");
    checkBytes(args.key.skCheck, "The check value", E2EE_LIMITS.checkBytes);
    if (!args.grants.some((g) => g.profileId === profile._id && g.version === 1)) fail("invalid_argument", "Grant the key to yourself too.");
    const now = Date.now();
    await insertScoped(ctx, "e2eeSpaceKeys", scope, { scopeKey: scopeKey(scope), version: 1, inboxPub: args.key.inboxPub, skCheck: args.key.skCheck, createdBy: profile._id, createdAt: now });
    const fields = { level: "standard" as const, state: "off" as const, currentKeyVersion: 1, changedBy: profile._id, changedAt: now, seq: await nextSeq(ctx, scope) };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await insertScoped(ctx, "e2eeSpaces", scope, { scopeKey: scopeKey(scope), switches: DEFAULT_SELECTED_SWITCHES, lockedCount: 0, ...fields });
    const granted = await storeGrants(ctx, scope, profile._id, args.grants.filter((g) => g.version === 1));
    let pending = 0;
    for (const m of await scopeMembers(ctx, scope)) {
      if (granted.has(m.profileId)) continue;
      await addPending(ctx, scope, m.profileId, "joined");
      pending++;
    }
    return { version: 1, pending };
  },
});

/**
 * Encrypts a space: "selected" (with the features picked) or "full". From Standard this starts a seal
 * migration (state "enabling" until devices finish it); from "selected" to "full" no data changes, but every
 * readable copy is purged. Needs two recovery methods (§4.7.5).
 */
export const enable = mutation({
  args: { scope: vScopeArg, level: vE2eeEnabledLevel, switches: vE2eeSwitches },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    await requireE2eeFlag(ctx);
    const { scope } = await managerScope(ctx, profile, args.scope);
    const account = await requireAccount(ctx, profile._id);
    await requireTwoMethods(ctx, account);
    const space = await requireSpace(ctx, scope);
    if (space.state === "disabling") fail("conflict", "Wait until the notes here are decrypted, then try again.");
    if (LEVEL_RANK[args.level] <= LEVEL_RANK[space.level]) fail("invalid_argument", "To lower the level, use Lower.");
    const before = switchesOf(space);
    const switches = switchesFor(args.level, args.switches);
    if (space.level === "standard") {
      const migrationId = await startSpaceMigration(ctx, scope, profile._id, "seal", args.level);
      await touchSpace(ctx, space, scope, profile._id, { level: args.level, state: "enabling", switches, migrationId });
      return { migrationId: migrationId as string, purged: [] as MirrorPurpose[] };
    }
    const purged = await schedulePurges(ctx, scope, before, switches);
    await touchSpace(ctx, space, scope, profile._id, { level: args.level, switches });
    return { migrationId: null, purged };
  },
});

/** Changes the feature switches at "Encrypted, with the features you pick". A switch turned off purges its readable copies. */
export const setSwitches = mutation({
  args: { scope: vScopeArg, switches: vE2eeSwitches },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { scope } = await managerScope(ctx, profile, args.scope);
    const space = await requireSpace(ctx, scope);
    if (space.level !== "selected") fail("invalid_argument", space.level === "full" ? "Fully encrypted spaces have every feature off." : "Switches apply once the space is encrypted.");
    const purged = await schedulePurges(ctx, scope, switchesOf(space), args.switches);
    await touchSpace(ctx, space, scope, profile._id, { switches: { ...args.switches } });
    return { purged };
  },
});

/**
 * Lowers the level: "full" to "selected" changes no data; to "standard" starts an unseal migration (state
 * "disabling"). The person must have re-checked a recovery method in the last 10 minutes: `recheckedWrapId`
 * is a wrap they fetched with keys.getWrap.
 */
export const lower = mutation({
  args: { scope: vScopeArg, level: vE2eeLevel, recheckedWrapId: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { scope } = await managerScope(ctx, profile, args.scope);
    const account = await requireAccount(ctx, profile._id);
    const space = await requireSpace(ctx, scope);
    if (LEVEL_RANK[args.level] >= LEVEL_RANK[space.level]) fail("invalid_argument", "That isn't a lower level.");
    const wrap = await ctx.db
      .query("e2eeAccountWraps")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.recheckedWrapId))
      .unique();
    const fresh = wrap && wrap.profileId === profile._id && wrap.epoch === account.epoch && wrap.kind !== "device" && (wrap.lastUsedAt ?? 0) >= Date.now() - RECHECK_WINDOW_MS;
    if (!fresh) failE2ee("e2ee_recovery_required", "Check one of your recovery methods again first.");
    if (args.level === "selected") {
      await touchSpace(ctx, space, scope, profile._id, { level: "selected", switches: DEFAULT_SELECTED_SWITCHES });
      return { migrationId: null };
    }
    const migrationId = await startSpaceMigration(ctx, scope, profile._id, "unseal", "standard");
    await touchSpace(ctx, space, scope, profile._id, { level: "standard", state: "disabling", switches: DEFAULT_SELECTED_SWITCHES, migrationId });
    return { migrationId: migrationId as string };
  },
});

/** Checks and stores note key wraps made with a space key version (rotation batches). */
async function storeSpaceNoteKeys(ctx: MutationCtx, scope: Scope, by: Id<"profiles">, spaceVersion: number, noteKeys: NoteKeyWrapInput[]): Promise<number> {
  if (noteKeys.length > E2EE_LIMITS.batch) fail("invalid_argument", "Too many note keys in one call.");
  if (!noteKeys.length) return 0;
  const seq = await nextSeq(ctx, scope);
  const now = Date.now();
  let stored = 0;
  for (const nk of noteKeys) {
    if (nk.wrappedBy !== "space" || nk.spaceVersion !== spaceVersion) fail("invalid_argument", "Rotation wraps note keys with the new space key.");
    checkBytes(nk.wrapped, "A note key", 22 + 16, E2EE_LIMITS.keyWrapBytes);
    const doc = await ctx.db
      .query("documents")
      .withIndex("by_public_id", (q) => q.eq("publicId", nk.documentId))
      .unique();
    if (!doc || !inScope(doc, scope)) fail("not_found", "Document not found.");
    const versions = await ctx.db
      .query("e2eeNoteKeys")
      .withIndex("by_document", (q) => q.eq("documentId", doc._id).eq("version", nk.version))
      .take(200);
    if (!versions.length) fail("invalid_argument", "That note key version doesn't exist.");
    for (const r of versions) if (r.wrappedBy === "space" && r.spaceVersion === spaceVersion) await ctx.db.delete(r._id);
    await insertScoped(ctx, "e2eeNoteKeys", scope, { documentId: doc._id, version: nk.version, wrappedBy: "space", spaceVersion, wrapped: nk.wrapped, createdBy: by, createdAt: now, seq });
    stored++;
  }
  return stored;
}

/**
 * Changes the space key (a member removed, a device revoked with "change your key"; §4.9, §8.3): version
 * n+1 granted to every remaining member, version n retired, and the first batch of note keys wrapped by the
 * new version. Members without keys wait as pending; old data is re-sealed in the background.
 */
export const rotate = mutation({
  args: { scope: vScopeArg, key: vSpaceKeyInput, grants: v.array(vSpaceGrantInput), noteKeys: v.array(vNoteKeyWrapInput) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { scope } = await managerScope(ctx, profile, args.scope);
    await requireAccount(ctx, profile._id);
    const space = await requireSpace(ctx, scope);
    const version = space.currentKeyVersion + 1;
    if (args.key.version !== version) fail("conflict", "The space key changed on another device. Reload and try again.");
    checkPublicKey(args.key.inboxPub, "The inbox key");
    checkBytes(args.key.skCheck, "The check value", E2EE_LIMITS.checkBytes);
    if (!args.grants.some((g) => g.profileId === profile._id && g.version === version)) fail("invalid_argument", "Grant the new key to yourself too.");
    const now = Date.now();
    for (const k of await spaceKeys(ctx, scope)) if (k.retiredAt === undefined) await ctx.db.patch(k._id, { retiredAt: now });
    await insertScoped(ctx, "e2eeSpaceKeys", scope, { scopeKey: scopeKey(scope), version, inboxPub: args.key.inboxPub, skCheck: args.key.skCheck, createdBy: profile._id, createdAt: now });
    await ctx.db.patch(space._id, { currentKeyVersion: version });
    const granted = await storeGrants(ctx, scope, profile._id, args.grants.filter((g) => g.version === version));
    // The rotation itself is done: its pending entries go; members left without the new key wait.
    const key = scopeKey(scope);
    const pendingRows = await ctx.db
      .query("e2eePendingGrants")
      .withIndex("by_scope", (q) => q.eq("scopeKey", key))
      .take(1000);
    for (const p of pendingRows) if (p.reason === "rotation") await ctx.db.delete(p._id);
    let pending = 0;
    for (const m of await scopeMembers(ctx, scope)) {
      if (granted.has(m.profileId)) continue;
      await addPending(ctx, scope, m.profileId, "joined");
      pending++;
    }
    const noteKeys = await storeSpaceNoteKeys(ctx, scope, profile._id, version, args.noteKeys);
    const fresh = (await ctx.db.get(space._id))!;
    const migrationId = await startSpaceMigration(ctx, scope, profile._id, "reseal", fresh.level);
    await touchSpace(ctx, fresh, scope, profile._id, { migrationId });
    return { version, pending, noteKeys, migrationId: migrationId as string };
  },
});

/** Later batches of a rotation: note keys wrapped by the current space key version. */
export const addNoteKeyWraps = mutation({
  args: { scope: vScopeArg, noteKeys: v.array(vNoteKeyWrapInput) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    await assertWritable(ctx, profile);
    const { scope } = await managerScope(ctx, profile, args.scope);
    const space = await requireSpace(ctx, scope);
    const stored = await storeSpaceNoteKeys(ctx, scope, profile._id, space.currentKeyVersion, args.noteKeys);
    return { stored };
  },
});

/** Who can unlock the space now (a grant of the current version at their current epoch) and who is waiting. */
export const keyHolders = query({
  args: { scope: vScopeArg },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const { scope } = await resolveScope(ctx, profile, args.scope);
    const space = await spaceE2ee(ctx, scope);
    const version = space?.currentKeyVersion ?? 0;
    const holders = [];
    for (const m of await scopeMembers(ctx, scope)) {
      const account = await activeAccount(ctx, m.profileId);
      const grants = account ? (await grantsOf(ctx, scope, m.profileId)).filter((g) => g.epoch === account.epoch) : [];
      if (!grants.some((g) => g.version === version)) continue;
      const person = await ctx.db.get(m.profileId);
      holders.push({ profileId: m.profileId as string, displayName: person?.displayName ?? "", manager: m.manager, versions: grants.map((g) => g.version).sort((a, b) => a - b) });
    }
    const pendingRows = await ctx.db
      .query("e2eePendingGrants")
      .withIndex("by_scope", (q) => q.eq("scopeKey", scopeKey(scope)))
      .take(1000);
    const pending = [];
    for (const p of pendingRows) {
      const person = await ctx.db.get(p.profileId);
      const doc = p.documentId ? await ctx.db.get(p.documentId) : null;
      pending.push({
        profileId: p.profileId as string,
        displayName: person?.displayName ?? "",
        reason: p.reason,
        documentId: doc?.publicId ?? null,
        hasKeys: (await activeAccount(ctx, p.profileId)) !== null,
        createdAt: p.createdAt,
      });
    }
    return { currentKeyVersion: version, count: holders.length, holders, pending };
  },
});
