// End-to-end encryption: shared helpers of the key-management modules (convex/e2ee/keys.ts, devices.ts,
// spaces.ts, grants.ts; docs/E2EE_DESIGN.md §4.7 to §4.9, §5.3). WP2.
//
// The server stores public keys, wrapped keys and signed statements. It never opens a wrap and never
// verifies a signature as a security decision: devices verify statements against the keys they trust
// (§4.8, §8.6). What it does check here is consistency (sizes, that a statement's body names the row it is
// stored with), so a buggy client can't store something other devices would reject later.
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { isFeatureEnabled } from "../flags";
import { fail } from "../errors";
import { insertScoped, scopeKey, type Scope } from "../scope";
import { nextSeq } from "../seq";
import { e2eeScopeId, failE2ee, isE2eeActive, spaceE2ee } from "./state";
import { E2EE_LIMITS, type WrapKind } from "./validators";

type Ctx = QueryCtx | MutationCtx;

// ---------------------------------------------------------------- bytes

/** base64url without padding (statement bodies carry public keys this way). */
export function b64u(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Constant-time comparison of two byte strings. */
export function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

/** Refuses bytes outside [min, max] (sizes are all the server can check on keys and ciphertext). */
export function checkBytes(bytes: ArrayBuffer, name: string, min: number, max = min): void {
  const n = bytes.byteLength;
  if (n < min || n > max) fail("invalid_argument", min === max ? `${name} must be ${min} bytes.` : `${name} must be ${min} to ${max} bytes.`);
}

export function checkPublicKey(bytes: ArrayBuffer, name: string): void {
  checkBytes(bytes, name, E2EE_LIMITS.publicKeyBytes);
}

/** A short label for a device or a recovery method: trimmed, no control characters, at most 80 characters. */
export function cleanLabel(label: string | undefined, fallback: string): string {
  const clean = (label ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, E2EE_LIMITS.labelChars);
  return clean || fallback;
}

/** ULIDs, as every public id. */
export function isUlid(id: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id);
}

// ---------------------------------------------------------------- statements

/** Parses a statement body (canonical JSON of an object), refusing anything else. */
export function statementBody(statement: { body: string }): Record<string, unknown> {
  if (statement.body.length > E2EE_LIMITS.statementBytes) fail("invalid_argument", "The statement is too large.");
  let value: unknown;
  try {
    value = JSON.parse(statement.body);
  } catch {
    fail("invalid_argument", "The statement isn't valid.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid_argument", "The statement isn't valid.");
  return value as Record<string, unknown>;
}

/** Refuses a statement whose body doesn't name exactly these values. */
export function expectStatement(statement: { body: string; sig: string }, expected: Record<string, string | number>): void {
  if (!statement.sig || statement.sig.length > 200) fail("invalid_argument", "The statement isn't signed.");
  const body = statementBody(statement);
  for (const [k, value] of Object.entries(expected)) {
    if (body[k] !== value) fail("invalid_argument", `The statement doesn't match (${k}).`);
  }
}

// ---------------------------------------------------------------- accounts

/** The person's current E2EE account epoch, or null when they never set encryption up (or reset it away). */
export async function activeAccount(ctx: Ctx, profileId: Id<"profiles">): Promise<Doc<"e2eeAccounts"> | null> {
  const latest = await ctx.db
    .query("e2eeAccounts")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId))
    .order("desc")
    .first();
  return latest && latest.status === "active" ? latest : null;
}

export async function requireAccount(ctx: Ctx, profileId: Id<"profiles">): Promise<Doc<"e2eeAccounts">> {
  const account = await activeAccount(ctx, profileId);
  if (!account) failE2ee("e2ee_not_set_up", "Set up encryption first.");
  return account;
}

/** Setting up encryption and encrypting spaces wait for the `e2ee` feature flag until launch (§5.9). */
export async function requireE2eeFlag(ctx: Ctx): Promise<void> {
  if (!(await isFeatureEnabled(ctx, "e2ee"))) failE2ee("e2ee_unavailable", "End-to-end encryption isn't available yet.", { feature: "e2ee" });
}

/** The account's AMK wraps of one epoch. */
export async function wrapsOf(ctx: Ctx, profileId: Id<"profiles">, epoch: number): Promise<Doc<"e2eeAccountWraps">[]> {
  return await ctx.db
    .query("e2eeAccountWraps")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId).eq("epoch", epoch))
    .take(200);
}

/** Trusted devices of a person (any kind). */
export async function trustedDevices(ctx: Ctx, profileId: Id<"profiles">): Promise<Doc<"e2eeDevices">[]> {
  return await ctx.db
    .query("e2eeDevices")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId).eq("status", "trusted"))
    .take(200);
}

export type MethodKind = WrapKind;

/**
 * The kinds of recovery methods the person has now (§4.7.5): a recovery key, a passkey, a passphrase, and
 * "device" while two or more trusted devices or browsers (not public sessions) hold a wrap of this epoch.
 * `without` leaves one wrap out (to check a removal).
 */
export async function methodKinds(ctx: Ctx, account: Doc<"e2eeAccounts">, without?: Id<"e2eeAccountWraps">): Promise<Set<MethodKind>> {
  const wraps = (await wrapsOf(ctx, account.profileId, account.epoch)).filter((w) => w._id !== without);
  const kinds = new Set<MethodKind>();
  for (const w of wraps) if (w.kind !== "device") kinds.add(w.kind);
  const trusted = new Set((await trustedDevices(ctx, account.profileId)).filter((d) => d.kind !== "session").map((d) => d.deviceId));
  const deviceWraps = new Set(wraps.filter((w) => w.kind === "device" && w.deviceId && trusted.has(w.deviceId)).map((w) => w.deviceId));
  if (deviceWraps.size >= 2) kinds.add("device");
  return kinds;
}

/** Whether the person holds a key to any space that is encrypted or has locked items (then methods can't drop below two). */
export async function holdsEncryptedSpace(ctx: Ctx, profileId: Id<"profiles">): Promise<boolean> {
  const grants = await ctx.db
    .query("e2eeSpaceGrants")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId))
    .take(500);
  const seen = new Set<string>();
  for (const g of grants) {
    if (seen.has(g.scopeKey)) continue;
    seen.add(g.scopeKey);
    const space = await ctx.db
      .query("e2eeSpaces")
      .withIndex("by_scope_key", (q) => q.eq("scopeKey", g.scopeKey))
      .unique();
    if (isE2eeActive(space)) return true;
  }
  return false;
}

export async function requireTwoMethods(ctx: Ctx, account: Doc<"e2eeAccounts">): Promise<void> {
  if ((await methodKinds(ctx, account)).size < 2) failE2ee("e2ee_recovery_required");
}

// ---------------------------------------------------------------- rate limit for unlocking (§4.7.3)

const UNLOCK_LIMIT = 10;
const UNLOCK_WINDOW_MS = 60 * 60_000;

/**
 * Counts one attempt to fetch a recovery wrap (10 an hour per account) in the `rateLimits` table. Beyond the
 * limit it refuses with `e2ee_rate_limited`; the refused call writes nothing, so the count stays at the limit.
 */
export async function consumeUnlockAttempt(ctx: MutationCtx, profileId: Id<"profiles">): Promise<void> {
  const now = Date.now();
  const windowStart = now - (now % UNLOCK_WINDOW_MS);
  const bucket = `e2eeUnlock:${profileId}`;
  const row = await ctx.db
    .query("rateLimits")
    .withIndex("by_bucket", (q) => q.eq("bucket", bucket))
    .unique();
  if (!row || row.windowStart !== windowStart) {
    if (row) await ctx.db.patch(row._id, { windowStart, count: 1 });
    else await ctx.db.insert("rateLimits", { bucket, windowStart, count: 1 });
    return;
  }
  if (row.count >= UNLOCK_LIMIT) failE2ee("e2ee_rate_limited", undefined, { retryAfterMs: windowStart + UNLOCK_WINDOW_MS - now });
  await ctx.db.patch(row._id, { count: row.count + 1 });
}

// ---------------------------------------------------------------- spaces

/** The space key versions of a scope, oldest first. */
export async function spaceKeys(ctx: Ctx, scope: Scope): Promise<Doc<"e2eeSpaceKeys">[]> {
  return await ctx.db
    .query("e2eeSpaceKeys")
    .withIndex("by_scope_version", (q) => q.eq("scopeKey", scopeKey(scope)))
    .take(1000);
}

export async function spaceKeyVersion(ctx: Ctx, scope: Scope, version: number): Promise<Doc<"e2eeSpaceKeys"> | null> {
  return await ctx.db
    .query("e2eeSpaceKeys")
    .withIndex("by_scope_version", (q) => q.eq("scopeKey", scopeKey(scope)).eq("version", version))
    .unique();
}

/** A space that has a space key, or `e2ee_not_set_up`. */
export async function requireSpace(ctx: Ctx, scope: Scope): Promise<Doc<"e2eeSpaces">> {
  const space = await spaceE2ee(ctx, scope);
  if (!space || space.currentKeyVersion < 1) failE2ee("e2ee_not_set_up");
  return space;
}

/** Grants of one person in a scope (every version and epoch). */
export async function grantsOf(ctx: Ctx, scope: Scope, profileId: Id<"profiles">): Promise<Doc<"e2eeSpaceGrants">[]> {
  return await ctx.db
    .query("e2eeSpaceGrants")
    .withIndex("by_scope_profile", (q) => q.eq("scopeKey", scopeKey(scope)).eq("profileId", profileId))
    .take(1000);
}

/** The people who belong to a scope: its owner (Personal) or its members (a workspace). */
export async function scopeMembers(ctx: Ctx, scope: Scope): Promise<{ profileId: Id<"profiles">; manager: boolean }[]> {
  if (scope.kind === "personal") return [{ profileId: scope.profileId, manager: true }];
  const members = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", scope.workspaceId))
    .take(5000);
  return members.map((m) => ({ profileId: m.profileId, manager: m.role === "owner" || m.role === "admin" }));
}

export async function isScopeMember(ctx: Ctx, scope: Scope, profileId: Id<"profiles">): Promise<boolean> {
  if (scope.kind === "personal") return scope.profileId === profileId;
  const m = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace_profile", (q) => q.eq("workspaceId", scope.workspaceId).eq("profileId", profileId))
    .unique();
  return m !== null;
}

/** A client-sent profile id, or `not_found`. */
export function profileIdOf(ctx: Ctx, id: string): Id<"profiles"> {
  const profileId = ctx.db.normalizeId("profiles", id);
  if (!profileId) fail("not_found", "Person not found.");
  return profileId;
}

export interface GrantRowInput {
  profileId: string;
  version: number;
  epoch: number;
  wrapped: ArrayBuffer;
  statement: { kind: "space-grant"; body: string; sig: string };
}

/**
 * Stores space key grants after checking each one: the grantee belongs to the scope and has an account at
 * that epoch, the version exists, the statement names this scope, version, grantee key and granter.
 * A grant already stored for the same (person, version, epoch) is replaced. Clears the grantees' "joined"
 * and "reset" pending rows once they hold the current version. Returns the grantees.
 */
export async function storeGrants(ctx: MutationCtx, scope: Scope, granter: Id<"profiles">, grants: GrantRowInput[]): Promise<Set<Id<"profiles">>> {
  if (grants.length > E2EE_LIMITS.batch) fail("invalid_argument", "Too many grants in one call.");
  const scopeId = await e2eeScopeId(ctx, scope);
  const key = scopeKey(scope);
  const space = await requireSpace(ctx, scope);
  const now = Date.now();
  const granted = new Set<Id<"profiles">>();
  for (const g of grants) {
    const profileId = profileIdOf(ctx, g.profileId);
    if (!(await isScopeMember(ctx, scope, profileId))) fail("forbidden", "Keys can only be shared with people in this space.");
    if (!(await spaceKeyVersion(ctx, scope, g.version))) fail("invalid_argument", "That key version doesn't exist.");
    const account = await ctx.db
      .query("e2eeAccounts")
      .withIndex("by_profile", (q) => q.eq("profileId", profileId).eq("epoch", g.epoch))
      .unique();
    if (!account || account.status !== "active") fail("conflict", "That person's encryption keys changed. Try again.");
    checkBytes(g.wrapped, "A grant", 49 + 16, E2EE_LIMITS.keyWrapBytes);
    expectStatement(g.statement, { scope: scopeId, version: g.version, profileId: g.profileId, granteeX25519Pub: b64u(account.x25519Pub), grantedBy: granter });
    const existing = (await grantsOf(ctx, scope, profileId)).filter((r) => r.version === g.version && r.epoch === g.epoch);
    for (const r of existing) await ctx.db.delete(r._id);
    await insertScoped(ctx, "e2eeSpaceGrants", scope, {
      scopeKey: key,
      version: g.version,
      profileId,
      epoch: g.epoch,
      wrapped: g.wrapped,
      statement: g.statement,
      grantedBy: granter,
      createdAt: now,
    });
    granted.add(profileId);
  }
  for (const profileId of granted) {
    const account = await activeAccount(ctx, profileId);
    const holdsCurrent = account && (await grantsOf(ctx, scope, profileId)).some((r) => r.version === space.currentKeyVersion && r.epoch === account.epoch);
    if (!holdsCurrent) continue;
    const pending = await ctx.db
      .query("e2eePendingGrants")
      .withIndex("by_profile", (q) => q.eq("profileId", profileId))
      .take(500);
    for (const p of pending) if (p.scopeKey === key && (p.reason === "joined" || p.reason === "reset")) await ctx.db.delete(p._id);
  }
  return granted;
}

/** Adds a pending grant unless the same one is already waiting. */
export async function addPending(
  ctx: MutationCtx,
  scope: Scope,
  profileId: Id<"profiles">,
  reason: Doc<"e2eePendingGrants">["reason"],
  documentId?: Id<"documents">,
): Promise<void> {
  const key = scopeKey(scope);
  const rows = await ctx.db
    .query("e2eePendingGrants")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId))
    .take(500);
  if (rows.some((r) => r.scopeKey === key && r.reason === reason && r.documentId === documentId)) return;
  await insertScoped(ctx, "e2eePendingGrants", scope, { scopeKey: key, profileId, reason, ...(documentId ? { documentId } : {}), createdAt: Date.now() });
}

/** Bumps the space row's seq so replicas pull the change (§5.3 pull). */
export async function touchSpace(ctx: MutationCtx, space: Doc<"e2eeSpaces">, scope: Scope, by: Id<"profiles">, patch: Partial<Doc<"e2eeSpaces">> = {}): Promise<void> {
  await ctx.db.patch(space._id, { ...patch, changedBy: by, changedAt: Date.now(), seq: await nextSeq(ctx, scope) });
}

// ---------------------------------------------------------------- migrations

/**
 * Starts a background job (§5.3 e2ee.migrate, §6.9) for a whole space: one `e2eeMigrations` row any eligible
 * device can claim. WP3's migrate.ts claims, leases and advances it. `total` is the scope's note count as
 * the scope row keeps it (the job recounts as it goes).
 * Extension point: WP3 may replace the body with its `migrate.start` logic, keeping this signature.
 */
export async function startSpaceMigration(
  ctx: MutationCtx,
  scope: Scope,
  by: Id<"profiles">,
  direction: Doc<"e2eeMigrations">["direction"],
  targetLevel: Doc<"e2eeMigrations">["targetLevel"],
): Promise<Id<"e2eeMigrations">> {
  const total = scope.kind === "personal" ? ((await ctx.db.get(scope.profileId))?.personalDocumentCount ?? 0) : ((await ctx.db.get(scope.workspaceId))?.documentCount ?? 0);
  return await insertScoped(ctx, "e2eeMigrations", scope, {
    scopeKey: scopeKey(scope),
    direction,
    targetLevel,
    scopeOf: "space",
    total,
    done: 0,
    failed: 0,
    phase: "documents",
    startedBy: by,
    startedAt: Date.now(),
  });
}
