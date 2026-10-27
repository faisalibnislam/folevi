// A password reset or change ends every way in that isn't a session (docs/SECURITY_PLAN.md P0.5): personal API
// tokens, the apps' device tokens and connected apps. Someone else's stay.
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, components, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { person, setup, type T } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

async function grantFor(t: T, p: Person, clientId: string) {
  return await t.run(async (ctx) =>
    ctx.db.insert("mcpGrants", { profileId: p.profileId as Id<"profiles">, clientId, clientName: "Notes Bot", redirectHost: "example.com", personal: true, workspaceIds: [], includeShared: false, createOnly: false, scopes: ["notes:read"], createdAt: Date.now(), updatedAt: Date.now() }),
  );
}

const counts = (t: T, p: Person) =>
  t.run(async (ctx) => ({
    tokens: (await ctx.db
      .query("apiTokens")
      .withIndex("by_profile", (q) => q.eq("profileId", p.profileId as Id<"profiles">))
      .collect()).length,
    apps: (await ctx.db
      .query("mcpGrants")
      .withIndex("by_profile", (q) => q.eq("profileId", p.profileId as Id<"profiles">))
      .collect()).length,
  }));

const authSubjectOf = (t: T, p: Person) => t.run(async (ctx) => (await ctx.db.get(p.profileId as Id<"profiles">))!.authSubject);

describe("ending every way in", { timeout: 30_000 }, () => {
  test("API tokens and connected apps go; another person's stay", async () => {
    const t = setup();
    const a = await person(t, "end-a@example.com");
    const b = await person(t, "end-b@example.com");
    await a.as.mutation(api.apiTokens.create, { name: "Script", scopes: ["notes:read"], personal: true, workspaceIds: [], expiresInDays: null });
    await a.as.mutation(api.apiTokens.create, { name: "Other", scopes: ["notes:read"], personal: true, workspaceIds: [], expiresInDays: 30 });
    await grantFor(t, a, "client-a");
    await b.as.mutation(api.apiTokens.create, { name: "B's", scopes: ["notes:read"], personal: true, workspaceIds: [], expiresInDays: null });
    await grantFor(t, b, "client-b");
    expect(await counts(t, a)).toEqual({ tokens: 2, apps: 1 });

    expect(await t.mutation(internal.apiTokens.endAllAccess, { authUserId: await authSubjectOf(t, a), reason: "password_reset" })).toEqual({ tokens: 2, apps: 1 });
    expect(await counts(t, a)).toEqual({ tokens: 0, apps: 0 });
    expect(await counts(t, b)).toEqual({ tokens: 1, apps: 1 });
    // Nobody with that id: nothing happens.
    expect(await t.mutation(internal.apiTokens.endAllAccess, { authUserId: "nobody", reason: "password_changed" })).toEqual({ tokens: 0, apps: 0 });
  });

  test("a real password reset ends a token made earlier (say, by someone who had the session for a while)", async () => {
    process.env.BETTER_AUTH_SECRET ??= "test-secret-".repeat(4);
    // The breached-password check asks a range API: answer "not breached".
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("https://api.pwnedpasswords.com/")) return new Response("0018A45C4D1DEF81644B54AB7F969B88D65:0", { status: 200 });
      return real(input, init);
    });
    const t = setup();
    const a = await person(t, "end-reset@example.com");
    await a.as.mutation(api.apiTokens.create, { name: "Left behind", scopes: ["notes:read"], personal: true, workspaceIds: [], expiresInDays: null });
    await grantFor(t, a, "client-left");
    const userId = await authSubjectOf(t, a);
    const token = `reset${Date.now()}`;
    await t.run(async (ctx) => {
      await ctx.runMutation(components.betterAuth.adapter.create, { input: { model: "verification", data: { identifier: `reset-password:${token}`, value: userId, expiresAt: Date.now() + 3_600_000, createdAt: Date.now(), updatedAt: Date.now() } } });
    });
    const res = await t.fetch("/api/auth/reset-password", { method: "POST", headers: { "content-type": "application/json", origin: "http://app.localhost:3000" }, body: JSON.stringify({ newPassword: "a brand new long password 42", token }) });
    expect(res.status).toBe(200);
    expect(await counts(t, a)).toEqual({ tokens: 0, apps: 0 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
