// Shared types for @folevi/email. Kept free of runtime imports so that
// `manifest.ts` can be loaded directly by Node's type stripping (scripts/).

export type TemplateKey =
  | "auth_verify_email"
  | "auth_password_reset"
  | "security_new_device"
  | "account_deletion_scheduled"
  | "account_deletion_completed"
  | "workspace_invite"
  | "mention_notification"
  | "comment_notification"
  | "comment_digest"
  | "share_notification"
  | "access_changed";

export type TemplateCategory = "identity" | "security" | "product";

export interface VariableSpec {
  type: "string" | "number";
  required: boolean;
  maxLength?: number;
  format?: "url" | "email" | "text" | "code";
  description: string;
}

export interface TemplateDefinition {
  key: TemplateKey;
  category: TemplateCategory;
  subject: string;
  previewText: string;
  /** From: `${localPart}@${EMAIL_SENDING_DOMAIN}` (the domain can be overridden per deployment). */
  sender: { name: string; localPart: string };
  /** false for identity/security (never unsubscribable); product notifications honor Folevi preferences. */
  unsubscribable: boolean;
  /** Folevi-side preference enforced by the caller before sending. */
  preferenceKey?: "mentions" | "comments" | "shares" | "invites" | "digest";
  variables: Record<string, VariableSpec>;
  /** Preview/test data. Fictional; only @example.com addresses. */
  fixture: Record<string, string | number>;
}

export type ValidationResult =
  { ok: true; dataVariables: Record<string, string | number> } | { ok: false; errors: string[] };

/** One template as compiled by scripts/build-templates.ts, with `{{variable}}` placeholders. */
export interface GeneratedTemplate {
  subject: string;
  previewText: string;
  html: string;
  text: string;
}

/** A template with its variables filled in, ready to hand to a provider. */
export interface RenderedEmail {
  subject: string;
  previewText: string;
  html: string;
  text: string;
}

export interface SendPolicy {
  environment: "production" | "preview" | "development" | "test";
  allowlist?: string[];
}

/** Which provider a send went through. */
export type EmailProviderKind = "mailtrap" | "mailtrap_sandbox";

export interface SendEmailInput {
  key: TemplateKey;
  to: string;
  dataVariables: Record<string, unknown>;
  /** Our send-attempt id (emailSendAttempts): sent as a custom variable so webhooks can be matched. */
  attemptId: string;
}

export interface SendOutcome {
  status: "accepted" | "failed" | "skipped";
  provider?: EmailProviderKind;
  httpStatus?: number;
  errorCode?: string;
  retryable: boolean;
  attempts: number;
  /** Provider message id, when the provider returned one with its 2xx response. */
  providerMessageId?: string;
  /** The provider's own reason for a refusal (e.g. Mailtrap's `errors`), with addresses and tokens masked. */
  providerError?: string;
}

// ------------------------------------------------------------------ Mailtrap webhooks

/** Mailtrap event names, normalised (Mailtrap sends e.g. "soft bounce"; we store "soft_bounced"). */
export type MailtrapEventName =
  | "delivered"
  | "soft_bounced"
  | "bounced"
  | "suspended"
  | "unsubscribed"
  | "opened"
  | "clicked"
  | "spam_complaint"
  | "rejected"
  | "other";

/** The fields Folevi keeps from one Mailtrap webhook event (never IPs, user agents, URLs or SMTP text). */
export interface MailtrapEvent {
  eventId: string;
  eventName: MailtrapEventName;
  /** Milliseconds since the epoch. */
  eventTime: number;
  messageId?: string;
  /** Hashed by the caller before storage; never stored or logged as is. */
  recipient?: string;
  /** Our template key (sent as the Mailtrap category). */
  category?: string;
  /** Our attempt id (sent as custom variable `attempt`). */
  attemptId?: string;
  bounceCategory?: string;
  responseCode?: number;
}
