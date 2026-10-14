// @folevi/email is Folevi's transactional email: templates (compiled in the repo), rendering, sending
// through Resend, webhook verification and inbound mail.
// Runtime-agnostic: only Web APIs (fetch, crypto.subtle, TextEncoder, atob/btoa), so it runs
// in the Convex V8 runtime, browsers and Node. No runtime dependencies.

export type {
  TemplateKey,
  TemplateCategory,
  VariableSpec,
  TemplateDefinition,
  ValidationResult,
  GeneratedTemplate,
  RenderedEmail,
  SendPolicy,
  EmailProviderKind,
  SendEmailInput,
  SendOutcome,
  EmailEvent,
  EmailEventName,
} from "./types";
export { emailManifest, TEMPLATE_KEYS, EMAIL_BRAND_BASE_URL, EMAIL_LOGO, EMAIL_SENDING_DOMAIN, SUPPORT_ADDRESS } from "./manifest";
export { validateDataVariables, isAllowedUrl, isPlausibleEmail } from "./validate";
export { renderEmail, EmailRenderError, escapeHtml } from "./render";
export { isRecipientAllowed } from "./policy";
export { selectProvider, sendingDomain, sendEmail, normaliseMessageId, threadHeaders, type ProviderSelection } from "./send";
export { RESEND_API, RESEND_SEND_ENDPOINT, resendRequestBody, postToResend, formatFrom, sanitizeProviderError } from "./providers/resend";
export { verifyResendSignature, parseResendWebhook, WEBHOOK_TOLERANCE_MS, type ResendWebhook } from "./providers/resendWebhook";
export { redactEmail, hashRecipient } from "./privacy";
export {
  fetchReceivedEmail,
  readInboundMessage,
  parseAddress,
  htmlToText,
  stripQuotedReply,
  ticketNumberFromSubject,
  automatedReason,
  MAX_INBOUND_TEXT,
  readNoteEmail,
  htmlToNoteText,
  MAX_NOTE_TEXT,
  type InboundMessage,
  type InboundFetchResult,
  type NoteEmail,
  type MailAuthentication,
  type AuthCheck,
} from "./providers/inbound";
