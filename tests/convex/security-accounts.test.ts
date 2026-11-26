// Security audit 2026-11-26, accounts and Folevi Server: the deployment gate fails closed, an unclaimed
// server takes no sign-ups without its setup code, an admin can't reach the owner's secrets or account,
// and identity email is limited per recipient.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { sha256Hex } from "../../convex/lib/crypto";
import { corsAllowed } from "../../convex/lib/cors";
import { deploymentOf, isProductionDeployment } from "../../convex/lib/deployment";
import { testPurchasesAllowed } from "../../convex/lib/polar";
import { person, setup, ulid, type T } from "./helpers";

const ENV = ["FOLEVI_EDITION", "FOLEVI_SETUP_TOKEN_HASH", "FOLEVI_ENV"] as const;
const SETUP_TOKEN = "setup-code-for-tests-0123456789";
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const data = (e as { data?: { code?: string } }).data;
    return data?.code ?? String((e as Error).message);
  }
  return "ok";
}

/** A claimed server with its owner, one admin and one member. */
async function staffedServer(t: T) {
  process.env.FOLEVI_EDITION = "server";
  process.env.FOLEVI_SETUP_TOKEN_HASH = await sha256Hex(SETUP_TOKEN);
  const owner = await person(t, "owner@example.com");
  await owner.as.mutation(api.server.claimOwner, { setupToken: SETUP_TOKEN });
  const admin = await person(t, "admin@example.com");
  await owner.as.mutation(api.serverAdmin.setRole, { userId: admin.profileId, role: "admin" });
  const member = await person(t, "member@example.com");
  return { owner, admin, member };
}

describe("the deployment gate fails closed", () => {
  test("only a named non-production deployment turns development tools on", () => {
    expect(deploymentOf("development")).toBe("development");
    expect(deploymentOf(" Test ")).toBe("test");
    expect(deploymentOf("preview")).toBe("preview");
    for (const value of [undefined, "", "production", "prod", "Production", "live", "dev"]) expect(deploymentOf(value)).toBe("production");
  });

  test("an unset or mistyped FOLEVI_ENV means production: no test purchases, no local CORS", () => {
    for (const value of [undefined, "prod", ""]) {
      if (value === undefined) delete process.env.FOLEVI_ENV;
      else process.env.FOLEVI_ENV = value;
      expect(isProductionDeployment()).toBe(true);
      expect(testPurchasesAllowed()).toBe(false);
      expect(corsAllowed("http://localhost:3000", { appUrl: "https://app.folevi.com", deployment: value })).toBe(false);
    }
    process.env.FOLEVI_ENV = "development";
    expect(testPurchasesAllowed()).toBe(true);
    expect(corsAllowed("http://localhost:3000", { appUrl: "https://app.folevi.com", deployment: "development" })).toBe(true);
  });
});

describe("Folevi Server: an unclaimed server", () => {
  test("takes a sign-up only with the setup code", async () => {
    const t = setup();
    process.env.FOLEVI_EDITION = "server";
    process.env.FOLEVI_SETUP_TOKEN_HASH = await sha256Hex(SETUP_TOKEN);
    expect(await t.query(internal.server.signUpGate, { email: "stranger@example.com" })).toMatchObject({ allowed: false, code: "SETUP_REQUIRED" });
    expect(await t.query(internal.server.signUpGate, { email: "stranger@example.com", inviteToken: "a-guess" })).toMatchObject({ allowed: false, code: "SETUP_REQUIRED" });
    expect(await t.query(internal.server.signUpGate, { email: "owner@example.com", inviteToken: SETUP_TOKEN })).toMatchObject({ allowed: true });
    // No setup code configured at all: nobody gets in (claimOwner refuses then, too).
    delete process.env.FOLEVI_SETUP_TOKEN_HASH;
    expect(await t.query(internal.server.signUpGate, { email: "owner@example.com", inviteToken: SETUP_TOKEN })).toMatchObject({ allowed: false });
  });
});

describe("Folevi Server: an admin can't reach the owner", () => {
  test("where mail and AI requests go is the owner's to change", async () => {
    const t = setup();
    const { owner, admin } = await staffedServer(t);
    const smtp = { host: "mail.example.com", port: 587, security: "starttls" as const, username: "me", password: "hunter2-secret", from: "Folevi <folevi@example.com>" };
    await owner.as.mutation(api.serverAdmin.updateSettings, { patch: { email: { mode: "smtp", smtp } } });
    expect(await codeOf(admin.as.mutation(api.serverAdmin.updateSettings, { patch: { email: { smtp: { host: "smtp.attacker.example", security: "none" } } } }))).toBe("forbidden");
    expect(await codeOf(admin.as.mutation(api.serverAdmin.updateSettings, { patch: { ai: { mode: "openai", openai: { baseUrl: "https://attacker.example/v1", model: "m" } } } }))).toBe("forbidden");
    expect(await codeOf(admin.as.mutation(api.serverAdmin.updateSettings, { patch: { emailIn: { mode: "off" } } }))).toBe("forbidden");
    expect(await codeOf(admin.as.mutation(api.serverAdmin.updateSettings, { patch: { covers: { mode: "off" } } }))).toBe("forbidden");
    expect((await owner.as.query(api.serverAdmin.getSettings, {})).email.smtp?.host).toBe("mail.example.com");
    // The rest of the settings stay open to admins.
    await admin.as.mutation(api.serverAdmin.updateSettings, { patch: { signUp: "open", name: "Our server" } });
    expect(await owner.as.query(api.serverAdmin.getSettings, {})).toMatchObject({ signUp: "open", name: "Our server" });
  });

  test("a stored password or key never follows a changed server", async () => {
    const t = setup();
    const { owner } = await staffedServer(t);
    const smtp = { host: "mail.example.com", port: 587, security: "starttls" as const, username: "me", password: "hunter2-secret", from: "Folevi <folevi@example.com>" };
    await owner.as.mutation(api.serverAdmin.updateSettings, { patch: { email: { mode: "smtp", smtp } } });
    // Another host or user name without the password again is refused; with it, or for the same host, it is fine.
    expect(await codeOf(owner.as.mutation(api.serverAdmin.updateSettings, { patch: { email: { smtp: { host: "smtp.other.example" } } } }))).toBe("invalid_argument");
    expect(await codeOf(owner.as.mutation(api.serverAdmin.updateSettings, { patch: { email: { smtp: { username: "someone-else" } } } }))).toBe("invalid_argument");
    await owner.as.mutation(api.serverAdmin.updateSettings, { patch: { email: { smtp: { port: 465, security: "tls" } } } });
    expect((await owner.as.query(api.serverAdmin.getSettings, {})).email.smtp).toMatchObject({ host: "mail.example.com", port: 465, password: { set: true } });
    await owner.as.mutation(api.serverAdmin.updateSettings, { patch: { email: { smtp: { host: "smtp.other.example", password: "another-secret" } } } });
    expect((await owner.as.query(api.serverAdmin.getSettings, {})).email.smtp).toMatchObject({ host: "smtp.other.example", password: { set: true } });

    // The AI key stays for the same service and is dropped when the address points somewhere else.
    await owner.as.mutation(api.serverAdmin.updateSettings, { patch: { ai: { mode: "openai", openai: { baseUrl: "https://api.openai.com/v1", apiKey: "sk-test-key", model: "gpt" } } } });
    await owner.as.mutation(api.serverAdmin.updateSettings, { patch: { ai: { openai: { baseUrl: "https://api.openai.com/v2", model: "gpt" } } } });
    expect((await owner.as.query(api.serverAdmin.getSettings, {})).ai.openai?.apiKey).toEqual({ set: true });
    await owner.as.mutation(api.serverAdmin.updateSettings, { patch: { ai: { openai: { baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.2" } } } });
    expect((await owner.as.query(api.serverAdmin.getSettings, {})).ai.openai?.apiKey).toEqual({ set: false });
  });

  test("the cloud console's user functions keep the server's order: only the owner acts on the owner or an admin", async () => {
    const t = setup();
    const { owner, admin, member } = await staffedServer(t);
    const second = await person(t, "admin2@example.com");
    await owner.as.mutation(api.serverAdmin.setRole, { userId: second.profileId, role: "admin" });
    const reason = "security audit test";
    for (const target of [owner, second]) {
      const email = target === owner ? "owner@example.com" : "admin2@example.com";
      expect(await codeOf(admin.as.mutation(api.admin.suspendUser, { profileId: target.profileId, suspend: true, confirmEmail: email, reason }))).toBe("forbidden");
      expect(await codeOf(admin.as.mutation(api.admin.revokeAllSessions, { profileId: target.profileId, reason }))).toBe("forbidden");
      expect(await codeOf(admin.as.mutation(api.admin.initiatePasswordReset, { profileId: target.profileId, userRequested: true, reason }))).toBe("forbidden");
      expect(await codeOf(admin.as.mutation(api.admin.scheduleAccountDeletion, { profileId: target.profileId, confirmEmail: email, reason }))).toBe("forbidden");
    }
    // Members are still an admin's to manage, and the owner manages admins.
    expect(await codeOf(admin.as.mutation(api.admin.revokeAllSessions, { profileId: member.profileId, reason }))).toBe("ok");
    expect(await codeOf(owner.as.mutation(api.admin.revokeAllSessions, { profileId: second.profileId, reason }))).toBe("ok");
  });

  test("an admin sets members' storage and their own, not the owner's or another admin's", async () => {
    const t = setup();
    const { owner, admin, member } = await staffedServer(t);
    expect(await codeOf(admin.as.mutation(api.serverAdmin.setQuota, { userId: owner.profileId, quotaBytes: 0 }))).toBe("forbidden");
    expect(await codeOf(admin.as.mutation(api.serverAdmin.setQuota, { userId: member.profileId, quotaBytes: 1024 }))).toBe("ok");
    expect(await codeOf(admin.as.mutation(api.serverAdmin.setQuota, { userId: admin.profileId, quotaBytes: 2048 }))).toBe("ok");
    expect(await codeOf(owner.as.mutation(api.serverAdmin.setQuota, { userId: admin.profileId, quotaBytes: 4096 }))).toBe("ok");
  });
});

describe("identity email is limited per recipient", () => {
  test("a sixth confirmation or reset to one address in an hour is dropped, whoever asks", async () => {
    const t = setup();
    for (let i = 0; i < 5; i++) expect(await t.mutation(internal.authEmails.admit, { key: "auth_verify_email", to: "Victim@Example.com" })).toBe(true);
    expect(await t.mutation(internal.authEmails.admit, { key: "auth_verify_email", to: "victim@example.com" })).toBe(false);
    // Resets have their own allowance, and other addresses are untouched.
    for (let i = 0; i < 5; i++) expect(await t.mutation(internal.authEmails.admit, { key: "auth_password_reset", to: "victim@example.com" })).toBe(true);
    expect(await t.mutation(internal.authEmails.admit, { key: "auth_password_reset", to: "victim@example.com" })).toBe(false);
    expect(await t.mutation(internal.authEmails.admit, { key: "auth_verify_email", to: "someone-else@example.com" })).toBe(true);
  });
});

describe("a note's cover colour is a name from the list", () => {
  test("free text in a colour or gradient cover is refused (it would land in a style attribute on shared pages)", async () => {
    const t = setup();
    const p = await person(t, "cover@example.com");
    const id = ulid();
    await p.as.mutation(api.sync.push, {
      scope: p.scope,
      deviceId: "device-cover-names",
      ops: [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title: "Cover", icon: null } }],
    });
    const setCover = async (cover: { kind: "color" | "gradient"; value?: string }) =>
      (await p.as.mutation(api.sync.push, { scope: p.scope, deviceId: "device-cover-names", ops: [{ opId: ulid(), kind: "document.update", documentId: id, patch: { cover }, baseRevision: null }] as never }))[0]!.status;
    expect(await setCover({ kind: "color", value: "x);position:fixed;inset:0;background:url(https://attacker.example/o.png);--x:(" })).not.toBe("applied");
    expect(await setCover({ kind: "gradient", value: "moss;position:fixed" })).not.toBe("applied");
    expect(await setCover({ kind: "color", value: "moss" })).toBe("applied");
    expect(await setCover({ kind: "gradient" })).toBe("applied");
  });
});
