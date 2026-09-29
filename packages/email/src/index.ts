// @folevi/email is Folevi's transactional email: templates (compiled in the repo), rendering, sending
// through Mailtrap, and webhook verification.
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
  MailtrapEvent,
  MailtrapEventName,
} from "./types";
export { emailManifest, TEMPLATE_KEYS, EMAIL_BRAND_BASE_URL, EMAIL_LOGO, EMAIL_SENDING_DOMAIN, SUPPORT_ADDRESS } from "./manifest";
export { validateDataVariables, isAllowedUrl, isPlausibleEmail } from "./validate";
export { renderEmail, EmailRenderError, escapeHtml } from "./render";
export { isRecipientAllowed } from "./policy";
export { selectProvider, sendingDomain, sendEmail, normaliseMessageId, threadHeaders, type ProviderSelection } from "./send";
export { MAILTRAP_SEND_ENDPOINT, MAILTRAP_SANDBOX_ENDPOINT, mailtrapRequestBody, postToMailtrap } from "./providers/mailtrap";
export {
  verifyMailtrapSignature,
  parseMailtrapWebhook,
  normaliseMailtrapEventName,
  MAX_MAILTRAP_EVENTS,
} from "./providers/mailtrapWebhook";
export { redactEmail, hashRecipient } from "./privacy";
export {
  parseMailtrapInboundWebhook,
  fetchInboundMessage,
  readInboundMessage,
  parseAddress,
  htmlToText,
  stripQuotedReply,
  ticketNumberFromSubject,
  automatedReason,
  MAILTRAP_INBOUND_API,
  MAX_INBOUND_EVENTS,
  MAX_INBOUND_TEXT,
  type InboundEvent,
  type InboundMessage,
  type InboundFetchResult,
} from "./providers/mailtrapInbound";
