import { describe, expect, it, vi } from "vitest";
import {
  emailManifest,
  sendTransactional,
  type LoopsSendInput,
  type SendPolicy,
} from "../src/index";

const ENV = { [emailManifest.mention_notification.envVar]: "cltemplate123" };
const PROD: SendPolicy = { environment: "production" };

function input(overrides: Partial<LoopsSendInput> = {}): LoopsSendInput {
  return {
    key: "mention_notification",
    to: "reader@example.com",
    dataVariables: { ...emailManifest.mention_notification.fixture },
    idempotencyKey: "mention:evt_123",
    ...overrides,
  };
}

function res(
  status: number,
  body: unknown = status === 200 ? { success: true } : { success: false, message: "x" },
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function setup(responses: Array<Response | Error>) {
  const fetchImpl = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  });
  const sleep = vi.fn(async () => {});
  return {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    calls: fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>,
    sleep,
  };
}

describe("sendTransactional", () => {
  it("sends once and reports accepted", async () => {
    const { fetchImpl, calls, sleep } = setup([res(200)]);
    const out = await sendTransactional(input(), {
      apiKey: "key_live",
      env: ENV,
      policy: PROD,
      fetchImpl,
      sleep,
    });
    expect(out).toEqual({ status: "accepted", httpStatus: 200, retryable: false, attempts: 1 });
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0]!;
    expect(url).toBe("https://app.loops.so/api/v1/transactional");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer key_live");
    expect(headers["Idempotency-Key"]).toBe("mention:evt_123");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      transactionalId: "cltemplate123",
      email: "reader@example.com",
      addToAudience: false,
    });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("never sends booleans or null in dataVariables; addToAudience is always false", async () => {
    const { fetchImpl, calls } = setup([res(200)]);
    const vars = { ...emailManifest.mention_notification.fixture } as Record<string, unknown>;
    delete vars.excerpt;
    await sendTransactional(input({ dataVariables: vars }), {
      apiKey: "k",
      env: ENV,
      policy: PROD,
      fetchImpl,
      sleep: async () => {},
    });
    const body = JSON.parse(String(calls[0]![1].body));
    expect(body.addToAudience).toBe(false);
    for (const v of Object.values(body.dataVariables))
      expect(["string", "number"]).toContain(typeof v);
    expect(body.dataVariables.excerpt).toBe("");
  });

  it("rejects a boolean variable before calling Loops", async () => {
    const { fetchImpl, calls } = setup([res(200)]);
    const out = await sendTransactional(
      input({ dataVariables: { ...emailManifest.mention_notification.fixture, excerpt: false } }),
      {
        apiKey: "k",
        env: ENV,
        policy: PROD,
        fetchImpl,
      },
    );
    expect(out).toEqual({
      status: "failed",
      errorCode: "invalid_payload",
      retryable: false,
      attempts: 0,
    });
    expect(calls).toHaveLength(0);
  });

  it("retries 429 then succeeds, honouring Retry-After", async () => {
    const { fetchImpl, calls, sleep } = setup([
      res(429, { success: false }, { "retry-after": "2" }),
      res(200),
    ]);
    const out = await sendTransactional(input(), {
      apiKey: "k",
      env: ENV,
      policy: PROD,
      fetchImpl,
      sleep,
    });
    expect(out).toMatchObject({ status: "accepted", attempts: 2 });
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(2000);
    // Same idempotency key and body on the retry.
    expect(calls[0]![1].body).toBe(calls[1]![1].body);
    expect((calls[1]![1].headers as Record<string, string>)["Idempotency-Key"]).toBe(
      "mention:evt_123",
    );
  });

  it("stops after maxAttempts on persistent 5xx with bounded backoff", async () => {
    const { fetchImpl, calls, sleep } = setup([res(503), res(502), res(500), res(500), res(500)]);
    const out = await sendTransactional(input(), {
      apiKey: "k",
      env: ENV,
      policy: PROD,
      fetchImpl,
      sleep,
      maxAttempts: 3,
    });
    expect(out).toEqual({
      status: "failed",
      httpStatus: 500,
      errorCode: "loops_server_error",
      retryable: true,
      attempts: 3,
    });
    expect(calls).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    for (const [ms] of sleep.mock.calls as unknown as Array<[number]>) {
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(8000);
    }
  });

  it("defaults to 4 attempts", async () => {
    const { fetchImpl, calls, sleep } = setup([res(500), res(500), res(500), res(500), res(500)]);
    const out = await sendTransactional(input(), {
      apiKey: "k",
      env: ENV,
      policy: PROD,
      fetchImpl,
      sleep,
    });
    expect(out.attempts).toBe(4);
    expect(calls).toHaveLength(4);
  });

  it("retries network errors", async () => {
    const { fetchImpl, calls, sleep } = setup([new TypeError("fetch failed"), res(200)]);
    const out = await sendTransactional(input(), {
      apiKey: "k",
      env: ENV,
      policy: PROD,
      fetchImpl,
      sleep,
    });
    expect(out).toMatchObject({ status: "accepted", attempts: 2 });
    expect(calls).toHaveLength(2);
  });

  it("does not retry 400", async () => {
    const { fetchImpl, calls } = setup([res(400), res(200)]);
    const out = await sendTransactional(input(), {
      apiKey: "k",
      env: ENV,
      policy: PROD,
      fetchImpl,
      sleep: async () => {},
    });
    expect(out).toEqual({
      status: "failed",
      httpStatus: 400,
      errorCode: "loops_rejected",
      retryable: false,
      attempts: 1,
    });
    expect(calls).toHaveLength(1);
  });

  it("does not retry 404", async () => {
    const { fetchImpl, calls } = setup([res(404), res(200)]);
    const out = await sendTransactional(input(), {
      apiKey: "k",
      env: ENV,
      policy: PROD,
      fetchImpl,
      sleep: async () => {},
    });
    expect(out).toMatchObject({
      status: "failed",
      errorCode: "template_not_found",
      retryable: false,
    });
    expect(calls).toHaveLength(1);
  });

  it("treats 409 as a non-retryable idempotency conflict", async () => {
    const { fetchImpl, calls } = setup([res(409), res(200)]);
    const out = await sendTransactional(input(), {
      apiKey: "k",
      env: ENV,
      policy: PROD,
      fetchImpl,
      sleep: async () => {},
    });
    expect(out).toEqual({
      status: "failed",
      httpStatus: 409,
      errorCode: "idempotency_conflict",
      retryable: false,
      attempts: 1,
    });
    expect(calls).toHaveLength(1);
  });

  it("fails with template_not_configured when the env var is missing", async () => {
    const { fetchImpl, calls } = setup([res(200)]);
    const out = await sendTransactional(input(), { apiKey: "k", env: {}, policy: PROD, fetchImpl });
    expect(out).toEqual({
      status: "failed",
      errorCode: "template_not_configured",
      retryable: false,
      attempts: 0,
    });
    expect(calls).toHaveLength(0);
  });

  it("non-production policy skips real addresses", async () => {
    const { fetchImpl, calls } = setup([res(200)]);
    const out = await sendTransactional(input({ to: "someone@gmail.com" }), {
      apiKey: "k",
      env: ENV,
      policy: { environment: "preview" },
      fetchImpl,
    });
    expect(out).toEqual({
      status: "skipped",
      errorCode: "recipient_not_allowed",
      retryable: false,
      attempts: 0,
    });
    expect(calls).toHaveLength(0);
  });

  it.each(["qa@example.com", "QA@Test.com"])("non-production policy allows %s", async (to) => {
    const { fetchImpl, calls } = setup([res(200)]);
    const out = await sendTransactional(input({ to }), {
      apiKey: "k",
      env: ENV,
      policy: { environment: "development" },
      fetchImpl,
    });
    expect(out.status).toBe("accepted");
    expect(calls).toHaveLength(1);
  });

  it("non-production policy allows exact allowlisted addresses only", async () => {
    const policy: SendPolicy = { environment: "test", allowlist: ["founder@folevi.com"] };
    const a = setup([res(200)]);
    expect(
      (
        await sendTransactional(input({ to: "Founder@folevi.com" }), {
          apiKey: "k",
          env: ENV,
          policy,
          fetchImpl: a.fetchImpl,
        })
      ).status,
    ).toBe("accepted");
    const b = setup([res(200)]);
    expect(
      (
        await sendTransactional(input({ to: "other@folevi.com" }), {
          apiKey: "k",
          env: ENV,
          policy,
          fetchImpl: b.fetchImpl,
        })
      ).status,
    ).toBe("skipped");
    const c = setup([res(200)]);
    expect(
      (
        await sendTransactional(input({ to: "x@sub.example.com" }), {
          apiKey: "k",
          env: ENV,
          policy,
          fetchImpl: c.fetchImpl,
        })
      ).status,
    ).toBe("skipped");
  });

  it("rejects invalid idempotency keys and recipients", async () => {
    const { fetchImpl } = setup([]);
    const opts = { apiKey: "k", env: ENV, policy: PROD, fetchImpl };
    expect(
      (await sendTransactional(input({ idempotencyKey: "x".repeat(101) }), opts)).errorCode,
    ).toBe("invalid_idempotency_key");
    expect((await sendTransactional(input({ idempotencyKey: "" }), opts)).errorCode).toBe(
      "invalid_idempotency_key",
    );
    expect((await sendTransactional(input({ to: "not-an-email" }), opts)).errorCode).toBe(
      "invalid_recipient",
    );
  });

  it("never returns the payload or recipient", async () => {
    const { fetchImpl } = setup([res(400)]);
    const out = await sendTransactional(input(), {
      apiKey: "k",
      env: ENV,
      policy: PROD,
      fetchImpl,
    });
    const serialised = JSON.stringify(out);
    expect(serialised).not.toContain("reader@example.com");
    expect(serialised).not.toContain("Spring planting plan");
  });
});
