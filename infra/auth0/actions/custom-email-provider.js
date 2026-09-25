/**
 * Folevi — Auth0 Action, trigger: custom-email-provider
 * (Branding > Email Provider > Custom Provider → this Action).
 *
 * Delivers Auth0 identity emails through the Loops transactional API, one dedicated
 * published Loops template per Auth0 message type. See docs/EMAIL_DECISION.md.
 *
 * Safety rules (do not relax without updating the decision record):
 *  - The only data taken from Auth0's rendered email is ONE action link (or one code). The
 *    link must be https, its host must be listed in AUTH0_LINK_HOSTS, and its path must match
 *    a known Auth0 verification/reset/unblock pattern for that message type.
 *  - If extraction fails the notification is DROPPED. There is no fallback to Auth0's built-in
 *    sender or to any other vendor.
 *  - Idempotency-Key = sha256(message_type | user_id | link) so Auth0 retries never duplicate.
 *  - Never log the link, the code, or the full recipient address.
 *
 * Secrets (Actions > this action > Secrets):
 *  LOOPS_API_KEY                                   required
 *  LOOPS_TRANSACTIONAL_AUTH_VERIFY_EMAIL_ID        required
 *  LOOPS_TRANSACTIONAL_AUTH_PASSWORD_RESET_ID      required
 *  LOOPS_TRANSACTIONAL_AUTH_BLOCKED_ACCOUNT_ID     required
 *  LOOPS_TRANSACTIONAL_AUTH_BREACHED_PASSWORD_ID   required
 *  LOOPS_TRANSACTIONAL_AUTH_VERIFICATION_CODE_ID   required if code-based flows are enabled
 *  AUTH0_LINK_HOSTS              e.g. "auth.folevi.com,folevi.us.auth0.com"   required
 *  FOLEVI_EMAIL_ALLOWLIST_MODE   "off" (production only) | "test-domains". Missing/unknown
 *                                values are treated as "test-domains" (fail closed).
 *  FOLEVI_EMAIL_ALLOWLIST        optional, comma-separated exact addresses allowed in test-domains mode
 *  AUTH0_VERIFY_EMAIL_TTL_HOURS     default 24  (must equal the Auth0 "Verification Email" URL lifetime)
 *  AUTH0_RESET_PASSWORD_TTL_HOURS   default 1   (must equal the "Change Password" URL lifetime)
 *  AUTH0_BLOCKED_ACCOUNT_TTL_HOURS  default 24
 *  AUTH0_BREACHED_PASSWORD_TTL_HOURS default 24
 *  AUTH0_CODE_TTL_MINUTES           default 10
 *  FOLEVI_PASSWORD_RESET_URL     optional https URL used ONLY for stolen_credentials when the
 *                                Auth0 notice carries no reset link (e.g. https://app.folevi.com/forgot-password)
 */
"use strict";

const crypto = require("node:crypto");

const LOOPS_ENDPOINT = "https://app.loops.so/api/v1/transactional";
const REQUEST_TIMEOUT_MS = 10000;

// MUST match AUTH0_MESSAGE_TYPE_TO_TEMPLATE in packages/email/src/manifest.ts (test-enforced).
const MESSAGE_TYPE_TO_TEMPLATE = Object.freeze({
  verify_email: "auth_verify_email",
  verify_email_by_code: "auth_verification_code",
  reset_email: "auth_password_reset",
  reset_email_by_code: "auth_verification_code",
  blocked_account: "auth_blocked_account",
  stolen_credentials: "auth_breached_password",
  welcome_email: null,
  verification_code: null,
  mfa_oob_code: null,
  enrollment_email: null,
  organization_invitation: null,
  try_provider_configuration_email: null,
});

// MUST match `envVar` in packages/email/src/manifest.ts (test-enforced).
const TEMPLATE_ENV = Object.freeze({
  auth_verify_email: "LOOPS_TRANSACTIONAL_AUTH_VERIFY_EMAIL_ID",
  auth_password_reset: "LOOPS_TRANSACTIONAL_AUTH_PASSWORD_RESET_ID",
  auth_blocked_account: "LOOPS_TRANSACTIONAL_AUTH_BLOCKED_ACCOUNT_ID",
  auth_breached_password: "LOOPS_TRANSACTIONAL_AUTH_BREACHED_PASSWORD_ID",
  auth_verification_code: "LOOPS_TRANSACTIONAL_AUTH_VERIFICATION_CODE_ID",
});

// Known Auth0 link paths per message type (New Universal Login `/u/...` and classic `/lo/...`).
// The blocked-account path is UNVERIFIED — confirm with a real tenant email before launch
// (docs/EMAIL_OPERATIONS.md "Auth0 smoke test"); a mismatch fails closed (drop), never open.
const RESET_PATHS = ["/u/reset-verify", "/lo/reset"];
const LINK_PATHS = Object.freeze({
  verify_email: ["/u/email-verification", "/lo/verify_email"],
  reset_email: RESET_PATHS,
  stolen_credentials: RESET_PATHS,
  blocked_account: ["/u/unblock", "/lo/unblock", "/unblock"],
});

const CODE_TYPES = new Set(["verify_email_by_code", "reset_email_by_code"]);
const TEST_DOMAINS = new Set(["example.com", "test.com"]);
const LOOPS_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function redact(email) {
  const value = String(email || "");
  const at = value.lastIndexOf("@");
  if (at <= 0) return "***";
  const domain = value.slice(at + 1);
  const labels = domain.split(".");
  return `${value[0]}***@${(labels[0] || "")[0] || ""}***${labels.length > 1 ? "." + labels[labels.length - 1] : ""}`;
}

function log(event, fields) {
  // Structured, PII-minimal logs only (visible in Auth0 Actions real-time logs).
  console.log(JSON.stringify({ src: "folevi.custom-email-provider", event, ...fields }));
}

function parseHosts(value) {
  return String(value || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&#x2f;/gi, "/")
    .replace(/&#47;/g, "/")
    .replace(/&#x3d;/gi, "=")
    .replace(/&#61;/g, "=");
}

/**
 * Returns the single action link for this message type, or null.
 * Accepts only https URLs on an allowed host whose path is a known pattern.
 * More than one DISTINCT qualifying link → null (ambiguous; fail closed).
 */
function extractActionLink(messageType, notification, allowedHosts) {
  const paths = LINK_PATHS[messageType];
  if (!paths || allowedHosts.length === 0) return null;
  const sources = [notification.text, notification.html].filter((s) => typeof s === "string" && s);
  const found = new Set();
  for (const source of sources) {
    const candidates = decodeEntities(source).match(/https:\/\/[^\s"'<>`]+/gi) || [];
    for (const raw of candidates) {
      const trimmed = raw.replace(/[).,;\]]+$/, "");
      let url;
      try {
        url = new URL(trimmed);
      } catch {
        continue;
      }
      if (url.protocol !== "https:" || url.username || url.password || url.port) continue;
      if (!allowedHosts.includes(url.hostname.toLowerCase())) continue;
      const path = url.pathname.replace(/\/+$/, "");
      if (!paths.includes(path)) continue;
      if (url.search.length < 2) continue; // every Auth0 action link carries a ticket/query
      found.add(url.href);
    }
    if (found.size > 0) break; // prefer the text part; fall back to html only if text had none
  }
  return found.size === 1 ? Array.from(found)[0] : null;
}

/** Exactly one distinct 4–8 digit code in the text (or html) part, else null. */
function extractCode(notification) {
  const sources = [notification.text, notification.html].filter((s) => typeof s === "string" && s);
  for (const source of sources) {
    const plain = source.replace(/<[^>]*>/g, " ").replace(/https?:\/\/\S+/g, " ");
    const codes = new Set(plain.match(/(?<![\w-])\d{4,8}(?![\w-])/g) || []);
    // Ignore years that commonly appear in footers.
    for (const c of Array.from(codes)) if (/^(19|20)\d{2}$/.test(c)) codes.delete(c);
    if (codes.size === 1) return Array.from(codes)[0];
    if (codes.size > 1) return null;
  }
  return null;
}

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function isAllowedRecipient(email, secrets) {
  const mode = secrets.FOLEVI_EMAIL_ALLOWLIST_MODE;
  if (mode === "off") return true;
  // "test-domains" and anything unrecognised → fail closed.
  const normalized = String(email || "")
    .trim()
    .toLowerCase();
  const domain = normalized.slice(normalized.lastIndexOf("@") + 1);
  if (TEST_DOMAINS.has(domain)) return true;
  return parseHosts(secrets.FOLEVI_EMAIL_ALLOWLIST).includes(normalized);
}

function idempotencyKey(messageType, userId, secretPart) {
  const digest = crypto
    .createHash("sha256")
    .update(`${messageType}|${userId}|${secretPart}`)
    .digest("hex");
  return `auth0-${digest}`; // 70 chars (< 100 Loops limit)
}

async function postToLoops(apiKey, key, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(LOOPS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {Event} event - Details about the notification and the user.
 * @param {CustomEmailProviderAPI} api - Methods to drop or retry the notification.
 */
exports.onExecuteCustomEmailProvider = async (event, api) => {
  const notification = event.notification || {};
  const secrets = event.secrets || {};
  const messageType = String(notification.message_type || "");
  const userId = (event.user && event.user.user_id) || "unknown";
  const recipient = String(notification.to || "").trim();
  const base = { messageType, to: redact(recipient) };

  if (messageType === "try_provider_configuration_email") {
    // Dashboard "Send test email": verify configuration without sending anything.
    const missing = [
      "LOOPS_API_KEY",
      "AUTH0_LINK_HOSTS",
      ...Object.values(TEMPLATE_ENV).slice(0, 4),
    ].filter((k) => !secrets[k]);
    log(missing.length ? "config_incomplete" : "config_ok", { ...base, missing });
    api.notification.drop(
      missing.length ? `config_incomplete:${missing.join(",")}` : "provider_test_ok",
    );
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(MESSAGE_TYPE_TO_TEMPLATE, messageType)) {
    log("drop", { ...base, reason: "unknown_message_type" });
    api.notification.drop("unknown_message_type");
    return;
  }
  const templateKey = MESSAGE_TYPE_TO_TEMPLATE[messageType];
  if (templateKey === null) {
    log("drop", { ...base, reason: "message_type_not_sent" });
    api.notification.drop("message_type_not_sent");
    return;
  }

  if (!recipient || !recipient.includes("@")) {
    log("drop", { ...base, reason: "invalid_recipient" });
    api.notification.drop("invalid_recipient");
    return;
  }
  if (!isAllowedRecipient(recipient, secrets)) {
    log("drop", { ...base, reason: "recipient_not_allowed" });
    api.notification.drop("recipient_not_allowed");
    return;
  }

  const transactionalId = String(secrets[TEMPLATE_ENV[templateKey]] || "").trim();
  if (!secrets.LOOPS_API_KEY || !LOOPS_ID_RE.test(transactionalId)) {
    log("drop", { ...base, reason: "template_not_configured" });
    api.notification.drop("template_not_configured");
    return;
  }

  let dataVariables;
  let secretPart;
  if (CODE_TYPES.has(messageType)) {
    const code = extractCode(notification);
    if (!code) {
      log("drop", { ...base, reason: "code_not_found" });
      api.notification.drop("code_not_found");
      return;
    }
    dataVariables = {
      code,
      expiresInMinutes: positiveNumber(secrets.AUTH0_CODE_TTL_MINUTES, 10),
    };
    secretPart = code;
  } else {
    let link = extractActionLink(messageType, notification, parseHosts(secrets.AUTH0_LINK_HOSTS));
    if (!link && messageType === "stolen_credentials") {
      // Breached-password notices may not carry a ticket; fall back to Folevi's own first-party
      // "forgot password" page (static, https only). Still never Auth0's sender.
      const fallback = String(secrets.FOLEVI_PASSWORD_RESET_URL || "");
      try {
        const u = new URL(fallback);
        if (u.protocol === "https:" && !u.username && !u.password) link = u.href;
      } catch {
        link = null;
      }
    }
    if (!link) {
      log("drop", { ...base, reason: "link_not_found" });
      api.notification.drop("link_not_found");
      return;
    }
    const ttl = {
      verify_email: positiveNumber(secrets.AUTH0_VERIFY_EMAIL_TTL_HOURS, 24),
      reset_email: positiveNumber(secrets.AUTH0_RESET_PASSWORD_TTL_HOURS, 1),
      blocked_account: positiveNumber(secrets.AUTH0_BLOCKED_ACCOUNT_TTL_HOURS, 24),
      stolen_credentials: positiveNumber(secrets.AUTH0_BREACHED_PASSWORD_TTL_HOURS, 24),
    }[messageType];
    dataVariables = { actionUrl: link, expiresInHours: ttl };
    secretPart = link;
  }

  const key = idempotencyKey(messageType, userId, secretPart);
  let res;
  try {
    res = await postToLoops(secrets.LOOPS_API_KEY, key, {
      transactionalId,
      email: recipient,
      addToAudience: false,
      dataVariables,
    });
  } catch {
    log("retry", { ...base, reason: "network_error" });
    api.notification.retry("loops_network_error");
    return;
  }

  if (res.status === 200) {
    log("accepted", { ...base, templateKey });
    return;
  }
  if (res.status === 429 || res.status === 408 || res.status >= 500) {
    log("retry", { ...base, status: res.status });
    api.notification.retry(`loops_http_${res.status}`);
    return;
  }
  // 400 (unpublished template / missing variable), 401/403, 404, 409 idempotency reuse.
  log("drop", { ...base, status: res.status });
  api.notification.drop(`loops_http_${res.status}`);
};

// Exposed for unit tests only; Auth0 ignores extra exports.
exports._internals = {
  MESSAGE_TYPE_TO_TEMPLATE,
  TEMPLATE_ENV,
  LINK_PATHS,
  extractActionLink,
  extractCode,
  idempotencyKey,
  redact,
};
