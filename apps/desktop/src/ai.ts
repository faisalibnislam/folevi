// Foli AI in local mode on the Mac (docs/LOCAL_MODE_PLAN.md §4.1, §4.2, R10): `foleviShell.ai` and
// `foleviShell.secrets` for the built-in interface. A request goes either to Apple's on-device model, through
// the folevi-ai helper (native/folevi-ai.swift, JSON lines over stdio), or to one of the person's own providers
// (OpenAI, Anthropic, Google) over HTTPS with the key they stored. The keys stay in this process: they're read
// from safeStorage (secrets.ts) just before a request, go only in that provider's own header, and never reach
// the page, a log or an error message. Folevi's own servers are never contacted from here.
//
// No Electron imports (like authBridge.ts): main.ts passes in the session's fetch, the secret store and the
// helper, so the unit tests run the same code as the app.
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import type { SecretStore } from "./secrets";

// ---------------------------------------------------------------- the contract (apps/web/src/lib/shell/types.ts)

export type AiProviderId = "on-device" | "openai" | "anthropic" | "google";
export type AiKeyProvider = Exclude<AiProviderId, "on-device">;
export type PageSecretName = "ai.openai" | "ai.anthropic" | "ai.google";
export type OnDeviceStatus = "available" | "notSupported" | "notEnabled" | "notReady" | "unknown";

export interface AiCaps {
  onDevice: boolean;
  onDeviceStatus?: OnDeviceStatus;
  onDeviceContext?: number;
  keys: Partial<Record<PageSecretName, boolean>>;
}

export interface AiRequest {
  provider: AiProviderId;
  model?: string;
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
  schema?: unknown;
}

export type AiErrorCode = "auth" | "rate" | "context" | "network" | "unavailable" | "invalid";

export interface AiResult {
  text: string;
  stopReason: "end" | "length" | "cancelled" | "error";
  error?: string;
  errorCode?: AiErrorCode;
}

export type TestKeyResult = { ok: true } | { ok: false; error: string };

/** The IPC channels (main.ts registers them through registerAiIpc; preload.ts calls them by these names). */
export const AI_CHANNELS = {
  secretsHas: "shell:secrets-has",
  secretsSet: "shell:secrets-set",
  secretsDelete: "shell:secrets-delete",
  capabilities: "shell:ai-capabilities",
  generate: "shell:ai-generate",
  cancel: "shell:ai-cancel",
  testKey: "shell:ai-test-key",
  /** Main to page: (id, text), each new piece of an answer. */
  chunk: "shell:ai-chunk",
} as const;

// ---------------------------------------------------------------- providers and the host allowlist

export const KEY_PROVIDERS: readonly AiKeyProvider[] = ["openai", "anthropic", "google"];
const PROVIDERS: readonly AiProviderId[] = ["on-device", ...KEY_PROVIDERS];
export const PAGE_SECRETS: readonly PageSecretName[] = ["ai.openai", "ai.anthropic", "ai.google"];

/** The only hosts this module ever requests (https, default port). Never Folevi's own. */
export const AI_HOSTS: Readonly<Record<AiKeyProvider, string>> = {
  openai: "api.openai.com",
  anthropic: "api.anthropic.com",
  google: "generativelanguage.googleapis.com",
};

/** Used when a request names no model (checked against each provider's model list, 2026-10-20). */
export const DEFAULT_MODELS: Readonly<Record<AiKeyProvider, string>> = {
  openai: "gpt-6.1-sol",
  anthropic: "claude-sonnet-5-5",
  google: "gemini-3.8-flash",
};

const NAMES: Readonly<Record<AiKeyProvider, string>> = { openai: "OpenAI", anthropic: "Anthropic", google: "Google" };

const isKeyProvider = (v: unknown): v is AiKeyProvider => typeof v === "string" && (KEY_PROVIDERS as readonly string[]).includes(v);
export const isPageSecret = (v: unknown): v is PageSecretName => typeof v === "string" && (PAGE_SECRETS as readonly string[]).includes(v);
const secretOf = (p: AiKeyProvider): PageSecretName => `ai.${p}`;

/**
 * The one place a provider address is checked: https, exactly the provider's host, the default port, no user
 * or password. Every request this module makes passes through it (and the folevi-ai session refuses anything
 * else too, main.ts).
 */
export function allowedAiUrl(url: string, provider?: AiKeyProvider): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.port !== "" || u.username !== "" || u.password !== "") return false;
  const hosts = provider ? [AI_HOSTS[provider]] : Object.values(AI_HOSTS);
  return hosts.includes(u.hostname);
}

// ---------------------------------------------------------------- checking a request

export const MODEL_ID = /^[A-Za-z0-9._:-]{1,80}$/;
export const MAX_TURNS = 64;
/** The most bytes of text one request may carry (system, schema and every turn together). */
export const MAX_REQUEST_BYTES = 400 * 1024;
const MAX_SCHEMA_BYTES = 32 * 1024;

const JSON_ONLY = "Answer with one JSON value only: no Markdown fences, no text before or after it.";

/** A request from the page, checked field by field; anything else is refused with a plain reason. */
export function checkRequest(input: unknown): { ok: true; req: AiRequest } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });
  if (!input || typeof input !== "object" || Array.isArray(input)) return bad("Not a request Foli AI can send.");
  const r = input as Record<string, unknown>;
  if (typeof r.provider !== "string" || !(PROVIDERS as readonly string[]).includes(r.provider)) return bad("Foli AI can't use that provider.");
  const provider = r.provider as AiProviderId;
  if (r.model !== undefined && (typeof r.model !== "string" || !MODEL_ID.test(r.model) || r.model.startsWith("."))) return bad("That isn't a model name Foli AI can use.");
  if (r.system !== undefined && typeof r.system !== "string") return bad("Not a request Foli AI can send.");
  if (!Array.isArray(r.messages) || r.messages.length === 0 || r.messages.length > MAX_TURNS) return bad(`A request has between 1 and ${MAX_TURNS} messages.`);
  const messages: AiRequest["messages"] = [];
  for (const m of r.messages as unknown[]) {
    if (!m || typeof m !== "object") return bad("Not a request Foli AI can send.");
    const { role, content } = m as Record<string, unknown>;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return bad("Not a request Foli AI can send.");
    messages.push({ role, content });
  }
  if (messages[messages.length - 1]!.role !== "user") return bad("The last message of a request is the person's.");
  if (r.maxTokens !== undefined && (typeof r.maxTokens !== "number" || !Number.isInteger(r.maxTokens) || r.maxTokens < 1 || r.maxTokens > 32768)) return bad("maxTokens is between 1 and 32768.");
  if (r.temperature !== undefined && (typeof r.temperature !== "number" || !Number.isFinite(r.temperature) || r.temperature < 0 || r.temperature > 2)) return bad("temperature is between 0 and 2.");
  if (r.json !== undefined && typeof r.json !== "boolean") return bad("Not a request Foli AI can send.");
  let schemaText = "";
  if (r.schema !== undefined && r.schema !== null) {
    try {
      schemaText = JSON.stringify(r.schema) ?? "";
    } catch {
      return bad("The answer's schema isn't JSON.");
    }
    if (Buffer.byteLength(schemaText) > MAX_SCHEMA_BYTES) return bad("The answer's schema is too long.");
  }
  const system = typeof r.system === "string" ? r.system : undefined;
  const bytes = Buffer.byteLength(system ?? "") + Buffer.byteLength(schemaText) + messages.reduce((n, m) => n + Buffer.byteLength(m.content), 0);
  if (bytes > MAX_REQUEST_BYTES) return bad("This is too long for Foli AI to send in one request.");
  const req: AiRequest = { provider, messages };
  if (typeof r.model === "string") req.model = r.model;
  if (system !== undefined) req.system = system;
  if (r.maxTokens !== undefined) req.maxTokens = r.maxTokens as number;
  if (r.temperature !== undefined) req.temperature = r.temperature as number;
  if (r.json === true) req.json = true;
  if (schemaText) req.schema = JSON.parse(schemaText);
  return { ok: true, req };
}

/** The instructions sent: the page's system prompt, plus the JSON rule and the schema when asked for. */
function instructions(req: AiRequest): string | undefined {
  const parts: string[] = [];
  if (req.system) parts.push(req.system);
  if (req.json || req.schema !== undefined) parts.push(JSON_ONLY);
  if (req.schema !== undefined) parts.push(`The JSON follows this JSON Schema:\n${JSON.stringify(req.schema)}`);
  return parts.length ? parts.join("\n\n") : undefined;
}

// ---------------------------------------------------------------- server-sent events

export interface SseEvent {
  event: string;
  data: string;
}

/** An incremental text/event-stream parser: feed it text as it arrives (any split), get whole events. */
export class SseParser {
  private buffer = "";
  private event = "";
  private data: string[] = [];

  feed(text: string): SseEvent[] {
    this.buffer += text;
    const out: SseEvent[] = [];
    for (;;) {
      const m = /\r\n|\r|\n/.exec(this.buffer);
      // A lone \r at the very end may be the first half of \r\n: wait for more.
      if (!m || (m[0] === "\r" && m.index === this.buffer.length - 1)) break;
      const line = this.buffer.slice(0, m.index);
      this.buffer = this.buffer.slice(m.index + m[0].length);
      this.line(line, out);
    }
    return out;
  }

  /** The end of the stream: an event that wasn't followed by a blank line still counts. */
  end(): SseEvent[] {
    const out: SseEvent[] = [];
    if (this.buffer) this.line(this.buffer, out);
    this.buffer = "";
    this.line("", out);
    return out;
  }

  private line(line: string, out: SseEvent[]) {
    if (line === "") {
      if (this.data.length) out.push({ event: this.event || "message", data: this.data.join("\n") });
      this.event = "";
      this.data = [];
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.event = value;
    else if (field === "data") this.data.push(value);
  }
}

// ---------------------------------------------------------------- the providers' streams

/** What a stream said so far: new text, and how it ended. */
interface StreamState {
  text: string;
  stop?: AiResult["stopReason"];
  error?: string;
  errorCode?: AiErrorCode;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Applies one event to the state; returns the new text it carried. */
type EventHandler = (ev: SseEvent, state: StreamState) => string;

const contextHint = /context|too long|too many tokens|maximum.*tokens|token.*limit|exceeds/i;

export const openaiEvents: EventHandler = (ev, state) => {
  let d: Json;
  try {
    d = obj(JSON.parse(ev.data));
  } catch {
    return "";
  }
  const type = str(d.type) || ev.event;
  if (type === "response.output_text.delta") return str(d.delta);
  if (type === "response.completed") state.stop ??= "end";
  else if (type === "response.incomplete") {
    const reason = str(obj(obj(d.response).incomplete_details).reason);
    if (reason === "content_filter") {
      state.stop = "error";
      state.error = "OpenAI stopped this answer (its content filter).";
    } else state.stop = "length";
  } else if (type === "response.failed" || type === "error") {
    const e = type === "error" ? (d.error ? obj(d.error) : d) : obj(obj(d.response).error);
    const code = str(e.code);
    const message = str(e.message);
    state.stop = "error";
    if (code === "context_length_exceeded" || (code === "" && contextHint.test(message) && /context/i.test(message))) {
      state.errorCode = "context";
      state.error = "This is too long for OpenAI's model.";
    } else if (code === "rate_limit_exceeded") {
      state.errorCode = "rate";
      state.error = "OpenAI asked Foli AI to slow down. Try again in a moment.";
    } else state.error = message ? `OpenAI: ${message}` : "OpenAI couldn't answer.";
  }
  return "";
};

export const anthropicEvents: EventHandler = (ev, state) => {
  let d: Json;
  try {
    d = obj(JSON.parse(ev.data));
  } catch {
    return "";
  }
  const type = str(d.type) || ev.event;
  if (type === "content_block_delta") {
    const delta = obj(d.delta);
    // Thinking (thinking_delta, signature_delta) and tool input aren't part of the answer.
    return delta.type === "text_delta" ? str(delta.text) : "";
  }
  if (type === "message_delta") {
    const reason = str(obj(d.delta).stop_reason);
    if (reason === "max_tokens" || reason === "model_context_window_exceeded") state.stop = "length";
    else if (reason === "refusal") {
      state.stop = "error";
      state.error = "Claude declined to answer this.";
    } else if (reason) state.stop = "end";
  } else if (type === "message_stop") state.stop ??= "end";
  else if (type === "error") {
    const e = obj(d.error);
    state.stop = "error";
    if (e.type === "rate_limit_error" || e.type === "overloaded_error") {
      state.errorCode = "rate";
      state.error = "Anthropic asked Foli AI to slow down. Try again in a moment.";
    } else state.error = str(e.message) ? `Anthropic: ${str(e.message)}` : "Anthropic couldn't answer.";
  }
  return "";
};

export const googleEvents: EventHandler = (ev, state) => {
  let d: Json;
  try {
    d = obj(JSON.parse(ev.data));
  } catch {
    return "";
  }
  if (d.error) {
    const e = obj(d.error);
    state.stop = "error";
    state.error = str(e.message) ? `Google: ${str(e.message)}` : "Google couldn't answer.";
    return "";
  }
  const blocked = str(obj(d.promptFeedback).blockReason);
  if (blocked) {
    state.stop = "error";
    state.error = `Gemini didn't answer this (${blocked.toLowerCase()}).`;
    return "";
  }
  const candidate = obj(Array.isArray(d.candidates) ? d.candidates[0] : undefined);
  const parts = Array.isArray(obj(candidate.content).parts) ? (obj(candidate.content).parts as unknown[]) : [];
  // Thought summaries (thought: true) aren't part of the answer.
  const text = parts.map((p) => (obj(p).thought === true ? "" : str(obj(p).text))).join("");
  const finish = str(candidate.finishReason);
  if (finish === "MAX_TOKENS") state.stop = "length";
  else if (finish === "STOP") state.stop = "end";
  else if (finish && finish !== "FINISH_REASON_UNSPECIFIED") {
    state.stop = "error";
    state.error = `Gemini stopped this answer (${finish.toLowerCase().replace(/_/g, " ")}).`;
  }
  return text;
};

const HANDLERS: Readonly<Record<AiKeyProvider, EventHandler>> = { openai: openaiEvents, anthropic: anthropicEvents, google: googleEvents };

/**
 * Room for the providers' reasoning on top of the answer: current models think before they write, and their
 * limits (max_output_tokens, max_tokens, maxOutputTokens) count both.
 */
export const REASONING_HEADROOM = 2048;
const ANTHROPIC_DEFAULT_MAX = 8192;

/** The HTTPS request for one generation (or, with `probe`, a tiny one that checks the key). */
export function buildRequest(provider: AiKeyProvider, req: AiRequest, key: string, probe = false): { url: string; headers: Record<string, string>; body: string } {
  const model = req.model ?? DEFAULT_MODELS[provider];
  if (!MODEL_ID.test(model) || model.startsWith(".")) throw new Error("That isn't a model name Foli AI can use.");
  const system = instructions(req);
  const budget = req.maxTokens === undefined ? undefined : req.maxTokens + REASONING_HEADROOM;
  if (provider === "openai") {
    // The Responses API. Current GPT models reason, and with reasoning on they refuse `temperature`.
    const body: Json = {
      model,
      input: req.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: !probe,
      store: false,
      reasoning: { effort: "low" },
    };
    if (system) body.instructions = system;
    if (probe) body.max_output_tokens = 16;
    else if (budget !== undefined) body.max_output_tokens = budget;
    if (req.json || req.schema !== undefined) body.text = { format: { type: "json_object" } };
    return { url: "https://api.openai.com/v1/responses", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(body) };
  }
  if (provider === "anthropic") {
    // Current Claude models think adaptively and refuse a non-default temperature: neither is sent. No JSON
    // mode: the instructions ask for JSON.
    const body: Json = {
      model,
      max_tokens: probe ? 8 : (budget ?? ANTHROPIC_DEFAULT_MAX),
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: !probe,
    };
    if (system) body.system = system;
    return {
      url: "https://api.anthropic.com/v1/messages",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    };
  }
  // Google: the key goes in its header, never in the address.
  const generationConfig: Json = {};
  if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
  if (probe) generationConfig.maxOutputTokens = 8;
  else if (budget !== undefined) generationConfig.maxOutputTokens = budget;
  if (req.json || req.schema !== undefined) generationConfig.responseMimeType = "application/json";
  const body: Json = {
    contents: req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    generationConfig,
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const path = `/v1beta/models/${encodeURIComponent(model)}:${probe ? "generateContent" : "streamGenerateContent"}`;
  const url = new URL(`https://generativelanguage.googleapis.com${path}`);
  if (!probe) url.searchParams.set("alt", "sse");
  // The model can't move the request anywhere else on the host (no dot segments, nothing escaped).
  if (url.pathname !== path) throw new Error("That isn't a model name Foli AI can use.");
  return { url: url.href, headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) };
}

/** Removes the key (and anything shaped like a provider key) from text before it goes anywhere. */
export function scrub(text: string, key: string | null): string {
  let out = text;
  if (key) out = out.split(key).join("[key]");
  return out.replace(/\b(sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{20,})/g, "[key]");
}

/** What an HTTP error from a provider means, in words for people (never the key). */
export function httpError(provider: AiKeyProvider, status: number, body: string, model: string): { error: string; errorCode?: AiErrorCode } {
  const name = NAMES[provider];
  let message = "";
  let code = "";
  try {
    const d = obj(JSON.parse(body));
    const e = obj(d.error);
    message = str(e.message) || str(d.message);
    code = str(e.code) || str(e.type) || str(e.status);
    const details = Array.isArray(e.details) ? (e.details as unknown[]).map((x) => str(obj(x).reason)).join(" ") : "";
    if (details) code = `${code} ${details}`;
  } catch {
    message = "";
  }
  if (status === 401 || status === 403 || /API_KEY_INVALID|API key not valid|invalid.api.key|authentication_error/i.test(`${code} ${message}`)) {
    return { error: `The ${name} key was refused. Check it in Settings > AI.`, errorCode: "auth" };
  }
  if (status === 429) {
    if (/insufficient_quota|quota|billing|credit/i.test(`${code} ${message}`)) return { error: `The ${name} account is out of credit or over its quota.`, errorCode: "rate" };
    return { error: `${name} asked Foli AI to slow down. Try again in a moment.`, errorCode: "rate" };
  }
  if ((status === 400 || status === 413) && (/context_length_exceeded/.test(code) || contextHint.test(message))) {
    return { error: `This is too long for ${name}'s model.`, errorCode: "context" };
  }
  if (status === 404) return { error: `${name} doesn't offer the model "${model}" to this key.`, errorCode: "invalid" };
  if (status >= 500) return { error: `${name} isn't answering right now. Try again later.`, errorCode: "unavailable" };
  const said = message ? `: ${message.slice(0, 300)}` : "";
  return { error: `${name} refused the request (${status})${said}`, errorCode: status === 400 ? "invalid" : undefined };
}

// ---------------------------------------------------------------- the on-device helper

export type SpawnLike = (path: string, args: string[], options: { stdio: ["pipe", "pipe", "ignore"] }) => ChildProcess;

type HelperReply = Record<string, unknown>;

/**
 * A JSON-lines client for folevi-ai: started when first needed, started again when it has died (at most a few
 * times a minute). Replies are routed to their request's listener by id.
 */
export class HelperClient {
  private child: ChildProcess | null = null;
  private buffer = "";
  private listeners = new Map<string, (reply: HelperReply | null) => boolean>();
  private starts: number[] = [];
  private disposed = false;
  private seq = 0;

  constructor(private readonly opts: { path: string; spawn?: SpawnLike; exists?: (path: string) => boolean }) {}

  /** Whether the helper's binary is there at all. */
  installed(): boolean {
    return (this.opts.exists ?? existsSync)(this.opts.path);
  }

  private ensure(): ChildProcess | null {
    if (this.child) return this.child;
    if (this.disposed || !this.installed()) return null;
    const now = Date.now();
    this.starts = this.starts.filter((t) => now - t < 60_000);
    if (this.starts.length >= 5) return null;
    this.starts.push(now);
    let child: ChildProcess;
    try {
      child = (this.opts.spawn ?? (nodeSpawn as unknown as SpawnLike))(this.opts.path, [], { stdio: ["pipe", "pipe", "ignore"] });
    } catch {
      return null;
    }
    this.child = child;
    this.buffer = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.data(chunk));
    child.stdin?.on("error", () => undefined);
    const gone = () => {
      if (this.child !== child) return;
      this.child = null;
      // Everything waiting hears that the helper is gone.
      const waiting = [...this.listeners.values()];
      this.listeners.clear();
      for (const l of waiting) l(null);
    };
    child.on("error", gone);
    child.on("exit", gone);
    return child;
  }

  private data(chunk: string) {
    this.buffer += chunk;
    if (this.buffer.length > 8 * 1024 * 1024) {
      this.child?.kill("SIGKILL");
      return;
    }
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      let reply: HelperReply;
      try {
        reply = obj(JSON.parse(line));
      } catch {
        continue;
      }
      const id = typeof reply.id === "string" ? reply.id : "";
      const listener = this.listeners.get(id);
      if (listener && listener(reply)) this.listeners.delete(id);
    }
  }

  /**
   * Sends a request under a new id (returned); `onReply` gets each reply for it (or null if the helper died)
   * and returns true on the last one. Null when the helper can't be started.
   */
  request(message: { op: string } & Record<string, unknown>, onReply: (reply: HelperReply | null) => boolean): string | null {
    const child = this.ensure();
    if (!child?.stdin) return null;
    this.seq += 1;
    const id = `r${this.seq}`;
    this.listeners.set(id, onReply);
    child.stdin.write(`${JSON.stringify({ ...message, id })}\n`);
    return id;
  }

  /** Stops a generation (the helper answers it "cancelled"). */
  cancel(id: string) {
    this.child?.stdin?.write(`${JSON.stringify({ id, op: "cancel" })}\n`);
  }

  forget(id: string) {
    this.listeners.delete(id);
  }

  dispose() {
    this.disposed = true;
    const child = this.child;
    this.child = null;
    for (const l of this.listeners.values()) l(null);
    this.listeners.clear();
    child?.stdin?.end();
    child?.kill();
  }
}

const ON_DEVICE: readonly OnDeviceStatus[] = ["available", "notSupported", "notEnabled", "notReady", "unknown"];
const ERROR_CODES: readonly AiErrorCode[] = ["auth", "rate", "context", "network", "unavailable", "invalid"];
const STOPS: readonly AiResult["stopReason"][] = ["end", "length", "cancelled", "error"];

// ---------------------------------------------------------------- the service

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal; redirect: "error" }) => Promise<Response>;

export interface AiServiceDeps {
  /** The folevi-ai session's fetch (no cookies, main.ts). */
  fetch: FetchLike;
  secrets: Pick<SecretStore, "get" | "has">;
  /** The helper's client, or null when this build has none. */
  helper: () => HelperClient | null;
  /** How long a stream may go quiet before it counts as lost. */
  idleMs?: number;
}

/** How long an availability answer is reused. */
const AVAILABILITY_TTL = 10_000;

export class AiService {
  private availability: { at: number; value: { status: OnDeviceStatus; context?: number } } | null = null;
  private asking: Promise<{ status: OnDeviceStatus; context?: number }> | null = null;

  constructor(private readonly deps: AiServiceDeps) {}

  /** Apple's model on this Mac: asked of the helper, reused for a few seconds. */
  onDevice(): Promise<{ status: OnDeviceStatus; context?: number }> {
    const cached = this.availability;
    if (cached && Date.now() - cached.at < AVAILABILITY_TTL) return Promise.resolve(cached.value);
    if (this.asking) return this.asking;
    const ask = new Promise<{ status: OnDeviceStatus; context?: number }>((resolve) => {
      const helper = this.deps.helper();
      if (!helper || !helper.installed()) return resolve({ status: "unknown" });
      let id: string | null = null;
      const timer = setTimeout(() => {
        if (id) helper.forget(id);
        resolve({ status: "unknown" });
      }, 5000);
      id = helper.request({ op: "availability" }, (reply) => {
        clearTimeout(timer);
        const status = reply && (ON_DEVICE as readonly unknown[]).includes(reply.availability) ? (reply.availability as OnDeviceStatus) : "unknown";
        const context = reply && typeof reply.contextTokens === "number" && reply.contextTokens > 0 ? Math.floor(reply.contextTokens) : undefined;
        resolve(context ? { status, context } : { status });
        return true;
      });
      if (!id) {
        clearTimeout(timer);
        resolve({ status: "unknown" });
      }
    }).then((value) => {
      // An answer from a working helper is kept a moment; "unknown" is asked again next time.
      this.availability = value.status === "unknown" ? null : { at: Date.now(), value };
      this.asking = null;
      return value;
    });
    this.asking = ask;
    return ask;
  }

  async capabilities(): Promise<AiCaps> {
    const device = await this.onDevice();
    const keys: Partial<Record<PageSecretName, boolean>> = {};
    for (const name of PAGE_SECRETS) keys[name] = this.deps.secrets.has(name);
    const caps: AiCaps = { onDevice: device.status === "available", onDeviceStatus: device.status, keys };
    if (device.context) caps.onDeviceContext = device.context;
    return caps;
  }

  /** Tokens in `text` for Apple's model (the helper's count when macOS has one, else about 4 characters each). */
  async countTokens(text: string): Promise<number> {
    const estimate = Math.ceil(text.length / 4);
    const helper = this.deps.helper();
    if (!helper || !helper.installed()) return estimate;
    return new Promise((resolve) => {
      let id: string | null = null;
      const timer = setTimeout(() => {
        if (id) helper.forget(id);
        resolve(estimate);
      }, 5000);
      id = helper.request({ op: "countTokens", text }, (reply) => {
        clearTimeout(timer);
        resolve(reply && typeof reply.tokens === "number" ? reply.tokens : estimate);
        return true;
      });
      if (!id) {
        clearTimeout(timer);
        resolve(estimate);
      }
    });
  }

  /** Streams an answer: `onChunk` gets each new piece; `done` has the whole text and how it ended. */
  generate(input: unknown, onChunk: (text: string) => void): { done: Promise<AiResult>; cancel(): void } {
    const checked = checkRequest(input);
    if (!checked.ok) return { done: Promise.resolve({ text: "", stopReason: "error", error: checked.error, errorCode: "invalid" }), cancel: () => undefined };
    const req = checked.req;
    return req.provider === "on-device" ? this.onDeviceGenerate(req, onChunk) : this.remoteGenerate(req.provider, req, onChunk);
  }

  private onDeviceGenerate(req: AiRequest, onChunk: (text: string) => void): { done: Promise<AiResult>; cancel(): void } {
    const helper = this.deps.helper();
    let text = "";
    let settle: (r: AiResult) => void = () => undefined;
    let settled = false;
    const done = new Promise<AiResult>((resolve) => {
      settle = (r) => {
        if (settled) return;
        settled = true;
        resolve(r);
      };
    });
    const unavailable = () => settle({ text, stopReason: "error", error: "Apple's on-device model isn't available on this Mac.", errorCode: "unavailable" });
    if (!helper || !helper.installed()) {
      unavailable();
      return { done, cancel: () => undefined };
    }
    const message: { op: string } & Record<string, unknown> = { op: "generate", messages: req.messages, json: req.json === true || req.schema !== undefined };
    const system = instructions(req);
    if (system) message.system = system;
    if (req.maxTokens !== undefined) message.maxTokens = req.maxTokens;
    if (req.temperature !== undefined) message.temperature = req.temperature;
    const id = helper.request(message, (reply) => {
      if (!reply) {
        settle({ text, stopReason: "error", error: "Apple's on-device model stopped unexpectedly. Try again.", errorCode: "unavailable" });
        return true;
      }
      if (typeof reply.delta === "string" && reply.delta) {
        text += reply.delta;
        if (!settled) onChunk(reply.delta);
      }
      if (reply.done !== true) return false;
      const stopReason = (STOPS as readonly unknown[]).includes(reply.stopReason) ? (reply.stopReason as AiResult["stopReason"]) : "error";
      const result: AiResult = { text: typeof reply.text === "string" ? reply.text : text, stopReason };
      if (typeof reply.error === "string" && reply.error) result.error = reply.error.slice(0, 500);
      if ((ERROR_CODES as readonly unknown[]).includes(reply.errorCode)) result.errorCode = reply.errorCode as AiErrorCode;
      settle(result);
      return true;
    });
    if (!id) {
      unavailable();
      return { done, cancel: () => undefined };
    }
    return {
      done,
      cancel: () => {
        if (settled) return;
        helper.cancel(id);
        // The helper answers "cancelled" itself; if it doesn't soon, the request ends here.
        setTimeout(() => {
          helper.forget(id);
          settle({ text, stopReason: "cancelled" });
        }, 2000).unref?.();
      },
    };
  }

  private remoteGenerate(provider: AiKeyProvider, req: AiRequest, onChunk: (text: string) => void): { done: Promise<AiResult>; cancel(): void } {
    const controller = new AbortController();
    let cancelled = false;
    const done = this.stream(provider, req, onChunk, controller, () => cancelled);
    return {
      done,
      cancel: () => {
        cancelled = true;
        controller.abort();
      },
    };
  }

  /** One request to a provider, only to its allowed address, with its key read just now. */
  private async send(provider: AiKeyProvider, req: AiRequest, signal: AbortSignal, probe: boolean): Promise<{ res: Response; key: string } | { error: string; errorCode: AiErrorCode }> {
    const key = this.deps.secrets.get(secretOf(provider));
    if (!key) return { error: `Add your ${NAMES[provider]} key in Settings > AI first.`, errorCode: "auth" };
    let built: ReturnType<typeof buildRequest>;
    try {
      built = buildRequest(provider, req, key, probe);
    } catch (e) {
      return { error: e instanceof Error ? scrub(e.message, key) : "Not a request Foli AI can send.", errorCode: "invalid" };
    }
    if (!allowedAiUrl(built.url, provider)) return { error: "Foli AI only talks to the provider's own address.", errorCode: "invalid" };
    const res = await this.deps.fetch(built.url, { method: "POST", headers: built.headers, body: built.body, signal, redirect: "error" });
    // Never followed: an answer that moved elsewhere is refused.
    if (res.redirected || (res.status >= 300 && res.status < 400) || (res.url && !allowedAiUrl(res.url, provider))) {
      await res.body?.cancel().catch(() => undefined);
      return { error: `${NAMES[provider]} answered from somewhere else; Foli AI didn't follow.`, errorCode: "network" };
    }
    return { res, key };
  }

  private async stream(provider: AiKeyProvider, req: AiRequest, onChunk: (text: string) => void, controller: AbortController, isCancelled: () => boolean): Promise<AiResult> {
    const state: StreamState = { text: "" };
    let key: string | null = null;
    let idle: NodeJS.Timeout | undefined;
    let timedOut = false;
    const idleMs = this.deps.idleMs ?? 90_000;
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, idleMs);
    };
    const result = (r: AiResult): AiResult => {
      clearTimeout(idle);
      if (r.error) r.error = scrub(r.error, key);
      return r;
    };
    try {
      touch();
      const sent = await this.send(provider, req, controller.signal, false);
      if ("error" in sent) return result({ text: "", stopReason: "error", error: sent.error, errorCode: sent.errorCode });
      key = sent.key;
      const res = sent.res;
      if (!res.ok) {
        const body = (await res.text().catch(() => "")).slice(0, 65536);
        const e = httpError(provider, res.status, body, req.model ?? DEFAULT_MODELS[provider]);
        return result({ text: "", stopReason: "error", error: e.error, ...(e.errorCode ? { errorCode: e.errorCode } : {}) });
      }
      if (!res.body) return result({ text: "", stopReason: "error", error: `${NAMES[provider]} sent no answer.`, errorCode: "network" });
      const handle = HANDLERS[provider];
      const parser = new SseParser();
      const decoder = new TextDecoder();
      const reader = res.body.getReader();
      // An abort ends the read even if the body doesn't notice it itself.
      controller.signal.addEventListener("abort", () => void reader.cancel().catch(() => undefined), { once: true });
      const apply = (events: SseEvent[]) => {
        for (const ev of events) {
          const piece = handle(ev, state);
          if (piece) {
            state.text += piece;
            onChunk(piece);
          }
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (controller.signal.aborted) throw new Error("aborted");
        if (done) break;
        touch();
        apply(parser.feed(decoder.decode(value, { stream: true })));
      }
      apply(parser.feed(decoder.decode()));
      apply(parser.end());
      if (!state.stop) {
        // Gemini's stream simply ends; the others always say how it ended, so a silent end was cut off.
        if (provider === "google") state.stop = "end";
        else return result({ text: state.text, stopReason: "error", error: `The answer from ${NAMES[provider]} was cut off.`, errorCode: "network" });
      }
      const r: AiResult = { text: state.text, stopReason: state.stop };
      if (state.error) r.error = state.error;
      if (state.errorCode) r.errorCode = state.errorCode;
      return result(r);
    } catch {
      if (isCancelled()) return result({ text: state.text, stopReason: "cancelled" });
      if (timedOut) return result({ text: state.text, stopReason: "error", error: `${NAMES[provider]} stopped answering.`, errorCode: "network" });
      return result({ text: state.text, stopReason: "error", error: `Foli AI couldn't reach ${NAMES[provider]}. Check the connection.`, errorCode: "network" });
    }
  }

  /** Checks a stored key with one tiny request (Settings > AI, "Test"). */
  async testKey(provider: unknown): Promise<TestKeyResult> {
    if (!isKeyProvider(provider)) return { ok: false, error: "Foli AI can't use that provider." };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let key: string | null = null;
    try {
      const sent = await this.send(provider, { provider, messages: [{ role: "user", content: "Reply with OK." }] }, controller.signal, true);
      if ("error" in sent) return { ok: false, error: sent.error };
      key = sent.key;
      const body = (await sent.res.text().catch(() => "")).slice(0, 65536);
      if (sent.res.ok) return { ok: true };
      return { ok: false, error: scrub(httpError(provider, sent.res.status, body, DEFAULT_MODELS[provider]).error, key) };
    } catch {
      return { ok: false, error: `Foli AI couldn't reach ${NAMES[provider]}. Check the connection.` };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------- IPC (main.ts)

type Handle = (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => void;

/** The page that asked: a stable key, a way to send it chunks, and a hook for when it goes away. */
export interface AiSender {
  key: string;
  send(channel: string, ...args: unknown[]): void;
  onGone(cb: () => void): void;
}

const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PER_PAGE = 8;
const MAX_KEY = 4096;

/** A key as typed or pasted: trimmed, printable ASCII without spaces, of a sane length; else null. */
export function cleanKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > MAX_KEY || !/^[\x21-\x7e]+$/.test(v)) return null;
  return v;
}

/**
 * Registers the secrets and AI handlers (ipcMain.handle). `allowed` checks the call came from the bundled
 * interface's own page; the page may only name the three `ai.` secrets (never "auth.session").
 */
export function registerAiIpc(
  handle: Handle,
  deps: { service: () => AiService | null; secrets: () => Pick<SecretStore, "has" | "set" | "delete"> | null; allowed: (event: unknown) => boolean; sender: (event: unknown) => AiSender },
) {
  /** The generations in flight, by page and request id. */
  const running = new Map<string, Map<string, () => void>>();
  const watched = new Set<string>();

  handle(AI_CHANNELS.secretsHas, (e, name) => {
    const store = deps.secrets();
    if (!deps.allowed(e) || !store || !isPageSecret(name)) return false;
    return store.has(name);
  });
  handle(AI_CHANNELS.secretsSet, (e, name, value) => {
    const store = deps.secrets();
    if (!deps.allowed(e) || !store) return { ok: false, error: "Keys can't be kept in this build of Folevi for Mac." };
    if (!isPageSecret(name)) return { ok: false, error: "Folevi doesn't keep that secret." };
    const key = cleanKey(value);
    if (!key) return { ok: false, error: "That doesn't look like an API key." };
    try {
      store.set(name, key);
      return { ok: true };
    } catch (err) {
      // secrets.ts says why in plain words; nothing of the key is in its messages.
      return { ok: false, error: err instanceof Error ? scrub(err.message, key) : "Folevi couldn't keep that key." };
    }
  });
  handle(AI_CHANNELS.secretsDelete, (e, name) => {
    const store = deps.secrets();
    if (!deps.allowed(e) || !store) return { ok: false, error: "Keys can't be kept in this build of Folevi for Mac." };
    if (!isPageSecret(name)) return { ok: false, error: "Folevi doesn't keep that secret." };
    store.delete(name);
    return { ok: true };
  });
  handle(AI_CHANNELS.capabilities, async (e) => {
    const service = deps.service();
    if (!deps.allowed(e) || !service) return { onDevice: false, onDeviceStatus: "unknown", keys: {} } satisfies AiCaps;
    return service.capabilities();
  });
  handle(AI_CHANNELS.generate, async (e, id, req): Promise<AiResult> => {
    const service = deps.service();
    if (!deps.allowed(e) || !service) return { text: "", stopReason: "error", error: "Foli AI isn't in this build of Folevi for Mac.", errorCode: "unavailable" };
    if (typeof id !== "string" || !REQUEST_ID.test(id)) return { text: "", stopReason: "error", error: "Not a request Foli AI can send.", errorCode: "invalid" };
    const page = deps.sender(e);
    let mine = running.get(page.key);
    if (!mine) {
      mine = new Map();
      running.set(page.key, mine);
    }
    if (mine.has(id)) return { text: "", stopReason: "error", error: "That request is already running.", errorCode: "invalid" };
    if (mine.size >= MAX_PER_PAGE) return { text: "", stopReason: "error", error: "Foli AI is already answering several requests. Try again in a moment.", errorCode: "rate" };
    if (!watched.has(page.key)) {
      watched.add(page.key);
      // A closed window's generations stop.
      page.onGone(() => {
        watched.delete(page.key);
        const list = running.get(page.key);
        running.delete(page.key);
        for (const cancel of list?.values() ?? []) cancel();
      });
    }
    const g = service.generate(req, (text) => {
      try {
        page.send(AI_CHANNELS.chunk, id, text);
      } catch {
        /* The page went away; onGone cancels. */
      }
    });
    mine.set(id, g.cancel);
    try {
      return await g.done;
    } finally {
      running.get(page.key)?.delete(id);
    }
  });
  handle(AI_CHANNELS.cancel, (e, id) => {
    if (!deps.allowed(e) || typeof id !== "string") return null;
    running.get(deps.sender(e).key)?.get(id)?.();
    return null;
  });
  handle(AI_CHANNELS.testKey, async (e, provider): Promise<TestKeyResult> => {
    const service = deps.service();
    if (!deps.allowed(e) || !service) return { ok: false, error: "Foli AI isn't in this build of Folevi for Mac." };
    return service.testKey(provider);
  });
}
