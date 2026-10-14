// Transactional email through Resend: sendTemplate (fetch mocked) and the signed webhook.
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { emailManifest, hashRecipient } from "@folevi/email";
import { setup, type T } from "./helpers";

const TOKEN = "re_test_key_SECRET"; // gitleaks:allow (fake test value)
const KEY_B64 = Buffer.from("resend-webhook-signing-secret-for-tests").toString("base64");
const WEBHOOK_SECRET = `whsec_${KEY_B64}`; // gitleaks:allow (fake test value)
const EMAIL_ENV = ["RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "EMAIL_REPLY_TO", "FOLEVI_EMAIL_ALLOWLIST"] as const;

let saved: Record<string, string | undefined> = {};
let fetchMock: ReturnType<typeof vi.fn>;

function resendOk(id = "msg-0001") {
  return new Response(JSON.stringify({ id }), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  saved = Object.fromEntries(EMAIL_ENV.map((k) => [k, process.env[k]]));
  for (const k of EMAIL_ENV) delete process.env[k];
  process.env.RESEND_API_KEY = TOKEN;
  process.env.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET;
  fetchMock = vi.fn(async () => resendOk());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of EMAIL_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const deviceVars = () => ({ ...emailManifest.security_new_device.fixture });
const mentionVars = () => ({ ...emailManifest.mention_notification.fixture });

async function attempts(t: T) {
  return await t.run(async (ctx) => await ctx.db.query("emailSendAttempts").collect());
}

describe("sendTemplate via Resend", () => {
  test("records the attempt with the provider message id and sends the rendered template", async () => {
    const t = setup();
    const res = await t.action(internal.email.sendTemplate, { key: "security_new_device", to: "reader@example.com", dataVariables: deviceVars(), idempotencyKey: "device:1" });
    expect(res).toEqual({ status: "accepted" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(String(init.body));
    const [row] = await attempts(t);
    expect(row).toMatchObject({ status: "accepted", provider: "resend", providerMessageId: "msg-0001", attempts: 1, recipientHint: "r***@e***.com" });
    expect(body.tags).toEqual([
      { name: "template", value: "security_new_device" },
      { name: "attempt", value: row!._id },
    ]);
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe(`folevi-${row!._id}`);
    expect(body.from).toBe("Folevi <security@mail.folevi.com>");
    expect(body.html).toContain("Safari on macOS");
  });

  test("is idempotent: the attempt row stops a second send for the same key", async () => {
    const t = setup();
    const args = { key: "security_new_device", to: "reader@example.com", dataVariables: deviceVars(), idempotencyKey: "device:2" };
    await t.action(internal.email.sendTemplate, args);
    const again = await t.action(internal.email.sendTemplate, args);
    expect(again).toEqual({ status: "accepted", duplicate: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await attempts(t)).toHaveLength(1);
  });

  test("an in-flight attempt blocks a concurrent run; an abandoned one doesn't", async () => {
    const t = setup();
    const hash = await hashRecipient("reader@example.com", "test-salt");
    const insert = (key: string, updatedAt: number) =>
      t.run(async (ctx) =>
        ctx.db.insert("emailSendAttempts", {
          templateKey: "security_new_device", category: "security", recipientHash: hash, recipientHint: "r***", idempotencyKey: key,
          status: "queued", attempts: 0, environment: "test", requestId: "r", createdAt: updatedAt, updatedAt,
        }),
      );
    await insert("device:3", Date.now());
    const blocked = await t.action(internal.email.sendTemplate, { key: "security_new_device", to: "reader@example.com", dataVariables: deviceVars(), idempotencyKey: "device:3" });
    expect(blocked).toEqual({ status: "queued", duplicate: true });
    expect(fetchMock).not.toHaveBeenCalled();

    const stale = await insert("device:4", Date.now() - 60 * 60 * 1000);
    const sent = await t.action(internal.email.sendTemplate, { key: "security_new_device", to: "reader@example.com", dataVariables: deviceVars(), idempotencyKey: "device:4" });
    expect(sent).toEqual({ status: "accepted" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await t.run(async (ctx) => (await ctx.db.get(stale))?.status)).toBe("failed");
  });

  test("a failed attempt can be retried with the same key", async () => {
    const t = setup();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ statusCode: 422, name: "validation_error", message: "bad" }), { status: 422 }));
    const args = { key: "security_new_device", to: "reader@example.com", dataVariables: deviceVars(), idempotencyKey: "device:5" };
    expect(await t.action(internal.email.sendTemplate, args)).toEqual({ status: "failed" });
    expect(await t.action(internal.email.sendTemplate, args)).toEqual({ status: "accepted" });
    const rows = await attempts(t);
    expect(rows.map((r) => [r.status, r.errorCode ?? null])).toEqual([["failed", "provider_rejected"], ["accepted", null]]);
  });

  test("outside production, real addresses are skipped; allowlisted ones go", async () => {
    const t = setup();
    const live = await t.action(internal.email.sendTemplate, { key: "security_new_device", to: "person@gmail.com", dataVariables: deviceVars(), idempotencyKey: "device:6" });
    expect(live).toEqual({ status: "skipped" });
    expect(fetchMock).not.toHaveBeenCalled();

    process.env.FOLEVI_EMAIL_ALLOWLIST = "person@gmail.com";
    const allowed = await t.action(internal.email.sendTemplate, { key: "security_new_device", to: "person@gmail.com", dataVariables: deviceVars(), idempotencyKey: "device:7" });
    expect(allowed).toEqual({ status: "accepted" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("no provider configured: recorded as failed, nothing sent", async () => {
    delete process.env.RESEND_API_KEY;
    const t = setup();
    expect(await t.action(internal.email.sendTemplate, { key: "security_new_device", to: "reader@example.com", dataVariables: deviceVars(), idempotencyKey: "device:8" })).toEqual({ status: "failed" });
    expect((await attempts(t))[0]).toMatchObject({ status: "failed", errorCode: "provider_not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("logs never contain the token, the address or the content", async () => {
    const logs: string[] = [];
    for (const m of ["log", "info", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
    const t = setup();
    await t.action(internal.email.sendTemplate, { key: "mention_notification", to: "reader@example.com", dataVariables: mentionVars(), idempotencyKey: "mention:1" });
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 401 }));
    await t.action(internal.email.sendTemplate, { key: "mention_notification", to: "reader@example.com", dataVariables: mentionVars(), idempotencyKey: "mention:2" });
    const all = logs.join("\n");
    expect(all).toContain("email.send");
    for (const secret of [TOKEN, "reader@example.com", "Spring planting plan", "Maya Okafor"]) expect(all).not.toContain(secret);
    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------- webhook

let seq = 0;
const nextId = () => `msg_${Date.now().toString(36)}${(seq++).toString(36)}`;

function sign(id: string, timestamp: string, body: string, key = KEY_B64) {
  return `v1,${createHmac("sha256", Buffer.from(key, "base64")).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

function evt(type: string, data: Record<string, unknown> = {}) {
  return JSON.stringify({
    type,
    created_at: new Date().toISOString(),
    data: { email_id: "msg-0001", from: "Folevi <hello@mail.folevi.com>", to: ["reader@example.com"], subject: "Hi", tags: { template: "mention_notification" }, ...data },
  });
}

async function post(t: T, body: string, opts: { id?: string; signature?: string | null; key?: string } = {}) {
  const id = opts.id ?? nextId();
  const ts = String(Math.floor(Date.now() / 1000));
  const signature = opts.signature === undefined ? sign(id, ts, body, opts.key) : opts.signature;
  return await t.fetch("/webhooks/resend", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "svix-id": id, "svix-timestamp": ts, ...(signature !== null ? { "svix-signature": signature } : {}) },
  });
}

async function sentAttempt(t: T, overrides: { to?: string; key?: string; messageId?: string } = {}): Promise<Id<"emailSendAttempts">> {
  const hash = await hashRecipient(overrides.to ?? "reader@example.com", "test-salt");
  return await t.run(async (ctx) =>
    ctx.db.insert("emailSendAttempts", {
      templateKey: overrides.key ?? "mention_notification",
      category: "product",
      recipientHash: hash,
      recipientHint: "r***",
      idempotencyKey: `k-${Math.random()}`,
      status: "accepted",
      attempts: 1,
      environment: "test",
      requestId: "req",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      provider: "resend",
      providerMessageId: overrides.messageId,
    }),
  );
}

async function events(t: T) {
  return await t.run(async (ctx) => await ctx.db.query("emailProviderEvents").collect());
}

describe("POST /webhooks/resend (delivery events)", () => {
  test("accepts a valid signature; rejects bad, missing and unconfigured ones", async () => {
    const t = setup();
    const body = evt("email.delivered");
    expect((await post(t, body)).status).toBe(200);
    expect((await post(t, body, { key: Buffer.from("another-secret").toString("base64") })).status).toBe(401);
    const id = nextId();
    const ts = String(Math.floor(Date.now() / 1000));
    expect((await post(t, body.replace("delivered", "bounced"), { id, signature: sign(id, ts, body) })).status).toBe(401);
    expect((await post(t, body, { signature: null })).status).toBe(401);
    process.env.RESEND_WEBHOOK_SECRET = "";
    expect((await post(t, body)).status).toBe(401);
    expect(await events(t)).toHaveLength(1);
  });

  test("400 on a signed but malformed body", async () => {
    const t = setup();
    expect((await post(t, "{not json")).status).toBe(400);
  });

  test("matches by email id, then by the attempt tag; stores hashes only", async () => {
    const t = setup();
    const byMessage = await sentAttempt(t, { messageId: "msg-A" });
    const byTag = await sentAttempt(t, { to: "b@example.com" });
    await post(t, evt("email.delivered", { email_id: "msg-A" }), { id: "msg_e1" });
    await post(t, evt("email.delivered", { email_id: "unknown", to: ["b@example.com"], tags: { template: "mention_notification", attempt: byTag } }), { id: "msg_e2" });
    // An attempt id that doesn't match the recipient is not trusted.
    await post(t, evt("email.delivered", { email_id: "unknown-2", to: ["c@example.com"], tags: { attempt: byTag } }), { id: "msg_e3" });
    const byId = Object.fromEntries((await events(t)).map((e) => [e.webhookId, e]));
    expect(byId["resend:msg_e1"]!.attemptId).toBe(byMessage);
    expect(byId["resend:msg_e2"]!.attemptId).toBe(byTag);
    expect(byId["resend:msg_e3"]!.attemptId).toBeUndefined();
    expect(byId["resend:msg_e1"]).toMatchObject({ provider: "resend", eventName: "delivered", recipientHash: await hashRecipient("reader@example.com", "test-salt") });
    expect(JSON.stringify(Object.values(byId))).not.toContain("@example.com");
    const attempt = await t.run(async (ctx) => ctx.db.get(byMessage));
    expect(attempt?.deliveryStatus).toBe("delivered");
  });

  test("dedupes on svix-id (retries are harmless); a delivery after a delay shows as delivered", async () => {
    const t = setup();
    const id = await sentAttempt(t, { messageId: "msg-L" });
    const delayed = evt("email.delivery_delayed", { email_id: "msg-L" });
    const delivered = evt("email.delivered", { email_id: "msg-L" });
    expect((await post(t, delayed, { id: "msg_L1" })).status).toBe(200);
    expect((await post(t, delayed, { id: "msg_L1" })).status).toBe(200);
    expect((await post(t, delivered, { id: "msg_L2" })).status).toBe(200);
    expect(await events(t)).toHaveLength(2);
    expect((await t.run(async (ctx) => ctx.db.get(id)))?.deliveryStatus).toBe("delivered");
  });

  test("hard bounces and complaints suppress product email; security email still goes", async () => {
    const t = setup();
    const id = await sentAttempt(t, { messageId: "msg-B", to: "gone@example.com" });
    const bounce = evt("email.bounced", { email_id: "msg-B", to: ["gone@example.com"], bounce: { type: "Permanent", subType: "General", message: "550 5.1.1 <gone@example.com> unknown" } });
    expect((await post(t, bounce, { id: "msg_B1" })).status).toBe(200);
    const [suppression] = await t.run(async (ctx) => ctx.db.query("emailSuppressions").collect());
    expect(suppression).toMatchObject({ reason: "hard_bounce", provider: "resend", recipientHash: await hashRecipient("gone@example.com", "test-salt") });
    const [event] = (await events(t)).filter((e) => e.webhookId === "resend:msg_B1");
    expect(event).toMatchObject({ bounceCategory: "Permanent:General" });
    expect(JSON.stringify(event)).not.toContain("unknown");
    expect((await t.run(async (ctx) => ctx.db.get(id)))?.deliveryStatus).toBe("bounced");

    const product = await t.action(internal.email.sendTemplate, { key: "mention_notification", to: "gone@example.com", dataVariables: mentionVars(), idempotencyKey: "mention:gone" });
    expect(product).toEqual({ status: "skipped" });
    const security = await t.action(internal.email.sendTemplate, { key: "security_new_device", to: "gone@example.com", dataVariables: deviceVars(), idempotencyKey: "device:gone" });
    expect(security).toEqual({ status: "accepted" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const rows = await attempts(t);
    expect(rows.find((r) => r.idempotencyKey === "mention:gone")).toMatchObject({ status: "skipped", errorCode: "recipient_suppressed" });

    // A later spam complaint upgrades the reason; nothing is duplicated.
    await post(t, evt("email.complained", { email_id: "msg-B", to: ["gone@example.com"] }), { id: "msg_B2" });
    const all = await t.run(async (ctx) => ctx.db.query("emailSuppressions").collect());
    expect(all).toHaveLength(1);
    expect(all[0]!.reason).toBe("spam_complaint");
  });

  test("events for mail another domain on the same Resend account sent are dropped", async () => {
    const t = setup();
    await sentAttempt(t, { messageId: "msg-X", to: "someone@example.com" });
    const other = evt("email.bounced", { email_id: "msg-X", from: "Other App <hi@other.app>", to: ["someone@example.com"], bounce: { type: "Permanent" } });
    expect((await post(t, other)).status).toBe(200);
    expect(await events(t)).toHaveLength(0);
    expect(await t.run(async (ctx) => ctx.db.query("emailSuppressions").collect())).toHaveLength(0);
  });

  test("a transient bounce is a soft bounce and suppresses nothing", async () => {
    const t = setup();
    await sentAttempt(t, { messageId: "msg-S", to: "full@example.com" });
    await post(t, evt("email.bounced", { email_id: "msg-S", to: ["full@example.com"], bounce: { type: "Transient", subType: "MailboxFull" } }), { id: "msg_S1" });
    expect((await events(t))[0]).toMatchObject({ eventName: "soft_bounced" });
    expect(await t.run(async (ctx) => ctx.db.query("emailSuppressions").collect())).toHaveLength(0);
  });
});
