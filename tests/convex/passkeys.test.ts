// Passkeys (Better Auth's passkey plugin, convex/auth.ts): adding one needs a fresh session and the app's
// relying party; listing, renaming and removing need the owner's session; signing in with one makes a
// session except for platform admins (who keep the authenticator code) and, for people with two-step
// verification on, a passkey that didn't verify the person.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, test } from "vitest";
import { components } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { deleteAuthUser } from "../../convex/lib/authStore";
import { authUser, person, setup, type T } from "./helpers";

process.env.BETTER_AUTH_SECRET ??= "test-secret-".repeat(4);

const ORIGIN = "http://app.localhost:3000";
const RP_ID = "app.localhost";

const b64url = (b: Uint8Array | Buffer) => Buffer.from(b).toString("base64url");

/** A session (with its raw token, for `Authorization: Bearer`) made `ageMs` ago. */
async function sessionToken(t: T, userId: string, ageMs = 0): Promise<string> {
  const token = `tok${Math.random().toString(36).slice(2)}${Date.now()}`;
  await t.run(async (ctx) => {
    const at = Date.now() - ageMs;
    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: { model: "session", data: { userId, token, expiresAt: Date.now() + 86_400_000, createdAt: at, updatedAt: at } },
    });
  });
  return token;
}

async function call(t: T, path: string, init: { method?: string; token?: string; body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.cookie) headers.cookie = init.cookie;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const res = await t.fetch(`/api/auth${path}`, { method: init.method ?? (init.body === undefined ? "GET" : "POST"), headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Record<string, unknown> & { code?: string }, setCookie: res.headers.get("set-cookie") ?? "" };
}

/** A software authenticator: an ES256 key whose public half is stored the way Better Auth stores passkeys. */
function authenticator() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  // COSE_Key {1: 2 (EC2), 3: -7 (ES256), -1: 1 (P-256), -2: x, -3: y}
  const cose = Buffer.concat([Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]), x, Buffer.from([0x22, 0x58, 0x20]), y]);
  const credentialId = b64url(Buffer.from(`cred-${Math.random()}`));
  return {
    credentialId,
    publicKey: cose.toString("base64"),
    assert(challenge: string, userVerified: boolean, counter = 1) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: ORIGIN, crossOrigin: false }));
      const flags = 0x01 | (userVerified ? 0x04 : 0);
      const authData = Buffer.concat([createHash("sha256").update(RP_ID).digest(), Buffer.from([flags]), Buffer.from([0, 0, 0, counter])]);
      const signature = sign("sha256", Buffer.concat([authData, createHash("sha256").update(clientDataJSON).digest()]), privateKey);
      return {
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        response: { clientDataJSON: b64url(clientDataJSON), authenticatorData: b64url(authData), signature: b64url(signature) },
        clientExtensionResults: {},
      };
    },
  };
}

async function storePasskey(t: T, userId: string, key: ReturnType<typeof authenticator>, name = "Test key") {
  return await t.run(async (ctx) => {
    const row = (await ctx.runMutation(components.betterAuth.adapter.create, {
      input: { model: "passkey", data: { name, userId, credentialID: key.credentialId, publicKey: key.publicKey, counter: 0, deviceType: "multiDevice", backedUp: true, transports: "internal", createdAt: Date.now() } },
    })) as { _id: string };
    return row._id;
  });
}

const challengeCookie = (setCookie: string) => /folevi\.better-auth-passkey=[^;]+/.exec(setCookie)?.[0] ?? "";

/** Runs a passkey sign-in ceremony with `key`; returns the verify response. */
async function signInWith(t: T, key: ReturnType<typeof authenticator>, userVerified = true) {
  const options = await call(t, "/passkey/generate-authenticate-options");
  expect(options.status).toBe(200);
  return await call(t, "/passkey/verify-authentication", { body: { response: key.assert(options.body.challenge as string, userVerified) }, cookie: challengeCookie(options.setCookie) });
}

async function sessionsOf(t: T, userId: string) {
  return await t.run(async (ctx) => {
    const res = (await ctx.runQuery(components.betterAuth.adapter.findMany, { model: "session", where: [{ field: "userId", value: userId }], paginationOpts: { numItems: 100, cursor: null } })) as { page: unknown[] };
    return res.page.length;
  });
}

async function setTwoFactor(t: T, userId: string, on: boolean) {
  await t.run(async (ctx) => {
    await ctx.runMutation(components.betterAuth.adapter.updateOne, { input: { model: "user", where: [{ field: "_id", value: userId }], update: { twoFactorEnabled: on } } });
  });
}

describe("adding a passkey", () => {
  test("registration options name Folevi's relying party and need a fresh session", async () => {
    const t = setup();
    const userId = await authUser(t, "passkey-add@example.com");
    const ok = await call(t, "/passkey/generate-register-options", { token: await sessionToken(t, userId) });
    expect(ok.status).toBe(200);
    expect(ok.body.rp).toEqual({ name: "Folevi", id: RP_ID });
    expect(typeof ok.body.challenge).toBe("string");
    expect((ok.body.authenticatorSelection as { residentKey: string }).residentKey).toBe("required");
    expect(challengeCookie(ok.setCookie)).not.toBe("");

    // Signed in 20 minutes ago: sign in again first.
    const stale = await call(t, "/passkey/generate-register-options", { token: await sessionToken(t, userId, 20 * 60_000) });
    expect(stale.status).toBe(403);
    expect(stale.body.code).toBe("SESSION_NOT_FRESH");

    expect((await call(t, "/passkey/generate-register-options")).status).toBe(401);
  });

  test("only the owner lists, renames and removes their passkeys", async () => {
    const t = setup();
    const owner = await authUser(t, "passkey-owner@example.com");
    const other = await authUser(t, "passkey-other@example.com");
    const ownerToken = await sessionToken(t, owner);
    const otherToken = await sessionToken(t, other);
    const id = await storePasskey(t, owner, authenticator(), "MacBook");

    expect((await call(t, "/passkey/list-user-passkeys")).status).toBe(401);
    const mine = await call(t, "/passkey/list-user-passkeys", { token: ownerToken });
    expect((mine.body as unknown as { name: string }[]).map((p) => p.name)).toEqual(["MacBook"]);
    expect((await call(t, "/passkey/list-user-passkeys", { token: otherToken })).body).toEqual([]);

    expect((await call(t, "/passkey/update-passkey", { token: otherToken, body: { id, name: "Mine now" } })).status).toBe(401);
    expect((await call(t, "/passkey/delete-passkey", { token: otherToken, body: { id } })).status).toBe(401);
    expect((await call(t, "/passkey/update-passkey", { token: ownerToken, body: { id, name: "Work laptop" } })).status).toBe(200);
    const renamed = await call(t, "/passkey/list-user-passkeys", { token: ownerToken });
    expect((renamed.body as unknown as { name: string }[])[0]!.name).toBe("Work laptop");
    expect((await call(t, "/passkey/delete-passkey", { token: ownerToken, body: { id } })).status).toBe(200);
    expect((await call(t, "/passkey/list-user-passkeys", { token: ownerToken })).body).toEqual([]);
  });

  test("deleting the account removes its passkeys", async () => {
    const t = setup();
    const userId = await authUser(t, "passkey-gone@example.com");
    await storePasskey(t, userId, authenticator());
    await t.run(async (ctx) => await deleteAuthUser(ctx, userId));
    const left = await t.run(async (ctx) => await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "passkey", where: [{ field: "userId", value: userId }] }));
    expect(left).toBeNull();
  });
});

describe("signing in with a passkey", () => {
  test("a valid passkey signs the person in; a forged signature or unknown passkey doesn't", async () => {
    const t = setup();
    const userId = await authUser(t, "passkey-in@example.com");
    await setTwoFactor(t, userId, false);
    const key = authenticator();
    await storePasskey(t, userId, key);

    const res = await signInWith(t, key, false);
    expect(res.status).toBe(200);
    expect((res.body.user as { id: string }).id).toBe(userId);
    expect(res.setCookie).toContain("folevi.session_token=");

    // Same challenge replayed: the challenge is single-use.
    const options = await call(t, "/passkey/generate-authenticate-options");
    const cookie = challengeCookie(options.setCookie);
    const assertion = key.assert(options.body.challenge as string, true, 2);
    expect((await call(t, "/passkey/verify-authentication", { body: { response: assertion }, cookie })).status).toBe(200);
    expect((await call(t, "/passkey/verify-authentication", { body: { response: assertion }, cookie })).status).toBe(400);

    const stranger = authenticator();
    expect((await signInWith(t, stranger)).status).toBe(401);
    const forged = { ...authenticator(), credentialId: key.credentialId };
    expect((await signInWith(t, forged as never)).status).toBeGreaterThanOrEqual(400);
  });

  test("with two-step verification on, the passkey must have verified the person", async () => {
    const t = setup();
    const userId = await authUser(t, "passkey-2fa@example.com");
    const key = authenticator();
    await storePasskey(t, userId, key);
    const before = await sessionsOf(t, userId);

    const unverified = await signInWith(t, key, false);
    expect(unverified.status).toBe(403);
    expect(unverified.body.code).toBe("PASSKEY_NOT_VERIFIED");
    expect(await sessionsOf(t, userId)).toBe(before);

    expect((await signInWith(t, key, true)).status).toBe(200);
  });

  test("platform admins keep signing in with a password and an authenticator code", async () => {
    const t = setup();
    const admin = await person(t, "passkey-admin@example.com");
    await t.run(async (ctx) => await ctx.db.patch(admin.profileId as Id<"profiles">, { platformRole: "support_admin" }));
    const key = authenticator();
    await storePasskey(t, admin.userId, key);
    const before = await sessionsOf(t, admin.userId);

    const res = await signInWith(t, key, true);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PASSKEY_ADMIN_NEEDS_CODE");
    expect(await sessionsOf(t, admin.userId)).toBe(before);
  });
});
