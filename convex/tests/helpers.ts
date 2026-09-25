import { convexTest } from "convex-test";
import schema from "../schema";
import { modules } from "../test.setup";
import { api } from "../_generated/api";
import { SCHEMA_VERSION, ulid, type WireBlock } from "@folevi/editor-schema";

process.env.FOLEVI_HASH_SALT = "test-salt";
process.env.FOLEVI_SERVER_SECRET = "a".repeat(64);
process.env.FOLEVI_ENV = "test";

export function setup() {
  return convexTest(schema, modules);
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
    "https://folevi.com/mfa": true,
    ...extra,
  };
}

/** Signs up a person (bootstrap → personal workspace with seed content). */
export async function person(t: T, email: string) {
  const as = t.withIdentity(identity(email));
  await as.mutation(api.users.bootstrap, { timeZone: "UTC", locale: "en" });
  const me = await as.query(api.users.me, {});
  if (me.state !== "ready") throw new Error(`not ready: ${me.state}`);
  return { as, profileId: me.profile.id, workspaceId: me.profile.defaultWorkspaceId! };
}

export function para(id: string, text: string, rank = "V", parentId: string | null = null): WireBlock {
  return { id, type: "paragraph", parentId, rank, schemaVersion: SCHEMA_VERSION, text: text ? [{ type: "text", text }] : [], props: {} };
}

export { ulid };
