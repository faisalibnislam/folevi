// Provider selection and the one entry point Convex uses to send a template.
import { EMAIL_SENDING_DOMAIN, emailManifest } from "./manifest";
import { isRecipientAllowed } from "./policy";
import { sendTransactional } from "./providers/loops";
import { MAILTRAP_SANDBOX_ENDPOINT, MAILTRAP_SEND_ENDPOINT, postToMailtrap } from "./providers/mailtrap";
import { EmailRenderError, renderEmail } from "./render";
import type { EmailProviderKind, SendEmailInput, SendOutcome, SendPolicy } from "./types";
import { isPlausibleEmail } from "./validate";

type Env = Record<string, string | undefined>;

export type ProviderSelection =
  | { kind: "mailtrap"; token: string; endpoint: string }
  | { kind: "mailtrap_sandbox"; token: string; endpoint: string }
  /** LEGACY (remove after cutover). */
  | { kind: "loops"; apiKey: string }
  | { kind: "none" };

const INBOX_ID_RE = /^\d{1,12}$/;
const HOSTNAME_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const ATTEMPT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const value = (env: Env, name: string): string | undefined => {
  const v = env[name]?.trim();
  return v && v !== "none" ? v : undefined;
};

/**
 * Which provider sends, in order:
 * 1. Outside production, when MAILTRAP_SANDBOX_INBOX_ID + MAILTRAP_SANDBOX_TOKEN are set: the Mailtrap
 *    sandbox (captured in a test inbox, never delivered). Ignored in production.
 * 2. MAILTRAP_API_TOKEN: Mailtrap's sending API.
 * 3. LEGACY, during the cutover only: LOOPS_API_KEY → Loops (remove after cutover).
 * 4. Otherwise nothing is configured.
 */
export function selectProvider(env: Env, environment: SendPolicy["environment"]): ProviderSelection {
  if (environment !== "production") {
    const inbox = value(env, "MAILTRAP_SANDBOX_INBOX_ID");
    const token = value(env, "MAILTRAP_SANDBOX_TOKEN");
    if (inbox && token && INBOX_ID_RE.test(inbox)) {
      return { kind: "mailtrap_sandbox", token, endpoint: `${MAILTRAP_SANDBOX_ENDPOINT}/${inbox}` };
    }
  }
  const token = value(env, "MAILTRAP_API_TOKEN");
  if (token) return { kind: "mailtrap", token, endpoint: MAILTRAP_SEND_ENDPOINT };
  const loopsKey = value(env, "LOOPS_API_KEY");
  if (loopsKey) return { kind: "loops", apiKey: loopsKey };
  return { kind: "none" };
}

/** The sending domain: EMAIL_SENDING_DOMAIN when it is a plain hostname, else the manifest default. */
export function sendingDomain(env: Env): string {
  const configured = value(env, "EMAIL_SENDING_DOMAIN")?.toLowerCase();
  return configured && HOSTNAME_RE.test(configured) ? configured : EMAIL_SENDING_DOMAIN;
}

/**
 * Sends one template to one recipient.
 *
 * `accepted` means the provider accepted the message for delivery — NOT delivered. Delivery, bounces
 * and complaints only arrive through signed webhooks. The outcome never contains the recipient, the
 * rendered content or any credential, and nothing here logs.
 */
export async function sendEmail(
  input: SendEmailInput,
  opts: {
    env: Env;
    policy: SendPolicy;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    maxAttempts?: number;
    timeoutMs?: number;
  },
): Promise<SendOutcome> {
  const fail = (errorCode: string, provider?: EmailProviderKind): SendOutcome => ({
    status: "failed",
    errorCode,
    retryable: false,
    attempts: 0,
    ...(provider ? { provider } : {}),
  });

  const def = emailManifest[input.key];
  if (!def) return fail("unknown_template");
  const to = typeof input.to === "string" ? input.to.trim() : "";
  if (!isPlausibleEmail(to)) return fail("invalid_recipient");

  const provider = selectProvider(opts.env, opts.policy.environment);
  if (provider.kind === "none") return fail("provider_not_configured");

  if (provider.kind === "loops") {
    // LEGACY (remove after cutover): Loops renders its own copy of the template.
    const outcome = await sendTransactional(
      { key: input.key, to, dataVariables: input.dataVariables, idempotencyKey: input.idempotencyKey.slice(0, 100) },
      { apiKey: provider.apiKey, env: opts.env, policy: opts.policy, fetchImpl: opts.fetchImpl, sleep: opts.sleep, maxAttempts: opts.maxAttempts },
    );
    return { ...outcome, provider: "loops" };
  }

  if (typeof input.attemptId !== "string" || !ATTEMPT_ID_RE.test(input.attemptId)) {
    return fail("invalid_attempt_id", provider.kind);
  }

  let rendered;
  try {
    const brand = value(opts.env, "EMAIL_BRAND_BASE_URL");
    rendered = renderEmail(input.key, input.dataVariables, {
      // A deployment may point the logo elsewhere (e.g. a staging host), but only over https.
      ...(brand && brand.startsWith("https://") ? { brandBaseUrl: brand } : {}),
    });
  } catch (error) {
    if (error instanceof EmailRenderError) return fail("invalid_payload", provider.kind);
    throw error;
  }

  // The sandbox never delivers, so any recipient may be captured there; live sends outside production
  // only go to test or allowlisted addresses.
  if (provider.kind === "mailtrap" && !isRecipientAllowed(to, opts.policy)) {
    return { status: "skipped", errorCode: "recipient_not_allowed", retryable: false, attempts: 0, provider: provider.kind };
  }

  const replyTo = value(opts.env, "EMAIL_REPLY_TO");
  const outcome = await postToMailtrap(
    {
      from: { email: `${def.sender.localPart}@${sendingDomain(opts.env)}`, name: def.sender.name },
      to,
      ...(replyTo && isPlausibleEmail(replyTo) ? { replyTo } : {}),
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      category: input.key,
      customVariables: { attempt: input.attemptId, template: input.key },
    },
    {
      token: provider.token,
      endpoint: provider.endpoint,
      fetchImpl: opts.fetchImpl,
      sleep: opts.sleep,
      maxAttempts: opts.maxAttempts,
      timeoutMs: opts.timeoutMs,
    },
  );
  return { ...outcome, provider: provider.kind };
}
