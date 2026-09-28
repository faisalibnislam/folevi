// @folevi/email — Loops transactional email contract for Folevi.
// Runtime-agnostic: only Web APIs (fetch, crypto.subtle, TextEncoder, atob/btoa), so it runs
// in the Convex V8 runtime, browsers and Node. No runtime dependencies.

export type {
  TemplateKey,
  TemplateCategory,
  VariableSpec,
  TemplateDefinition,
  ValidationResult,
  LoopsSendInput,
  LoopsSendOutcome,
  SendPolicy,
  LoopsWebhookEvent,
} from "./types";
export { emailManifest, TEMPLATE_KEYS } from "./manifest";
export { validateDataVariables } from "./validate";
export { transactionalIdFor, sendTransactional } from "./send";
export { redactEmail, hashRecipient } from "./privacy";
export { verifyLoopsWebhook, parseLoopsWebhook } from "./webhook";
