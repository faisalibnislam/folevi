import { convexTest } from "convex-test";
import schema from "../../convex/schema";
import authSchema from "../../convex/betterAuth/schema";
import { authModules, modules } from "./setup";
import { vi } from "vitest";
import { api, components, internal } from "../../convex/_generated/api";
import { SCHEMA_VERSION, ulid, type WireBlock } from "@folevi/editor-schema";

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
