// Google Gemini over fetch (server-side only: the key never reaches a browser). A provider adapter for
// lib/ai/provider.ts: the model and key come with each call (the feature's route, lib/ai/config.ts), the
// key from the admin panel or GEMINI_API_KEY. GEMINI_MODEL and GEMINI_FAST_MODEL seed the default models
// (lib/ai/config.ts defaultModels); GEMINI_EMBEDDING_MODEL picks semantic search's model.
//
// Privacy: prompts, note text and answers are never logged. Only the event, model, status and token
// counts are.
import { fail } from "../errors";
import { tokensForChars, type CallUsage } from "../credits";
import type { CallTarget, Content, EmbedResult, EmbedTask, GenerateRequest, GenerateResult, Grounding, OnDelta, Part, ProviderAdapter, ToolCall } from "./provider";
import { capabilitiesOf } from "./capabilities";
import { EMBEDDING_DIMENSIONS, normalize } from "./retrieval";
import { visibleSoFar } from "@folevi/ai-prompts/safety";
import { Deadline, emptyMessage, estimatedUsage, KEY_REFUSED, NOT_SET_UP, refusalOf as readRefusal, STREAM_IDLE_MS, systemWithSafety, TOO_SLOW, UNREACHABLE, BUSY, withoutMarker } from "./common";

export { systemWithSafety } from "./common";

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
type GeminiChunk = { candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string; groundingMetadata?: GeminiGrounding }[]; promptFeedback?: { blockReason?: string }; usageMetadata?: GeminiUsage };

/** Finish reasons that mean Gemini's filters stopped the reply (not that it ran out of room or had nothing to say). */
const BLOCKED_FINISH = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "IMAGE_SAFETY"]);
/**
 * Why a reply ended: the candidate's finish reason, or, when Gemini refused the question itself (no
 * candidate at all, only promptFeedback.blockReason), "BLOCKED_PROMPT".
 */
const finishOf = (data: GeminiChunk): string | null => data.candidates?.[0]?.finishReason ?? (data.promptFeedback?.blockReason ? "BLOCKED_PROMPT" : null);
const blocked = (finish: string | null) => finish === "BLOCKED_PROMPT" || (finish !== null && BLOCKED_FINISH.has(finish));
/**
 * A call's token counts, from Gemini's usage metadata (cumulative in a stream, so the last one counts).
 * Without any (a stream stopped before it arrived), estimated from the characters sent and received.
 */
function usageOf(model: string, meta: GeminiUsage | undefined, req: GenerateRequest, text: string): CallUsage {
  if (meta && typeof meta.promptTokenCount === "number") return { model, promptTokens: meta.promptTokenCount, outputTokens: meta.candidatesTokenCount ?? 0, thoughtsTokens: meta.thoughtsTokenCount ?? 0 };
  return estimatedUsage(model, req, text);
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

/**
 * Gemini's own filter, set rather than left at its defaults (which block very little): docs/AI_GUARDRAILS.md.
 * A reply it blocks finishes with SAFETY and is counted as "filtered".
 */
const SAFETY_SETTINGS = ["HARM_CATEGORY_DANGEROUS_CONTENT", "HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT"].map((category) => ({ category, threshold: "BLOCK_MEDIUM_AND_ABOVE" }));

/** What a reply declined, if it did: the marker the model wrote, or Gemini's filter (lib/ai/common.ts). */
const refusalOf = (raw: string, finish: string | null) => readRefusal(raw, blocked(finish));

/** The request body: the system prompt, the turns (earlier ones, then the question with any files), and settings. */
function bodyOf(req: GenerateRequest, model: string): string {
  const ask: Part[] = [...(req.prompt ? [{ text: req.prompt }] : []), ...(req.attachments ?? [])];
  // Another provider's own record of a turn (`raw`) means nothing to Gemini.
  const earlier = (req.contents ?? []).map((c) => ({ ...c, parts: c.parts.filter((p) => !("raw" in p)) })).filter((c) => c.parts.length);
  const contents: Content[] = [...earlier, ...(ask.length ? [{ role: "user" as const, parts: ask }] : [])];
  // Google Search grounding goes in a request of its own: not every model takes it with function
  // declarations (lib/ai/provider.ts), so the declarations win and the search is left out.
  const tools = [
    ...(req.tools?.length ? [{ functionDeclarations: req.tools }] : []),
    ...(req.searchGrounding && !req.tools?.length ? [{ google_search: {} }] : []),
  ];
  return JSON.stringify({
    systemInstruction: { parts: [{ text: systemWithSafety(req) }] },
    safetySettings: SAFETY_SETTINGS,
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

/**
 * One call to Gemini. With `onDelta`, the reply streams (server-sent events) and each new piece of text is
 * passed on as it arrives; `onDelta` returning false stops the stream (the person pressed Stop). Falls back
 * to the lighter model once when the main one is busy, as long as nothing has been streamed yet. Every
 * answered call adds its token counts to `meter` (even one whose reply is unusable: it was still billed).
 * Every call has a deadline (no answer, a stalled stream, or a stream running too long), so a hung
 * connection can't hold the action, and the person's credit hold, until the platform kills it.
 */
async function generate(req: GenerateRequest, meter: CallUsage[], onDelta: OnDelta | undefined, target: CallTarget): Promise<GenerateResult> {
  const key = target.apiKey ?? process.env.GEMINI_API_KEY;
  if (!key) fail("maintenance", NOT_SET_UP);
  // When the model is busy, its lighter one gets one try (Gemini only, same provider), as long as it can do
  // what was asked: a grounded request only goes to models that can search.
  const models = [target.model, ...(target.lighter && target.lighter !== target.model ? [target.lighter] : [])].filter((m, i) => i === 0 || !req.searchGrounding || capabilitiesOf(m).searchGrounding);
  let lastStatus = 0;
  for (const m of models) {
    const stream = Boolean(onDelta);
    const deadline = new Deadline(stream);
    const controller = deadline.controller;
    const waitAtMost = (ms: number) => deadline.waitAtMost(ms);
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
        if (!deadline.timedOut) throw e;
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
              finish = finishOf(data) ?? finish;
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
            if (!deadline.timedOut) throw e;
            break;
          }
          const { done, value } = next;
          if (done) break;
          buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
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
        if (!stopped && !deadline.timedOut && buffer.trim()) take(buffer);
        // A stream cut off by its deadline was still billed for what it produced.
        const refusal = refusalOf(text, finish);
        const used = { ...withSearches(usageOf(m, usage, req, text), grounding), ...(refusal.refused ? { refused: refusal.refused } : {}) };
        text = refusal.text;
        meter.push(used);
        console.log(JSON.stringify({ event: "ai.call", model: m, status: res.status, stream: true, finish, stopped, timedOut: deadline.timedOut, tokensIn: used.promptTokens, tokensOut: used.outputTokens + used.thoughtsTokens, ...(refusal.refused ? { refused: refusal.refused.kind } : {}) }));
        if (deadline.timedOut) fail("maintenance", TOO_SLOW);
        if (!text.trim() && !stopped && !toolCalls.length) fail("invalid_argument", emptyMessage(blocked(finish)));
        return { text: text.trim(), toolCalls, parts: [...(text ? [{ text }] : []), ...callParts], finish, stopped, model: m, usage: used, ...(grounding ? { grounding } : {}) };
      }
      if (res.ok) {
        let data: GeminiChunk;
        try {
          data = (await res.json()) as GeminiChunk;
        } catch (e) {
          if (!deadline.timedOut) throw e;
          console.warn(JSON.stringify({ event: "ai.timeout", model: m, stream }));
          fail("maintenance", TOO_SLOW);
        }
        const raw = textOf(data).trim();
        const toolCalls = callsOf(data);
        const finish = finishOf(data);
        const grounding = groundingOf(data);
        const refusal = refusalOf(raw, finish);
        const text = refusal.text;
        const used = { ...withSearches(usageOf(m, data.usageMetadata, req, raw), grounding), ...(refusal.refused ? { refused: refusal.refused } : {}) };
        meter.push(used);
        console.log(JSON.stringify({ event: "ai.call", model: m, status: res.status, finish, tokensIn: used.promptTokens, tokensOut: used.outputTokens + used.thoughtsTokens, ...(used.searches ? { searches: used.searches } : {}), ...(refusal.refused ? { refused: refusal.refused.kind } : {}) }));
        if (!text && !toolCalls.length) fail("invalid_argument", emptyMessage(blocked(finish)));
        return { text, toolCalls, parts: withoutMarker(modelPartsOf(partsOf(data))), finish, stopped: false, model: m, usage: used, ...(grounding ? { grounding } : {}) };
      }
      console.warn(JSON.stringify({ event: "ai.error", model: m, status: res.status }));
      if (res.status !== 429 && res.status !== 503 && res.status !== 500) break;
    } finally {
      deadline.clear();
    }
  }
  if (lastStatus === 429) fail("rate_limited", BUSY);
  if (lastStatus === 400 || lastStatus === 403) fail("maintenance", KEY_REFUSED);
  fail("maintenance", UNREACHABLE);
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
async function embed(texts: string[], task: EmbedTask, apiKey?: string): Promise<EmbedResult> {
  const key = apiKey ?? process.env.GEMINI_API_KEY;
  if (!key) fail("maintenance", NOT_SET_UP);
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
      if (res.status === 429) fail("rate_limited", BUSY);
      fail("maintenance", UNREACHABLE);
    }
    const data = (await res.json().catch(() => null)) as { embeddings?: { values?: unknown }[] } | null;
    const got = (data?.embeddings ?? []).map((e) => (Array.isArray(e.values) ? (e.values as unknown[]).filter((x): x is number => typeof x === "number") : []));
    if (got.length !== batch.length || got.some((v) => v.length !== EMBEDDING_DIMENSIONS)) {
      console.warn(JSON.stringify({ event: "ai.embed_error", model, status: res.status, count: got.length }));
      fail("maintenance", UNREACHABLE);
    }
    vectors.push(...got.map(normalize));
  }
  const tokens = tokensForChars(texts.reduce((n, t) => n + t.length, 0));
  console.log(JSON.stringify({ event: "ai.embed", model, task, count: texts.length, tokensIn: tokens }));
  return { vectors, model, tokens };
}

export const geminiAdapter: ProviderAdapter = { id: "gemini", generate };

/** Semantic search's embeddings: always Gemini (the owner's decision, 2026-11-25). */
export const geminiEmbeddings = { model: geminiEmbeddingModel, embed };
