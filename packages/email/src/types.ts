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
  /** Name of the env var / secret holding the published Loops transactionalId. */
  envVar: string;
  subject: string;
  previewText: string;
  /** Domain comes from LOOPS_SENDING_DOMAIN (configured in Loops per environment). */
  sender: { name: string; localPart: string };
  replyTo?: string;
  /** false for identity/security (never unsubscribable); product notifications honor Folevi preferences. */
  unsubscribable: boolean;
  /** Folevi-side preference enforced by the caller before sending. */
  preferenceKey?: "mentions" | "comments" | "shares" | "invites" | "digest";
  variables: Record<string, VariableSpec>;
  /** Preview/test data. Fictional; only @example.com addresses. */
  fixture: Record<string, string | number>;
  /** Relative to packages/email. */
  source: { kind: "mjml"; path: string };
}

export type ValidationResult =
  { ok: true; dataVariables: Record<string, string | number> } | { ok: false; errors: string[] };

export interface LoopsSendInput {
  key: TemplateKey;
  to: string;
  dataVariables: Record<string, unknown>;
  idempotencyKey: string;
  addToAudience?: false;
}

export interface LoopsSendOutcome {
  status: "accepted" | "failed" | "skipped";
  httpStatus?: number;
  errorCode?: string;
  retryable: boolean;
  attempts: number;
  /** Provider message id, only when Loops returned one with the 200 response. */
  providerMessageId?: string;
}

export interface SendPolicy {
  environment: "production" | "preview" | "development" | "test";
  allowlist?: string[];
}

export type LoopsWebhookEvent = {
  eventName: string;
  eventTime: number;
  transactionalId?: string;
  emailId?: string;
  recipient?: string;
};
