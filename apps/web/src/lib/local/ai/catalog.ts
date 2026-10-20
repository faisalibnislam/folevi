// The models Foli AI can use in local mode (docs/LOCAL_MODE_PLAN.md §4.1, WP11): Apple's model on this device,
// or the person's own OpenAI, Anthropic or Google key, called straight from the device and never through
// Folevi. Each provider has a model the person picks (Settings > AI) and a small, quick one for the plumbing
// calls the server also sends to its fast model (search terms, titles, short rewrites).
//
// Model ids are the providers' current ones (checked against their documentation on 2026-10-20). A model the
// person picked that later disappears from this list still works as long as the provider accepts it.
import type { AiKeyProvider, AiProviderId, SecretName } from "@/lib/shell/types";

export interface ModelInfo {
  id: string;
  label: string;
  /** For people to read, under the name. */
  note: string;
}

export interface ProviderInfo {
  id: AiProviderId;
  label: string;
  /** The Keychain secret holding the person's key (none for the device). */
  secret: SecretName | null;
  models: ModelInfo[];
  defaultModel: string;
  /** The quick model for plumbing calls (the server's "fast" requests). */
  fastModel: string;
  /** Tokens the model takes in and gives back together (on the device the host reports it). */
  contextTokens: number;
  /** The most it writes in one answer. */
  maxOutputTokens: number;
  /** Where people get a key. */
  keyUrl?: string;
  /** What a key looks like, for a light check before it's stored (the provider decides for real). */
  keyPattern?: RegExp;
}

/** Apple's on-device model: about 4,000 tokens for the question and the answer together (R10). */
export const ON_DEVICE_CONTEXT = 4096;

export const PROVIDERS: Record<AiProviderId, ProviderInfo> = {
  "on-device": {
    id: "on-device",
    label: "On this Mac",
    secret: null,
    models: [{ id: "apple-on-device", label: "Apple Intelligence", note: "Runs on this Mac. Nothing leaves it." }],
    defaultModel: "apple-on-device",
    fastModel: "apple-on-device",
    contextTokens: ON_DEVICE_CONTEXT,
    maxOutputTokens: 2048,
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    secret: "ai.openai",
    models: [
      { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", note: "Balanced: smart and quick." },
      { id: "gpt-6-astra", label: "GPT-6 Astra", note: "The most capable, and the slowest." },
      { id: "gpt-6-luna", label: "GPT-6 Luna", note: "The quickest and cheapest." },
    ],
    defaultModel: "gpt-6.1-sol",
    fastModel: "gpt-6-luna",
    contextTokens: 400_000,
    maxOutputTokens: 16_384,
    keyUrl: "https://platform.openai.com/api-keys",
    keyPattern: /^sk-[A-Za-z0-9_-]{20,}$/,
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    secret: "ai.anthropic",
    models: [
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "Balanced: smart and quick." },
      { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "The most capable, and the slowest." },
      { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", note: "The quickest and cheapest." },
    ],
    defaultModel: "claude-sonnet-5-5",
    fastModel: "claude-haiku-5-5",
    contextTokens: 1_000_000,
    maxOutputTokens: 16_384,
    keyUrl: "https://platform.claude.com/settings/keys",
    keyPattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
  },
  google: {
    id: "google",
    label: "Google",
    secret: "ai.google",
    models: [
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", note: "Balanced: smart and quick." },
      { id: "gemini-4-argon", label: "Gemini 4 Argon", note: "The most capable, and the slowest." },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", note: "The quickest and cheapest." },
    ],
    defaultModel: "gemini-3.8-flash",
    fastModel: "gemini-3.5-flash-lite",
    contextTokens: 1_000_000,
    maxOutputTokens: 16_384,
    keyUrl: "https://aistudio.google.com/apikey",
    keyPattern: /^[A-Za-z0-9_-]{30,}$/,
  },
};

export const KEY_PROVIDERS: readonly AiKeyProvider[] = ["openai", "anthropic", "google"];
export const PROVIDER_ORDER: readonly AiProviderId[] = ["on-device", ...KEY_PROVIDERS];

/** A model id the provider layer will send (the host checks it again). */
export const MODEL_ID = /^[A-Za-z0-9._:-]{1,80}$/;

export function isProviderId(v: unknown): v is AiProviderId {
  return typeof v === "string" && (PROVIDER_ORDER as readonly string[]).includes(v);
}

/** The model's name for people, or its id. */
export function modelLabel(provider: AiProviderId, model: string): string {
  return PROVIDERS[provider].models.find((m) => m.id === model)?.label ?? model;
}
