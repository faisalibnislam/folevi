// OpenAI through its official SDK and the Responses API (server-side only: the key never reaches a
// browser). A provider adapter for lib/ai/provider.ts; the model and key come with each call (the
// feature's route, lib/ai/config.ts), the key from the admin panel or OPENAI_API_KEY.
//
// Done the OpenAI way rather than as a Gemini port:
// - Streaming with the Responses API's typed events; reasoning effort by slot (low for quick and normal
//   answers, medium for heavy jobs), with room for reasoning on top of the answer's tokens.
// - Function tools with their JSON schemas; the model's whole turn (reasoning items, encrypted because
//   nothing is stored at OpenAI: `store: false`) goes back as-is in the next step of a tool loop.
// - JSON mode (`text.format: json_object`) for structured replies.
// - Web search with the `web_search` tool; its URL citations become the answer's sources.
// - Prompt caching is automatic; a stable `prompt_cache_key` per system prompt keeps repeated requests on
//   the same cache, and cached input tokens are billed at OpenAI's cached rate (lib/credits.ts).
// - Images and PDFs go inline (data URLs). Audio isn't read here: transcription always uses Gemini.
//
// Privacy: prompts, note text and answers are never logged. Only the event, model, status and token counts are.
import OpenAI from "openai";
import type { Response as OpenAIResponse, ResponseCreateParamsBase, ResponseInputItem, ResponseOutputItem, ResponseStreamEvent, Tool as OpenAITool } from "openai/resources/responses/responses";
import { fail } from "../errors";
import type { CallUsage } from "../credits";
import type { CallTarget, GenerateRequest, GenerateResult, Grounding, OnDelta, Part, ProviderAdapter, ToolCall } from "./provider";
import { visibleSoFar } from "@folevi/ai-prompts/safety";
import { Deadline, emptyMessage, estimatedUsage, failForStatus, NOT_SET_UP, objectSchema, refusalOf, STREAM_IDLE_MS, systemWithSafety, TOO_SLOW, unfenced, withoutMarker } from "./common";

/** Room for reasoning on top of the answer's own tokens, by slot (reasoning tokens count as output). */
const REASONING_ROOM = { fast: 1_024, main: 2_048, heavy: 8_192 } as const;
const EFFORT = { fast: "low", main: "low", heavy: "medium" } as const;
/** Web searches one grounded call may run. */
export const MAX_SEARCHES = 5;
const JSON_RULE = "Reply with one JSON value only: no code fence, no other text.";

/** A short stable hash (FNV-1a) of the system prompt: the prompt cache key, so equal prefixes share a cache. */
function cacheKey(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `folevi-${(h >>> 0).toString(36)}`;
}

/** A file part as OpenAI takes it, or a refusal for what it can't read. */
function filePart(d: { mimeType: string; data: string }): Record<string, unknown> {
  const url = `data:${d.mimeType};base64,${d.data}`;
  if (d.mimeType.startsWith("image/")) return { type: "input_image", image_url: url, detail: "auto" };
  if (d.mimeType === "application/pdf") return { type: "input_file", filename: "attachment.pdf", file_data: url };
  if (d.mimeType.startsWith("text/")) return { type: "input_text", text: new TextDecoder().decode(Uint8Array.from(atob(d.data), (c) => c.charCodeAt(0))) };
  fail("unsupported_file", "The AI model in use can't read this kind of file.");
}

/** The conversation as Responses input items: earlier turns, then the question with any files. */
export function inputOf(req: GenerateRequest): ResponseInputItem[] {
  const items: Record<string, unknown>[] = [];
  const turns = [...(req.contents ?? [])];
  const ask: Part[] = [...(req.prompt ? [{ text: req.prompt }] : []), ...(req.attachments ?? [])];
  if (ask.length) turns.push({ role: "user", parts: ask });
  let calls = 0;
  for (const turn of turns) {
    if (turn.role === "model") {
      const raw = turn.parts.find((p): p is Extract<Part, { raw: unknown }> => "raw" in p && p.raw.provider === "openai");
      if (raw) {
        items.push(...(raw.raw.items as Record<string, unknown>[]));
        continue;
      }
      const text = turn.parts.flatMap((p) => ("text" in p && !("functionCall" in p) ? [p.text] : [])).join("");
      if (text) items.push({ role: "assistant", content: text });
      for (const p of turn.parts) {
        if ("functionCall" in p) items.push({ type: "function_call", call_id: p.functionCall.id ?? `call_${calls++}`, name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args) });
      }
      continue;
    }
    const content: Record<string, unknown>[] = [];
    for (const p of turn.parts) {
      if ("functionResponse" in p) items.push({ type: "function_call_output", call_id: p.functionResponse.id ?? p.functionResponse.name, output: JSON.stringify(p.functionResponse.response) });
      else if ("text" in p) content.push({ type: "input_text", text: p.text });
      else if ("inlineData" in p) content.push(filePart(p.inlineData));
      else if ("fileData" in p) fail("unsupported_file", "The AI model in use can't read this kind of file.");
    }
    if (content.length) items.push({ role: "user", content });
  }
  return items as unknown as ResponseInputItem[];
}

/** The request: instructions (safety rules last), the input, tools or web search, JSON mode and effort. */
export function paramsOf(req: GenerateRequest, target: CallTarget): ResponseCreateParamsBase {
  const instructions = `${systemWithSafety(req)}${req.json ? `\n\n${JSON_RULE}` : ""}`;
  const tools: OpenAITool[] = req.tools?.length
    ? req.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: objectSchema(t.parameters), strict: false }))
    : req.searchGrounding
      ? [{ type: "web_search" }]
      : [];
  return {
    model: target.model,
    instructions,
    input: inputOf(req),
    // Nothing is kept at OpenAI; a tool loop carries the model's reasoning itself (encrypted).
    store: false,
    include: ["reasoning.encrypted_content", ...(req.searchGrounding ? (["web_search_call.action.sources"] as const) : [])],
    reasoning: { effort: EFFORT[target.slot] },
    max_output_tokens: (req.maxOutputTokens ?? 2048) + REASONING_ROOM[target.slot],
    prompt_cache_key: cacheKey(instructions),
    ...(tools.length ? { tools } : {}),
    ...(req.tools?.length ? { tool_choice: req.toolChoice === "none" ? "none" : "auto" } : {}),
    ...(req.json ? { text: { format: { type: "json_object" } } } : {}),
  };
}

type Item = ResponseOutputItem & Record<string, unknown>;

/** What came back: text, tool calls, a refusal, searches and their sources. */
export function readResponse(r: OpenAIResponse): { text: string; toolCalls: ToolCall[]; refused: boolean; searches: number; grounding?: Grounding } {
  let text = "";
  let refused = false;
  let searches = 0;
  const toolCalls: ToolCall[] = [];
  const queries: string[] = [];
  const sources: Grounding["sources"] = [];
  const supports: Grounding["supports"] = [];
  const sourceIndex = (uri: string, title: string) => {
    let i = sources.findIndex((s) => s.uri === uri);
    if (i < 0) {
      i = sources.length;
      sources.push({ uri: uri.slice(0, 2_000), title: title.slice(0, 300) });
    }
    return i;
  };
  for (const item of (r.output ?? []) as Item[]) {
    if (item.type === "message") {
      for (const c of (item.content ?? []) as { type: string; text?: string; refusal?: string; annotations?: { type: string; url?: string; title?: string; start_index?: number; end_index?: number }[] }[]) {
        if (c.type === "refusal") refused = true;
        if (c.type !== "output_text" || typeof c.text !== "string") continue;
        for (const a of c.annotations ?? []) {
          if (a.type !== "url_citation" || typeof a.url !== "string" || !/^https?:\/\//i.test(a.url)) continue;
          const i = sourceIndex(a.url, a.title ?? "");
          const cited = c.text.slice(a.start_index ?? 0, a.end_index ?? 0);
          // The sentence a citation backs: from the last sentence break before it to the citation.
          const before = c.text.slice(0, a.start_index ?? 0);
          const sentence = before.slice(Math.max(before.lastIndexOf(". "), before.lastIndexOf("\n")) + 1).trim();
          const backs = sentence || cited;
          if (backs.trim()) supports.push({ text: backs.slice(0, 2_000), sources: [i] });
        }
        text += c.text;
      }
    } else if (item.type === "function_call") {
      let args: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(String(item.arguments ?? "{}")) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
      } catch {
        /* a call with arguments that aren't JSON runs with none; the tool reports what's missing */
      }
      toolCalls.push({ name: String(item.name), args, ...(item.call_id ? { id: String(item.call_id) } : {}) });
    } else if (item.type === "web_search_call") {
      searches++;
      const action = item.action as { type?: string; query?: unknown; queries?: unknown; sources?: { url?: unknown }[] } | undefined;
      for (const q of [action?.query, ...(Array.isArray(action?.queries) ? action.queries : [])]) if (typeof q === "string" && q.trim()) queries.push(q.slice(0, 300));
    }
  }
  const grounding = queries.length || sources.length ? { queries: [...new Set(queries)], sources, supports } : undefined;
  return { text, toolCalls, refused, searches, ...(grounding ? { grounding } : {}) };
}

/** Token counts: input includes cached tokens; reasoning tokens are counted as thoughts (billed as output). */
export function usageOf(model: string, r: OpenAIResponse | undefined, req: GenerateRequest, text: string, searches: number): CallUsage {
  const u = r?.usage;
  const base: CallUsage = u
    ? {
        model,
        promptTokens: u.input_tokens,
        ...(u.input_tokens_details?.cached_tokens ? { cachedTokens: u.input_tokens_details.cached_tokens } : {}),
        outputTokens: Math.max(0, u.output_tokens - (u.output_tokens_details?.reasoning_tokens ?? 0)),
        thoughtsTokens: u.output_tokens_details?.reasoning_tokens ?? 0,
      }
    : estimatedUsage(model, req, text);
  return searches ? { ...base, searches } : base;
}

const client = (apiKey: string) =>
  // `fetch` looked up on each call, so tests can stub it; the SDK retries once on 429 and 5xx.
  new OpenAI({ apiKey, fetch: (input, init) => globalThis.fetch(input, init), maxRetries: 1, timeout: 5 * 60_000 });

async function generate(req: GenerateRequest, meter: CallUsage[], onDelta: OnDelta | undefined, target: CallTarget): Promise<GenerateResult> {
  const apiKey = target.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) fail("maintenance", NOT_SET_UP);
  const params = paramsOf(req, target);
  const m = target.model;
  const stream = Boolean(onDelta);
  const deadline = new Deadline(stream);
  let response: OpenAIResponse | undefined;
  let streamed = "";
  let stopped = false;
  try {
    if (stream) {
      const events = await client(apiKey).responses.create({ ...params, stream: true }, { signal: deadline.signal });
      for await (const event of events as AsyncIterable<ResponseStreamEvent>) {
        deadline.waitAtMost(STREAM_IDLE_MS);
        if (event.type === "response.output_text.delta") {
          streamed += event.delta;
          if (!(await onDelta!(visibleSoFar(streamed)))) {
            stopped = true;
            deadline.stop();
            break;
          }
        } else if (event.type === "response.completed" || event.type === "response.incomplete" || event.type === "response.failed") {
          response = event.response;
        }
      }
    } else {
      response = await client(apiKey).responses.create({ ...params, stream: false }, { signal: deadline.signal });
    }
  } catch (e) {
    if (stopped) {
      /* Stop pressed: what was written stands */
    } else if (deadline.timedOut) {
      // A stream cut off by its deadline was still billed for what it produced.
      if (streamed) meter.push(estimatedUsage(m, req, streamed));
      console.warn(JSON.stringify({ event: "ai.timeout", provider: "openai", model: m, stream }));
      fail("maintenance", TOO_SLOW);
    } else {
      const status = e instanceof OpenAI.APIError ? e.status : undefined;
      console.warn(JSON.stringify({ event: "ai.error", provider: "openai", model: m, status: status ?? null }));
      failForStatus(status);
    }
  } finally {
    deadline.clear();
  }
  const read = response ? readResponse(response) : { text: streamed, toolCalls: [], refused: false, searches: 0 };
  const filtered = read.refused || response?.incomplete_details?.reason === "content_filter";
  const raw = (stopped ? streamed : read.text).trim();
  const refusal = refusalOf(req.json ? unfenced(raw) : raw, filtered);
  const used = { ...usageOf(m, response, req, read.text || streamed, read.searches), ...(refusal.refused ? { refused: refusal.refused } : {}) };
  meter.push(used);
  const finish = response ? (response.incomplete_details?.reason ?? response.status ?? null) : null;
  console.log(JSON.stringify({ event: "ai.call", provider: "openai", model: m, stream, finish, stopped, tokensIn: used.promptTokens, cachedIn: used.cachedTokens ?? 0, tokensOut: used.outputTokens + used.thoughtsTokens, ...(used.searches ? { searches: used.searches } : {}), ...(refusal.refused ? { refused: refusal.refused.kind } : {}) }));
  if (response?.status === "failed") fail("maintenance", "Foli AI couldn't be reached. Try again shortly.");
  const text = refusal.text.trim();
  if (!text && !stopped && !read.toolCalls.length) fail("invalid_argument", emptyMessage(filtered));
  const parts: Part[] = [
    ...(response && read.toolCalls.length ? [{ raw: { provider: "openai" as const, items: response.output as unknown[] } }] : []),
    ...withoutMarker(text ? [{ text }] : []),
    ...read.toolCalls.map((c) => ({ functionCall: { name: c.name, args: c.args, ...(c.id ? { id: c.id } : {}) } })),
  ];
  return { text, toolCalls: read.toolCalls, parts, finish, stopped, model: m, usage: used, ...(read.grounding ? { grounding: read.grounding } : {}) };
}

export const openaiAdapter: ProviderAdapter = { id: "openai", generate };
