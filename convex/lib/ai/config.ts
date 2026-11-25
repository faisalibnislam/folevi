// Which AI provider and models each Foli AI feature uses (docs/AI_ASSISTANT.md, "Provider layer"). The
// admin panel (Admin > Foli AI, convex/aiConfig.ts) picks a provider per feature and three models per
// provider; the keys are stored sealed (convex/aiConfig.ts) or come from the environment.
//
//   Fast:  plumbing calls (titles, search terms, short rewrites): requests marked `fast`.
//   Main:  normal answers.
//   Heavy: the jobs that need a stronger model, decided before the call by what the request carries: tools
//          (the agent's loop), a web search, files or images, or a very long prompt.
//
// A request's route rides on its meter (like the person's preferences, lib/ai/memory.ts): `metered`
// (convex/ai.ts) looks it up for the request's credit hold, so every call the work makes goes where its
// feature is set to go. There is no fallback to another provider (the owner's decision, 2026-11-25): a
// feature whose provider fails or has no key shows the error. Search embeddings and audio transcription
// always use Gemini.
import { v, type Infer } from "convex/values";
import type { CallUsage } from "../credits";
import type { GenerateRequest } from "./provider";

export const AI_PROVIDERS = ["gemini", "openai", "anthropic"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];
export const vAiProvider = v.union(v.literal("gemini"), v.literal("openai"), v.literal("anthropic"));

export const PROVIDER_LABELS: Record<AiProviderId, string> = { gemini: "Google Gemini", openai: "OpenAI", anthropic: "Anthropic" };

/** The environment variable each provider's key can also come from (a key saved in the admin panel wins). */
export const KEY_ENV: Record<AiProviderId, string> = { gemini: "GEMINI_API_KEY", openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY" };

/**
 * The features the admin panel routes, in its order: the usage card's (lib/ai/usage.ts) plus the knowledge
 * graph (platform-paid, no credits). Transcription isn't here: it always uses Gemini.
 */
export const ROUTED_FEATURES = ["chat", "agent", "writing", "research", "attachments", "digests", "routines", "graph", "other"] as const;
export type RoutedFeature = (typeof ROUTED_FEATURES)[number];
export const vRoutedFeature = v.union(
  v.literal("chat"),
  v.literal("agent"),
  v.literal("writing"),
  v.literal("research"),
  v.literal("attachments"),
  v.literal("digests"),
  v.literal("routines"),
  v.literal("graph"),
  v.literal("other"),
);

export const ROUTED_FEATURE_LABELS: Record<RoutedFeature, { label: string; note: string }> = {
  chat: { label: "Chat", note: "Answers in Foli AI conversations, with web search when asked." },
  agent: { label: "Agent", note: "The agent that reads and edits notes with tools." },
  writing: { label: "Writing", note: "Writing help, diagrams, tables, stickies, mind maps, charts, wireframes." },
  research: { label: "Research", note: "Deep research reports with web sources." },
  attachments: { label: "Attachments", note: "Reading files and images people attach." },
  digests: { label: "Digests", note: "Daily and weekly digests." },
  routines: { label: "Routines", note: "Scheduled routines." },
  graph: { label: "Knowledge graph", note: "Building a note's knowledge graph in the background (no credits)." },
  other: { label: "Other", note: "Everything else: study tools, to-dos, reading images in notes." },
};

export const MODEL_SLOTS = ["fast", "main", "heavy"] as const;
export type ModelSlot = (typeof MODEL_SLOTS)[number];
export type ModelSet = Record<ModelSlot, string>;
export const vModelSet = v.object({ fast: v.string(), main: v.string(), heavy: v.string() });

/** A model id as providers write them; anything else is refused before it's stored or sent. */
export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

/**
 * Starting models ("cheap first everywhere", the owner's pick on 2026-11-25), until an admin changes them.
 * Gemini keeps honoring its environment variables: GEMINI_FAST_MODEL (the cheap model, now also Main) and
 * GEMINI_MODEL (the stronger one, now Heavy).
 */
export function defaultModels(p: AiProviderId): ModelSet {
  if (p === "gemini") {
    const cheap = process.env.GEMINI_FAST_MODEL ?? "gemini-flash-lite-latest";
    return { fast: cheap, main: cheap, heavy: process.env.GEMINI_MODEL ?? "gemini-3.8-flash" };
  }
  if (p === "openai") return { fast: "gpt-6-luna", main: "gpt-6-luna", heavy: "gpt-6.2-sol" };
  return { fast: "claude-haiku-5-5", main: "claude-haiku-5-5", heavy: "claude-sonnet-5-5" };
}

/** Model suggestions the admin panel offers (any other id a provider accepts can be typed). */
export const MODEL_SUGGESTIONS: Record<AiProviderId, { id: string; label: string }[]> = {
  gemini: [
    { id: "gemini-flash-lite-latest", label: "Flash-Lite (latest)" },
    { id: "gemini-3.8-flash", label: "Flash 3.8" },
    { id: "gemini-4-argon", label: "Argon 4" },
  ],
  openai: [
    { id: "gpt-6-luna", label: "GPT-6 Luna" },
    { id: "gpt-6.1-terra", label: "GPT-6.1 Terra" },
    { id: "gpt-6.2-sol", label: "GPT-6.2 Sol" },
    { id: "gpt-6.2-astra", label: "GPT-6.2 Astra" },
  ],
  anthropic: [
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
    { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  ],
};

/** What admins have set (systemSettings "foliAi"): only what differs from the defaults is stored. */
export const vAiSettings = v.object({
  routes: v.optional(v.record(v.string(), vAiProvider)),
  models: v.optional(v.record(v.string(), v.object({ fast: v.optional(v.string()), main: v.optional(v.string()), heavy: v.optional(v.string()) }))),
});
export type StoredAiSettings = Infer<typeof vAiSettings>;
export const AI_SETTINGS_KEY = "foliAi";

export interface AiSettings {
  routes: Record<RoutedFeature, AiProviderId>;
  models: Record<AiProviderId, ModelSet>;
}

const isProvider = (p: unknown): p is AiProviderId => typeof p === "string" && (AI_PROVIDERS as readonly string[]).includes(p);
export const isRoutedFeature = (f: unknown): f is RoutedFeature => typeof f === "string" && (ROUTED_FEATURES as readonly string[]).includes(f);

/** The stored settings with every gap filled from the defaults; anything malformed is ignored. */
export function normalizeSettings(stored: unknown): AiSettings {
  const s = (stored && typeof stored === "object" ? stored : {}) as { routes?: Record<string, unknown>; models?: Record<string, Record<string, unknown> | undefined> };
  const routes = {} as Record<RoutedFeature, AiProviderId>;
  for (const f of ROUTED_FEATURES) {
    const p = s.routes?.[f];
    routes[f] = isProvider(p) ? p : "gemini";
  }
  const models = {} as Record<AiProviderId, ModelSet>;
  for (const p of AI_PROVIDERS) {
    const d = defaultModels(p);
    const set = s.models?.[p] ?? {};
    models[p] = {} as ModelSet;
    for (const slot of MODEL_SLOTS) {
      const m = set[slot];
      models[p][slot] = typeof m === "string" && MODEL_ID.test(m) ? m : d[slot];
    }
  }
  return { routes, models };
}

/** The routed feature a credit hold's feature maps to (transcription stays on Gemini, see `routeOf`). */
export function routedFeatureOf(feature: string | undefined): RoutedFeature | "transcription" {
  if (feature === "transcription") return "transcription";
  return isRoutedFeature(feature) ? feature : "other";
}

/** Where a request goes: the provider, its three models, and the key (only ever held in an action's memory). */
export interface AiRoute {
  feature: RoutedFeature | "transcription" | "embeddings";
  provider: AiProviderId;
  models: ModelSet;
  /** The key, when one was saved in the admin panel; otherwise the adapter reads the environment variable. */
  apiKey?: string;
}

/** A feature's route without its key. Transcription and embeddings always go to Gemini. */
export function routeOf(settings: AiSettings, feature: AiRoute["feature"]): AiRoute {
  const provider: AiProviderId = feature === "transcription" || feature === "embeddings" ? "gemini" : settings.routes[feature];
  return { feature, provider, models: settings.models[provider] };
}

/** Gemini at its defaults with the environment's key: for a call made without a route (none should be). */
export const fallbackRoute = (): AiRoute => ({ feature: "other", provider: "gemini", models: defaultModels("gemini") });

/** A prompt this long (characters, about 50,000 tokens) is a heavy job. */
export const HEAVY_PROMPT_CHARS = 200_000;

/** Characters a request sends as text (system prompt, question, earlier turns): for the long-prompt test. */
export function textChars(req: GenerateRequest): number {
  let n = req.system.length + req.prompt.length;
  for (const c of req.contents ?? []) {
    for (const p of c.parts) {
      if ("text" in p) n += p.text.length;
      else if ("functionResponse" in p) n += JSON.stringify(p.functionResponse.response).length;
    }
  }
  return n;
}

/** Which slot a request uses: `fast` when it asks for it; heavy for tools, web search, files or a long prompt. */
export function slotFor(req: GenerateRequest): ModelSlot {
  if (req.fast) return "fast";
  if (req.tools?.length || req.searchGrounding || req.attachments?.length || textChars(req) > HEAVY_PROMPT_CHARS) return "heavy";
  return "main";
}

// ---------------------------------------------------------------------------------------------------
// A request's route, carried on its meter (set by `metered` or `routedMeter`, read by lib/ai/provider.ts)
// ---------------------------------------------------------------------------------------------------

const KEY = "__foleviRoute";

/** Attaches the route to a meter (not enumerable: never stored, settled or logged). */
export function setMeterRoute(meter: CallUsage[], route: AiRoute): void {
  Object.defineProperty(meter, KEY, { value: route, enumerable: false, configurable: true, writable: true });
}

export function meterRoute(meter: CallUsage[]): AiRoute | null {
  const value = (meter as unknown as Record<string, unknown>)[KEY];
  return value && typeof value === "object" ? (value as AiRoute) : null;
}

/** A fresh meter carrying `route` (for calls outside a credit hold: the knowledge graph). */
export function routedMeter(route: AiRoute): CallUsage[] {
  const meter: CallUsage[] = [];
  setMeterRoute(meter, route);
  return meter;
}

/** The last four characters of a key, the most of it ever shown. */
export const keyHint = (key: string) => key.trim().slice(-4);
