// Any OpenAI-compatible service as Foli AI's provider (Folevi Server only, docs/SELF_HOSTING_PLAN.md §7): the
// owner's own key or a model on the home network (Ollama, LM Studio, vLLM), and Folevi AI, which is the same API at
// `${FOLEVI_CONNECT_URL}/v1/ai` with the server's Connect token. Chat completions (streamed when the caller streams,
// with tool calls and JSON replies) and embeddings. A whole provider for lib/ai/provider.ts (a server's settings
// pick it), unlike lib/ai/openai.ts, which is Folevi Cloud's adapter for OpenAI's own Responses API.
//
// Privacy: prompts, note text and answers are never logged. Only the event, model, status and token counts are.
import { DECLINE_RULE, MAX_FREE_REFUSAL_CHARS, readDecline, SAFETY_RULE, visibleSoFar, type RefusalKind } from "@folevi/ai-prompts/safety";
import { fail } from "../errors";
import { tokensForChars, type CallUsage } from "../credits";
import { capabilitiesOf, type ModelCapabilities } from "./capabilities";
import type { AiProvider, Content, EmbedResult, EmbedTask, GenerateRequest, GenerateResult, OnDelta, Part, ToolCall } from "./provider";
import { EMBEDDING_DIMENSIONS, normalize } from "./retrieval";

export interface OpenAiSettings {
  /** "openai" for the owner's own service, "folevi" for Folevi AI (the names show in logs only). */
  id: "openai" | "folevi";
  /** The API's base address, ending before /chat/completions (for example http://192.168.1.20:11434/v1). */
  baseUrl: string;
  apiKey?: string;
  model: string;
  embeddingModel?: string;
  /** Ask for EMBEDDING_DIMENSIONS-long vectors (only services known to support `dimensions`). */
  sendDimensions?: boolean;
}

type ChatMessage =
  | { role: "system" | "user"; content: string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[] }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

type ChoiceDelta = { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] };
type Completion = {
  choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] }; delta?: ChoiceDelta; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

const RESPONSE_TIMEOUT_MS = 60_000;
const REPLY_TIMEOUT_MS = 180_000;
const STREAM_IDLE_MS = 60_000;
const STREAM_TOTAL_MS = 5 * 60_000;
const EMBED_TIMEOUT_MS = 60_000;
const EMBED_BATCH = 64;
const TOO_SLOW = "The AI took too long to answer. Try again shortly.";
const UNREACHABLE = "Foli AI couldn't be reached. Try again shortly.";

/** The system prompt with the safety rules (as lib/ai/gemini.ts adds them) and, for JSON, a reminder to answer in JSON. */
function systemOf(req: GenerateRequest): string {
  return `${req.system}\n\n${SAFETY_RULE}${req.json ? "\n\nAnswer with one JSON value only, no other text." : ` ${DECLINE_RULE}`}`;
}

const callId = (name: string, i: number) => `call_${i}_${name}`.slice(0, 64);

/** Folevi's conversation turns as OpenAI chat messages (images as data: URLs, tool calls and results paired by id). */
export function messagesOf(req: GenerateRequest): ChatMessage[] {
  const out: ChatMessage[] = [{ role: "system", content: systemOf(req) }];
  let n = 0;
  const pendingIds: string[] = [];
  const turns: Content[] = [...(req.contents ?? [])];
  const ask: Part[] = [...(req.prompt ? [{ text: req.prompt }] : []), ...(req.attachments ?? [])];
  if (ask.length) turns.push({ role: "user", parts: ask });
  for (const turn of turns) {
    if (turn.role === "model") {
      const text = turn.parts.map((p) => ("text" in p && !("functionCall" in p) ? p.text : "")).join("");
      const calls = turn.parts.flatMap((p) => ("functionCall" in p ? [p.functionCall] : []));
      const toolCalls = calls.map((c) => {
        const id = c.id ?? callId(c.name, n++);
        pendingIds.push(id);
        return { id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } };
      });
      out.push({ role: "assistant", content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
      continue;
    }
    const content: ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[] = [];
    for (const p of turn.parts) {
      if ("functionResponse" in p) {
        const id = p.functionResponse.id ?? pendingIds.shift() ?? callId(p.functionResponse.name, n++);
        out.push({ role: "tool", tool_call_id: id, content: JSON.stringify(p.functionResponse.response ?? {}) });
      } else if ("text" in p) content.push({ type: "text", text: p.text });
      else if ("inlineData" in p) content.push({ type: "image_url", image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } });
      // A file held by Gemini's Files API (fileData) can't be sent elsewhere; capabilities keep callers from it.
    }
    if (content.length) out.push({ role: "user", content: content.every((c) => c.type === "text") ? content.map((c) => (c as { text: string }).text).join("\n\n") : content });
  }
  return out;
}

/** The request body for /chat/completions. */
export function chatBody(req: GenerateRequest, model: string, stream: boolean): Record<string, unknown> {
  const tools = req.tools?.length ? req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters ?? { type: "object", properties: {} } } })) : undefined;
  return {
    model,
    messages: messagesOf(req),
    temperature: req.temperature ?? 0.6,
    max_tokens: req.maxOutputTokens ?? 2048,
    ...(tools ? { tools, ...(req.toolChoice === "none" ? { tool_choice: "none" } : {}) } : {}),
    ...(req.json ? { response_format: { type: "json_object" } } : {}),
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
  };
}

function charsSent(req: GenerateRequest): number {
  let n = req.system.length + req.prompt.length;
  for (const p of [...(req.contents ?? []).flatMap((c) => c.parts), ...(req.attachments ?? [])]) {
    if ("text" in p) n += p.text.length;
    else if ("functionCall" in p) n += JSON.stringify(p.functionCall.args).length;
    else if ("functionResponse" in p) n += JSON.stringify(p.functionResponse.response).length;
    else if ("inlineData" in p) n += p.inlineData.data.length;
  }
  return n;
}

function usageOf(model: string, u: Completion["usage"], req: GenerateRequest, text: string): CallUsage {
  if (u && typeof u.prompt_tokens === "number") return { model, promptTokens: u.prompt_tokens, outputTokens: u.completion_tokens ?? 0, thoughtsTokens: 0 };
  return { model, promptTokens: tokensForChars(charsSent(req)), outputTokens: tokensForChars(text.length), thoughtsTokens: 0 };
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function refusalOf(raw: string, finish: string | null): { text: string; refused?: { kind: RefusalKind; free: boolean } } {
  const { text, declined } = readDecline(raw);
  const kind: RefusalKind | null = declined ?? (finish === "content_filter" ? "filtered" : null);
  return kind ? { text, refused: { kind, free: text.trim().length <= MAX_FREE_REFUSAL_CHARS } } : { text };
}

const headersOf = (s: OpenAiSettings) => ({ "content-type": "application/json", ...(s.apiKey ? { authorization: `Bearer ${s.apiKey}` } : {}) });

function failFor(status: number): never {
  if (status === 429) fail("rate_limited", "The AI is busy right now. Try again in a minute.");
  if (status === 401 || status === 403) fail("maintenance", "Foli AI isn't available right now (the server's AI key was refused).");
  if (status === 404) fail("maintenance", "Foli AI isn't available right now (the AI service doesn't know that model).");
  fail("maintenance", UNREACHABLE);
}

async function generate(s: OpenAiSettings, req: GenerateRequest, meter: CallUsage[], onDelta?: OnDelta): Promise<GenerateResult> {
  const model = s.model;
  const stream = Boolean(onDelta);
  const controller = new AbortController();
  let timedOut = false;
  const expire = () => {
    timedOut = true;
    controller.abort();
  };
  let idle: ReturnType<typeof setTimeout> | undefined;
  const waitAtMost = (ms: number) => {
    clearTimeout(idle);
    idle = setTimeout(expire, ms);
  };
  const total = setTimeout(expire, stream ? STREAM_TOTAL_MS : REPLY_TIMEOUT_MS);
  waitAtMost(stream ? RESPONSE_TIMEOUT_MS : REPLY_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(`${s.baseUrl}/chat/completions`, { method: "POST", signal: controller.signal, headers: headersOf(s), body: JSON.stringify(chatBody(req, model, stream)) });
    } catch {
      console.warn(JSON.stringify({ event: timedOut ? "ai.timeout" : "ai.error", provider: s.id, model, stream }));
      fail("maintenance", timedOut ? TOO_SLOW : UNREACHABLE);
    }
    if (!res.ok) {
      console.warn(JSON.stringify({ event: "ai.error", provider: s.id, model, status: res.status }));
      failFor(res.status);
    }
    let text = "";
    let finish: string | null = null;
    let usage: Completion["usage"];
    let stopped = false;
    const calls = new Map<number, { id?: string; name: string; args: string }>();
    const addCalls = (list: ChoiceDelta["tool_calls"] | undefined) => {
      for (const [i, c] of (list ?? []).entries()) {
        const at = c.index ?? i;
        const cur = calls.get(at) ?? { name: "", args: "" };
        if (c.id) cur.id = c.id;
        if (c.function?.name) cur.name += c.function.name;
        if (c.function?.arguments) cur.args += c.function.arguments;
        calls.set(at, cur);
      }
    };
    if (stream && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const take = (event: string) => {
        for (const line of event.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const data = JSON.parse(payload) as Completion;
            const choice = data.choices?.[0];
            if (choice?.delta?.content) text += choice.delta.content;
            addCalls(choice?.delta?.tool_calls);
            finish = choice?.finish_reason ?? finish;
            usage = data.usage ?? usage;
          } catch {
            /* a partial or keep-alive line */
          }
        }
      };
      while (!stopped) {
        waitAtMost(STREAM_IDLE_MS);
        let next: Awaited<ReturnType<typeof reader.read>>;
        try {
          next = await reader.read();
        } catch (e) {
          if (!timedOut) throw e;
          break;
        }
        if (next.done) break;
        buffer = (buffer + decoder.decode(next.value, { stream: true })).replace(/\r\n/g, "\n");
        let cut: number;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          take(buffer.slice(0, cut));
          buffer = buffer.slice(cut + 2);
          if (!(await onDelta!(visibleSoFar(text)))) {
            stopped = true;
            controller.abort();
            break;
          }
        }
      }
      if (!stopped && !timedOut && buffer.trim()) take(buffer);
    } else {
      let data: Completion;
      try {
        data = (await res.json()) as Completion;
      } catch {
        console.warn(JSON.stringify({ event: timedOut ? "ai.timeout" : "ai.error", provider: s.id, model, stream }));
        fail("maintenance", timedOut ? TOO_SLOW : UNREACHABLE);
      }
      const choice = data.choices?.[0];
      text = choice?.message?.content ?? "";
      addCalls(choice?.message?.tool_calls?.map((c, index) => ({ index, ...c })));
      finish = choice?.finish_reason ?? null;
      usage = data.usage;
    }
    const toolCalls: ToolCall[] = [...calls.values()].filter((c) => c.name).map((c) => ({ name: c.name, args: parseArgs(c.args), ...(c.id ? { id: c.id } : {}) }));
    const refusal = refusalOf(text, finish);
    const used: CallUsage = { ...usageOf(model, usage, req, text), ...(refusal.refused ? { refused: refusal.refused } : {}) };
    meter.push(used);
    console.log(JSON.stringify({ event: "ai.call", provider: s.id, model, status: res.status, stream, finish, stopped, timedOut, tokensIn: used.promptTokens, tokensOut: used.outputTokens, ...(refusal.refused ? { refused: refusal.refused.kind } : {}) }));
    if (timedOut) fail("maintenance", TOO_SLOW);
    const answer = refusal.text.trim();
    if (!answer && !stopped && !toolCalls.length) fail("invalid_argument", finish === "content_filter" ? "The AI couldn't help with that request." : "The AI returned nothing. Try rephrasing.");
    const parts: Part[] = [...(answer ? [{ text: answer }] : []), ...toolCalls.map((c) => ({ functionCall: c }))];
    return { text: answer, toolCalls, parts, finish, stopped, model, usage: used };
  } finally {
    clearTimeout(idle);
    clearTimeout(total);
  }
}

/**
 * A vector of EMBEDDING_DIMENSIONS for the search index, whatever length the model gave: longer ones are cut
 * (models trained for shortening keep their meaning in the first dimensions), shorter ones padded with zeros
 * (cosine similarity is unchanged), then normalized.
 */
export function fitVector(values: number[]): number[] {
  const fitted = values.length >= EMBEDDING_DIMENSIONS ? values.slice(0, EMBEDDING_DIMENSIONS) : [...values, ...new Array<number>(EMBEDDING_DIMENSIONS - values.length).fill(0)];
  return normalize(fitted);
}

async function embed(s: OpenAiSettings, texts: string[], task: EmbedTask): Promise<EmbedResult> {
  const model = s.embeddingModel;
  if (!model) fail("maintenance", "Semantic search isn't set up on this server (no embedding model).");
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${s.baseUrl}/embeddings`, {
        method: "POST",
        signal: controller.signal,
        headers: headersOf(s),
        body: JSON.stringify({ model, input: batch, ...(s.sendDimensions ? { dimensions: EMBEDDING_DIMENSIONS } : {}) }),
      });
    } catch {
      console.warn(JSON.stringify({ event: "ai.embed_timeout", provider: s.id, model }));
      fail("maintenance", TOO_SLOW);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      console.warn(JSON.stringify({ event: "ai.embed_error", provider: s.id, model, status: res.status }));
      failFor(res.status);
    }
    const data = (await res.json().catch(() => null)) as { data?: { embedding?: unknown; index?: number }[] } | null;
    const rows = [...(data?.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const got = rows.map((r) => (Array.isArray(r.embedding) ? (r.embedding as unknown[]).filter((x): x is number => typeof x === "number") : []));
    if (got.length !== batch.length || got.some((v) => v.length === 0)) {
      console.warn(JSON.stringify({ event: "ai.embed_error", provider: s.id, model, status: res.status, count: got.length }));
      fail("maintenance", UNREACHABLE);
    }
    vectors.push(...got.map(fitVector));
  }
  const tokens = tokensForChars(texts.reduce((n, t) => n + t.length, 0));
  console.log(JSON.stringify({ event: "ai.embed", provider: s.id, model, task, count: texts.length, tokensIn: tokens }));
  return { vectors, model, tokens };
}

/**
 * What a model behind an OpenAI-compatible API can do: chat, tools, JSON and images. No audio and no Google
 * Search grounding (those features say so and stay hidden). Priced like Gemini Flash so the server's monthly
 * limits per person count usage the same way.
 */
export function openAiCapabilities(model: string): ModelCapabilities {
  return { ...capabilitiesOf("chat"), audioIn: false, searchGrounding: false, longContext: false, contextWindow: 128_000, ...(/embed/i.test(model) ? { text: false, embeddings: true } : {}) };
}

export function openAiProvider(s: OpenAiSettings): AiProvider {
  return {
    id: s.id,
    // One model answers everything: the owner names one in the server's settings.
    models: () => ({ fast: s.model, main: s.model, heavy: s.model }),
    embeddingModel: () => s.embeddingModel ?? "none",
    capabilities: openAiCapabilities,
    generate: (req, meter, onDelta) => generate(s, req, meter, onDelta),
    embed: (texts, task) => embed(s, texts, task),
  };
}
