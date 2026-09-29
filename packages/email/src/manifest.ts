// Source of truth for every transactional email Folevi sends (through Mailtrap; Loops only as a
// legacy fallback during the cutover).
//
// Each entry is one template. Its copy and layout live in scripts/build-templates.ts, which compiles
// every template to final HTML + plain text in src/generated/templates.ts (with `{{variable}}`
// placeholders); `renderEmail()` fills them in at send time. See docs/EMAIL_OPERATIONS.md.
//
// Rules:
// - Identity/security templates are never unsubscribable and carry no marketing footer.
// - Product notifications honor Folevi-side preferences (`preferenceKey`) and always link
//   to `preferencesUrl`.
// - Variables are deliberately minimal: never note bodies or comment text (not even excerpts),
//   TOTP secrets, backup codes, passwords or tokens beyond the single action link.
// - Subjects are static on purpose: user-controlled strings (names, titles) never appear
//   in a subject line, which limits spoofing/phishing via crafted display names.
//
// This file must only use `import type` so Node can load it with type stripping.

import type { TemplateDefinition, TemplateKey } from "./types";

const SECURITY_SENDER = { name: "Folevi", localPart: "security" } as const;
const PRODUCT_SENDER = { name: "Folevi", localPart: "hello" } as const;

const url = (description: string, required = true) =>
  ({ type: "string", required, format: "url", maxLength: 2048, description }) as const;
const text = (description: string, maxLength: number, required = true) =>
  ({ type: "string", required, format: "text", maxLength, description }) as const;
const num = (description: string) => ({ type: "number", required: true, description }) as const;

const FIX_APP = "https://app.folevi.com";

/** Default sending domain (From: security@… / hello@…). Deployments may override it with EMAIL_SENDING_DOMAIN. */
export const EMAIL_SENDING_DOMAIN = "mail.folevi.com";

/**
 * Where emails load the logo from: the only images an email may contain. Written by
 * packages/design-tokens/scripts/brand-icons.mjs into apps/web/public/brand/email/ and served by the
 * marketing site. Previews point it at the local files instead (renderEmail's `brandBaseUrl`).
 */
export const EMAIL_BRAND_BASE_URL = "https://folevi.com/brand/email";
export const EMAIL_LOGO = {
  light: "folevi-logo@2x.png",
  dark: "folevi-logo-dark@2x.png",
  /** Display size (the files are 2x). */
  width: 120,
  height: 30,
} as const;

const definitions: Record<TemplateKey, TemplateDefinition> = {
  auth_verify_email: {
    key: "auth_verify_email",
    category: "identity",
    subject: "Confirm your email for Folevi",
    previewText: "Confirm this address to finish setting up your Folevi account.",
    sender: SECURITY_SENDER,
    unsubscribable: false,
    variables: {
      actionUrl: url(
        "Email-verification link from Folevi's own sign-in (Better Auth on Convex, served under the app host).",
      ),
      expiresInHours: num(
        "Hours until the link expires (matches the verification token lifetime).",
      ),
    },
    fixture: {
      actionUrl: `${FIX_APP}/api/auth/verify-email?token=EXAMPLEtoken123&callbackURL=%2Fonboarding`,
      expiresInHours: 24,
    },
  },
  auth_password_reset: {
    key: "auth_password_reset",
    category: "identity",
    subject: "Reset your Folevi password",
    previewText: "Use this link to choose a new password. If you did not ask, ignore this email.",
    sender: SECURITY_SENDER,
    unsubscribable: false,
    variables: {
      actionUrl: url("Password-reset link from Folevi's own sign-in (single use)."),
      expiresInHours: num("Hours until the link expires."),
    },
    fixture: {
      actionUrl: `${FIX_APP}/api/auth/reset-password/EXAMPLEtoken456?callbackURL=%2Freset-password`,
      expiresInHours: 1,
    },
  },
  security_new_device: {
    key: "security_new_device",
    category: "security",
    subject: "New sign-in to your Folevi account",
    previewText: "A new device signed in to your account. Review it if this was not you.",
    sender: SECURITY_SENDER,
    unsubscribable: false,
    variables: {
      deviceLabel: text('Human label, e.g. "Safari on macOS".', 80),
      approximateLocation: text(
        'Coarse location (city/region). Optional: pass "Not available" rather than omitting when unknown.',
        80,
        false,
      ),
      signedInAt: text("Pre-formatted sign-in time including timezone.", 64),
      securityUrl: url("Link to Settings > Security (sessions & devices)."),
    },
    fixture: {
      deviceLabel: "Safari on macOS",
      approximateLocation: "Lisbon, Portugal",
      signedInAt: "25 September 2026, 10:42 UTC",
      securityUrl: `${FIX_APP}/settings/security`,
    },
  },
  account_deletion_scheduled: {
    key: "account_deletion_scheduled",
    category: "security",
    subject: "Your Folevi account is scheduled for deletion",
    previewText: "Your account and notes will be deleted. You can still cancel.",
    sender: SECURITY_SENDER,
    unsubscribable: false,
    variables: {
      scheduledFor: text("Pre-formatted deletion date.", 64),
      cancelUrl: url("Link to cancel the scheduled deletion (requires sign-in)."),
    },
    fixture: {
      scheduledFor: "9 October 2026",
      cancelUrl: `${FIX_APP}/settings/account/deletion`,
    },
  },
  account_deletion_completed: {
    key: "account_deletion_completed",
    category: "security",
    subject: "Your Folevi account has been deleted",
    previewText: "Your account and its data have been deleted.",
    sender: SECURITY_SENDER,
    unsubscribable: false,
    variables: {
      completedOn: text("Pre-formatted date the deletion completed.", 64),
    },
    fixture: { completedOn: "9 October 2026" },
  },
  workspace_invite: {
    key: "workspace_invite",
    category: "product",
    subject: "You have been invited to a Folevi workspace",
    previewText: "Accept the invitation to start working together in Folevi.",
    sender: PRODUCT_SENDER,
    unsubscribable: true,
    preferenceKey: "invites",
    variables: {
      inviterName: text("Display name of the inviter (user-controlled).", 80),
      workspaceName: text("Workspace name (user-controlled).", 80),
      role: text('Workspace role, e.g. "Member", "Admin" or "Member (can comment)".', 32),
      acceptUrl: url("Invitation acceptance link."),
      expiresInDays: num("Days until the invitation expires."),
      preferencesUrl: url("Email preferences page."),
    },
    fixture: {
      inviterName: "Maya Okafor",
      workspaceName: "Field Notes",
      role: "Member",
      acceptUrl: `${FIX_APP}/invite/EXAMPLEinvite`,
      expiresInDays: 7,
      preferencesUrl: `${FIX_APP}/settings/notifications`,
    },
  },
  mention_notification: {
    key: "mention_notification",
    category: "product",
    subject: "You were mentioned in Folevi",
    previewText: "Someone mentioned you on a page in Folevi.",
    sender: PRODUCT_SENDER,
    unsubscribable: true,
    preferenceKey: "mentions",
    variables: {
      actorName: text("Display name of the person who mentioned you.", 80),
      documentTitle: text("Page title (user-controlled).", 120),
      documentUrl: url("Deep link to the mention."),
      preferencesUrl: url("Email preferences page."),
    },
    fixture: {
      actorName: "Maya Okafor",
      documentTitle: "Spring planting plan",
      documentUrl: `${FIX_APP}/d/EXAMPLEdoc#mention`,
      preferencesUrl: `${FIX_APP}/settings/notifications`,
    },
  },
  comment_notification: {
    key: "comment_notification",
    category: "product",
    subject: "New comment in Folevi",
    previewText: "Someone commented on a page you follow.",
    sender: PRODUCT_SENDER,
    unsubscribable: true,
    preferenceKey: "comments",
    variables: {
      actorName: text("Display name of the commenter.", 80),
      documentTitle: text("Page title (user-controlled).", 120),
      documentUrl: url("Deep link to the comment thread."),
      preferencesUrl: url("Email preferences page."),
    },
    fixture: {
      actorName: "Jonas Lindqvist",
      documentTitle: "Q4 reading list",
      documentUrl: `${FIX_APP}/d/EXAMPLEdoc#comment`,
      preferencesUrl: `${FIX_APP}/settings/notifications`,
    },
  },
  comment_digest: {
    key: "comment_digest",
    category: "product",
    subject: "Your Folevi comment digest",
    previewText: "A summary of recent comments on pages you follow.",
    sender: PRODUCT_SENDER,
    unsubscribable: true,
    preferenceKey: "digest",
    variables: {
      count: num("Number of new comments summarised."),
      summary: text("Plain-text summary (titles and names only, no comment bodies).", 500),
      inboxUrl: url("Link to the in-app inbox."),
      preferencesUrl: url("Email preferences page."),
    },
    fixture: {
      count: 3,
      summary: "• Maya Okafor commented on Spring planting plan\n• Jonas Lindqvist mentioned you on Q4 reading list\n• Maya Okafor replied on Spring planting plan",
      inboxUrl: `${FIX_APP}/documents`,
      preferencesUrl: `${FIX_APP}/settings/notifications`,
    },
  },
  share_notification: {
    key: "share_notification",
    category: "product",
    subject: "A page was shared with you in Folevi",
    previewText: "Someone shared a page in Folevi with this email address.",
    sender: PRODUCT_SENDER,
    unsubscribable: true,
    preferenceKey: "shares",
    variables: {
      actorName: text("Display name of the person who shared.", 80),
      documentTitle: text("Page title (user-controlled).", 120),
      role: text('Access to the page: "Can edit", "Can comment" or "Can view".', 32),
      documentUrl: url("Link to the page (for someone without an account yet: the guest invitation link)."),
      preferencesUrl: url("Email preferences page."),
    },
    fixture: {
      actorName: "Maya Okafor",
      documentTitle: "Spring planting plan",
      role: "Can edit",
      documentUrl: `${FIX_APP}/d/EXAMPLEdoc`,
      preferencesUrl: `${FIX_APP}/settings/notifications`,
    },
  },
  access_changed: {
    key: "access_changed",
    category: "product",
    subject: "Your access in Folevi changed",
    previewText: "Someone changed what you can open or edit in Folevi.",
    sender: PRODUCT_SENDER,
    unsubscribable: true,
    preferenceKey: "shares",
    variables: {
      actorName: text("Display name of the person who made the change.", 80),
      summary: text(
        'Server-composed sentence from fixed phrases, e.g. \'changed your access to "Plan" to Can comment.\' Contains a title (user-controlled), never content.',
        240,
      ),
      actionUrl: url("Link to the page when still accessible, otherwise to the page list."),
      preferencesUrl: url("Email preferences page."),
    },
    fixture: {
      actorName: "Maya Okafor",
      summary: "changed your access to “Spring planting plan” to Can comment.",
      actionUrl: `${FIX_APP}/d/EXAMPLEdoc`,
      preferencesUrl: `${FIX_APP}/settings/notifications`,
    },
  },
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

export const emailManifest: Readonly<Record<TemplateKey, TemplateDefinition>> =
  deepFreeze(definitions);

export const TEMPLATE_KEYS: readonly TemplateKey[] = Object.freeze(
  Object.keys(definitions) as TemplateKey[],
);
