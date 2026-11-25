// Anthropic (Claude) through its official SDK and the Messages API (server-side only: the key never reaches
// a browser). A provider adapter for lib/ai/provider.ts; the model and key come with each call (the
// feature's route, lib/ai/config.ts), the key from the admin panel or ANTHROPIC_API_KEY.
//
// Done the Claude way rather than as a Gemini port:
// - Streaming with typed events. Adaptive thinking (Claude's current models always think) with effort by
//   slot: low for quick and normal answers, medium for heavy jobs. No temperature: current Claude models
//   refuse non-default sampling settings. Thinking counts toward max_tokens, so it gets room on top.
// - Prompt caching: the system prompt (feature rules plus the safety rules, the same on every call) is a
//   cache breakpoint, and a multi-turn request (a chat's history, the agent's tool loop) also caches the
//   conversation so each step reads the earlier ones from the cache. Cache reads and writes are billed at
//   Anthropic's rates (lib/credits.ts).
// - Tools with their JSON schemas; the model's whole turn, thinking blocks included, goes back unchanged in
//   the next step of a tool loop (Claude requires it).
// - JSON replies: asked for in the system prompt and taken out of a code fence if one comes back (Claude's
//   structured outputs need a schema, which these requests don't carry).
// - Web search with Claude's web search tool (dynamic filtering where the model has it); its citations
//   become the answer's sources, and `pause_turn` is resumed.
// - Images and PDFs go inline. Audio isn't read here: transcription always uses Gemini.
// - A `refusal` stop counts as the provider's filter (a free refusal, like Gemini's SAFETY).
//
// Privacy: prompts, note text and answers are never logged. Only the event, model, status and token counts are.
import Anthropic from "@anthropic-ai/sdk";
import { fail } from "../errors";
import type { CallUsage } from "../credits";
import type { CallTarget, GenerateRequest, GenerateResult, Grounding, OnDelta, Part, ProviderAdapter, ToolCall } from "./provider";
import { visibleSoFar } from "@folevi/ai-prompts/safety";
import { Deadline, emptyMessage, estimatedUsage, failForStatus, NOT_SET_UP, objectSchema, refusalOf, STREAM_IDLE_MS, systemWithSafety, TOO_SLOW, unfenced, withoutMarker } from "./common";

type MessageParam = Anthropic.MessageParam;
type ContentBlockParam = Anthropic.ContentBlockParam;
type Message = Anthropic.Message;
type CreateParams = Anthropic.MessageCreateParamsNonStreaming;

/** Room for thinking on top of the answer's own tokens, by slot (thinking counts toward max_tokens). */
const THINKING_ROOM = { fast: 1_024, main: 2_048, heavy: 8_192 } as const;
const EFFORT = { fast: "low", main: "low", heavy: "medium" } as const;
/** Web searches one grounded call may run. */
export const MAX_SEARCHES = 5;
/** Times a paused server-tool turn (web search) is resumed. */
const MAX_RESUMES = 3;
const JSON_RULE = "Reply with one JSON value only: no code fence, no other text.";

/** Claude models with the web search tool that filters results (the newer variant); others get the basic one. */
const DYNAMIC_SEARCH = /^claude-(fable|mythos|opus-(5|4-[678])|sonnet-(5|4-6))/i;

/** A file part as Claude takes it, or a refusal for what it can't read. */
function filePart(d: { mimeType: string; data: string }): ContentBlockParam {
  const type = d.mimeType.toLowerCase();
  if (type === "image/png" || type === "image/jpeg" || type === "image/gif" || type === "image/webp") return { type: "image", source: { type: "base64", media_type: type, data: d.data } };
  if (type === "application/pdf") return { type: "document", source: { type: "base64", media_type: "application/pdf", data: d.data } };
  if (type.startsWith("text/")) return { type: "document", source: { type: "text", media_type: "text/plain", data: new TextDecoder().decode(Uint8Array.from(atob(d.data), (c) => c.charCodeAt(0))) } };
  fail("unsupported_file", "The AI model in use can't read this kind of file.");
}

/** The conversation as Claude messages: earlier turns, then the question with its files (files first). */
export function messagesOf(req: GenerateRequest): MessageParam[] {
  const out: MessageParam[] = [];
  const turns = [...(req.contents ?? [])];
  const ask: Part[] = [...(req.attachments ?? []), ...(req.prompt ? [{ text: req.prompt }] : [])];
  if (ask.length) turns.push({ role: "user", parts: ask });
  let calls = 0;
  for (const turn of turns) {
    if (turn.role === "model") {
      const raw = turn.parts.find((p): p is Extract<Part, { raw: unknown }> => "raw" in p && p.raw.provider === "anthropic");
      if (raw) {
        out.push({ role: "assistant", content: raw.raw.items as ContentBlockParam[] });
        continue;
      }
      const content: ContentBlockParam[] = [];
      for (const p of turn.parts) {
        if ("functionCall" in p) content.push({ type: "tool_use", id: p.functionCall.id ?? `toolu_folevi_${calls++}`, name: p.functionCall.name, input: p.functionCall.args });
        else if ("text" in p && p.text) content.push({ type: "text", text: p.text });
      }
      if (content.length) out.push({ role: "assistant", content });
      continue;
    }
    // Tool results first in their message, as Claude requires.
    const results: ContentBlockParam[] = [];
    const rest: ContentBlockParam[] = [];
    for (const p of turn.parts) {
      if ("functionResponse" in p) results.push({ type: "tool_result", tool_use_id: p.functionResponse.id ?? p.functionResponse.name, content: JSON.stringify(p.functionResponse.response) });
      else if ("text" in p) {
        if (p.text) rest.push({ type: "text", text: p.text });
      } else if ("inlineData" in p) rest.push(filePart(p.inlineData));
      else if ("fileData" in p) fail("unsupported_file", "The AI model in use can't read this kind of file.");
    }
    const content = [...results, ...rest];
    if (content.length) out.push({ role: "user", content });
  }
  return out;
}

/** The request: the system prompt as a cache breakpoint, tools or web search, thinking effort and room. */
export function paramsOf(req: GenerateRequest, target: CallTarget): CreateParams {
  const system = `${systemWithSafety(req)}${req.json ? `\n\n${JSON_RULE}` : ""}`;
  const messages = messagesOf(req);
  const tools: Anthropic.ToolUnion[] = req.tools?.length
    ? req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: objectSchema(t.parameters) as Anthropic.Tool.InputSchema }))
    : req.searchGrounding
      ? [DYNAMIC_SEARCH.test(target.model) ? { type: "web_search_20260209", name: "web_search", max_uses: MAX_SEARCHES } : { type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES }]
      : [];
  return {
    model: target.model,
    max_tokens: (req.maxOutputTokens ?? 2048) + THINKING_ROOM[target.slot],
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages,
    thinking: { type: "adaptive" },
    output_config: { effort: EFFORT[target.slot] },
    // A conversation (history or a tool loop) is cached up to its latest turn, for the next step to read.
    ...(messages.length > 1 ? { cache_control: { type: "ephemeral" } } : {}),
    ...(tools.length ? { tools } : {}),
    ...(req.tools?.length ? { tool_choice: req.toolChoice === "none" ? { type: "none" } : { type: "auto" } } : {}),
  };
}

/** What came back: text, tool calls, searches and their sources. */
export function readMessage(content: Anthropic.ContentBlock[]): { text: string; toolCalls: ToolCall[]; grounding?: Grounding } {
  let text = "";
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
  for (const block of content) {
    if (block.type === "text") {
      text += block.text;
      const cited: number[] = [];
      for (const c of block.citations ?? []) {
        if (c.type === "web_search_result_location" && /^https?:\/\//i.test(c.url)) cited.push(sourceIndex(c.url, c.title ?? ""));
      }
      if (cited.length && block.text.trim()) supports.push({ text: block.text.slice(0, 2_000), sources: [...new Set(cited)] });
    } else if (block.type === "tool_use") {
      const input = block.input && typeof block.input === "object" && !Array.isArray(block.input) ? (block.input as Record<string, unknown>) : {};
      toolCalls.push({ name: block.name, args: input, id: block.id });
    } else if (block.type === "server_tool_use" && block.name === "web_search") {
      const q = (block.input as { query?: unknown } | undefined)?.query;
      if (typeof q === "string" && q.trim()) queries.push(q.slice(0, 300));
    } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) if (r.type === "web_search_result" && /^https?:\/\//i.test(r.url)) sourceIndex(r.url, r.title ?? "");
    }
  }
  const grounding = queries.length || sources.length ? { queries: [...new Set(queries)], sources, supports } : undefined;
  return { text, toolCalls, ...(grounding ? { grounding } : {}) };
}

/** Token counts: every input token (uncached, cache reads, cache writes); thinking is in the output count. */
export function usageOf(model: string, msg: Message | undefined, req: GenerateRequest, text: string): CallUsage {
  const u = msg?.usage;
  if (!u) return estimatedUsage(model, req, text);
  const read = u.cache_read_input_tokens ?? 0;
  const written = u.cache_creation_input_tokens ?? 0;
  const searches = u.server_tool_use?.web_search_requests ?? 0;
  return {
    model,
    promptTokens: u.input_tokens + read + written,
    ...(read ? { cachedTokens: read } : {}),
    ...(written ? { cacheWriteTokens: written } : {}),
    outputTokens: u.output_tokens,
    thoughtsTokens: 0,
    ...(searches ? { searches } : {}),
  };
}

/** The usage of several messages (a resumed web search turn) added up. */
function sumUsage(list: CallUsage[], model: string): CallUsage {
  const add = (k: "promptTokens" | "cachedTokens" | "cacheWriteTokens" | "outputTokens" | "searches") => list.reduce((n, u) => n + (u[k] ?? 0), 0);
  const out: CallUsage = { model, promptTokens: add("promptTokens"), outputTokens: add("outputTokens"), thoughtsTokens: 0 };
  if (add("cachedTokens")) out.cachedTokens = add("cachedTokens");
  if (add("cacheWriteTokens")) out.cacheWriteTokens = add("cacheWriteTokens");
  if (add("searches")) out.searches = add("searches");
  return out;
}

const client = (apiKey: string) =>
  // `fetch` looked up on each call, so tests can stub it; the SDK retries once on 429, 529 and 5xx.
  new Anthropic({ apiKey, fetch: (input, init) => globalThis.fetch(input, init), maxRetries: 1, timeout: 5 * 60_000 });

async function generate(req: GenerateRequest, meter: CallUsage[], onDelta: OnDelta | undefined, target: CallTarget): Promise<GenerateResult> {
  const apiKey = target.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) fail("maintenance", NOT_SET_UP);
  const m = target.model;
  const params = paramsOf(req, target);
  const stream = Boolean(onDelta);
  const deadline = new Deadline(stream);
  const usages: CallUsage[] = [];
  const blocks: Anthropic.ContentBlock[] = [];
  let last: Message | undefined;
  let streamed = "";
  let stopped = false;
  try {
    // A web search turn can pause on Claude's side; it's resumed with what it has so far.
    for (let turn = 0; turn <= MAX_RESUMES; turn++) {
      const body: CreateParams = turn === 0 ? params : { ...params, messages: [...params.messages, { role: "assistant", content: blocks as ContentBlockParam[] }] };
      if (stream) {
        const s = client(apiKey).messages.stream(body, { signal: deadline.signal });
        for await (const event of s) {
          deadline.waitAtMost(STREAM_IDLE_MS);
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            streamed += event.delta.text;
            if (!(await onDelta!(visibleSoFar(streamed)))) {
              stopped = true;
              deadline.stop();
              break;
            }
          }
        }
        if (stopped) break;
        last = await s.finalMessage();
      } else {
        last = await client(apiKey).messages.create(body, { signal: deadline.signal });
      }
      usages.push(usageOf(m, last, req, ""));
      blocks.push(...last.content);
      if (last.stop_reason !== "pause_turn") break;
    }
  } catch (e) {
    if (stopped) {
      /* Stop pressed: what was written stands */
    } else if (deadline.timedOut) {
      // A stream cut off by its deadline was still billed for what it produced.
      if (streamed) meter.push(estimatedUsage(m, req, streamed));
      console.warn(JSON.stringify({ event: "ai.timeout", provider: "anthropic", model: m, stream }));
      fail("maintenance", TOO_SLOW);
    } else {
      const status = e instanceof Anthropic.APIError ? e.status : undefined;
      console.warn(JSON.stringify({ event: "ai.error", provider: "anthropic", model: m, status: status ?? null }));
      failForStatus(status);
    }
  } finally {
    deadline.clear();
  }
  const read = readMessage(blocks);
  const filtered = last?.stop_reason === "refusal";
  const raw = (stopped ? streamed : read.text).trim();
  const refusal = refusalOf(req.json ? unfenced(raw) : raw, filtered);
  // A stream stopped before its usage arrived is estimated from what was sent and written.
  const counted = usages.length ? sumUsage(usages, m) : estimatedUsage(m, req, streamed);
  const used = { ...counted, ...(refusal.refused ? { refused: refusal.refused } : {}) };
  meter.push(used);
  const finish = stopped ? null : (last?.stop_reason ?? null);
  console.log(JSON.stringify({ event: "ai.call", provider: "anthropic", model: m, stream, finish, stopped, tokensIn: used.promptTokens, cachedIn: used.cachedTokens ?? 0, tokensOut: used.outputTokens, ...(used.searches ? { searches: used.searches } : {}), ...(refusal.refused ? { refused: refusal.refused.kind } : {}) }));
  const text = refusal.text.trim();
  if (!text && !stopped && !read.toolCalls.length) fail("invalid_argument", emptyMessage(filtered));
  const parts: Part[] = [
    // The whole turn, thinking included, for the next step of a tool loop.
    ...(read.toolCalls.length ? [{ raw: { provider: "anthropic" as const, items: blocks as unknown[] } }] : []),
    ...withoutMarker(text ? [{ text }] : []),
    ...read.toolCalls.map((c) => ({ functionCall: { name: c.name, args: c.args, ...(c.id ? { id: c.id } : {}) } })),
  ];
  return { text, toolCalls: read.toolCalls, parts, finish, stopped, model: m, usage: used, ...(read.grounding ? { grounding: read.grounding } : {}) };
}

export const anthropicAdapter: ProviderAdapter = { id: "anthropic", generate };
