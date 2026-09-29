import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emailManifest,
  mailtrapRequestBody,
  selectProvider,
  sendEmail,
  sendingDomain,
  type SendEmailInput,
  type SendPolicy,
} from "../src/index";

const TOKEN = "mt_live_token_SECRET_1234567890"; // gitleaks:allow (fake test value)
const SANDBOX_TOKEN = "mt_sandbox_token_SECRET_abcdef"; // gitleaks:allow (fake test value)
const PROD: SendPolicy = { environment: "production" };
const LIVE_ENV = { MAILTRAP_API_TOKEN: TOKEN };

function input(overrides: Partial<SendEmailInput> = {}): SendEmailInput {
  return {
    key: "mention_notification",
    to: "reader@example.com",
    dataVariables: { ...emailManifest.mention_notification.fixture },
    attemptId: "j57abc123def456",
    ...overrides,
  };
}

function res(status: number, body: unknown = status < 300 ? { success: true, message_ids: ["msg-0001-abc"] } : { success: false, errors: ["x"] }, headers: Record<string, string> = {}) {
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
  it("uses Mailtrap when a token is set, else none", () => {
    expect(selectProvider({ MAILTRAP_API_TOKEN: TOKEN }, "production")).toMatchObject({ kind: "mailtrap", endpoint: "https://send.api.mailtrap.io/api/send" });
    expect(selectProvider({}, "production")).toEqual({ kind: "none" });
    expect(selectProvider({ MAILTRAP_API_TOKEN: "none" }, "production")).toEqual({ kind: "none" });
    expect(selectProvider({ MAILTRAP_API_TOKEN: " " }, "production")).toEqual({ kind: "none" });
  });

  it("uses the sandbox outside production when both sandbox values are set", () => {
    const env = { MAILTRAP_API_TOKEN: TOKEN, MAILTRAP_SANDBOX_INBOX_ID: "4242", MAILTRAP_SANDBOX_TOKEN: SANDBOX_TOKEN };
    expect(selectProvider(env, "preview")).toEqual({ kind: "mailtrap_sandbox", token: SANDBOX_TOKEN, endpoint: "https://sandbox.api.mailtrap.io/api/send/4242" });
    expect(selectProvider(env, "development").kind).toBe("mailtrap_sandbox");
    // Never in production.
    expect(selectProvider(env, "production").kind).toBe("mailtrap");
    // Both values are needed, and the inbox id must be numeric.
    expect(selectProvider({ MAILTRAP_API_TOKEN: TOKEN, MAILTRAP_SANDBOX_INBOX_ID: "4242" }, "preview").kind).toBe("mailtrap");
    expect(selectProvider({ MAILTRAP_SANDBOX_INBOX_ID: "../x", MAILTRAP_SANDBOX_TOKEN: SANDBOX_TOKEN }, "preview").kind).toBe("none");
  });

  it("sending domain comes from the manifest unless a valid override is set", () => {
    expect(sendingDomain({})).toBe("mail.folevi.com");
    expect(sendingDomain({ EMAIL_SENDING_DOMAIN: "mail-staging.folevi.com" })).toBe("mail-staging.folevi.com");
    expect(sendingDomain({ EMAIL_SENDING_DOMAIN: "evil.com>\r\nBcc: x" })).toBe("mail.folevi.com");
  });
});

describe("sendEmail via Mailtrap", () => {
  it("posts the documented request body once and returns the message id", async () => {
    const { fetchImpl, calls, sleep } = setup([res(200)]);
    const out = await sendEmail(input(), { env: { ...LIVE_ENV, EMAIL_REPLY_TO: "support@folevi.com" }, policy: PROD, fetchImpl, sleep });
    expect(out).toEqual({ status: "accepted", provider: "mailtrap", httpStatus: 200, retryable: false, attempts: 1, providerMessageId: "msg-0001-abc" });
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0]!;
    expect(url).toBe("https://send.api.mailtrap.io/api/send");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(String(init.body));
    expect(Object.keys(body).sort()).toEqual(["category", "custom_variables", "from", "html", "reply_to", "subject", "text", "to"]);
    expect(body.from).toEqual({ email: "hello@mail.folevi.com", name: "Folevi" });
    expect(body.to).toEqual([{ email: "reader@example.com" }]);
    expect(body.reply_to).toEqual({ email: "support@folevi.com" });
    expect(body.subject).toBe("You were mentioned in Folevi");
    expect(body.category).toBe("mention_notification");
    // Opaque ids only — no personal data in custom variables (they come back in webhooks).
    expect(body.custom_variables).toEqual({ attempt: "j57abc123def456", template: "mention_notification" });
    expect(body.html).toContain("Maya Okafor");
    expect(body.text).toContain("Maya Okafor mentioned you on Spring planting plan.");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("uses the security sender for identity/security mail and omits reply_to when unset", async () => {
    const { fetchImpl, calls } = setup([res(200)]);
    await sendEmail(input({ key: "auth_password_reset", dataVariables: { ...emailManifest.auth_password_reset.fixture } }), { env: LIVE_ENV, policy: PROD, fetchImpl });
    const body = JSON.parse(String(calls[0]![1].body));
    expect(body.from).toEqual({ email: "security@mail.folevi.com", name: "Folevi" });
    expect(body).not.toHaveProperty("reply_to");
    expect(mailtrapRequestBody({ from: { email: "a@b.co", name: "F" }, to: "c@d.co", subject: "s", text: "t", html: "h", category: "k", customVariables: {} })).not.toHaveProperty("reply_to");
  });

  it("retries 429 (honouring Retry-After) and 5xx with the same body", async () => {
    const { fetchImpl, calls, sleep } = setup([res(429, { success: false }, { "retry-after": "2" }), res(503), res(200)]);
    const out = await sendEmail(input(), { env: LIVE_ENV, policy: PROD, fetchImpl, sleep });
    expect(out).toMatchObject({ status: "accepted", attempts: 3, providerMessageId: "msg-0001-abc" });
    expect(calls).toHaveLength(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 2000);
    expect(calls[0]![1].body).toBe(calls[2]![1].body);
  });

  it("stops after maxAttempts on persistent 5xx", async () => {
    const { fetchImpl, calls, sleep } = setup([res(500), res(502), res(500), res(500)]);
    const out = await sendEmail(input(), { env: LIVE_ENV, policy: PROD, fetchImpl, sleep, maxAttempts: 3 });
    expect(out).toEqual({ status: "failed", provider: "mailtrap", httpStatus: 500, errorCode: "provider_server_error", retryable: true, attempts: 3, providerError: "x" });
    expect(calls).toHaveLength(3);
    for (const [ms] of sleep.mock.calls as unknown as Array<[number]>) expect(ms).toBeLessThanOrEqual(8000);
  });

  it.each([
    [400, "provider_rejected"],
    [401, "unauthorized"],
    [403, "unauthorized"],
    [404, "provider_rejected"],
    [422, "provider_rejected"],
  ])("does not retry %s", async (status, code) => {
    const { fetchImpl, calls } = setup([res(status), res(200)]);
    const out = await sendEmail(input(), { env: LIVE_ENV, policy: PROD, fetchImpl, sleep: async () => {} });
    expect(out).toMatchObject({ status: "failed", httpStatus: status, errorCode: code, retryable: false, attempts: 1 });
    expect(calls).toHaveLength(1);
  });

  it("treats a 200 with success:false as rejected", async () => {
    const { fetchImpl } = setup([res(200, { success: false, errors: ["nope"] })]);
    const out = await sendEmail(input(), { env: LIVE_ENV, policy: PROD, fetchImpl });
    expect(out).toMatchObject({ status: "failed", errorCode: "provider_rejected" });
  });

  it("retries connection errors but never a timeout (it may have been accepted: no double send)", async () => {
    const a = setup([new TypeError("fetch failed"), res(200)]);
    expect(await sendEmail(input(), { env: LIVE_ENV, policy: PROD, fetchImpl: a.fetchImpl, sleep: async () => {} })).toMatchObject({ status: "accepted", attempts: 2 });
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const b = setup([abort, res(200)]);
    expect(await sendEmail(input(), { env: LIVE_ENV, policy: PROD, fetchImpl: b.fetchImpl, sleep: async () => {} })).toMatchObject({ status: "failed", errorCode: "timeout", retryable: false });
    expect(b.calls).toHaveLength(1);
  });

  it("aborts a hung request after the timeout", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
    );
    const out = await sendEmail(input(), { env: LIVE_ENV, policy: PROD, fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 5 });
    expect(out).toMatchObject({ status: "failed", errorCode: "timeout" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid variables before calling Mailtrap", async () => {
    const { fetchImpl, calls } = setup([res(200)]);
    const out = await sendEmail(input({ dataVariables: { ...emailManifest.mention_notification.fixture, documentUrl: "javascript:alert(1)" } }), { env: LIVE_ENV, policy: PROD, fetchImpl });
    expect(out).toEqual({ status: "failed", errorCode: "invalid_payload", retryable: false, attempts: 0, provider: "mailtrap" });
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
    expect(out).toEqual({ status: "skipped", errorCode: "recipient_not_allowed", retryable: false, attempts: 0, provider: "mailtrap" });
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

  it("captures everything in the sandbox (never delivered), with the sandbox token", async () => {
    const { fetchImpl, calls } = setup([res(200)]);
    const env = { ...LIVE_ENV, MAILTRAP_SANDBOX_INBOX_ID: "4242", MAILTRAP_SANDBOX_TOKEN: SANDBOX_TOKEN };
    const out = await sendEmail(input({ to: "someone@gmail.com" }), { env, policy: { environment: "preview" }, fetchImpl });
    expect(out).toMatchObject({ status: "accepted", provider: "mailtrap_sandbox" });
    expect(calls[0]![0]).toBe("https://sandbox.api.mailtrap.io/api/send/4242");
    expect((calls[0]![1].headers as Record<string, string>).Authorization).toBe(`Bearer ${SANDBOX_TOKEN}`);
    expect(JSON.stringify(calls[0]![1].headers)).not.toContain(TOKEN);
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

describe("Mailtrap refusal reasons", () => {
  it("keeps Mailtrap's reason, masking addresses and token-like strings", async () => {
    const { sanitizeProviderError } = await import("../src/providers/mailtrap");
    expect(sanitizeProviderError(["Unauthorized: sender ada@example.com not allowed", "key abcdefghijklmnopqrstuvwxyz123456"])).toBe(
      "Unauthorized: sender <email> not allowed; key <redacted>",
    );
    expect(sanitizeProviderError("x".repeat(500))!.length).toBeLessThanOrEqual(200);
    expect(sanitizeProviderError(undefined)).toBeUndefined();
    expect(sanitizeProviderError([42, null])).toBeUndefined();
  });
});
