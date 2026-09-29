// Transactional email through Mailtrap: sendTemplate (fetch mocked) and the signed webhook.
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { emailManifest, hashRecipient } from "@folevi/email";
import { setup, type T } from "./helpers";

const TOKEN = "mt-test-token-SECRET"; // gitleaks:allow (fake test value)
const WEBHOOK_SECRET = "mt-webhook-signing-secret"; // gitleaks:allow (fake test value)
const EMAIL_ENV = [
  "MAILTRAP_API_TOKEN",
  "MAILTRAP_WEBHOOK_SECRET",
  "MAILTRAP_SANDBOX_INBOX_ID",
  "MAILTRAP_SANDBOX_TOKEN",
  "EMAIL_REPLY_TO",
  "LOOPS_API_KEY",
  "FOLEVI_EMAIL_ALLOWLIST",
] as const;

let saved: Record<string, string | undefined> = {};
let fetchMock: ReturnType<typeof vi.fn>;

function mailtrapOk(id = "msg-0001") {
  return new Response(JSON.stringify({ success: true, message_ids: [id] }), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  saved = Object.fromEntries(EMAIL_ENV.map((k) => [k, process.env[k]]));
  for (const k of EMAIL_ENV) delete process.env[k];
  process.env.MAILTRAP_API_TOKEN = TOKEN;
  process.env.MAILTRAP_WEBHOOK_SECRET = WEBHOOK_SECRET;
  fetchMock = vi.fn(async () => mailtrapOk());
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

describe("sendTemplate via Mailtrap", () => {
  test("records the attempt with the provider message id and sends the rendered template", async () => {
    const t = setup();
    const res = await t.action(internal.email.sendTemplate, { key: "security_new_device", to: "reader@example.com", dataVariables: deviceVars(), idempotencyKey: "device:1" });
    expect(res).toEqual({ status: "accepted" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://send.api.mailtrap.io/api/send");
    const body = JSON.parse(String(init.body));
    const [row] = await attempts(t);
    expect(row).toMatchObject({ status: "accepted", provider: "mailtrap", providerMessageId: "msg-0001", attempts: 1, recipientHint: "r***@e***.com" });
    expect(body.custom_variables).toEqual({ attempt: row!._id, template: "security_new_device" });
    expect(body.category).toBe("security_new_device");
    expect(body.from.email).toBe("security@mail.folevi.com");
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
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: false, errors: ["bad"] }), { status: 400 }));
    const args = { key: "security_new_device", to: "reader@example.com", dataVariables: deviceVars(), idempotencyKey: "device:5" };
    expect(await t.action(internal.email.sendTemplate, args)).toEqual({ status: "failed" });
    expect(await t.action(internal.email.sendTemplate, args)).toEqual({ status: "accepted" });
    const rows = await attempts(t);
    expect(rows.map((r) => [r.status, r.errorCode ?? null])).toEqual([["failed", "provider_rejected"], ["accepted", null]]);
  });

  test("outside production, real addresses are skipped on the live API but captured by the sandbox", async () => {
    const t = setup();
    const live = await t.action(internal.email.sendTemplate, { key: "security_new_device", to: "person@gmail.com", dataVariables: deviceVars(), idempotencyKey: "device:6" });
    expect(live).toEqual({ status: "skipped" });
    expect(fetchMock).not.toHaveBeenCalled();

    process.env.MAILTRAP_SANDBOX_INBOX_ID = "777";
    process.env.MAILTRAP_SANDBOX_TOKEN = "sandbox-token";
    const sandboxed = await t.action(internal.email.sendTemplate, { key: "security_new_device", to: "person@gmail.com", dataVariables: deviceVars(), idempotencyKey: "device:7" });
    expect(sandboxed).toEqual({ status: "accepted" });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe("https://sandbox.api.mailtrap.io/api/send/777");
    expect((await attempts(t)).find((a) => a.idempotencyKey === "device:7")?.provider).toBe("mailtrap_sandbox");
  });

  test("no provider configured: recorded as failed, nothing sent", async () => {
    delete process.env.MAILTRAP_API_TOKEN;
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

const sign = (body: string, secret = WEBHOOK_SECRET) => createHmac("sha256", secret).update(body).digest("hex");

function mtEvent(overrides: Record<string, unknown> = {}) {
  return {
    event: "delivery",
    message_id: "msg-0001",
    email: "reader@example.com",
    timestamp: Math.floor(Date.now() / 1000),
    event_id: `evt-${Math.random().toString(36).slice(2)}`,
    sending_stream: "transactional",
    category: "mention_notification",
    ...overrides,
  };
}

async function post(t: T, body: string, signature: string | null = sign(body)) {
  return await t.fetch("/webhooks/mailtrap", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", ...(signature !== null ? { "mailtrap-signature": signature } : {}) },
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
      provider: "mailtrap",
      providerMessageId: overrides.messageId,
    }),
  );
}

async function events(t: T) {
  return await t.run(async (ctx) => await ctx.db.query("emailProviderEvents").collect());
}

describe("POST /webhooks/mailtrap", () => {
  test("accepts a valid signature; rejects bad, missing and unconfigured ones", async () => {
    const t = setup();
    const body = JSON.stringify({ events: [mtEvent()] });
    expect((await post(t, body)).status).toBe(200);
    expect((await post(t, body, sign(body, "wrong-secret"))).status).toBe(401);
    expect((await post(t, body.replace("delivery", "bounce"), sign(body))).status).toBe(401);
    expect((await post(t, body, null)).status).toBe(401);
    process.env.MAILTRAP_WEBHOOK_SECRET = "";
    expect((await post(t, body, sign(body, ""))).status).toBe(401);
    expect(await events(t)).toHaveLength(1);
  });

  test("400 on a signed but malformed body", async () => {
    const t = setup();
    expect((await post(t, "{not json")).status).toBe(400);
  });

  test("matches by message id, then by the attempt custom variable; stores hashes only", async () => {
    const t = setup();
    const byMessage = await sentAttempt(t, { messageId: "msg-A" });
    const byVariable = await sentAttempt(t, { to: "b@example.com" });
    const body = JSON.stringify({
      events: [
        mtEvent({ event_id: "e1", message_id: "msg-A" }),
        mtEvent({ event_id: "e2", message_id: "unknown", email: "b@example.com", custom_variables: { attempt: byVariable, template: "mention_notification" } }),
        // An attempt id that doesn't match the recipient is not trusted.
        mtEvent({ event_id: "e3", message_id: "unknown-2", email: "c@example.com", custom_variables: { attempt: byVariable } }),
      ],
    });
    expect((await post(t, body)).status).toBe(200);
    const byId = Object.fromEntries((await events(t)).map((e) => [e.webhookId, e]));
    expect(byId["mailtrap:e1"]!.attemptId).toBe(byMessage);
    expect(byId["mailtrap:e2"]!.attemptId).toBe(byVariable);
    expect(byId["mailtrap:e3"]!.attemptId).toBeUndefined();
    expect(byId["mailtrap:e1"]).toMatchObject({ provider: "mailtrap", eventName: "delivered", recipientHash: await hashRecipient("reader@example.com", "test-salt") });
    expect(JSON.stringify(Object.values(byId))).not.toContain("@example.com");
    const attempt = await t.run(async (ctx) => ctx.db.get(byMessage));
    expect(attempt?.deliveryStatus).toBe("delivered");
  });

  test("accepts JSON Lines and dedupes on event_id (retries are harmless)", async () => {
    const t = setup();
    const id = await sentAttempt(t, { messageId: "msg-L" });
    const lines = [JSON.stringify(mtEvent({ event_id: "L1", message_id: "msg-L", event: "soft bounce" })), JSON.stringify(mtEvent({ event_id: "L2", message_id: "msg-L" }))].join("\n");
    expect((await post(t, lines)).status).toBe(200);
    expect((await post(t, lines)).status).toBe(200);
    expect(await events(t)).toHaveLength(2);
    // A delivery after a soft bounce shows as delivered.
    expect((await t.run(async (ctx) => ctx.db.get(id)))?.deliveryStatus).toBe("delivered");
  });

  test("hard bounces and complaints suppress product email; security email still goes", async () => {
    const t = setup();
    const id = await sentAttempt(t, { messageId: "msg-B", to: "gone@example.com" });
    const body = JSON.stringify({ events: [mtEvent({ event_id: "B1", message_id: "msg-B", email: "gone@example.com", event: "bounce", bounce_category: "bad_mailbox", response_code: 550, response: "550 5.1.1 <gone@example.com> unknown" })] });
    expect((await post(t, body)).status).toBe(200);
    const [suppression] = await t.run(async (ctx) => ctx.db.query("emailSuppressions").collect());
    expect(suppression).toMatchObject({ reason: "hard_bounce", provider: "mailtrap", recipientHash: await hashRecipient("gone@example.com", "test-salt") });
    const [event] = (await events(t)).filter((e) => e.webhookId === "mailtrap:B1");
    expect(event).toMatchObject({ bounceCategory: "bad_mailbox", responseCode: 550 });
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
    await post(t, JSON.stringify({ events: [mtEvent({ event_id: "B2", message_id: "msg-B", email: "gone@example.com", event: "spam" })] }));
    const all = await t.run(async (ctx) => ctx.db.query("emailSuppressions").collect());
    expect(all).toHaveLength(1);
    expect(all[0]!.reason).toBe("spam_complaint");
  });
});
