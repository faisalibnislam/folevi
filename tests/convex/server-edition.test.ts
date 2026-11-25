// Folevi Server (docs/self-hosting/CONTRACT.md §7, §8): the server edition's settings, owner claim, roles,
// invites, sign-up rules, quotas, billing off, email, push relay and Foli AI provider choice. And, with
// FOLEVI_EDITION unset, proof that Folevi Cloud behaves as before.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, components, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { sha256Hex } from "../../convex/lib/crypto";
import { assertStorageFor, personalEntitlements } from "../../convex/lib/entitlements";
import { personalEntitlementsOf, workspaceEntitlementsOf } from "../../convex/lib/plans";
import { authProvider, pluginJwksOptions, staticJwks } from "../../convex/lib/jwks";
import { aiAvailable, provider, serverProviderFor, useServerAiSettings } from "../../convex/lib/ai/provider";
import { chatBody, fitVector, messagesOf, openAiProvider } from "../../convex/lib/ai/openai";
import { relayPushBody, sendThroughRelay } from "../../convex/lib/pushRelay";
import { applySettingsPatch, defaultServerSettings, publicSettingsView, SettingsError } from "../../convex/lib/serverSettings";
import { emailManifest } from "@folevi/email";
import { person, setup, type T } from "./helpers";

const ENV = ["FOLEVI_EDITION", "FOLEVI_SETUP_TOKEN_HASH", "FOLEVI_CONNECT_TOKEN", "FOLEVI_CONNECT_URL", "FOLEVI_JWKS", "CONVEX_SITE_URL", "GEMINI_API_KEY", "RESEND_API_KEY"] as const;
const SETUP_TOKEN = "setup-code-for-tests-0123456789";
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  useServerAiSettings(null);
});

async function asServer() {
  process.env.FOLEVI_EDITION = "server";
  process.env.FOLEVI_SETUP_TOKEN_HASH = await sha256Hex(SETUP_TOKEN);
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const data = (e as { data?: { code?: string } }).data;
    return data?.code ?? String((e as Error).message);
  }
  return "ok";
}

/** A server with an owner (the first person) and returns them. */
async function ownedServer(t: T) {
  await asServer();
  const owner = await person(t, "owner@example.com");
  await owner.as.mutation(api.server.claimOwner, { setupToken: SETUP_TOKEN });
  return owner;
}

const profileOf = (t: T, id: string) => t.run(async (ctx) => await ctx.db.get(id as Id<"profiles">));

// ---------------------------------------------------------------------------------------------------
// Folevi Cloud: unchanged when FOLEVI_EDITION is unset
// ---------------------------------------------------------------------------------------------------

describe("Folevi Cloud (FOLEVI_EDITION unset)", () => {
  test("info describes the cloud; every server function answers not_found", async () => {
    const t = setup();
    const p = await person(t, "cloud@example.com");
    const info = await t.query(api.server.info, {});
    expect(info).toMatchObject({ kind: "folevi-cloud", needsSetup: false, apiVersion: 1 });
    expect(await codeOf(p.as.query(api.serverAdmin.getSettings, {}))).toBe("not_found");
    expect(await codeOf(p.as.mutation(api.server.claimOwner, { setupToken: SETUP_TOKEN }))).toBe("not_found");
    expect(await codeOf(p.as.mutation(api.serverInvites.accept, { token: "x" }))).toBe("not_found");
    expect(await t.query(api.serverInvites.preview, { token: "x" })).toBeNull();
    expect(await t.query(internal.server.emailTransport, {})).toBeNull();
    expect(await t.query(internal.server.aiSettings, {})).toBeNull();
    expect(await t.query(internal.server.signUpGate, { email: "anyone@example.com" })).toMatchObject({ allowed: true });
  });

  test("new accounts still get the Pro AI trial; plans and storage are the cloud's", async () => {
    const t = setup();
    const p = await person(t, "trial@example.com");
    const e = await t.run(async (ctx) => await personalEntitlements(ctx, p.profileId as Id<"profiles">));
    expect(e.trialing).toBe(true);
    expect(e.paid).toBe(false);
    expect(personalEntitlementsOf(null, Date.now())).toMatchObject({ planId: "personal_free", paid: false });
    expect(workspaceEntitlementsOf(null, {}, Date.now())).toMatchObject({ planId: "workspace_free", paid: false });
  });

  test("static JWKS is ignored and the provider is Gemini from the environment", () => {
    process.env.FOLEVI_JWKS = JSON.stringify({ keys: [{ kty: "RSA", n: "x", e: "AQAB", kid: "k" }] });
    process.env.CONVEX_SITE_URL = "https://cloud.example";
    expect(staticJwks()).toEqual({ kind: "none" });
    expect(authProvider().jwks).toBe("https://cloud.example/api/auth/convex/jwks");
    expect(pluginJwksOptions().jwks).toBeUndefined();
    expect(provider().id).toBe("gemini");
    expect(aiAvailable()).toBe(false);
    process.env.GEMINI_API_KEY = "k";
    expect(aiAvailable()).toBe(true);
  });

  test("email still goes through Resend", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "m1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const t = setup();
    const res = await t.action(internal.email.sendTemplate, { key: "security_new_device", to: "a@example.com", dataVariables: { ...emailManifest.security_new_device.fixture }, idempotencyKey: "c1" });
    expect(res.status).toBe("accepted");
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("https://api.resend.com/emails");
  });
});

// ---------------------------------------------------------------------------------------------------
// Folevi Server
// ---------------------------------------------------------------------------------------------------

describe("Folevi Server: setup and settings", () => {
  test("the first person claims the server with the setup code, once", async () => {
    const t = setup();
    await asServer();
    expect(await t.query(api.server.info, {})).toMatchObject({ kind: "folevi-server", needsSetup: true, features: { ai: false, email: false, push: false } });
    const first = await person(t, "first@example.com");
    expect(await codeOf(first.as.mutation(api.server.claimOwner, { setupToken: "wrong" }))).toBe("forbidden");
    expect(await first.as.mutation(api.server.claimOwner, { setupToken: SETUP_TOKEN })).toEqual({ ok: true });
    expect((await profileOf(t, first.profileId))?.platformRole).toBe("super_admin");
    expect(await t.query(api.server.info, {})).toMatchObject({ needsSetup: false });
    // Sign-up is invite-only once there's an owner (the first account was allowed in for setup).
    const second = await person(t, "second@example.com");
    expect(await codeOf(second.as.mutation(api.server.claimOwner, { setupToken: SETUP_TOKEN }))).toBe("forbidden");
    const audit = await t.run(async (ctx) => await ctx.db.query("adminAuditLogs").collect());
    expect(audit.map((a) => a.action)).toContain("server.claim_owner");
  });

  test("settings: secrets are write-only and every change is audited", async () => {
    const t = setup();
    const owner = await ownedServer(t);
    const view = await owner.as.mutation(api.serverAdmin.updateSettings, {
      patch: { name: "Smith family", email: { mode: "smtp", smtp: { host: "mail.example.com", port: 587, security: "starttls", username: "me", password: "hunter2-secret", from: "Folevi <folevi@example.com>" } } },
    });
    expect(view.email.smtp?.password).toEqual({ set: true });
    const read = await owner.as.query(api.serverAdmin.getSettings, {});
    expect(JSON.stringify(read)).not.toContain("hunter2-secret");
    expect(read).toMatchObject({ name: "Smith family", configured: { email: true } });
    expect(await t.query(api.server.info, {})).toMatchObject({ name: "Smith family", features: { email: true } });
    // Clearing a secret, and a bad value refused with nothing written.
    await owner.as.mutation(api.serverAdmin.updateSettings, { patch: { email: { smtp: { password: null } } } });
    expect((await owner.as.query(api.serverAdmin.getSettings, {})).email.smtp?.password).toEqual({ set: false });
    expect(await codeOf(owner.as.mutation(api.serverAdmin.updateSettings, { patch: { signUp: "domains" } }))).toBe("invalid_argument");
    const audit = await t.run(async (ctx) => await ctx.db.query("adminAuditLogs").collect());
    const update = audit.find((a) => a.action === "server.update_settings");
    expect((update?.after as { fields: string[] }).fields.sort()).toEqual(["email.mode", "email.smtp.from", "email.smtp.host", "email.smtp.password", "email.smtp.port", "email.smtp.security", "email.smtp.username", "name"]);
    expect(JSON.stringify(audit)).not.toContain("hunter2-secret");
  });

  test("members and guests can't reach the admin functions", async () => {
    const t = setup();
    await ownedServer(t);
    const member = await person(t, "member@example.com");
    expect(await codeOf(member.as.query(api.serverAdmin.getSettings, {}))).toBe("not_found");
    expect(await codeOf(member.as.query(api.serverAdmin.listPeople, {}))).toBe("not_found");
    expect(await codeOf(member.as.mutation(api.serverAdmin.invite, { role: "member" }))).toBe("not_found");
  });

  test("settings validation", () => {
    const s = defaultServerSettings();
    expect(() => applySettingsPatch(s, { signIn: { password: false, passkey: false } }, 1)).toThrow(SettingsError);
    expect(() => applySettingsPatch(s, { ai: { mode: "openai" } }, 1)).toThrow(SettingsError);
    const next = applySettingsPatch(s, { ai: { mode: "openai", openai: { baseUrl: "http://192.168.1.20:11434/v1/", model: "llama3.2", apiKey: "sk-x" } }, allowedDomains: ["@Example.COM"] }, 1);
    expect(next.ai.openai).toEqual({ baseUrl: "http://192.168.1.20:11434/v1", model: "llama3.2", apiKey: "sk-x" });
    expect(next.allowedDomains).toEqual(["example.com"]);
    expect(publicSettingsView(next).ai.openai?.apiKey).toEqual({ set: true });
  });
});

describe("Folevi Server: people, roles and invites", () => {
  test("invite, preview, sign-up gate and accept", async () => {
    const t = setup();
    const owner = await ownedServer(t);
    // Invite-only: a sign-up without an invite is refused.
    expect(await t.query(internal.server.signUpGate, { email: "new@example.com" })).toMatchObject({ allowed: false, code: "SIGNUP_INVITE_ONLY", emailOn: false });
    const inv = await owner.as.mutation(api.serverAdmin.invite, { email: "new@example.com", role: "admin" });
    expect(inv.url).toMatch(/\/join\//);
    expect(await t.query(api.serverInvites.preview, { token: inv.token })).toMatchObject({ role: "admin", email: "new@example.com", expired: false });
    expect(await t.query(internal.server.signUpGate, { email: "other@example.com", inviteToken: inv.token })).toMatchObject({ allowed: false, code: "INVITE_OTHER_EMAIL" });
    expect(await t.query(internal.server.signUpGate, { email: "new@example.com", inviteToken: inv.token })).toMatchObject({ allowed: true, emailOn: false });
    // The sign-up spends it; the new account gets the role when its profile is made.
    await t.mutation(internal.server.spendInviteAtSignUp, { inviteToken: inv.token, email: "new@example.com" });
    const joined = await person(t, "new@example.com");
    expect((await profileOf(t, joined.profileId))?.platformRole).toBe("ops_admin");
    expect(await t.query(api.serverInvites.preview, { token: inv.token })).toMatchObject({ expired: true });
    // A link invite (no address) for an existing account: it never lowers anyone (a member stays a member).
    const link = await owner.as.mutation(api.serverAdmin.invite, { role: "guest" });
    const existing = await person(t, "existing@example.com");
    expect(await existing.as.mutation(api.serverInvites.accept, { token: link.token })).toEqual({ ok: true, role: "member" });
    await owner.as.mutation(api.serverAdmin.setRole, { userId: existing.profileId, role: "guest" });
    expect(await codeOf(existing.as.mutation(api.serverInvites.accept, { token: link.token }))).toBe("expired");
    const people = await owner.as.query(api.serverAdmin.listPeople, {});
    expect(Object.fromEntries(people.map((p) => [p.email, p.role]))).toMatchObject({ "owner@example.com": "owner", "new@example.com": "admin", "existing@example.com": "guest" });
  });

  test("open and domain sign-up", async () => {
    const t = setup();
    const owner = await ownedServer(t);
    await owner.as.mutation(api.serverAdmin.updateSettings, { patch: { signUp: "domains", allowedDomains: ["smith.family"] } });
    expect(await t.query(internal.server.signUpGate, { email: "kid@smith.family" })).toMatchObject({ allowed: true });
    expect(await t.query(internal.server.signUpGate, { email: "kid@elsewhere.com" })).toMatchObject({ allowed: false, code: "SIGNUP_DOMAIN" });
    await owner.as.mutation(api.serverAdmin.updateSettings, { patch: { signUp: "open" } });
    expect(await t.query(internal.server.signUpGate, { email: "kid@elsewhere.com" })).toMatchObject({ allowed: true });
  });

  test("roles: only the owner makes admins; ownership transfers; suspension is honored", async () => {
    const t = setup();
    const owner = await ownedServer(t);
    const a = await person(t, "a@example.com");
    const b = await person(t, "b@example.com");
    await owner.as.mutation(api.serverAdmin.setRole, { userId: a.profileId, role: "admin" });
    expect(await codeOf(a.as.mutation(api.serverAdmin.setRole, { userId: b.profileId, role: "admin" }))).toBe("forbidden");
    expect(await codeOf(a.as.mutation(api.serverAdmin.suspend, { userId: owner.profileId }))).toBe("forbidden");
    await a.as.mutation(api.serverAdmin.suspend, { userId: b.profileId });
    expect(await codeOf(b.as.mutation(api.serverInvites.accept, { token: "x" }))).toBe("suspended");
    await a.as.mutation(api.serverAdmin.unsuspend, { userId: b.profileId });
    await owner.as.mutation(api.serverAdmin.transferOwnership, { userId: a.profileId });
    expect((await profileOf(t, a.profileId))?.platformRole).toBe("super_admin");
    expect((await profileOf(t, owner.profileId))?.platformRole).toBe("ops_admin");
    expect(await codeOf(owner.as.mutation(api.serverAdmin.transferOwnership, { userId: b.profileId }))).toBe("not_found");
  });

  test("password reset with email off returns a one-time link Better Auth accepts", async () => {
    const t = setup();
    const owner = await ownedServer(t);
    const m = await person(t, "forgot@example.com");
    const res = await owner.as.mutation(api.serverAdmin.resetPassword, { userId: m.profileId });
    expect(res.emailed).toBe(false);
    const token = new URL(res.link!).searchParams.get("token")!;
    const row = await t.run(async (ctx) => await ctx.runQuery(components.betterAuth.adapter.findOne, { model: "verification", where: [{ field: "identifier", value: `reset-password:${token}` }] }));
    expect(row).toMatchObject({ value: m.userId });
  });
});

describe("Folevi Server: billing off and quotas", () => {
  test("everyone has the top plan with no trial; billing refuses", async () => {
    const t = setup();
    const owner = await ownedServer(t);
    const e = await t.run(async (ctx) => await personalEntitlements(ctx, owner.profileId as Id<"profiles">));
    expect(e).toMatchObject({ paid: true, trialing: false, trialEndsAt: null, ai: true, devices: null });
    const sub = await t.run(async (ctx) => await ctx.db.query("subscriptions").collect().catch(() => []));
    expect(sub.filter((s) => (s as { trialEndsAt?: number }).trialEndsAt)).toHaveLength(0);
    expect(await codeOf(owner.as.action(api.billing.checkout, { plan: "pro", interval: "month" }))).toBe("not_found");
  });

  test("a person's quota stops uploads past it", async () => {
    const t = setup();
    const owner = await ownedServer(t);
    const m = await person(t, "quota@example.com");
    const scope = { kind: "personal" as const, profileId: m.profileId as Id<"profiles"> };
    expect(await t.run(async (ctx) => await assertStorageFor(ctx, scope, 10 * 1024 * 1024, scope.profileId))).toBeNull();
    await owner.as.mutation(api.serverAdmin.setQuota, { userId: m.profileId, quotaBytes: 1024 * 1024 });
    expect(await t.run(async (ctx) => await assertStorageFor(ctx, scope, 2 * 1024 * 1024, scope.profileId))).toMatch(/used your storage on this server/);
    // The server's default applies to people without their own quota.
    await owner.as.mutation(api.serverAdmin.setQuota, { userId: m.profileId, quotaBytes: null });
    await owner.as.mutation(api.serverAdmin.updateSettings, { patch: { defaultQuotaBytes: 1024 } });
    expect(await t.run(async (ctx) => await assertStorageFor(ctx, scope, 2048, scope.profileId))).not.toBeNull();
    expect((await owner.as.query(api.serverAdmin.listPeople, {})).find((p) => p.email === "quota@example.com")?.quotaBytes).toBe(1024);
  });
});

describe("Folevi Server: email", () => {
  test("with email off, mail is skipped, not failed", async () => {
    const t = setup();
    await asServer();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await t.action(internal.email.sendTemplate, { key: "auth_verify_email", to: "a@example.com", dataVariables: { actionUrl: "https://x.example/verify", expiresInHours: 24 }, idempotencyKey: "s1" });
    expect(res.status).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
    const [row] = await t.run(async (ctx) => await ctx.db.query("emailSendAttempts").collect());
    expect(row).toMatchObject({ status: "skipped", errorCode: "email_off" });
  });

  test("Folevi Mail posts to Connect's /v1/mail with the server's token, replies to the owner", async () => {
    const t = setup();
    const owner = await ownedServer(t);
    process.env.FOLEVI_CONNECT_TOKEN = "connect-token-test";
    process.env.FOLEVI_CONNECT_URL = "https://connect.test";
    await owner.as.mutation(api.serverAdmin.updateSettings, { patch: { email: { mode: "folevi" } } });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "relay-1" }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await t.action(internal.email.sendTemplate, { key: "auth_verify_email", to: "a@example.com", dataVariables: { actionUrl: "https://x.example/verify", expiresInHours: 24 }, idempotencyKey: "s2" });
    expect(res.status).toBe("accepted");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://connect.test/v1/mail");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer connect-token-test");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ to: "a@example.com", tag: "auth_verify_email", replyTo: "owner@example.com" });
    expect(typeof body.html).toBe("string");
  });

  test("testEmail is for admins and says why it can't send", async () => {
    const t = setup();
    const owner = await ownedServer(t);
    expect(await owner.as.action(api.serverAdmin.testEmail, { to: "me@example.com" })).toEqual({ ok: false, error: "Email is off on this server." });
    const member = await person(t, "m@example.com");
    expect(await codeOf(member.as.action(api.serverAdmin.testEmail, { to: "me@example.com" }))).toBe("not_found");
  });
});

describe("Folevi Server: push relay", () => {
  test("410 drops the token, 503 is tried again, 202 is sent", async () => {
    process.env.FOLEVI_CONNECT_TOKEN = "tok";
    process.env.FOLEVI_CONNECT_URL = "https://connect.test";
    const push = { platform: "apns" as const, token: "dev", environment: "production" as const, title: "Hi", data: { path: "/d/x" } };
    const noSleep = async () => {};
    expect(await sendThroughRelay(push, (async () => new Response('{"error":"token_gone"}', { status: 410 })) as typeof fetch, noSleep)).toEqual({ outcome: "gone", status: 410 });
    const busy = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(new Response("", { status: 202 }));
    expect(await sendThroughRelay(push, busy as unknown as typeof fetch, noSleep)).toEqual({ outcome: "sent", status: 202 });
    expect(busy).toHaveBeenCalledTimes(2);
    expect((busy.mock.calls[0] as unknown as [string])[0]).toBe("https://connect.test/v1/push");
    expect(relayPushBody(push)).toEqual({ platform: "apns", token: "dev", environment: "production", title: "Hi", body: "", data: { path: "/d/x" } });
    delete process.env.FOLEVI_CONNECT_TOKEN;
    expect(await sendThroughRelay(push, busy as unknown as typeof fetch, noSleep)).toEqual({ outcome: "failed", status: 0 });
  });
});

describe("Folevi Server: Foli AI", () => {
  test("off until set up; requests are refused and info says ai: false", async () => {
    const t = setup();
    const owner = await ownedServer(t);
    expect((await t.query(api.server.info, {})).features.ai).toBe(false);
    useServerAiSettings(null);
    expect(provider().id).toBe("off");
    expect(aiAvailable()).toBe(false);
    await owner.as.mutation(api.serverAdmin.updateSettings, { patch: { ai: { mode: "openai", openai: { baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.2" } } } });
    expect((await t.query(api.server.info, {})).features.ai).toBe(true);
    const settings = await t.query(internal.server.aiSettings, {});
    useServerAiSettings(settings);
    expect(provider().id).toBe("openai");
    expect(provider().models().main).toBe("llama3.2");
  });

  test("provider choice: gemini, openai-compatible, Folevi AI (Connect gateway)", () => {
    process.env.FOLEVI_EDITION = "server";
    expect(serverProviderFor({ mode: "gemini", configured: true, gemini: { apiKey: "g" }, openai: null }).id).toBe("gemini");
    expect(serverProviderFor({ mode: "folevi", configured: true, gemini: null, openai: null }).id).toBe("off");
    process.env.FOLEVI_CONNECT_TOKEN = "tok";
    expect(serverProviderFor({ mode: "folevi", configured: true, gemini: null, openai: null }).id).toBe("folevi");
    expect(serverProviderFor({ mode: "off", configured: false, gemini: null, openai: null }).id).toBe("off");
  });

  test("the OpenAI-compatible adapter: messages, tools, JSON, streaming and embeddings", async () => {
    const req = {
      system: "Be brief.",
      prompt: "",
      contents: [
        { role: "user" as const, parts: [{ text: "Find my notes" }] },
        { role: "model" as const, parts: [{ functionCall: { name: "search", args: { q: "x" } } }] },
        { role: "user" as const, parts: [{ functionResponse: { name: "search", response: { hits: 1 } } }] },
      ],
      tools: [{ name: "search", description: "Search notes" }],
      json: true,
    };
    const msgs = messagesOf(req);
    expect(msgs.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
    const call = (msgs[2] as { tool_calls: { id: string }[] }).tool_calls[0]!;
    expect((msgs[3] as { tool_call_id: string }).tool_call_id).toBe(call.id);
    const body = chatBody(req, "m", true);
    expect(body).toMatchObject({ model: "m", response_format: { type: "json_object" }, stream: true });
    expect((body.tools as unknown[]).length).toBe(1);

    const sse = ['data: {"choices":[{"delta":{"content":"Hel"}}]}', 'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}', 'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3}}', "data: [DONE]", ""].join("\n\n");
    const fetchMock = vi.fn(async () => new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    const p = openAiProvider({ id: "openai", baseUrl: "http://ai.local/v1", apiKey: "sk", model: "llama", embeddingModel: "nomic" });
    const meter: { promptTokens: number }[] = [];
    const deltas: string[] = [];
    const res = await p.generate({ system: "s", prompt: "hi" }, meter as never, async (t) => {
      deltas.push(t);
      return true;
    });
    expect(res.text).toBe("Hello");
    expect(meter[0]).toMatchObject({ promptTokens: 12, outputTokens: 3 });
    expect(deltas.at(-1)).toBe("Hello");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://ai.local/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [3, 4] }] }), { status: 200 })));
    const emb = await p.embed(["note"], "document");
    expect(emb.vectors[0]).toHaveLength(768);
    expect(emb.vectors[0]!.slice(0, 2)).toEqual([0.6, 0.8]);
    expect(fitVector(new Array(1000).fill(1))).toHaveLength(768);
  });
});

describe("Folevi Server: static JWKS", () => {
  test("public keys go inline as a data: URL; key rows go to the plugin too", () => {
    process.env.FOLEVI_EDITION = "server";
    process.env.CONVEX_SITE_URL = "https://nas.example/convex-site";
    expect(authProvider().jwks).toBe("https://nas.example/convex-site/api/auth/convex/jwks");
    process.env.FOLEVI_JWKS = JSON.stringify({ keys: [{ kty: "RSA", n: "abc", e: "AQAB", kid: "k1", alg: "RS256" }] });
    const p = authProvider();
    expect(p.jwks.startsWith("data:text/plain;charset=utf-8;base64,")).toBe(true);
    expect(JSON.parse(atob(p.jwks.split(",")[1]!))).toEqual({ keys: [{ kty: "RSA", n: "abc", e: "AQAB", kid: "k1", alg: "RS256" }] });
    expect(p.issuer).toBe("https://nas.example/convex-site");
    // The plugin keeps signing with the database's key, so it gets the ordinary provider.
    expect(pluginJwksOptions().jwks).toBeUndefined();
    expect(pluginJwksOptions().authConfig.providers[0]!.jwks).toMatch(/^https:/);
    const rows = JSON.stringify([{ id: "k1", publicKey: JSON.stringify({ kty: "RSA", n: "abc", e: "AQAB" }), privateKey: "sealed", alg: "RS256", createdAt: 1 }]);
    process.env.FOLEVI_JWKS = rows;
    expect(pluginJwksOptions().jwks).toBe(rows);
    expect(authProvider().jwks.startsWith("data:")).toBe(true);
    process.env.FOLEVI_JWKS = "not json";
    expect(staticJwks()).toEqual({ kind: "none" });
  });
});

describe("Folevi Server: trusted origins", () => {
  test("every name the server answers on is trusted for sign-in; the cloud trusts none of them", async () => {
    const { serverTrustedOrigins } = await import("../../convex/lib/edition");
    vi.stubEnv("FOLEVI_TRUSTED_ORIGINS", "http://192.168.1.20:8460, https://abc1234567.folevi.app,not a url,ftp://x,http://192.168.1.20:8460/");
    vi.stubEnv("FOLEVI_EDITION", "");
    expect(serverTrustedOrigins()).toEqual([]);
    vi.stubEnv("FOLEVI_EDITION", "server");
    expect(serverTrustedOrigins()).toEqual(["http://192.168.1.20:8460", "https://abc1234567.folevi.app"]);
    vi.unstubAllEnvs();
  });
});
