import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emailManifest,
  resendRequestBody,
  sanitizeProviderError,
  selectProvider,
  sendEmail,
  sendingDomain,
  type SendEmailInput,
  type SendPolicy,
} from "../src/index";

const TOKEN = "re_live_key_SECRET_1234567890"; // gitleaks:allow (fake test value)
const PROD: SendPolicy = { environment: "production" };
const LIVE_ENV = { RESEND_API_KEY: TOKEN };

function input(overrides: Partial<SendEmailInput> = {}): SendEmailInput {
  return {
    key: "mention_notification",
    to: "reader@example.com",
    dataVariables: { ...emailManifest.mention_notification.fixture },
    attemptId: "j57abc123def456",
    ...overrides,
  };
}

function res(status: number, body: unknown = status < 300 ? { id: "msg-0001-abc" } : { statusCode: status, name: "error", message: "x" }, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function setup(responses: Array<Response | Error>) {
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) {
      if (next.name === "AbortError" && init.signal) throw next;
      throw next;
    }
    return next;
  });
  const sleep = vi.fn(async () => {});
  return {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    calls: fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>,
    sleep,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("selectProvider", () => {
  it("uses Resend when a key is set, else none", () => {
    expect(selectProvider({ RESEND_API_KEY: TOKEN }, "production")).toEqual({ kind: "resend", apiKey: TOKEN });
    expect(selectProvider({ RESEND_API_KEY: TOKEN }, "preview")).toEqual({ kind: "resend", apiKey: TOKEN });
    expect(selectProvider({}, "production")).toEqual({ kind: "none" });
    expect(selectProvider({ RESEND_API_KEY: "none" }, "production")).toEqual({ kind: "none" });
    expect(selectProvider({ RESEND_API_KEY: " " }, "production")).toEqual({ kind: "none" });
  });

  it("sending domain comes from the manifest unless a valid override is set", () => {
    expect(sendingDomain({})).toBe("mail.folevi.com");
    expect(sendingDomain({ EMAIL_SENDING_DOMAIN: "mail-staging.folevi.com" })).toBe("mail-staging.folevi.com");
    expect(sendingDomain({ EMAIL_SENDING_DOMAIN: "evil.com>\r\nBcc: x" })).toBe("mail.folevi.com");
  });
});

describe("sendEmail via Resend", () => {
  it("posts the documented request body once and returns the message id", async () => {
    const { fetchImpl, calls, sleep } = setup([res(200)]);
    const out = await sendEmail(input(), { env: { ...LIVE_ENV, EMAIL_REPLY_TO: "support@folevi.com" }, policy: PROD, fetchImpl, sleep });
    expect(out).toEqual({ status: "accepted", provider: "resend", httpStatus: 200, retryable: false, attempts: 1, providerMessageId: "msg-0001-abc" });
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    // The attempt id is the idempotency key: a retried request can never send twice.
    expect(headers["Idempotency-Key"]).toBe("folevi-j57abc123def456");
    const body = JSON.parse(String(init.body));
    expect(Object.keys(body).sort()).toEqual(["from", "html", "reply_to", "subject", "tags", "text", "to"]);
    expect(body.from).toBe("Folevi <hello@mail.folevi.com>");
    expect(body.to).toEqual(["reader@example.com"]);
    expect(body.reply_to).toBe("support@folevi.com");
    expect(body.subject).toBe("You were mentioned in Folevi");
    // Opaque ids only: no personal data in tags (they come back in webhooks).
    expect(body.tags).toEqual([
      { name: "template", value: "mention_notification" },
      { name: "attempt", value: "j57abc123def456" },
    ]);
    expect(body.html).toContain("Maya Okafor");
    expect(body.text).toContain("Maya Okafor mentioned you on Spring planting plan.");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("uses the security sender for identity/security mail and omits reply_to when unset", async () => {
    const { fetchImpl, calls } = setup([res(200)]);
    await sendEmail(input({ key: "auth_password_reset", dataVariables: { ...emailManifest.auth_password_reset.fixture } }), { env: LIVE_ENV, policy: PROD, fetchImpl });
    const body = JSON.parse(String(calls[0]![1].body));
    expect(body.from).toBe("Folevi <security@mail.folevi.com>");
    expect(body).not.toHaveProperty("reply_to");
    expect(resendRequestBody({ from: { email: "a@b.co", name: "F" }, to: "c@d.co", subject: "s", text: "t", html: "h", tags: { template: "k", attempt: "a" } })).not.toHaveProperty("reply_to");
    // A tag value Resend would refuse is left out rather than failing the send.
    expect(resendRequestBody({ from: { email: "a@b.co", name: 'F"<x>' }, to: "c@d.co", subject: "s", text: "t", html: "h", tags: { template: "k", attempt: "bad id" } })).toMatchObject({ from: "Fx <a@b.co>", tags: [{ name: "template", value: "k" }] });
  });

  it("retries 429 (honouring Retry-After) and 5xx with the same body and idempotency key", async () => {
    const { fetchImpl, calls, sleep } = setup([res(429, { message: "slow down" }, { "retry-after": "2" }), res(503), res(200)]);
    const out = await sendEmail(input(), { env: LIVE_ENV, policy: PROD, fetchImpl, sleep });
    expect(out).toMatchObject({ status: "accepted", attempts: 3, providerMessageId: "msg-0001-abc" });
    expect(calls).toHaveLength(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 2000);
    expect(calls[0]![1].body).toBe(calls[2]![1].body);
    expect((calls[0]![1].headers as Record<string, string>)["Idempotency-Key"]).toBe((calls[2]![1].headers as Record<string, string>)["Idempotency-Key"]);
  });

  it("stops after maxAttempts on persistent 5xx", async () => {
    const { fetchImpl, calls, sleep } = setup([res(500), res(502), res(500), res(500)]);
    const out = await sendEmail(input(), { env: LIVE_ENV, policy: PROD, fetchImpl, sleep, maxAttempts: 3 });
    expect(out).toEqual({ status: "failed", provider: "resend", httpStatus: 500, errorCode: "provider_server_error", retryable: true, attempts: 3, providerError: "x" });
    expect(calls).toHaveLength(3);
    for (const [ms] of sleep.mock.calls as unknown as Array<[number]>) expect(ms).toBeLessThanOrEqual(8000);
  });

  it.each([
    [400, "provider_rejected"],
    [401, "unauthorized"],
    [403, "unauthorized"],
    [404, "provider_rejected"],
    [409, "idempotency_conflict"],
    [422, "provider_rejected"],
  ])("does not retry %s", async (status, code) => {
    const { fetchImpl, calls } = setup([res(status), res(200)]);
    const out = await sendEmail(input(), { env: LIVE_ENV, policy: PROD, fetchImpl, sleep: async () => {} });
    expect(out).toMatchObject({ status: "failed", httpStatus: status, errorCode: code, retryable: false, attempts: 1 });
    expect(calls).toHaveLength(1);
  });

  it("retries connection errors and timeouts: the idempotency key makes a repeat harmless", async () => {
    const a = setup([new TypeError("fetch failed"), res(200)]);
    expect(await sendEmail(input(), { env: LIVE_ENV, policy: PROD, fetchImpl: a.fetchImpl, sleep: async () => {} })).toMatchObject({ status: "accepted", attempts: 2 });
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const b = setup([abort, res(200)]);
    expect(await sendEmail(input(), { env: LIVE_ENV, policy: PROD, fetchImpl: b.fetchImpl, sleep: async () => {} })).toMatchObject({ status: "accepted", attempts: 2 });
    expect(b.calls).toHaveLength(2);
  });

  it("aborts a hung request after the timeout", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
    );
    const out = await sendEmail(input(), { env: LIVE_ENV, policy: PROD, fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 5, maxAttempts: 1 });
    expect(out).toMatchObject({ status: "failed", errorCode: "timeout" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid variables before calling Resend", async () => {
    const { fetchImpl, calls } = setup([res(200)]);
    const out = await sendEmail(input({ dataVariables: { ...emailManifest.mention_notification.fixture, documentUrl: "javascript:alert(1)" } }), { env: LIVE_ENV, policy: PROD, fetchImpl });
    expect(out).toEqual({ status: "failed", errorCode: "invalid_payload", retryable: false, attempts: 0, provider: "resend" });
    expect(calls).toHaveLength(0);
  });

  it("resolves app-relative links against FOLEVI_APP_URL", async () => {
    const { fetchImpl, calls } = setup([res(200)]);
    const out = await sendEmail(input({ dataVariables: { ...emailManifest.mention_notification.fixture, documentUrl: "/d/abc" } }), { env: { ...LIVE_ENV, FOLEVI_APP_URL: "https://app.folevi.com" }, policy: PROD, fetchImpl });
    expect(out.status).toBe("accepted");
    expect(JSON.parse(String(calls[0]![1].body)).html).toContain('href="https://app.folevi.com/d/abc"');
  });

  it("rejects bad recipients and attempt ids", async () => {
    const { fetchImpl, calls } = setup([]);
    expect((await sendEmail(input({ to: "not-an-email" }), { env: LIVE_ENV, policy: PROD, fetchImpl })).errorCode).toBe("invalid_recipient");
    expect((await sendEmail(input({ attemptId: "has space" }), { env: LIVE_ENV, policy: PROD, fetchImpl })).errorCode).toBe("invalid_attempt_id");
    expect(calls).toHaveLength(0);
  });

  it("reports provider_not_configured without calling anything", async () => {
    const { fetchImpl, calls } = setup([res(200)]);
    expect(await sendEmail(input(), { env: {}, policy: PROD, fetchImpl })).toEqual({ status: "failed", errorCode: "provider_not_configured", retryable: false, attempts: 0 });
    expect(calls).toHaveLength(0);
  });
});

describe("non-production policy", () => {
  it("skips real addresses on the live API outside production", async () => {
    const { fetchImpl, calls } = setup([res(200)]);
    const out = await sendEmail(input({ to: "someone@gmail.com" }), { env: LIVE_ENV, policy: { environment: "preview" }, fetchImpl });
    expect(out).toEqual({ status: "skipped", errorCode: "recipient_not_allowed", retryable: false, attempts: 0, provider: "resend" });
    expect(calls).toHaveLength(0);
  });

  it.each(["qa@example.com", "QA@Test.com"])("allows %s", async (to) => {
    const { fetchImpl, calls } = setup([res(200)]);
    expect((await sendEmail(input({ to }), { env: LIVE_ENV, policy: { environment: "development" }, fetchImpl })).status).toBe("accepted");
    expect(calls).toHaveLength(1);
  });

  it("allows exact allowlisted addresses only", async () => {
    const policy: SendPolicy = { environment: "test", allowlist: ["founder@folevi.com"] };
    expect((await sendEmail(input({ to: "Founder@folevi.com" }), { env: LIVE_ENV, policy, fetchImpl: setup([res(200)]).fetchImpl })).status).toBe("accepted");
    expect((await sendEmail(input({ to: "other@folevi.com" }), { env: LIVE_ENV, policy, fetchImpl: setup([res(200)]).fetchImpl })).status).toBe("skipped");
  });
});

describe("secrets and personal data", () => {
  it("never logs and never returns the token, recipient or content", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const outcomes = [
      await sendEmail(input(), { env: LIVE_ENV, policy: PROD, fetchImpl: setup([res(200)]).fetchImpl }),
      await sendEmail(input(), { env: LIVE_ENV, policy: PROD, fetchImpl: setup([res(401)]).fetchImpl }),
      await sendEmail(input(), { env: LIVE_ENV, policy: PROD, fetchImpl: setup([new TypeError("x"), res(500), res(500), res(500)]).fetchImpl, sleep: async () => {} }),
      await sendEmail(input({ dataVariables: {} }), { env: LIVE_ENV, policy: PROD, fetchImpl: setup([]).fetchImpl }),
    ];
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    const serialised = JSON.stringify(outcomes);
    for (const secret of [TOKEN, "reader@example.com", "Spring planting plan", "Maya"]) expect(serialised).not.toContain(secret);
  });
});

describe("refusal reasons", () => {
  it("keeps Resend's reason, masking addresses and token-like strings", () => {
    expect(sanitizeProviderError(["Unauthorized: sender ada@example.com not allowed", "key abcdefghijklmnopqrstuvwxyz123456"])).toBe(
      "Unauthorized: sender <email> not allowed; key <redacted>",
    );
    expect(sanitizeProviderError("x".repeat(500))!.length).toBeLessThanOrEqual(200);
    expect(sanitizeProviderError(undefined)).toBeUndefined();
    expect(sanitizeProviderError([42, null])).toBeUndefined();
  });
});
