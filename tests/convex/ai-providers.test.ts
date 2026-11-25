// Foli AI on Gemini, OpenAI and Anthropic (lib/ai/provider.ts, openai.ts, anthropic.ts, config.ts,
// convex/aiConfig.ts): each adapter speaks its provider's own API (streaming, tools, JSON, web search,
// caching), usage is priced per provider, a feature goes where Admin > Foli AI routes it, and keys are
// stored sealed and never shown. Every request is answered by a stubbed `fetch`: no real key is used.
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { openaiAdapter } from "../../convex/lib/ai/openai";
import { anthropicAdapter } from "../../convex/lib/ai/anthropic";
import { defaultModels, normalizeSettings, routeOf, slotFor, HEAVY_PROMPT_CHARS } from "../../convex/lib/ai/config";
import { capabilitiesOf, priceOf } from "../../convex/lib/ai/capabilities";
import { costNano, estimateCredits, type CallUsage } from "../../convex/lib/credits";
import type { CallTarget, GenerateRequest } from "../../convex/lib/ai/provider";
import { SAFETY_RULE } from "@folevi/ai-prompts/safety";
import { person, setAiSettings, setup, type T } from "./helpers";

type Seen = { url: string; body: Record<string, unknown>; headers: Headers };

/** Stubs `fetch` with replies in order (the last one repeats); records every request. */
function stub(...replies: (() => Response)[]): Seen[] {
  const seen: Seen[] = [];
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      seen.push({ url, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}, headers: new Headers(init?.headers) });
      const reply = replies[Math.min(i++, replies.length - 1)]!;
      return reply();
    }),
  );
  return seen;
}

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const sse = (events: { event?: string; data: unknown }[]) => () =>
  new Response(events.map((e) => `${e.event ? `event: ${e.event}\n` : ""}data: ${JSON.stringify(e.data)}\n\n`).join(""), { status: 200, headers: { "content-type": "text/event-stream" } });

const req = (o: Partial<GenerateRequest> = {}): GenerateRequest => ({ system: "You help with notes.", prompt: "Summarize this.", ...o });
const target = (model: string, slot: CallTarget["slot"] = "main"): CallTarget => ({ model, slot, apiKey: "sk-test-key-0000000000000000" });

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

// ---------------------------------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------------------------------

const openaiResponse = (o: { output: unknown[]; usage?: Record<string, unknown>; status?: string; incomplete?: string }) => ({
  id: "resp_1",
  object: "response",
  created_at: 0,
  model: "gpt-6-luna",
  status: o.status ?? "completed",
  ...(o.incomplete ? { incomplete_details: { reason: o.incomplete } } : {}),
  output: o.output,
  usage: o.usage ?? { input_tokens: 1000, input_tokens_details: { cached_tokens: 800, cache_write_tokens: 0 }, output_tokens: 300, output_tokens_details: { reasoning_tokens: 100 }, total_tokens: 1300 },
});
const message = (text: string, annotations: unknown[] = []) => ({ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations }] });

describe("OpenAI (Responses API)", () => {
  test("a plain answer: instructions end with the safety rules, nothing stored, low effort, a cache key; usage priced with cached tokens", async () => {
    const seen = stub(json(openaiResponse({ output: [{ type: "reasoning", id: "rs_1", summary: [], encrypted_content: "enc" }, message("Three points.")] })));
    const meter: CallUsage[] = [];
    const res = await openaiAdapter.generate(req({ temperature: 0.4, maxOutputTokens: 500 }), meter, undefined, target("gpt-6-luna"));
    expect(res.text).toBe("Three points.");
    expect(seen[0]!.url).toBe("https://api.openai.com/v1/responses");
    expect(seen[0]!.headers.get("authorization")).toBe("Bearer sk-test-key-0000000000000000");
    const body = seen[0]!.body;
    expect(body).toMatchObject({ model: "gpt-6-luna", store: false, reasoning: { effort: "low" }, max_output_tokens: 500 + 2048 });
    expect(String(body.instructions)).toContain("You help with notes.");
    expect(String(body.instructions)).toContain(SAFETY_RULE);
    expect(String(body.prompt_cache_key)).toMatch(/^folevi-/);
    // Sampling isn't sent: GPT-6 models refuse it.
    expect(body).not.toHaveProperty("temperature");
    expect(body.input).toEqual([{ role: "user", content: [{ type: "input_text", text: "Summarize this." }] }]);
    expect(meter).toEqual([{ model: "gpt-6-luna", promptTokens: 1000, cachedTokens: 800, outputTokens: 200, thoughtsTokens: 100 }]);
    // 200 uncached × 100 + 800 cached × 10 + 300 out × 500 nano-dollars.
    expect(costNano(meter)).toBe(200 * 100 + 800 * 10 + 300 * 500);
  });

  test("JSON mode, images and PDFs inline; audio is refused", async () => {
    const seen = stub(json(openaiResponse({ output: [message('```json\n{"ok":true}\n```')] })));
    const res = await openaiAdapter.generate(
      req({ json: true, attachments: [{ inlineData: { mimeType: "image/png", data: "aGVsbG8=" } }, { inlineData: { mimeType: "application/pdf", data: "JVBERi0=" } }] }),
      [],
      undefined,
      target("gpt-6.2-sol", "heavy"),
    );
    expect(res.text).toBe('{"ok":true}');
    const body = seen[0]!.body;
    expect(body).toMatchObject({ text: { format: { type: "json_object" } }, reasoning: { effort: "medium" } });
    expect(String(body.instructions)).toMatch(/JSON/);
    const content = (body.input as { content: { type: string; image_url?: string; file_data?: string }[] }[])[0]!.content;
    expect(content.map((c) => c.type)).toEqual(["input_text", "input_image", "input_file"]);
    expect(content[1]!.image_url).toBe("data:image/png;base64,aGVsbG8=");
    expect(content[2]!.file_data).toBe("data:application/pdf;base64,JVBERi0=");
    await expect(openaiAdapter.generate(req({ attachments: [{ inlineData: { mimeType: "audio/mpeg", data: "AAAA" } }] }), [], undefined, target("gpt-6-luna"))).rejects.toThrow(/can't read this kind of file/);
  });

  test("tools: calls come back with their ids; the whole turn (reasoning included) goes back as-is with the results", async () => {
    const turn = [
      { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "secret-reasoning" },
      { type: "function_call", id: "fc_1", call_id: "call_abc", name: "read_note", arguments: '{"noteId":"n1"}', status: "completed" },
    ];
    const seen = stub(json(openaiResponse({ output: turn })), json(openaiResponse({ output: [message("Done.")] })));
    const tools = [{ name: "read_note", description: "Reads a note.", parameters: { type: "object", properties: { noteId: { type: "string" } }, required: ["noteId"] } }];
    const first = await openaiAdapter.generate(req({ tools }), [], undefined, target("gpt-6.2-sol", "heavy"));
    expect(first.toolCalls).toEqual([{ name: "read_note", args: { noteId: "n1" }, id: "call_abc" }]);
    expect(seen[0]!.body).toMatchObject({ tools: [{ type: "function", name: "read_note", parameters: tools[0]!.parameters }], tool_choice: "auto", include: ["reasoning.encrypted_content"] });
    await openaiAdapter.generate(
      req({ prompt: "", tools, toolChoice: "none", contents: [{ role: "user", parts: [{ text: "Summarize n1" }] }, { role: "model", parts: first.parts }, { role: "user", parts: [{ functionResponse: { name: "read_note", id: "call_abc", response: { text: "Hello" } } }] }] }),
      [],
      undefined,
      target("gpt-6.2-sol", "heavy"),
    );
    const input = seen[1]!.body.input as Record<string, unknown>[];
    expect(input[1]).toMatchObject({ type: "reasoning", encrypted_content: "secret-reasoning" });
    expect(input[2]).toMatchObject({ type: "function_call", call_id: "call_abc" });
    expect(input[3]).toEqual({ type: "function_call_output", call_id: "call_abc", output: '{"text":"Hello"}' });
    expect(seen[1]!.body.tool_choice).toBe("none");
  });

  test("web search: the web_search tool, its citations as sources, each search billed", async () => {
    const text = "Oslo has 700,000 people. It is the capital.";
    const seen = stub(
      json(
        openaiResponse({
          output: [
            { type: "web_search_call", id: "ws_1", status: "completed", action: { type: "search", query: "Oslo population" } },
            message(text, [{ type: "url_citation", url: "https://ssb.no/oslo", title: "SSB", start_index: 24, end_index: 24 }]),
          ],
        }),
      ),
    );
    const meter: CallUsage[] = [];
    const res = await openaiAdapter.generate(req({ searchGrounding: true }), meter, undefined, target("gpt-6.2-sol", "heavy"));
    expect(seen[0]!.body.tools).toEqual([{ type: "web_search" }]);
    expect(res.grounding).toEqual({ queries: ["Oslo population"], sources: [{ uri: "https://ssb.no/oslo", title: "SSB" }], supports: [{ text: "Oslo has 700,000 people.", sources: [0] }] });
    expect(meter[0]!.searches).toBe(1);
    expect(costNano(meter) - costNano([{ ...meter[0]!, searches: 0 }])).toBe(10_000_000);
  });

  test("streaming: pieces arrive as they're written; Stop ends it; usage from the completed event", async () => {
    const events = [
      { event: "response.output_text.delta", data: { type: "response.output_text.delta", delta: "Hello", item_id: "msg_1", output_index: 0, content_index: 0, sequence_number: 1 } },
      { event: "response.output_text.delta", data: { type: "response.output_text.delta", delta: " there", item_id: "msg_1", output_index: 0, content_index: 0, sequence_number: 2 } },
      { event: "response.completed", data: { type: "response.completed", sequence_number: 3, response: openaiResponse({ output: [message("Hello there")] }) } },
    ];
    stub(sse(events));
    const pieces: string[] = [];
    const meter: CallUsage[] = [];
    const res = await openaiAdapter.generate(req(), meter, async (soFar) => (pieces.push(soFar), true), target("gpt-6-luna"));
    expect(pieces).toEqual(["Hello", "Hello there"]);
    expect(res.text).toBe("Hello there");
    expect(meter[0]!.promptTokens).toBe(1000);
    stub(sse(events));
    const stopped = await openaiAdapter.generate(req(), [], async () => false, target("gpt-6-luna"));
    expect(stopped).toMatchObject({ stopped: true, text: "Hello" });
  });

  test("errors: busy, a refused key, no key, a content filter", async () => {
    stub(json({ error: { message: "slow down" } }, 429));
    await expect(openaiAdapter.generate(req(), [], undefined, target("gpt-6-luna"))).rejects.toThrow(/busy/);
    stub(json({ error: { message: "bad key" } }, 401));
    await expect(openaiAdapter.generate(req(), [], undefined, target("gpt-6-luna"))).rejects.toThrow(/key was refused/);
    await expect(openaiAdapter.generate(req(), [], undefined, { model: "gpt-6-luna", slot: "main" })).rejects.toThrow(/isn't set up/);
    stub(json(openaiResponse({ output: [], status: "incomplete", incomplete: "content_filter" })));
    const meter: CallUsage[] = [];
    await expect(openaiAdapter.generate(req(), meter, undefined, target("gpt-6-luna"))).rejects.toThrow(/couldn't help/);
    expect(meter[0]!.refused).toEqual({ kind: "filtered", free: true });
  });
});

// ---------------------------------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------------------------------

const claudeMessage = (content: unknown[], o: { stop?: string; usage?: Record<string, unknown> } = {}) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-haiku-5-5",
  content,
  stop_reason: o.stop ?? "end_turn",
  stop_sequence: null,
  usage: o.usage ?? { input_tokens: 100, cache_creation_input_tokens: 2000, cache_read_input_tokens: 5000, output_tokens: 400 },
});

describe("Anthropic (Messages API)", () => {
  test("a plain answer: the system prompt cached, adaptive thinking at low effort, no temperature; usage with cache reads and writes", async () => {
    const seen = stub(json(claudeMessage([{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: "Three points." }])));
    const meter: CallUsage[] = [];
    const res = await anthropicAdapter.generate(req({ temperature: 0.4, maxOutputTokens: 500 }), meter, undefined, target("claude-haiku-5-5"));
    expect(res.text).toBe("Three points.");
    expect(seen[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen[0]!.headers.get("authorization")).toBe("Bearer sk-test-key-0000000000000000");
    const body = seen[0]!.body;
    expect(body).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 500 + 2048, thinking: { type: "adaptive" }, output_config: { effort: "low" } });
    expect(body).not.toHaveProperty("temperature");
    const system = body.system as { text: string; cache_control: unknown }[];
    expect(system[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(system[0]!.text).toContain(SAFETY_RULE);
    // A single question isn't a conversation: no conversation breakpoint.
    expect(body).not.toHaveProperty("cache_control");
    expect(meter).toEqual([{ model: "claude-haiku-5-5", promptTokens: 7100, cachedTokens: 5000, cacheWriteTokens: 2000, outputTokens: 400, thoughtsTokens: 0 }]);
    // Haiku 5.5: 100 × 100 + 5000 × 10 (cache read) + 2000 × 125 (cache write) + 400 × 500.
    expect(costNano(meter)).toBe(100 * 100 + 5000 * 10 + 2000 * 125 + 400 * 500);
  });

  test("a conversation caches its turns; files go before the question; JSON comes out of its fence", async () => {
    const seen = stub(json(claudeMessage([{ type: "text", text: '```json\n{"ok":true}\n```' }])));
    const res = await anthropicAdapter.generate(
      req({ json: true, contents: [{ role: "user", parts: [{ text: "Earlier" }] }, { role: "model", parts: [{ text: "Reply" }] }], attachments: [{ inlineData: { mimeType: "image/png", data: "aGVsbG8=" } }, { inlineData: { mimeType: "application/pdf", data: "JVBERi0=" } }] }),
      [],
      undefined,
      target("claude-sonnet-5-5", "heavy"),
    );
    expect(res.text).toBe('{"ok":true}');
    const body = seen[0]!.body;
    expect(body).toMatchObject({ cache_control: { type: "ephemeral" }, output_config: { effort: "medium" } });
    const messages = body.messages as { role: string; content: { type: string }[] }[];
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(messages[2]!.content.map((c) => c.type)).toEqual(["image", "document", "text"]);
    expect(String((body.system as { text: string }[])[0]!.text)).toMatch(/JSON/);
  });

  test("tools: the whole turn, thinking included, goes back unchanged with the results first", async () => {
    const turn = [
      { type: "thinking", thinking: "", signature: "sig-1" },
      { type: "tool_use", id: "toolu_1", name: "read_note", input: { noteId: "n1" } },
    ];
    const seen = stub(json(claudeMessage(turn, { stop: "tool_use" })), json(claudeMessage([{ type: "text", text: "Done." }])));
    const tools = [{ name: "read_note", description: "Reads a note.", parameters: { type: "object", properties: { noteId: { type: "string" } }, required: ["noteId"] } }];
    const first = await anthropicAdapter.generate(req({ tools }), [], undefined, target("claude-sonnet-5-5", "heavy"));
    expect(first.toolCalls).toEqual([{ name: "read_note", args: { noteId: "n1" }, id: "toolu_1" }]);
    expect(seen[0]!.body).toMatchObject({ tools: [{ name: "read_note", input_schema: tools[0]!.parameters }], tool_choice: { type: "auto" } });
    await anthropicAdapter.generate(
      req({ prompt: "", tools, toolChoice: "none", contents: [{ role: "user", parts: [{ text: "Summarize n1" }] }, { role: "model", parts: first.parts }, { role: "user", parts: [{ functionResponse: { name: "read_note", id: "toolu_1", response: { text: "Hello" } } }] }] }),
      [],
      undefined,
      target("claude-sonnet-5-5", "heavy"),
    );
    const messages = seen[1]!.body.messages as { role: string; content: Record<string, unknown>[] }[];
    expect(messages[1]).toEqual({ role: "assistant", content: turn });
    expect(messages[2]!.content[0]).toEqual({ type: "tool_result", tool_use_id: "toolu_1", content: '{"text":"Hello"}' });
    expect(seen[1]!.body.tool_choice).toEqual({ type: "none" });
  });

  test("web search: Claude's tool (the filtering one on Sonnet, the basic one on Haiku), citations as sources, a paused turn resumed", async () => {
    const searched = [
      { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "Oslo population" } },
      { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", url: "https://ssb.no/oslo", title: "SSB", encrypted_content: "x", page_age: null }] },
    ];
    const answer = [{ type: "text", text: "Oslo has 700,000 people.", citations: [{ type: "web_search_result_location", url: "https://ssb.no/oslo", title: "SSB", cited_text: "700,000", encrypted_index: "e" }] }];
    const seen = stub(json(claudeMessage(searched, { stop: "pause_turn", usage: { input_tokens: 50, output_tokens: 10, server_tool_use: { web_search_requests: 1 } } })), json(claudeMessage(answer, { usage: { input_tokens: 80, output_tokens: 20, server_tool_use: { web_search_requests: 1 } } })));
    const meter: CallUsage[] = [];
    const res = await anthropicAdapter.generate(req({ searchGrounding: true }), meter, undefined, target("claude-sonnet-5-5", "heavy"));
    expect(seen).toHaveLength(2);
    expect(seen[0]!.body.tools).toEqual([{ type: "web_search_20260209", name: "web_search", max_uses: 5 }]);
    // The paused turn goes back as the assistant's so far.
    expect((seen[1]!.body.messages as { role: string }[]).at(-1)!.role).toBe("assistant");
    expect(res.text).toBe("Oslo has 700,000 people.");
    expect(res.grounding).toEqual({ queries: ["Oslo population"], sources: [{ uri: "https://ssb.no/oslo", title: "SSB" }], supports: [{ text: "Oslo has 700,000 people.", sources: [0] }] });
    expect(meter).toEqual([{ model: "claude-sonnet-5-5", promptTokens: 130, outputTokens: 30, thoughtsTokens: 0, searches: 2 }]);
    stub(json(claudeMessage(answer)));
    const seenHaiku = stub(json(claudeMessage(answer)));
    await anthropicAdapter.generate(req({ searchGrounding: true }), [], undefined, target("claude-haiku-5-5", "heavy"));
    expect((seenHaiku[0]!.body.tools as { type: string }[])[0]!.type).toBe("web_search_20250305");
  });

  test("streaming, Stop, a refusal, and errors", async () => {
    const stream = sse([
      { event: "message_start", data: { type: "message_start", message: { ...claudeMessage([]), stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } } },
      { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
      { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } } },
      { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " there" } } },
      { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
      { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 12 } } },
      { event: "message_stop", data: { type: "message_stop" } },
    ]);
    stub(stream);
    const pieces: string[] = [];
    const meter: CallUsage[] = [];
    const res = await anthropicAdapter.generate(req(), meter, async (soFar) => (pieces.push(soFar), true), target("claude-haiku-5-5"));
    expect(pieces).toEqual(["Hello", "Hello there"]);
    expect(res.text).toBe("Hello there");
    expect(meter[0]).toMatchObject({ promptTokens: 10, outputTokens: 12 });
    stub(stream);
    expect(await anthropicAdapter.generate(req(), [], async () => false, target("claude-haiku-5-5"))).toMatchObject({ stopped: true, text: "Hello" });

    stub(json(claudeMessage([], { stop: "refusal" })));
    const refusedMeter: CallUsage[] = [];
    await expect(anthropicAdapter.generate(req(), refusedMeter, undefined, target("claude-haiku-5-5"))).rejects.toThrow(/couldn't help/);
    expect(refusedMeter[0]!.refused).toEqual({ kind: "filtered", free: true });

    stub(json({ type: "error", error: { type: "overloaded_error", message: "busy" } }, 529));
    await expect(anthropicAdapter.generate(req(), [], undefined, target("claude-haiku-5-5"))).rejects.toThrow(/busy/);
    stub(json({ type: "error", error: { type: "authentication_error", message: "bad key" } }, 401));
    await expect(anthropicAdapter.generate(req(), [], undefined, target("claude-haiku-5-5"))).rejects.toThrow(/key was refused/);
    await expect(anthropicAdapter.generate(req(), [], undefined, { model: "claude-haiku-5-5", slot: "main" })).rejects.toThrow(/isn't set up/);
  });
});

// ---------------------------------------------------------------------------------------------------
// Models, prices, slots and routes
// ---------------------------------------------------------------------------------------------------

describe("models, prices and slots", () => {
  test("every provider's models are known with their prices; unknown ones are priced as the dearest", () => {
    expect(capabilitiesOf("gpt-6-luna")).toMatchObject({ provider: "openai", tools: true, searchGrounding: true, audioIn: false, contextWindow: 272_000 });
    expect(priceOf("gpt-6.2-sol")).toMatchObject({ inputNanoPerToken: 2_000, outputNanoPerToken: 10_000, cachedInputNanoPerToken: 100 });
    expect(priceOf("gpt-7-mystery")).toMatchObject({ inputNanoPerToken: 10_000, outputNanoPerToken: 50_000 });
    expect(capabilitiesOf("claude-sonnet-5-5")).toMatchObject({ provider: "anthropic", vision: true, searchGrounding: true, contextWindow: 1_000_000 });
    expect(priceOf("claude-sonnet-5-5")).toMatchObject({ inputNanoPerToken: 2_000, outputNanoPerToken: 10_000, cachedInputNanoPerToken: 100, cacheWriteNanoPerToken: 2_500 });
    expect(priceOf("claude-new-thing")).toMatchObject({ inputNanoPerToken: 10_000, outputNanoPerToken: 50_000 });
    // Gemini is unchanged.
    expect(priceOf("gemini-3.8-flash")).toEqual({ inputNanoPerToken: 1500, outputNanoPerToken: 7500 });
  });

  test("Haiku 5.5's dearer rate applies to a prompt over 100k tokens", () => {
    expect(costNano([{ model: "claude-haiku-5-5", promptTokens: 100_000, outputTokens: 0, thoughtsTokens: 0 }])).toBe(100_000 * 100);
    expect(costNano([{ model: "claude-haiku-5-5", promptTokens: 100_001, outputTokens: 10, thoughtsTokens: 0 }])).toBe(100_001 * 500 + 10 * 2_500);
  });

  test("the slot a request uses: fast when asked; heavy for tools, search, files and long prompts", () => {
    expect(slotFor(req())).toBe("main");
    expect(slotFor(req({ fast: true, attachments: [{ inlineData: { mimeType: "image/png", data: "" } }] }))).toBe("fast");
    expect(slotFor(req({ tools: [{ name: "x", description: "x" }] }))).toBe("heavy");
    expect(slotFor(req({ searchGrounding: true }))).toBe("heavy");
    expect(slotFor(req({ attachments: [{ inlineData: { mimeType: "image/png", data: "" } }] }))).toBe("heavy");
    expect(slotFor(req({ prompt: "x".repeat(HEAVY_PROMPT_CHARS + 1) }))).toBe("heavy");
  });

  test("defaults are cheap first; estimates hold at the dearer of main and heavy", () => {
    expect(defaultModels("gemini")).toEqual({ fast: "gemini-flash-lite-latest", main: "gemini-flash-lite-latest", heavy: "gemini-3.8-flash" });
    expect(defaultModels("openai")).toEqual({ fast: "gpt-6-luna", main: "gpt-6-luna", heavy: "gpt-6.2-sol" });
    expect(defaultModels("anthropic")).toEqual({ fast: "claude-haiku-5-5", main: "claude-haiku-5-5", heavy: "claude-sonnet-5-5" });
    const plan = [{ fast: false, inputChars: 40_000, maxOutputTokens: 1_000 }];
    expect(estimateCredits(plan, defaultModels("anthropic"))).toBe(estimateCredits(plan, { fast: "claude-sonnet-5-5", main: "claude-sonnet-5-5" }));
  });

  test("routes: Gemini for every feature until changed; transcription and embeddings always Gemini; bad settings ignored", () => {
    const s = normalizeSettings({ routes: { chat: "anthropic", agent: "openai", writing: "nope" }, models: { openai: { main: "gpt-6.1-terra", heavy: "bad id!" } } });
    expect(routeOf(s, "chat").provider).toBe("anthropic");
    expect(routeOf(s, "agent").models).toEqual({ fast: "gpt-6-luna", main: "gpt-6.1-terra", heavy: "gpt-6.2-sol" });
    expect(routeOf(s, "writing").provider).toBe("gemini");
    expect(routeOf(s, "research").provider).toBe("gemini");
    const all = normalizeSettings({ routes: Object.fromEntries(["chat", "agent", "writing", "research", "attachments", "digests", "routines", "graph", "other"].map((f) => [f, "openai"])) });
    expect(routeOf(all, "transcription").provider).toBe("gemini");
    expect(routeOf(all, "embeddings").provider).toBe("gemini");
  });
});

// ---------------------------------------------------------------------------------------------------
// Admin > Foli AI, end to end
// ---------------------------------------------------------------------------------------------------

const REASON = "Switching writing to try it out";

async function admin(t: T, email: string, role: "super_admin" | "ops_admin" | "support_admin") {
  const p = await person(t, email);
  await t.run(async (ctx) => ctx.db.patch(p.profileId as Id<"profiles">, { platformRole: role }));
  return p;
}

describe("Admin > Foli AI", () => {
  test("a saved key is sealed, shown only by its last four, used for its provider's calls, and audited without it", async () => {
    const t = setup();
    const owner = await admin(t, "ai-owner@example.com", "super_admin");
    const ops = await admin(t, "ai-ops@example.com", "ops_admin");
    const someone = await person(t, "ai-someone@example.com");
    const key = "sk-ant-api03-REALLOOKINGKEY-abcdefghijklmnop-WXYZ";

    // Only the super admin saves keys; nobody else learns the panel exists.
    await expect(ops.as.action(api.aiConfig.setKey, { provider: "anthropic", key, reason: REASON })).rejects.toThrow();
    await expect(someone.as.query(api.aiConfig.overview, {})).rejects.toThrow(/Not found/);
    await expect(owner.as.action(api.aiConfig.setKey, { provider: "anthropic", key: "short", reason: REASON })).rejects.toThrow(/doesn't look like an API key/);
    await expect(owner.as.action(api.aiConfig.setKey, { provider: "anthropic", key, reason: "x" })).rejects.toThrow(/reason/);
    expect(await owner.as.action(api.aiConfig.setKey, { provider: "anthropic", key, reason: REASON })).toEqual({ last4: "WXYZ" });

    const stored = await t.run(async (ctx) => ctx.db.query("aiProviderKeys").collect());
    expect(stored).toHaveLength(1);
    expect(stored[0]!.last4).toBe("WXYZ");
    expect(stored[0]!.sealed).not.toContain("REALLOOKINGKEY");
    const overview = await ops.as.query(api.aiConfig.overview, {});
    expect(JSON.stringify(overview)).not.toContain("REALLOOKINGKEY");
    expect(overview.providers.find((p) => p.id === "anthropic")!.key).toMatchObject({ source: "saved", last4: "WXYZ" });
    expect(overview).toMatchObject({ canEditKeys: false, canEdit: true });
    const audit = await t.run(async (ctx) => ctx.db.query("adminAuditLogs").collect());
    expect(JSON.stringify(audit)).not.toContain("REALLOOKINGKEY");
    expect(audit.find((a) => a.action === "ai.key.set")).toMatchObject({ targetId: "anthropic", reason: REASON });

    // Writing routed to Claude: the saved key goes with the call, to Anthropic.
    await ops.as.mutation(api.aiConfig.setRoute, { feature: "writing", provider: "anthropic", reason: REASON });
    const seen = stub(json(claudeMessage([{ type: "text", text: "A summary." }])));
    const { text } = await someone.as.action(api.ai.write, { scope: someone.scope, task: "summarize", text: "Some notes to summarize." });
    expect(text).toBe("A summary.");
    expect(seen[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen[0]!.headers.get("authorization")).toBe(`Bearer ${key}`);
    expect(seen[0]!.body.model).toBe("claude-haiku-5-5");
    // Charged at Claude's real cost.
    const usage = await t.run(async (ctx) => ctx.db.query("aiUsage").collect());
    expect(usage[0]).toMatchObject({ count: 1 });

    // Removing the key: the feature has no key (no fallback to another provider).
    await owner.as.mutation(api.aiConfig.removeKey, { provider: "anthropic", reason: REASON });
    await expect(someone.as.action(api.ai.write, { scope: someone.scope, task: "summarize", text: "Some notes." })).rejects.toThrow(/isn't set up/);
  });

  test("models are checked against their provider; routes and models are audited", async () => {
    const t = setup();
    const ops = await admin(t, "ai-models@example.com", "ops_admin");
    const support = await admin(t, "ai-support@example.com", "support_admin");
    await expect(support.as.mutation(api.aiConfig.setRoute, { feature: "chat", provider: "openai", reason: REASON })).rejects.toThrow();
    await expect(ops.as.mutation(api.aiConfig.setModels, { provider: "openai", models: { fast: "gpt-6-luna", main: "claude-haiku-5-5", heavy: "gpt-6.2-sol" }, reason: REASON })).rejects.toThrow(/isn't a OpenAI model/);
    await expect(ops.as.mutation(api.aiConfig.setModels, { provider: "openai", models: { fast: "gpt-6-luna", main: "bad id!", heavy: "gpt-6.2-sol" }, reason: REASON })).rejects.toThrow(/isn't valid/);
    await ops.as.mutation(api.aiConfig.setModels, { provider: "openai", models: { fast: "gpt-6-luna", main: "gpt-6.1-terra", heavy: "gpt-6.2-astra" }, reason: REASON });
    await ops.as.mutation(api.aiConfig.setRoute, { feature: "chat", provider: "openai", reason: REASON });
    const overview = await ops.as.query(api.aiConfig.overview, {});
    expect(overview.providers.find((p) => p.id === "openai")!.models).toEqual({ fast: "gpt-6-luna", main: "gpt-6.1-terra", heavy: "gpt-6.2-astra" });
    expect(overview.features.find((f) => f.feature === "chat")!.provider).toBe("openai");
    const actions = (await t.run(async (ctx) => ctx.db.query("adminAuditLogs").collect())).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["ai.models.set", "ai.route.set"]));
  });

  test("a key in the environment still works when none is saved; the chat says which provider it uses", async () => {
    const t = setup();
    const p = await person(t, "ai-env@example.com");
    await setAiSettings(t, { routes: { writing: "openai" } });
    process.env.OPENAI_API_KEY = "sk-env-key-00000000000000000000";
    const seen = stub(json(openaiResponse({ output: [message("Summary.")] })));
    await p.as.action(api.ai.write, { scope: p.scope, task: "summarize", text: "Notes." });
    expect(seen[0]!.headers.get("authorization")).toBe("Bearer sk-env-key-00000000000000000000");
    await setAiSettings(t, { routes: { chat: "anthropic" } });
    expect(await p.as.query(api.aiChat.capabilities, {})).toMatchObject({ provider: "anthropic", model: "claude-haiku-5-5", searchGrounding: true, vision: true });
  });
});
