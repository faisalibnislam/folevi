// Provider selection and the one entry point Convex uses to send a template.
import { EMAIL_SENDING_DOMAIN, emailManifest } from "./manifest";
import { isRecipientAllowed } from "./policy";
import { postToResend } from "./providers/resend";
import { EmailRenderError, renderEmail } from "./render";
import type { EmailProviderKind, SendEmailInput, SendOutcome, SendPolicy } from "./types";
import { isPlausibleEmail } from "./validate";

type Env = Record<string, string | undefined>;

export type ProviderSelection = { kind: "resend"; apiKey: string } | { kind: "none" };

const HOSTNAME_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const ATTEMPT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** An RFC 5322 msg-id without the angle brackets: printable, no spaces, no brackets, one "@". */
const MSG_ID_RE = /^[\x21-\x3b\x3d\x3f-\x7e]{1,250}@[\x21-\x3b\x3d\x3f-\x7e]{1,250}$/;

/** `<id@host>` for a plausible message id (with or without brackets), else null. */
export function normaliseMessageId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const bare = value.trim().replace(/^<|>$/g, "");
  return bare.length <= 250 && MSG_ID_RE.test(bare) ? `<${bare}>` : null;
}

/** In-Reply-To / References for a reply, from validated message ids only (at most 10 references). */
export function threadHeaders(thread: SendEmailInput["thread"]): Record<string, string> {
  if (!thread) return {};
  const out: Record<string, string> = {};
  const inReplyTo = normaliseMessageId(thread.inReplyTo);
  if (inReplyTo) out["In-Reply-To"] = inReplyTo;
  const refs = (thread.references ?? []).map(normaliseMessageId).filter((r): r is string => r !== null).slice(-10);
  if (inReplyTo && !refs.includes(inReplyTo)) refs.push(inReplyTo);
  if (refs.length) out.References = refs.join(" ");
  return out;
}

const value = (env: Env, name: string): string | undefined => {
  const v = env[name]?.trim();
  return v && v !== "none" ? v : undefined;
};

/**
 * Which provider sends: Resend when RESEND_API_KEY is set, otherwise nothing is configured. Outside
 * production, live sends only reach test or allowlisted addresses (policy.ts); everything else is skipped.
 */
export function selectProvider(env: Env, _environment: SendPolicy["environment"]): ProviderSelection {
  const apiKey = value(env, "RESEND_API_KEY");
  return apiKey ? { kind: "resend", apiKey } : { kind: "none" };
}

/** The sending domain: EMAIL_SENDING_DOMAIN when it is a plain hostname, else the manifest default. */
export function sendingDomain(env: Env): string {
  const configured = value(env, "EMAIL_SENDING_DOMAIN")?.toLowerCase();
  return configured && HOSTNAME_RE.test(configured) ? configured : EMAIL_SENDING_DOMAIN;
}

/**
 * Sends one template to one recipient.
 *
 * `accepted` means the provider accepted the message for delivery. It does NOT mean delivered. Delivery, bounces
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

  if (typeof input.attemptId !== "string" || !ATTEMPT_ID_RE.test(input.attemptId)) {
    return fail("invalid_attempt_id", provider.kind);
  }

  let rendered;
  try {
    const brand = value(opts.env, "EMAIL_BRAND_BASE_URL");
    const appUrl = value(opts.env, "FOLEVI_APP_URL");
    rendered = renderEmail(input.key, input.dataVariables, {
      // A deployment may point the logo elsewhere (e.g. a staging host), but only over https.
      ...(brand && brand.startsWith("https://") ? { brandBaseUrl: brand } : {}),
      // App-relative links ("/settings/…") resolve against the app origin.
      ...(appUrl && /^https?:\/\//.test(appUrl) ? { appUrl } : {}),
    });
  } catch (error) {
    if (error instanceof EmailRenderError) return fail("invalid_payload", provider.kind);
    throw error;
  }

  // Outside production, live sends only go to test or allowlisted addresses.
  if (!isRecipientAllowed(to, opts.policy)) {
    return { status: "skipped", errorCode: "recipient_not_allowed", retryable: false, attempts: 0, provider: provider.kind };
  }

  // A template may fix its Reply-To (support mail answers to the support mailbox) or have none (staff notices).
  const replyTo = def.replyTo === undefined ? value(opts.env, "EMAIL_REPLY_TO") : (def.replyTo ?? undefined);
  const headers = threadHeaders(input.thread);
  const outcome = await postToResend(
    {
      from: { email: def.sender.address ?? `${def.sender.localPart}@${sendingDomain(opts.env)}`, name: def.sender.name },
      to,
      ...(replyTo && isPlausibleEmail(replyTo) ? { replyTo } : {}),
      ...(Object.keys(headers).length ? { headers } : {}),
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      tags: { template: input.key, attempt: input.attemptId },
    },
    {
      apiKey: provider.apiKey,
      idempotencyKey: `folevi-${input.attemptId}`,
      fetchImpl: opts.fetchImpl,
      sleep: opts.sleep,
      maxAttempts: opts.maxAttempts,
      timeoutMs: opts.timeoutMs,
    },
  );
  return { ...outcome, provider: provider.kind };
}
