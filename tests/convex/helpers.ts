import { convexTest } from "convex-test";
import schema from "../../convex/schema";
import authSchema from "../../convex/betterAuth/schema";
import { authModules, modules } from "./setup";
import { api, components } from "../../convex/_generated/api";
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

/** Signs up a person (bootstrap → personal workspace with seed content). */
export async function person(t: T, email: string) {
  const { as, userId, sessionId } = await signedIn(t, email);
  await as.mutation(api.users.bootstrap, { timeZone: "UTC", locale: "en" });
  const me = await as.query(api.users.me, {});
  if (me.state !== "ready") throw new Error(`not ready: ${me.state}`);
  return { as, profileId: me.profile.id, workspaceId: me.profile.defaultWorkspaceId!, userId, sessionId };
}

export function para(id: string, text: string, rank = "V", parentId: string | null = null): WireBlock {
  return { id, type: "paragraph", parentId, rank, schemaVersion: SCHEMA_VERSION, text: text ? [{ type: "text", text }] : [], props: {} };
}

export { ulid };
