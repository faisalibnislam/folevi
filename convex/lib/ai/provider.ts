// The one interface every AI provider implements (docs/AI_ASSISTANT.md, "Provider layer"), so another
// provider is configuration, not a rewrite. Today there is one: Gemini (lib/ai/gemini.ts). Tests stub
// `fetch` (the adapter's only way out), which keeps every request, tool call and usage count testable.
import type { CallUsage } from "../credits";
import { capabilitiesOf, type ModelCapabilities } from "./capabilities";
import { fail } from "../errors";
import { connectToken, connectUrl, isServerEdition } from "../edition";
import { geminiKey, geminiProvider, setServerGemini } from "./gemini";
import { withMemory } from "./memory";
import { openAiProvider } from "./openai";
import { internal } from "../../_generated/api";
import type { QueryCtx } from "../../_generated/server";
import { readServerSettings, serverAiSettingsOf } from "../serverSettings";

/** One piece of a message: text, a file sent inline (base64), or a file the provider already holds. */
export type Part =
  | { text: string; thoughtSignature?: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType: string; fileUri: string } }
  | { functionCall: { name: string; args: Record<string, unknown>; id?: string }; thoughtSignature?: string }
  | { functionResponse: { name: string; response: Record<string, unknown>; id?: string } };

/** One turn of a conversation, as the provider sees it. */
export interface Content {
  role: "user" | "model";
  parts: Part[];
}

/** A tool the model may call (function calling); `parameters` is a JSON schema (OpenAPI subset). */
export interface ToolDeclaration {
  name: string;
  description: string;
  /** Left out for a tool without arguments. */
  parameters?: Record<string, unknown>;
}

/** A call the model asked for. The caller runs it (as the person) and answers with a functionResponse. */
export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  /** The provider's id for the call, when it gives one (sent back with the result). */
  id?: string;
}

export interface GenerateRequest {
  system: string;
  /** A single question (one user turn). */
  prompt: string;
  /** Earlier turns, before `prompt` (or the whole conversation when `prompt` is empty). */
  contents?: Content[];
  /** Files sent with `prompt` (images, PDFs, audio), for models that can read them. */
  attachments?: Part[];
  /** The fast, cheap model (titles, search terms, short rewrites). */
  fast?: boolean;
  /** Structured output: the reply is JSON. */
  json?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
  /** Tools the model may call instead of (or before) answering. */
  tools?: ToolDeclaration[];
  /** "none": the tools stay declared (earlier turns used them) but this reply must be text. */
  toolChoice?: "auto" | "none";
  /**
   * Ground the answer in Google Search results (lib/ai/web.ts). Never together with `tools`: not every
   * model takes Google Search and function declarations in one request, so a search is its own call and
   * its results go back to a tool loop as a tool result. The adapter drops the search when both are set.
   */
  searchGrounding?: boolean;
  /**
   * Leave out the person's saved preferences (lib/ai/memory.ts): calls that copy content out of a file
   * (reading, transcribing) must not be shaped by them.
   */
  noMemory?: boolean;
}

/** A web page a grounded answer drew on (Google's link to it, and its title, often the site's domain). */
export interface GroundingSource {
  uri: string;
  title: string;
}

/** A stretch of a grounded answer and the sources (indexes into `sources`) that back it. */
export interface GroundingSupport {
  text: string;
  sources: number[];
}

/** What a grounded answer was based on: the searches the model ran, the pages, and which text each backs. */
export interface Grounding {
  queries: string[];
  sources: GroundingSource[];
  supports: GroundingSupport[];
  /**
   * Google's Search Suggestions chip (searchEntryPoint.renderedContent: HTML and CSS), which Google's terms
   * require showing with a grounded answer. Untrusted markup: only ever shown in a sandboxed frame.
   */
  entryPoint?: string;
}

export interface GenerateResult {
  /** The answer's text (trimmed); empty when the model only called tools, or was stopped first. */
  text: string;
  toolCalls: ToolCall[];
  /**
   * The model's turn as it came back (text and tool calls, with any signatures the provider needs to see
   * again), to send back as the "model" turn of a multi-step exchange (the agent's tool loop).
   */
  parts: Part[];
  finish: string | null;
  /** Whether the person pressed Stop while it streamed. */
  stopped: boolean;
  model: string;
  usage: CallUsage;
  /** A grounded answer's searches and sources (searchGrounding). */
  grounding?: Grounding;
}

/**
 * Streams pieces of the answer as they arrive (the whole text so far). Returning false stops the stream
 * (the person pressed Stop).
 */
export type OnDelta = (textSoFar: string) => Promise<boolean>;

/** What texts are embedded for: "document" text to index, or a "query" to search the index with. */
export type EmbedTask = "document" | "query";

export interface EmbedResult {
  /** One unit-length vector per text, in order (EMBEDDING_DIMENSIONS each, lib/ai/retrieval.ts). */
  vectors: number[][];
  model: string;
  /** Input tokens (estimated when the provider doesn't say). Embeddings are platform-paid, never credits. */
  tokens: number;
}

export interface AiProvider {
  id: string;
  /** The models requests use (from the server's settings). */
  models(): { main: string; fast: string };
  /** The model `embed` uses (stored on every chunk, so a model change re-embeds). */
  embeddingModel(): string;
  /** Turns texts into vectors for semantic search. Fails with a person-readable error like `generate`. */
  embed(texts: string[], task: EmbedTask): Promise<EmbedResult>;
  /**
   * One request. Every answered call adds its token counts to `meter` (a reply that turned out unusable
   * was still billed). Fails with a person-readable error when the provider can't be reached.
   */
  generate(req: GenerateRequest, meter: CallUsage[], onDelta?: OnDelta): Promise<GenerateResult>;
  /** What a model can do, when the provider knows better than the model registry (lib/ai/capabilities.ts). */
  capabilities?(model: string): ModelCapabilities;
}

/**
 * The provider with the memory layer: a call made with a request's meter gets the person's preferences
 * added to its system prompt (lib/ai/memory.ts withMemory), whichever feature makes it.
 */
const active: AiProvider = { ...geminiProvider, generate: (req, meter, onDelta) => geminiProvider.generate(withMemory(req, meter), meter, onDelta) };

// ---------------------------------------------------------------------------------------------------
// Folevi Server: the provider comes from the server's settings (docs/self-hosting/CONTRACT.md §8 `ai`)
// ---------------------------------------------------------------------------------------------------

/** The server's AI settings, as convex/server.ts aiSettings returns them (keys included; backend only). */
export interface ServerAiSettings {
  mode: "off" | "folevi" | "gemini" | "openai";
  configured: boolean;
  gemini: { apiKey?: string; model?: string; embeddingModel?: string } | null;
  openai: { baseUrl: string; apiKey?: string; model: string; embeddingModel?: string } | null;
}

/** The model Folevi AI (the Connect gateway) answers with unless told otherwise. */
export const FOLEVI_AI_MODEL = "folevi-default";
export const FOLEVI_AI_EMBEDDING_MODEL = "folevi-embedding";

const OFF = "Foli AI is off on this server.";

/** A server with Foli AI off (or not set up): every request is refused plainly. */
const offProvider: AiProvider = {
  id: "off",
  models: () => ({ main: "off", fast: "off" }),
  embeddingModel: () => "off",
  embed: async () => fail("maintenance", OFF),
  generate: async () => fail("maintenance", OFF),
  capabilities: (model) => ({ ...capabilitiesOf(model), vision: false, audioIn: false, tools: false, searchGrounding: false }),
};

let serverAi: ServerAiSettings | null = null;
let serverActive: AiProvider = offProvider;

/** The provider for a server's settings (exported for tests). */
export function serverProviderFor(s: ServerAiSettings | null): AiProvider {
  if (!s || !s.configured) return offProvider;
  if (s.mode === "gemini" && s.gemini?.apiKey) return geminiProvider;
  if (s.mode === "openai" && s.openai) return openAiProvider({ id: "openai", baseUrl: s.openai.baseUrl, apiKey: s.openai.apiKey, model: s.openai.model, embeddingModel: s.openai.embeddingModel });
  if (s.mode === "folevi") {
    const token = connectToken();
    if (token) return openAiProvider({ id: "folevi", baseUrl: `${connectUrl()}/v1/ai`, apiKey: token, model: FOLEVI_AI_MODEL, embeddingModel: FOLEVI_AI_EMBEDDING_MODEL, sendDimensions: true });
  }
  return offProvider;
}

/** Puts a server's settings in force for this function run (no-op on Folevi Cloud). */
export function useServerAiSettings(s: ServerAiSettings | null): void {
  serverAi = s;
  setServerGemini(s?.mode === "gemini" && s.gemini ? { apiKey: s.gemini.apiKey, model: s.gemini.model, fastModel: s.gemini.model, embeddingModel: s.gemini.embeddingModel } : { apiKey: undefined });
  const p = serverProviderFor(s);
  serverActive = { ...p, generate: (req, meter, onDelta) => p.generate(withMemory(req, meter), meter, onDelta) };
}

type SettingsReader = { db: unknown } | { runQuery: (ref: never, args: never) => Promise<unknown> };

/**
 * Folevi Server: puts the server's AI settings in force before anything asks the provider (the provider is
 * chosen by the owner in the admin panel, not by environment variables). Called at the start of every function
 * that uses Foli AI; a query or mutation reads the settings directly, an action through convex/server.ts
 * aiSettings. Folevi Cloud: does nothing.
 */
export async function loadAiSettings(ctx: SettingsReader): Promise<void> {
  if (!isServerEdition()) return;
  if ("db" in ctx) {
    useServerAiSettings(serverAiSettingsOf(await readServerSettings(ctx as unknown as QueryCtx)));
    return;
  }
  useServerAiSettings((await ctx.runQuery(internal.server.aiSettings as never, {} as never)) as ServerAiSettings | null);
}

/** Whether Foli AI can answer at all (Folevi Cloud: a Gemini key; a server: its settings, once loaded). */
export function aiAvailable(): boolean {
  if (!isServerEdition()) return Boolean(geminiKey());
  return Boolean(serverAi?.configured) && serverActive.id !== "off";
}

/** Whether notes can be embedded for semantic search (a provider with an embedding model). */
export function embeddingsAvailable(): boolean {
  if (!isServerEdition()) return Boolean(geminiKey());
  const m = serverActive.embeddingModel();
  return aiAvailable() && m !== "none" && m !== "off";
}

/** The provider requests go to. */
export function provider(): AiProvider {
  return isServerEdition() ? serverActive : active;
}

/** What the model a request would use can do. */
export function capabilities(fast = false): ModelCapabilities & { model: string } {
  const p = provider();
  const m = p.models();
  const model = fast ? m.fast : m.main;
  return { ...(p.capabilities?.(model) ?? capabilitiesOf(model)), model };
}
