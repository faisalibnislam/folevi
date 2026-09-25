import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH0_MESSAGE_TYPE_TO_TEMPLATE, emailManifest, type TemplateKey } from "../src/index";

const require = createRequire(import.meta.url);

type Api = Record<string, Record<string, ReturnType<typeof vi.fn>>>;
type Handler = (event: unknown, api: unknown) => Promise<void>;

const emailAction = require("../../../infra/auth0/actions/custom-email-provider.js") as {
  onExecuteCustomEmailProvider: Handler;
  _internals: {
    MESSAGE_TYPE_TO_TEMPLATE: Record<string, TemplateKey | null>;
    TEMPLATE_ENV: Record<string, string>;
    extractActionLink: (
      t: string,
      n: { text?: string; html?: string },
      hosts: string[],
    ) => string | null;
    idempotencyKey: (a: string, b: string, c: string) => string;
  };
};
const loginAction = require("../../../infra/auth0/actions/post-login.js") as {
  onExecutePostLogin: Handler;
};

const SECRETS = {
  LOOPS_API_KEY: "loops_test_key",
  AUTH0_LINK_HOSTS: "auth.folevi.com, folevi.us.auth0.com",
  FOLEVI_EMAIL_ALLOWLIST_MODE: "off",
  LOOPS_TRANSACTIONAL_AUTH_VERIFY_EMAIL_ID: "clverify",
  LOOPS_TRANSACTIONAL_AUTH_PASSWORD_RESET_ID: "clreset",
  LOOPS_TRANSACTIONAL_AUTH_BLOCKED_ACCOUNT_ID: "clblocked",
  LOOPS_TRANSACTIONAL_AUTH_BREACHED_PASSWORD_ID: "clbreached",
  LOOPS_TRANSACTIONAL_AUTH_VERIFICATION_CODE_ID: "clcode",
};

const VERIFY_LINK = "https://auth.folevi.com/u/email-verification?ticket=TICKET123#";

function emailEvent(overrides: Record<string, unknown> = {}, secrets: Record<string, string> = {}) {
  return {
    notification: {
      message_type: "verify_email",
      to: "new.user@example.com",
      from: "security@mail.folevi.com",
      subject: "Verify your email",
      text: `Hi! Please verify: ${VERIFY_LINK}\nThanks, Folevi`,
      html: `<p><a href="${VERIFY_LINK}">Confirm email address</a></p>`,
      locale: "en",
      ...overrides,
    },
    user: { user_id: "auth0|abc123", email: "new.user@example.com" },
    secrets: { ...SECRETS, ...secrets },
  };
}

function emailApi() {
  return { notification: { drop: vi.fn(), retry: vi.fn() }, cache: { get: vi.fn(), set: vi.fn() } };
}

let fetchMock: ReturnType<typeof vi.fn>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response('{"success":true}', { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  logSpy.mockRestore();
});

function sentBody(): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]![1] as RequestInit;
  return JSON.parse(String(init.body));
}

describe("custom-email-provider action", () => {
  it("mapping matches @folevi/email exactly", () => {
    expect(emailAction._internals.MESSAGE_TYPE_TO_TEMPLATE).toEqual(AUTH0_MESSAGE_TYPE_TO_TEMPLATE);
    for (const [key, envVar] of Object.entries(emailAction._internals.TEMPLATE_ENV)) {
      expect(emailManifest[key as TemplateKey].envVar).toBe(envVar);
    }
    for (const target of Object.values(AUTH0_MESSAGE_TYPE_TO_TEMPLATE)) {
      if (target) expect(emailAction._internals.TEMPLATE_ENV[target]).toBeDefined();
    }
  });

  it("sends verify_email through Loops with the extracted link", async () => {
    const api = emailApi();
    await emailAction.onExecuteCustomEmailProvider(emailEvent(), api);
    expect(api.notification.drop).not.toHaveBeenCalled();
    expect(api.notification.retry).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://app.loops.so/api/v1/transactional");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer loops_test_key");
    expect(headers["Idempotency-Key"]).toMatch(/^auth0-[0-9a-f]{64}$/);
    expect(headers["Idempotency-Key"]!.length).toBeLessThanOrEqual(100);
    expect(sentBody()).toEqual({
      transactionalId: "clverify",
      email: "new.user@example.com",
      addToAudience: false,
      dataVariables: { actionUrl: VERIFY_LINK, expiresInHours: 24 },
    });
  });

  it("uses a stable idempotency key across Auth0 retries", async () => {
    await emailAction.onExecuteCustomEmailProvider(emailEvent(), emailApi());
    await emailAction.onExecuteCustomEmailProvider(emailEvent(), emailApi());
    const k1 = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    const k2 = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(k1["Idempotency-Key"]).toBe(k2["Idempotency-Key"]);
  });

  it("never logs the link or the full address", async () => {
    await emailAction.onExecuteCustomEmailProvider(emailEvent(), emailApi());
    const logged = logSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(logged).not.toContain("TICKET123");
    expect(logged).not.toContain("new.user@example.com");
    expect(logged).toContain("n***@e***.com");
  });

  it.each([
    ["foreign host", "https://evil.example.com/u/email-verification?ticket=x"],
    ["lookalike host", "https://auth.folevi.com.evil.example/u/email-verification?ticket=x"],
    ["http scheme", "http://auth.folevi.com/u/email-verification?ticket=x"],
    ["unknown path", "https://auth.folevi.com/authorize?client_id=x"],
    ["reset path on verify email", "https://auth.folevi.com/u/reset-verify?ticket=x"],
    ["no query", "https://auth.folevi.com/u/email-verification"],
    ["explicit port", "https://auth.folevi.com:8443/u/email-verification?ticket=x"],
    ["userinfo", "https://user@auth.folevi.com/u/email-verification?ticket=x"],
  ])("drops when the only link is a %s", async (_label, link) => {
    const api = emailApi();
    await emailAction.onExecuteCustomEmailProvider(
      emailEvent({ text: `Verify: ${link}`, html: "" }),
      api,
    );
    expect(api.notification.drop).toHaveBeenCalledWith("link_not_found");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("drops when two distinct valid links are present (ambiguous)", async () => {
    const api = emailApi();
    const text = `${VERIFY_LINK}\nhttps://auth.folevi.com/u/email-verification?ticket=OTHER`;
    await emailAction.onExecuteCustomEmailProvider(emailEvent({ text, html: "" }), api);
    expect(api.notification.drop).toHaveBeenCalledWith("link_not_found");
  });

  it("falls back to the html part and decodes entities", () => {
    const link = emailAction._internals.extractActionLink(
      "reset_email",
      {
        text: "",
        html: '<a href="https://folevi.us.auth0.com/u/reset-verify?ticket=a&amp;x=1#">Reset</a>',
      },
      ["folevi.us.auth0.com"],
    );
    expect(link).toBe("https://folevi.us.auth0.com/u/reset-verify?ticket=a&x=1#");
  });

  it("sends code-based verification with the code only", async () => {
    await emailAction.onExecuteCustomEmailProvider(
      emailEvent({
        message_type: "verify_email_by_code",
        text: "Your code is 482913. © 2026 Folevi",
        html: "",
      }),
      emailApi(),
    );
    expect(sentBody()).toMatchObject({
      transactionalId: "clcode",
      dataVariables: { code: "482913", expiresInMinutes: 10 },
    });
  });

  it.each([
    "welcome_email",
    "mfa_oob_code",
    "enrollment_email",
    "verification_code",
    "organization_invitation",
  ])("drops %s intentionally", async (messageType) => {
    const api = emailApi();
    await emailAction.onExecuteCustomEmailProvider(emailEvent({ message_type: messageType }), api);
    expect(api.notification.drop).toHaveBeenCalledWith("message_type_not_sent");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handles the dashboard test email as a configuration check", async () => {
    const api = emailApi();
    await emailAction.onExecuteCustomEmailProvider(
      emailEvent({ message_type: "try_provider_configuration_email" }),
      api,
    );
    expect(api.notification.drop).toHaveBeenCalledWith("provider_test_ok");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("drops unknown message types", async () => {
    const api = emailApi();
    await emailAction.onExecuteCustomEmailProvider(
      emailEvent({ message_type: "something_new" }),
      api,
    );
    expect(api.notification.drop).toHaveBeenCalledWith("unknown_message_type");
  });

  it("enforces the test-domain allowlist (and fails closed when the mode is unset)", async () => {
    const api1 = emailApi();
    await emailAction.onExecuteCustomEmailProvider(
      emailEvent({ to: "person@gmail.com" }, { FOLEVI_EMAIL_ALLOWLIST_MODE: "test-domains" }),
      api1,
    );
    expect(api1.notification.drop).toHaveBeenCalledWith("recipient_not_allowed");

    const unset = emailEvent({ to: "person@gmail.com" });
    delete (unset.secrets as Record<string, string>).FOLEVI_EMAIL_ALLOWLIST_MODE;
    const api2 = emailApi();
    await emailAction.onExecuteCustomEmailProvider(unset, api2);
    expect(api2.notification.drop).toHaveBeenCalledWith("recipient_not_allowed");

    const api3 = emailApi();
    await emailAction.onExecuteCustomEmailProvider(
      emailEvent({ to: "qa@test.com" }, { FOLEVI_EMAIL_ALLOWLIST_MODE: "test-domains" }),
      api3,
    );
    expect(api3.notification.drop).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([429, 500, 503])("asks Auth0 to retry on %s", async (status) => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status }));
    const api = emailApi();
    await emailAction.onExecuteCustomEmailProvider(emailEvent(), api);
    expect(api.notification.retry).toHaveBeenCalledWith(`loops_http_${status}`);
    expect(api.notification.drop).not.toHaveBeenCalled();
  });

  it("asks Auth0 to retry on network errors", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const api = emailApi();
    await emailAction.onExecuteCustomEmailProvider(emailEvent(), api);
    expect(api.notification.retry).toHaveBeenCalledWith("loops_network_error");
  });

  it.each([400, 404, 409])("drops on %s", async (status) => {
    fetchMock.mockResolvedValueOnce(new Response('{"success":false}', { status }));
    const api = emailApi();
    await emailAction.onExecuteCustomEmailProvider(emailEvent(), api);
    expect(api.notification.drop).toHaveBeenCalledWith(`loops_http_${status}`);
    expect(api.notification.retry).not.toHaveBeenCalled();
  });

  it("drops when the template id secret is missing", async () => {
    const api = emailApi();
    await emailAction.onExecuteCustomEmailProvider(
      emailEvent({}, { LOOPS_TRANSACTIONAL_AUTH_VERIFY_EMAIL_ID: "" }),
      api,
    );
    expect(api.notification.drop).toHaveBeenCalledWith("template_not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the first-party reset URL only for stolen_credentials without a link", async () => {
    const api = emailApi();
    await emailAction.onExecuteCustomEmailProvider(
      emailEvent(
        {
          message_type: "stolen_credentials",
          text: "Your password was found in a breach.",
          html: "",
        },
        { FOLEVI_PASSWORD_RESET_URL: "https://app.folevi.com/forgot-password" },
      ),
      api,
    );
    expect(sentBody()).toMatchObject({
      transactionalId: "clbreached",
      dataVariables: { actionUrl: "https://app.folevi.com/forgot-password", expiresInHours: 24 },
    });
  });

  it("maps reset_email to the reset template with its TTL", async () => {
    await emailAction.onExecuteCustomEmailProvider(
      emailEvent(
        {
          message_type: "reset_email",
          text: "Reset: https://auth.folevi.com/u/reset-verify?ticket=R1#",
          html: "",
        },
        { AUTH0_RESET_PASSWORD_TTL_HOURS: "2" },
      ),
      emailApi(),
    );
    expect(sentBody()).toMatchObject({
      transactionalId: "clreset",
      dataVariables: {
        actionUrl: "https://auth.folevi.com/u/reset-verify?ticket=R1#",
        expiresInHours: 2,
      },
    });
  });
});

function loginEvent(
  overrides: {
    user?: Record<string, unknown>;
    methods?: Array<{ name: string }>;
    protocol?: string;
  } = {},
) {
  return {
    user: {
      user_id: "auth0|abc123",
      email: "reader@example.com",
      email_verified: true,
      app_metadata: {},
      enrolledFactors: [{ type: "otp" }],
      ...overrides.user,
    },
    authentication: {
      methods: overrides.methods ?? [{ name: "pwd", timestamp: "2026-09-25T10:00:00Z" }],
    },
    transaction: { protocol: overrides.protocol ?? "oidc-basic-profile" },
    stats: { logins_count: 3 },
  };
}

function loginApi(): Api {
  return {
    access: { deny: vi.fn() },
    multifactor: { enable: vi.fn() },
    authentication: { enrollWith: vi.fn(), challengeWith: vi.fn() },
    idToken: { setCustomClaim: vi.fn() },
  };
}

function claims(api: Api): Record<string, unknown> {
  return Object.fromEntries(api.idToken!.setCustomClaim!.mock.calls.map((c) => [c[0], c[1]]));
}

describe("post-login action", () => {
  it("denies suspended users", async () => {
    const api = loginApi();
    await loginAction.onExecutePostLogin(
      loginEvent({ user: { app_metadata: { folevi_suspended: true } } }),
      api,
    );
    expect(api.access!.deny).toHaveBeenCalledWith(expect.stringMatching(/^account_suspended:/));
    expect(api.multifactor!.enable).not.toHaveBeenCalled();
  });

  it("denies unverified users with a clear message", async () => {
    const api = loginApi();
    await loginAction.onExecutePostLogin(loginEvent({ user: { email_verified: false } }), api);
    expect(api.access!.deny).toHaveBeenCalledWith(
      expect.stringMatching(/^email_not_verified: .*verify-email/),
    );
    expect(api.idToken!.setCustomClaim).not.toHaveBeenCalled();
  });

  it("forces OTP enrollment for users without OTP", async () => {
    const api = loginApi();
    await loginAction.onExecutePostLogin(loginEvent({ user: { enrolledFactors: [] } }), api);
    expect(api.authentication!.enrollWith).toHaveBeenCalledWith({ type: "otp" });
    expect(api.multifactor!.enable).not.toHaveBeenCalled();
    expect(claims(api)).toEqual({
      "https://folevi.com/email_verified": true,
      "https://folevi.com/mfa": true,
    });
  });

  it("challenges enrolled users, allowing remembered browsers", async () => {
    const api = loginApi();
    await loginAction.onExecutePostLogin(loginEvent(), api);
    expect(api.multifactor!.enable).toHaveBeenCalledWith("any", { allowRememberBrowser: true });
    expect(api.access!.deny).not.toHaveBeenCalled();
  });

  it("does not re-challenge when MFA already happened in this session", async () => {
    const api = loginApi();
    await loginAction.onExecutePostLogin(
      loginEvent({ methods: [{ name: "pwd" }, { name: "mfa" }] }),
      api,
    );
    expect(api.multifactor!.enable).not.toHaveBeenCalled();
    expect(claims(api)["https://folevi.com/mfa"]).toBe(true);
  });

  it("never prompts MFA on refresh-token exchange; claim reflects enrollment", async () => {
    const api = loginApi();
    await loginAction.onExecutePostLogin(loginEvent({ protocol: "oauth2-refresh-token" }), api);
    expect(api.multifactor!.enable).not.toHaveBeenCalled();
    expect(api.authentication!.enrollWith).not.toHaveBeenCalled();
    expect(claims(api)["https://folevi.com/mfa"]).toBe(true);

    const api2 = loginApi();
    await loginAction.onExecutePostLogin(
      loginEvent({ protocol: "oauth2-refresh-token", user: { enrolledFactors: [] } }),
      api2,
    );
    expect(claims(api2)["https://folevi.com/mfa"]).toBe(false);
  });

  it("still denies suspended users on refresh", async () => {
    const api = loginApi();
    await loginAction.onExecutePostLogin(
      loginEvent({
        protocol: "oauth2-refresh-token",
        user: { app_metadata: { folevi_suspended: true } },
      }),
      api,
    );
    expect(api.access!.deny).toHaveBeenCalled();
  });
});
