// Google Gemini over fetch (server-side only: the key never reaches a browser). The provider adapter for
// lib/ai/provider.ts. Settings: GEMINI_API_KEY, GEMINI_MODEL (main), GEMINI_FAST_MODEL (Flash-Lite),
// GEMINI_EMBEDDING_MODEL (semantic search).
//
// Privacy: prompts, note text and answers are never logged. Only the event, model, status and token
// counts are.
import { fail } from "../errors";
import { tokensForChars, type CallUsage } from "../credits";
import type { AiProvider, Content, EmbedResult, EmbedTask, GenerateRequest, GenerateResult, Grounding, OnDelta, Part, ToolCall } from "./provider";
import { capabilitiesOf } from "./capabilities";
import { EMBEDDING_DIMENSIONS, normalize } from "./retrieval";
import { attachmentTokens } from "./attachments";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
export const geminiModel = () => process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
export const geminiFastModel = () => process.env.GEMINI_FAST_MODEL ?? "gemini-flash-lite-latest";
/** Semantic search's embeddings (GEMINI_EMBEDDING_MODEL; lib/ai/capabilities.ts prices it). */
export const geminiEmbeddingModel = () => process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001";

type GeminiUsage = { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
type GeminiPart = { text?: string; thought?: boolean; thoughtSignature?: string; functionCall?: { name?: string; args?: Record<string, unknown>; id?: string } };
type GeminiGrounding = {
  webSearchQueries?: unknown[];
  groundingChunks?: { web?: { uri?: unknown; title?: unknown } }[];
  groundingSupports?: { segment?: { text?: unknown }; groundingChunkIndices?: unknown[] }[];
  searchEntryPoint?: { renderedContent?: unknown };
};
type GeminiChunk = { candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string; groundingMetadata?: GeminiGrounding }[]; usageMetadata?: GeminiUsage };

/** Characters sent in a request (for a usage estimate when none came back). */
function charsSent(req: GenerateRequest): number {
  let n = req.system.length + req.prompt.length;
  for (const p of [...(req.contents ?? []).flatMap((c) => c.parts), ...(req.attachments ?? [])]) {
    if ("text" in p) n += p.text.length;
    else if ("functionCall" in p) n += JSON.stringify(p.functionCall.args).length;
    else if ("functionResponse" in p) n += JSON.stringify(p.functionResponse.response).length;
    else if ("inlineData" in p) n += inlineChars(p.inlineData);
  }
  return n;
}

/** A file sent inline, as characters' worth of its tokens (lib/ai/attachments.ts estimates them). */
function inlineChars(d: { mimeType: string; data: string }): number {
  const kind = d.mimeType.startsWith("image/") ? "image" : d.mimeType.startsWith("audio/") ? "audio" : "pdf";
  return attachmentTokens(kind, Math.floor((d.data.length * 3) / 4)) * 4;
}

/**
 * A call's token counts, from Gemini's usage metadata (cumulative in a stream, so the last one counts).
 * Without any (a stream stopped before it arrived), estimated from the characters sent and received.
 */
function usageOf(model: string, meta: GeminiUsage | undefined, req: GenerateRequest, text: string): CallUsage {
  if (meta && typeof meta.promptTokenCount === "number") return { model, promptTokens: meta.promptTokenCount, outputTokens: meta.candidatesTokenCount ?? 0, thoughtsTokens: meta.thoughtsTokenCount ?? 0 };
  return { model, promptTokens: tokensForChars(charsSent(req)), outputTokens: tokensForChars(text.length), thoughtsTokens: 0 };
}

/**
 * A grounded answer's metadata (Google Search grounding): the queries it ran, the pages (web chunks with a
 * link and a title) and which stretches of text each backs. Anything malformed is left out.
 */
function groundingOf(data: GeminiChunk): Grounding | undefined {
  const g = data.candidates?.[0]?.groundingMetadata;
  if (!g) return undefined;
  const queries = (g.webSearchQueries ?? []).filter((q): q is string => typeof q === "string" && q.trim().length > 0).map((q) => q.slice(0, 300));
  const sources: Grounding["sources"] = [];
  const at = new Map<number, number>();
  for (const [i, c] of (g.groundingChunks ?? []).entries()) {
    const uri = c?.web?.uri;
    if (typeof uri !== "string" || !/^https?:\/\//i.test(uri)) continue;
    at.set(i, sources.length);
    sources.push({ uri: uri.slice(0, 2_000), title: typeof c.web?.title === "string" ? c.web.title.slice(0, 300) : "" });
  }
  const supports: Grounding["supports"] = [];
  for (const s of g.groundingSupports ?? []) {
    const text = typeof s?.segment?.text === "string" ? s.segment.text : "";
    const refs = (s?.groundingChunkIndices ?? []).filter((n): n is number => typeof n === "number" && at.has(n)).map((n) => at.get(n)!);
    if (text.trim() && refs.length) supports.push({ text: text.slice(0, 2_000), sources: [...new Set(refs)] });
  }
  if (!queries.length && !sources.length) return undefined;
  // Google's Search Suggestions chip, kept as Google wrote it (shown in a sandboxed frame), unless too large.
  const rendered = g.searchEntryPoint?.renderedContent;
  const entryPoint = typeof rendered === "string" && rendered.trim() && rendered.length <= MAX_ENTRY_POINT_CHARS ? rendered : undefined;
  return { queries, sources, supports, ...(entryPoint ? { entryPoint } : {}) };
}

/** Google Search queries a grounded reply ran (each is billed; a reply with sources ran at least one). */
/** The largest Search Suggestions chip kept (Google's HTML and CSS); a larger one is left out, never cut. */
export const MAX_ENTRY_POINT_CHARS = 32 * 1024;

const searchesOf = (g: Grounding | undefined) => (g ? Math.max(g.queries.length, g.sources.length ? 1 : 0) : 0);

/** A call's usage with the Google Search queries it ran (billed per query, lib/ai/capabilities.ts). */
const withSearches = (u: CallUsage, g: Grounding | undefined): CallUsage => (searchesOf(g) ? { ...u, searches: searchesOf(g) } : u);

const partsOf = (data: GeminiChunk) => data.candidates?.[0]?.content?.parts ?? [];
const textOf = (data: GeminiChunk) =>
  partsOf(data)
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
const callsOf = (data: GeminiChunk): ToolCall[] =>
  partsOf(data)
    .filter((p) => p.functionCall && typeof p.functionCall.name === "string")
    .map((p) => ({ name: p.functionCall!.name!, args: p.functionCall!.args ?? {}, ...(p.functionCall!.id ? { id: p.functionCall!.id } : {}) }));

/**
 * The model's turn to send back in the next request of a tool loop: its text and calls, each with the
 * thought signature Gemini 3 attached (a request that drops them is refused), never its thoughts.
 */
const modelPartsOf = (parts: GeminiPart[]): Part[] =>
  parts.flatMap((p): Part[] => {
    const sig = typeof p.thoughtSignature === "string" ? { thoughtSignature: p.thoughtSignature } : {};
    if (p.functionCall && typeof p.functionCall.name === "string") {
      return [{ functionCall: { name: p.functionCall.name, args: p.functionCall.args ?? {}, ...(p.functionCall.id ? { id: p.functionCall.id } : {}) }, ...sig }];
    }
    if (!p.thought && typeof p.text === "string" && (p.text || sig.thoughtSignature)) return [{ text: p.text, ...sig }];
    return [];
  });

/** The request body: the system prompt, the turns (earlier ones, then the question with any files), and settings. */
function bodyOf(req: GenerateRequest, model: string): string {
  const ask: Part[] = [...(req.prompt ? [{ text: req.prompt }] : []), ...(req.attachments ?? [])];
  const contents: Content[] = [...(req.contents ?? []), ...(ask.length ? [{ role: "user" as const, parts: ask }] : [])];
  // Google Search grounding goes in a request of its own: not every model takes it with function
  // declarations (lib/ai/provider.ts), so the declarations win and the search is left out.
  const tools = [
    ...(req.tools?.length ? [{ functionDeclarations: req.tools }] : []),
    ...(req.searchGrounding && !req.tools?.length ? [{ google_search: {} }] : []),
  ];
  return JSON.stringify({
    systemInstruction: { parts: [{ text: req.system }] },
    contents,
    ...(tools.length ? { tools } : {}),
    ...(req.tools?.length && req.toolChoice === "none" ? { toolConfig: { functionCallingConfig: { mode: "NONE" } } } : {}),
    generationConfig: {
      temperature: req.temperature ?? 0.6,
      maxOutputTokens: req.maxOutputTokens ?? 2048,
      ...(req.json ? { responseMimeType: "application/json" } : {}),
      // Light reasoning: first words in ~1.5 s instead of ~4 s, which matters when text streams in.
      ...(model.startsWith("gemini-3") ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
    },
  });
}

/** No answer to a request at all within this long (a streamed reply's first bytes): the call is given up. */
const RESPONSE_TIMEOUT_MS = 60_000;
/** A whole reply that isn't streamed (a flowchart's JSON can take a while to think through). */
const REPLY_TIMEOUT_MS = 120_000;
/** A stream that goes quiet this long between pieces has stalled. */
const STREAM_IDLE_MS = 30_000;
/** However well a stream is flowing, it ends by then (well inside an action's time limit). */
const STREAM_TOTAL_MS = 5 * 60_000;
const TOO_SLOW = "The AI took too long to answer. Try again shortly.";

/**
 * One call to Gemini. With `onDelta`, the reply streams (server-sent events) and each new piece of text is
 * passed on as it arrives; `onDelta` returning false stops the stream (the person pressed Stop). Falls back
 * to the lighter model once when the main one is busy, as long as nothing has been streamed yet. Every
 * answered call adds its token counts to `meter` (even one whose reply is unusable: it was still billed).
 * Every call has a deadline (no answer, a stalled stream, or a stream running too long), so a hung
 * connection can't hold the action, and the person's credit hold, until the platform kills it.
 */
async function generate(req: GenerateRequest, meter: CallUsage[], onDelta?: OnDelta): Promise<GenerateResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) fail("maintenance", "Foli isn't set up on this server yet.");
  // A grounded request only goes to models that can search (no fallback to one that can't).
  const models = (req.fast ? [geminiFastModel()] : [geminiModel(), geminiFastModel()]).filter((m, i) => i === 0 || !req.searchGrounding || capabilitiesOf(m).searchGrounding);
  let lastStatus = 0;
  for (const m of models) {
    const stream = Boolean(onDelta);
    // One controller for Stop and for the deadlines; `timedOut` tells them apart.
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
        res = await fetch(`${ENDPOINT}/${m}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`, {
          method: "POST",
          signal: controller.signal,
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body: bodyOf(req, m),
        });
      } catch (e) {
        if (!timedOut) throw e;
        console.warn(JSON.stringify({ event: "ai.timeout", model: m, stream }));
        fail("maintenance", TOO_SLOW);
      }
      lastStatus = res.status;
      if (res.ok && stream && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let text = "";
        const toolCalls: ToolCall[] = [];
        let finish: string | null = null;
        let stopped = false;
        let usage: GeminiUsage | undefined;
        let grounding: Grounding | undefined;
        const callParts: Part[] = [];
        // Server-sent events: one JSON object per "data:" line, events separated by a blank line (\n or \r\n).
        const take = (event: string) => {
          for (const line of event.split("\n")) {
            if (!line.startsWith("data:")) continue;
            try {
              const data = JSON.parse(line.slice(5)) as GeminiChunk;
              text += textOf(data);
              toolCalls.push(...callsOf(data));
              callParts.push(...modelPartsOf(partsOf(data)).filter((p) => "functionCall" in p));
              finish = data.candidates?.[0]?.finishReason ?? finish;
              usage = data.usageMetadata ?? usage;
              grounding = groundingOf(data) ?? grounding;
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
          const { done, value } = next;
          if (done) break;
          buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
          let cut: number;
          while ((cut = buffer.indexOf("\n\n")) >= 0) {
            take(buffer.slice(0, cut));
            buffer = buffer.slice(cut + 2);
            if (!(await onDelta!(text))) {
              stopped = true;
              controller.abort();
              break;
            }
          }
        }
        if (!stopped && !timedOut && buffer.trim()) take(buffer);
        // A stream cut off by its deadline was still billed for what it produced.
        const used = withSearches(usageOf(m, usage, req, text), grounding);
        meter.push(used);
        console.log(JSON.stringify({ event: "ai.call", model: m, status: res.status, stream: true, finish, stopped, timedOut, tokensIn: used.promptTokens, tokensOut: used.outputTokens + used.thoughtsTokens }));
        if (timedOut) fail("maintenance", TOO_SLOW);
        if (!text.trim() && !stopped && !toolCalls.length) fail("invalid_argument", finish === "SAFETY" ? "The AI couldn't help with that request." : "The AI returned nothing. Try rephrasing.");
        return { text: text.trim(), toolCalls, parts: [...(text ? [{ text }] : []), ...callParts], finish, stopped, model: m, usage: used, ...(grounding ? { grounding } : {}) };
      }
      if (res.ok) {
        let data: GeminiChunk;
        try {
          data = (await res.json()) as GeminiChunk;
        } catch (e) {
          if (!timedOut) throw e;
          console.warn(JSON.stringify({ event: "ai.timeout", model: m, stream }));
          fail("maintenance", TOO_SLOW);
        }
        const text = textOf(data).trim();
        const toolCalls = callsOf(data);
        const finish = data.candidates?.[0]?.finishReason ?? null;
        const grounding = groundingOf(data);
        const used = withSearches(usageOf(m, data.usageMetadata, req, text), grounding);
        meter.push(used);
        console.log(JSON.stringify({ event: "ai.call", model: m, status: res.status, finish, tokensIn: used.promptTokens, tokensOut: used.outputTokens + used.thoughtsTokens, ...(used.searches ? { searches: used.searches } : {}) }));
        if (!text && !toolCalls.length) fail("invalid_argument", finish === "SAFETY" ? "The AI couldn't help with that request." : "The AI returned nothing. Try rephrasing.");
        return { text, toolCalls, parts: modelPartsOf(partsOf(data)), finish, stopped: false, model: m, usage: used, ...(grounding ? { grounding } : {}) };
      }
      console.warn(JSON.stringify({ event: "ai.error", model: m, status: res.status }));
      if (res.status !== 429 && res.status !== 503 && res.status !== 500) break;
    } finally {
      clearTimeout(idle);
      clearTimeout(total);
    }
  }
  if (lastStatus === 429) fail("rate_limited", "The AI is busy right now. Try again in a minute.");
  if (lastStatus === 400 || lastStatus === 403) fail("maintenance", "Foli isn't available right now (the server's AI key was refused).");
  fail("maintenance", "Foli couldn't be reached. Try again shortly.");
}

/** Texts per batchEmbedContents request (Gemini's limit is 100). */
const EMBED_BATCH = 100;
/** A batch of embeddings answers well within this. */
const EMBED_TIMEOUT_MS = 30_000;

/**
 * Embeddings for semantic search: gemini-embedding-001 at 768 dimensions (batchEmbedContents), each vector
 * normalized (Google's truncated embeddings aren't). "document" texts are indexed, a "query" searches.
 * Platform-paid: the caller rate-limits per account, nothing is charged to credits. No usage comes back,
 * so tokens are estimated from the characters sent.
 */
async function embed(texts: string[], task: EmbedTask): Promise<EmbedResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) fail("maintenance", "Foli isn't set up on this server yet.");
  const model = geminiEmbeddingModel();
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${ENDPOINT}/${model}:batchEmbedContents`, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          requests: batch.map((text) => ({
            model: `models/${model}`,
            content: { parts: [{ text }] },
            taskType: task === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
            outputDimensionality: EMBEDDING_DIMENSIONS,
          })),
        }),
      });
    } catch {
      console.warn(JSON.stringify({ event: "ai.embed_timeout", model }));
      fail("maintenance", TOO_SLOW);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      console.warn(JSON.stringify({ event: "ai.embed_error", model, status: res.status }));
      if (res.status === 429) fail("rate_limited", "The AI is busy right now. Try again in a minute.");
      fail("maintenance", "Foli couldn't be reached. Try again shortly.");
    }
    const data = (await res.json().catch(() => null)) as { embeddings?: { values?: unknown }[] } | null;
    const got = (data?.embeddings ?? []).map((e) => (Array.isArray(e.values) ? (e.values as unknown[]).filter((x): x is number => typeof x === "number") : []));
    if (got.length !== batch.length || got.some((v) => v.length !== EMBEDDING_DIMENSIONS)) {
      console.warn(JSON.stringify({ event: "ai.embed_error", model, status: res.status, count: got.length }));
      fail("maintenance", "Foli couldn't be reached. Try again shortly.");
    }
    vectors.push(...got.map(normalize));
  }
  const tokens = tokensForChars(texts.reduce((n, t) => n + t.length, 0));
  console.log(JSON.stringify({ event: "ai.embed", model, task, count: texts.length, tokensIn: tokens }));
  return { vectors, model, tokens };
}

export const geminiProvider: AiProvider = {
  id: "gemini",
  models: () => ({ main: geminiModel(), fast: geminiFastModel() }),
  embeddingModel: geminiEmbeddingModel,
  generate,
  embed,
};
