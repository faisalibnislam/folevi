import { convexTest } from "convex-test";
import schema from "../../convex/schema";
import authSchema from "../../convex/betterAuth/schema";
import { authModules, modules } from "./setup";
import { vi } from "vitest";
import { api, components, internal } from "../../convex/_generated/api";
import { SCHEMA_VERSION, ulid, type WireBlock } from "@folevi/editor-schema";
import type * as E2ee from "@folevi/local-store/e2ee";

process.env.FOLEVI_HASH_SALT = "test-salt";
process.env.FOLEVI_SERVER_SECRET = "a".repeat(64);
process.env.FOLEVI_ENV = "test";

export function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("betterAuth", authSchema, authModules);
  return t;
}

export type T = ReturnType<typeof setup>;

export function identity(email: string, extra: Record<string, unknown> = {}) {
  return {
    subject: `test|${email}`,
    issuer: "https://test.folevi.local",
    tokenIdentifier: `https://test.folevi.local|test|${email}`,
    email,
    name: email.split("@")[0],
    emailVerified: true,
    "https://folevi.com/email_verified": true,
    "https://folevi.com/mfa": true,
    ...extra,
  };
}

/** Creates (or reuses) a Better Auth user for `email` in the auth component and returns its id. */
export async function authUser(t: T, email: string): Promise<string> {
  return await t.run(async (ctx) => {
    const existing = (await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "email", value: email }] })) as { _id: string } | null;
    if (existing) return existing._id;
    const now = Date.now();
    const user = (await ctx.runMutation(components.betterAuth.adapter.create, {
      input: { model: "user", data: { name: email.split("@")[0]!, email, emailVerified: true, twoFactorEnabled: true, createdAt: now, updatedAt: now } },
    })) as { _id: string };
    return user._id;
  });
}

/** A live Better Auth session for the user (what signing in creates). */
export async function authSession(t: T, userId: string, userAgent = "Mozilla/5.0 (Macintosh) Chrome/140"): Promise<string> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const session = (await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "session",
        data: { userId, token: `tok-${Math.random().toString(36).slice(2)}`, expiresAt: now + 14 * 86_400_000, createdAt: now, updatedAt: now, userAgent },
      },
    })) as { _id: string };
    return session._id;
  });
}

/** A signed-in client for `email` backed by a real auth user + session (sessions are enforced). */
export async function signedIn(t: T, email: string, extra: Record<string, unknown> = {}) {
  const userId = await authUser(t, email);
  const sessionId = await authSession(t, userId);
  const base = identity(email, { subject: userId, tokenIdentifier: `https://test.folevi.local|${userId}`, sessionId, ...extra });
  return { as: t.withIdentity(base), userId, sessionId };
}

/** The signed-in person's own Personal, as clients name it. */
export const PERSONAL = { kind: "personal" } as const;

/** A team workspace scope, as clients name it. */
export function inWorkspace(workspaceId: string) {
  return { kind: "workspace" as const, workspaceId };
}

/** A scope as clients name it. */
export type ScopeArg = typeof PERSONAL | ReturnType<typeof inWorkspace>;

/** Signs up a person (bootstrap → their Personal with seed content; no workspace). */
export async function person(t: T, email: string) {
  const { as, userId, sessionId } = await signedIn(t, email);
  await as.mutation(api.users.bootstrap, { timeZone: "UTC", locale: "en" });
  const me = await as.query(api.users.me, {});
  if (me.state !== "ready") throw new Error(`not ready: ${me.state}`);
  // `scope` is where their own actions go by default: their Personal (tests re-point it at a workspace).
  return { as, profileId: me.profile.id, scope: PERSONAL as ScopeArg, userId, sessionId };
}

type Person = Awaited<ReturnType<typeof person>>;

/** Creates a team workspace owned by `owner`; returns its public id and scope. */
export async function teamWorkspace(owner: Person, name = "Team") {
  const { id } = await owner.as.mutation(api.workspaces.createTeamWorkspace, { name });
  return { workspaceId: id, scope: inWorkspace(id) };
}

/** Invites `who` into a workspace with `role` and has them accept (the workspace_invites flag must allow it). */
export async function join(t: T, owner: Person, who: Person, email: string, workspaceId: string, role: "admin" | "editor" | "commenter" | "viewer") {
  await owner.as.mutation(api.workspaces.invite, { workspaceId, email, role });
  const inviteId = await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("workspaceInvites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    return rows.find((r) => r.status === "pending")!.publicId;
  });
  await who.as.mutation(api.workspaces.acceptInvite, { inviteId });
}

/**
 * Runs the account-model check to the end (it's a background job: start, let it run, read the report).
 * Small pages force it through many runs, the way it works on a big database.
 */
export async function verifyAccountModel(t: T, opts: { pageSize?: number; pagesPerRun?: number } = {}) {
  const fake = vi.isFakeTimers();
  if (!fake) vi.useFakeTimers();
  try {
    const { reportId } = await t.mutation(internal.migrations.verifyAccountModel, opts);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const report = await t.query(internal.migrations.accountModelReport, { reportId });
    if (!report?.done) throw new Error("the account-model check didn't finish");
    return report;
  } finally {
    if (!fake) vi.useRealTimers();
  }
}

export function para(id: string, text: string, rank = "V", parentId: string | null = null): WireBlock {
  return { id, type: "paragraph", parentId, rank, schemaVersion: SCHEMA_VERSION, text: text ? [{ type: "text", text }] : [], props: {} };
}

export { ulid };

// ---------------------------------------------------------------- end-to-end encryption (docs/E2EE_DESIGN.md, WP2)

/** Turns a feature flag on. */
export async function enableFlag(t: T, key: string) {
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (row) await ctx.db.patch(row._id, { enabled: true });
    else await ctx.db.insert("featureFlags", { key, enabled: true, description: "test", updatedAt: Date.now() });
  });
}

/** Turns the `e2ee` feature flag on (it gates setting encryption up until launch, §5.9). */
export async function enableE2eeFlag(t: T) {
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", "e2ee"))
      .unique();
    if (row) await ctx.db.patch(row._id, { enabled: true });
    else await ctx.db.insert("featureFlags", { key: "e2ee", enabled: true, description: "test", updatedAt: Date.now() });
  });
}

/** WP1's crypto core, loaded on first use so suites that don't use encryption never load it. */
export const e2eeLib = () => import("@folevi/local-store/e2ee");

/** Bytes for the wire (a standalone ArrayBuffer). */
export function wire(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.length);
  new Uint8Array(out).set(bytes);
  return out;
}

/** A device's own key pairs (extractable is irrelevant in tests; WebCrypto or noble, whichever WP1 picks). */
export async function e2eeDeviceKeys(deviceId = ulid()) {
  const e2ee = await e2eeLib();
  const x = await e2ee.generateX25519();
  const ed = await e2ee.generateEd25519();
  return { deviceId, x, ed };
}
export type E2eeDeviceKeys = Awaited<ReturnType<typeof e2eeDeviceKeys>>;

/** A device statement signed by the account key (§4.8). */
export async function deviceStatement(account: E2ee.AccountKeys, profileId: string, device: E2eeDeviceKeys, approvedBy: string, kind: "app" | "browser" | "session" = "browser") {
  const e2ee = await e2eeLib();
  return await e2ee.signStatement(account.ed25519.privateKey, "device", {
    profileId,
    deviceId: device.deviceId,
    kind,
    x25519Pub: e2ee.toBase64Url(device.x.publicKey),
    ed25519Pub: e2ee.toBase64Url(device.ed.publicKey),
    label: "Test browser",
    approvedBy,
    approvedAt: Date.now(),
  });
}

/** The registration a device sends (keys.createAccount, devices.register). */
export function deviceRegistration(device: E2eeDeviceKeys, kind: "app" | "browser" | "session" = "browser", statement?: { kind: "device"; body: string; sig: string }) {
  return { deviceId: device.deviceId, kind, label: "Test browser", platform: "test", x25519Pub: wire(device.x.publicKey), ed25519Pub: wire(device.ed.publicKey), ...(statement ? { statement } : {}) };
}

/** A fresh account epoch: AMK, derived keys and the self-signed account statement. */
export async function e2eeEpoch(profileId: string, epoch: number) {
  const e2ee = await e2eeLib();
  const amk = e2ee.randomBytes(32);
  const keys = await e2ee.deriveAccountKeys(amk.slice());
  const statement = await e2ee.signStatement(keys.ed25519.privateKey, "account-key", {
    profileId,
    epoch,
    x25519Pub: e2ee.toBase64Url(keys.x25519.publicKey),
    ed25519Pub: e2ee.toBase64Url(keys.ed25519.publicKey),
    createdAt: Date.now(),
  });
  const registration = { epoch, x25519Pub: wire(keys.x25519.publicKey), ed25519Pub: wire(keys.ed25519.publicKey), amkCheck: wire(keys.check), statement };
  return { amk, keys, statement, registration };
}

/**
 * A person with end-to-end encryption set up (keys.createAccount with WP1's real keys): one trusted browser
 * holding a wrap of the AMK. Turns the e2ee flag on.
 */
export async function e2eePerson(t: T, email: string) {
  const e2ee = await e2eeLib();
  const p = await person(t, email);
  await enableE2eeFlag(t);
  const { amk, keys, statement } = await e2eeEpoch(p.profileId, 1);
  const device = await e2eeDeviceKeys();
  const devStatement = await deviceStatement(keys, p.profileId, device, "setup");
  const deviceWrap = await e2ee.sealTo(device.x.publicKey, e2ee.ctx.amkDevice(p.profileId, device.deviceId), amk);
  await p.as.mutation(api.e2ee.keys.createAccount, {
    x25519Pub: wire(keys.x25519.publicKey),
    ed25519Pub: wire(keys.ed25519.publicKey),
    amkCheck: wire(keys.check),
    statement,
    device: deviceRegistration(device, "browser", devStatement),
    deviceWrap: wire(deviceWrap),
  });
  return { ...p, amk, account: keys, epoch: 1, device };
}
export type E2eePerson = Awaited<ReturnType<typeof e2eePerson>>;

/** Adds a recovery key and a passphrase wrap (two kinds, so spaces can be encrypted, §4.7.5). */
export async function e2eeRecoveryMethods(p: { as: E2eePerson["as"]; profileId: string; amk: Uint8Array; epoch: number }) {
  const e2ee = await e2eeLib();
  const recovery = e2ee.newRecoveryKey();
  const recoveryWrapId = ulid();
  const recoveryWrap = await e2ee.sealRecord(await e2ee.recoveryWrapKey(recovery.bytes.slice()), p.epoch, e2ee.ctx.amkRecovery(p.profileId, recoveryWrapId), p.amk);
  await p.as.mutation(api.e2ee.keys.addWrap, { kind: "recoveryKey", wrapId: recoveryWrapId, wrapped: wire(recoveryWrap) });
  // The passphrase key is stretched on the device; the server only stores the parameters, so tests skip the KDF.
  const passKey = e2ee.randomBytes(32);
  const passWrapId = ulid();
  const passWrap = await e2ee.sealRecord(await e2ee.importAead(passKey.slice()), p.epoch, e2ee.ctx.amkPassphrase(p.profileId, passWrapId), p.amk);
  await p.as.mutation(api.e2ee.keys.addWrap, {
    kind: "passphrase",
    wrapId: passWrapId,
    wrapped: wire(passWrap),
    kdf: { name: "argon2id", m: 65536, t: 3, p: 1, salt: wire(e2ee.randomBytes(16)) },
  });
  return { recovery, recoveryWrapId, passWrapId };
}

/** The scope string inside AAD contexts and statements (§4.5). */
export function e2eeScopeString(scope: ScopeArg, profileId: string): string {
  return scope.kind === "personal" ? `personal:${profileId}` : `workspace:${scope.workspaceId}`;
}

/** A space key version sealed to a member, signed by the granter (§4.9). */
export async function spaceGrant(scopeId: string, version: number, sk: Uint8Array, granter: { profileId: string; account: E2ee.AccountKeys }, grantee: { profileId: string; x25519Pub: Uint8Array; epoch: number }) {
  const e2ee = await e2eeLib();
  const wrapped = await e2ee.sealTo(grantee.x25519Pub, e2ee.ctx.spaceGrant(scopeId, version, grantee.profileId), sk);
  const statement = await e2ee.signStatement(granter.account.ed25519.privateKey, "space-grant", {
    scope: scopeId,
    version,
    profileId: grantee.profileId,
    granteeX25519Pub: e2ee.toBase64Url(grantee.x25519Pub),
    grantedBy: granter.profileId,
    at: Date.now(),
  });
  return { profileId: grantee.profileId, version, epoch: grantee.epoch, wrapped: wire(wrapped), statement };
}

/** A new space key version's public parts. */
export async function spaceKeyInput(version: number) {
  const e2ee = await e2eeLib();
  const sk = e2ee.randomBytes(32);
  const keys = await e2ee.deriveSpaceKeys(sk.slice());
  return { sk, key: { version, inboxPub: wire(keys.inbox.publicKey), skCheck: wire(keys.check) } };
}

/** Sets a space up (spaces.setUp) with a key granted to `owner` and to each of `members` that has keys. */
export async function e2eeSpace(owner: E2eePerson, scope: ScopeArg, members: E2eePerson[] = []) {
  const scopeId = e2eeScopeString(scope, owner.profileId);
  const { sk, key } = await spaceKeyInput(1);
  const grants = [];
  for (const m of [owner, ...members]) grants.push(await spaceGrant(scopeId, 1, sk, owner, { profileId: m.profileId, x25519Pub: m.account.x25519.publicKey, epoch: m.epoch }));
  const result = await owner.as.mutation(api.e2ee.spaces.setUp, { scope, key, grants });
  return { sk, scopeId, ...result };
}
