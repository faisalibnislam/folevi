// The one interface every AI provider implements (docs/AI_ASSISTANT.md, "Provider layer"), so another
// provider is configuration, not a rewrite. Today there is one: Gemini (lib/ai/gemini.ts). Tests stub
// `fetch` (the adapter's only way out), which keeps every request, tool call and usage count testable.
import type { CallUsage } from "../credits";
import { capabilitiesOf, type ModelCapabilities } from "./capabilities";
import { geminiProvider } from "./gemini";

/** One piece of a message: text, a file sent inline (base64), or a file the provider already holds. */
export type Part =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType: string; fileUri: string } }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

/** One turn of a conversation, as the provider sees it. */
export interface Content {
  role: "user" | "model";
  parts: Part[];
}

/** A tool the model may call (function calling); `parameters` is a JSON schema (OpenAPI subset). */
export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** A call the model asked for. The caller runs it (as the person) and answers with a functionResponse. */
export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
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
  /** Ground the answer in Google Search results. */
  searchGrounding?: boolean;
}

export interface GenerateResult {
  /** The answer's text (trimmed); empty when the model only called tools, or was stopped first. */
  text: string;
  toolCalls: ToolCall[];
  finish: string | null;
  /** Whether the person pressed Stop while it streamed. */
  stopped: boolean;
  model: string;
  usage: CallUsage;
}

/**
 * Streams pieces of the answer as they arrive (the whole text so far). Returning false stops the stream
 * (the person pressed Stop).
 */
export type OnDelta = (textSoFar: string) => Promise<boolean>;

export interface AiProvider {
  id: string;
  /** The models requests use (from the server's settings). */
  models(): { main: string; fast: string };
  /**
   * One request. Every answered call adds its token counts to `meter` (a reply that turned out unusable
   * was still billed). Fails with a person-readable error when the provider can't be reached.
   */
  generate(req: GenerateRequest, meter: CallUsage[], onDelta?: OnDelta): Promise<GenerateResult>;
}

/** The provider requests go to. */
export function provider(): AiProvider {
  return geminiProvider;
}

/** What the model a request would use can do. */
export function capabilities(fast = false): ModelCapabilities & { model: string } {
  const p = provider().models();
  const model = fast ? p.fast : p.main;
  return { ...capabilitiesOf(model), model };
}
