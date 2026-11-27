// Foli AI with the person's own key (docs/PRICING_PLAN.md, "Bring your own AI"; docs/AI_ASSISTANT.md,
// "Your own AI key"). Anthropic, OpenAI or Google Gemini, on every plan, with no credits.
//
// On Folevi Cloud and Folevi Server the device decrypts the key and sends it with each AI request (an
// action's arguments, over TLS). The server uses it for that request only:
//   - `ai.begin` (a mutation) never sees the key: it gets `{ provider, model }` and marks the hold as an
//     own-key hold, which holds and charges no credits (the hourly limit still applies).
//   - The key rides on the request's meter as its route (lib/ai/config.ts setMeterRoute: not enumerable,
//     so it's never stored, settled or logged), and dies with the action.
//   - It is never written to the database, never put in a scheduled function's arguments (those are
//     stored), and never logged. Errors name the provider, never the key.
// Background jobs with no device behind them (digests, routines) can't carry a key: they use credits.
import { v, type Infer } from "convex/values";
import { fail } from "../errors";
import { defaultModels, MODEL_ID, PROVIDER_LABELS, vAiProvider, type AiProviderId, type AiRoute, type ModelSet } from "./config";

/** What a request carries: the provider, the key, and the model the person picked (else the default). */
export const vOwnKey = v.object({ provider: vAiProvider, apiKey: v.string(), model: v.optional(v.string()) });
export type OwnKey = Infer<typeof vOwnKey>;

/** What `ai.begin` gets about an own key: never the key itself. */
export const vOwnKeyMeta = v.object({ provider: vAiProvider, model: v.optional(v.string()) });
export type OwnKeyMeta = Infer<typeof vOwnKeyMeta>;

/** The model an own key uses until the person picks another (the apps' catalog, apps/web/src/lib/local/ai/catalog.ts). */
export const OWN_KEY_DEFAULT_MODEL: Record<AiProviderId, string> = {
  anthropic: "claude-sonnet-5-5",
  openai: "gpt-6.1-sol",
  gemini: "gemini-3.8-flash",
};

/** Keys are printable ASCII with no spaces, and no longer than any provider issues. */
const KEY_SHAPE = /^[\x21-\x7e]{16,400}$/;

/** The key and model as sent, checked (the key is trimmed). Fails without ever echoing the key. */
export function checkedOwnKey(k: OwnKey): OwnKey {
  const apiKey = k.apiKey.trim();
  if (!KEY_SHAPE.test(apiKey)) fail("invalid_argument", `That doesn't look like a ${PROVIDER_LABELS[k.provider]} key.`);
  const model = k.model?.trim();
  if (model && !MODEL_ID.test(model)) fail("invalid_argument", "That model name isn't valid.");
  return { provider: k.provider, apiKey, ...(model ? { model } : {}) };
}

/** Just the provider and model, for `ai.begin`. */
export const ownKeyMeta = (k: OwnKey | undefined): { ownKey?: OwnKeyMeta } => (k ? { ownKey: { provider: k.provider, ...(k.model ? { model: k.model } : {}) } } : {});

/**
 * The models an own key uses: the picked model (or the default) for normal and heavy answers, and the
 * provider's cheap model for plumbing calls (titles, search terms) so they don't cost the person much.
 */
export function ownKeyModels(provider: AiProviderId, model?: string): ModelSet {
  const main = model || OWN_KEY_DEFAULT_MODEL[provider];
  return { fast: defaultModels(provider).fast, main, heavy: main };
}

/** A request's route on the person's own key. `own` marks it for the errors in lib/ai/provider.ts. */
export function ownKeyRoute(feature: AiRoute["feature"], key: OwnKey): AiRoute {
  const k = checkedOwnKey(key);
  return { feature, provider: k.provider, models: ownKeyModels(k.provider, k.model), apiKey: k.apiKey, own: true };
}

/** What a person reads when their provider refuses their key. */
export const ownKeyRefused = (provider: AiProviderId) => `${PROVIDER_LABELS[provider]} refused your key. Check it in Settings, Foli AI, Your own AI key.`;
