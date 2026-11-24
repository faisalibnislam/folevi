import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  AI_CHANNELS,
  AI_HOSTS,
  AiService,
  allowedAiUrl,
  buildRequest,
  checkRequest,
  cleanKey,
  DEFAULT_MODELS,
  HelperClient,
  registerAiIpc,
  SseParser,
  type AiKeyProvider,
  type AiRequest,
  type AiResult,
  type FetchLike,
} from "./ai";

const KEYS: Record<AiKeyProvider, string> = {
  openai: "sk-proj-TESTKEY0123456789abcdefXYZ",
  anthropic: "sk-ant-api03-TESTKEY0123456789abcdef",
  google: "AIzaSyTESTKEY0123456789abcdefghijkl",
};

type Sent = { url: string; init: Parameters<FetchLike>[1] };

function memorySecrets(initial: Partial<Record<string, string>> = {}) {
  const map = new Map<string, string>(Object.entries(initial) as [string, string][]);
  return {
    map,
    get: (n: string) => map.get(n) ?? null,
    has: (n: string) => map.has(n),
    set: (n: string, v: string) => void map.set(n, v),
    delete: (n: string) => void map.delete(n),
  };
}

/** A streamed answer made of these chunks (strings or raw bytes), sent one by one. */
function streamed(chunks: (string | Uint8Array)[], status = 200, opts: { hang?: boolean } = {}): Response {
  const enc = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        const c = chunks[i++]!;
        controller.enqueue(typeof c === "string" ? enc.encode(c) : c);
      } else if (!opts.hang) controller.close();
      else return new Promise(() => undefined);
    },
  });
  return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
}

/** A service whose fetch answers with `respond` and records every request (and checks its host). */
function harness(respond: (s: Sent) => Response | Promise<Response>, keys: Partial<Record<string, string>> = { "ai.openai": KEYS.openai, "ai.anthropic": KEYS.anthropic, "ai.google": KEYS.google }) {
  const sent: Sent[] = [];
  const secrets = memorySecrets(keys);
  const fetch: FetchLike = async (url, init) => {
    sent.push({ url, init });
    // Whatever the request, it may only ever go to one of the three providers.
    expect(Object.values(AI_HOSTS)).toContain(new URL(url).hostname);
    expect(new URL(url).protocol).toBe("https:");
    expect(init.redirect).toBe("error");
    return respond({ url, init });
  };
  const service = new AiService({ fetch, secrets, helper: () => null });
  return { service, sent, secrets };
}

const sse = (events: { event?: string; data: unknown }[]) => events.map((e) => `${e.event ? `event: ${e.event}\n` : ""}data: ${JSON.stringify(e.data)}\n\n`).join("");

/** Every way of cutting `text` in two, plus one byte at a time. */
function splits(text: string): (string | Uint8Array)[][] {
  const bytes = new TextEncoder().encode(text);
  const out: (string | Uint8Array)[][] = [];
  for (let i = 1; i < bytes.length; i += 7) out.push([bytes.slice(0, i), bytes.slice(i)]);
  out.push(Array.from(bytes, (b) => new Uint8Array([b])));
  return out;
}

const ask = (provider: AiRequest["provider"], extra: Partial<AiRequest> = {}): AiRequest => ({ provider, messages: [{ role: "user", content: "Hello" }], ...extra });

async function run(service: AiService, req: unknown) {
  const chunks: string[] = [];
  const result = await service.generate(req, (t) => chunks.push(t)).done;
  return { result, chunks };
}

const OPENAI_STREAM = sse([
  { event: "response.created", data: { type: "response.created", response: { status: "in_progress" } } },
  { event: "response.output_text.delta", data: { type: "response.output_text.delta", delta: "Hé" } },
  { event: "response.output_text.delta", data: { type: "response.output_text.delta", delta: "llo, " } },
  { event: "response.output_text.delta", data: { type: "response.output_text.delta", delta: "wörld 👋" } },
  { event: "response.completed", data: { type: "response.completed", response: { status: "completed" } } },
]);

const ANTHROPIC_STREAM = sse([
  { event: "message_start", data: { type: "message_start", message: { id: "msg_1" } } },
  { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } } },
  { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "secret plan" } } },
  { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } } },
  { event: "content_block_start", data: { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } } },
  { event: "ping", data: { type: "ping" } },
  { event: "content_block_delta", data: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hé" } } },
  { event: "content_block_delta", data: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "llo, wörld 👋" } } },
  { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "end_turn" } } },
  { event: "message_stop", data: { type: "message_stop" } },
]);

const GOOGLE_STREAM = sse([
  { data: { candidates: [{ content: { role: "model", parts: [{ text: "thinking about it", thought: true }] } }] } },
  { data: { candidates: [{ content: { role: "model", parts: [{ text: "Hé" }] } }] } },
  { data: { candidates: [{ content: { role: "model", parts: [{ text: "llo, wörld 👋" }] }, finishReason: "STOP" }] } },
]);

describe("server-sent events", () => {
  test("events come out whole however the stream is cut", () => {
    const text = "event: a\ndata: one\n\n: a comment\r\ndata: two\r\ndata: lines\r\n\r\nevent: b\rdata: three\r\r";
    for (let i = 0; i <= text.length; i++) {
      const p = new SseParser();
      const events = [...p.feed(text.slice(0, i)), ...p.feed(text.slice(i)), ...p.end()];
      expect(events).toEqual([
        { event: "a", data: "one" },
        { event: "message", data: "two\nlines" },
        { event: "b", data: "three" },
      ]);
    }
  });

  test("an event the stream ends on still counts", () => {
    const p = new SseParser();
    expect([...p.feed("data: last"), ...p.end()]).toEqual([{ event: "message", data: "last" }]);
  });
});

describe("streaming from the three providers", () => {
  const cases: [AiKeyProvider, string][] = [
    ["openai", OPENAI_STREAM],
    ["anthropic", ANTHROPIC_STREAM],
    ["google", GOOGLE_STREAM],
  ];
  for (const [provider, stream] of cases) {
    test(`${provider}: deltas split across chunks (even inside a character) make the same answer`, async () => {
      for (const parts of splits(stream)) {
        const { service } = harness(() => streamed(parts));
        const { result, chunks } = await run(service, ask(provider));
        expect(result).toEqual({ text: "Héllo, wörld 👋", stopReason: "end" });
        expect(chunks.join("")).toBe("Héllo, wörld 👋");
      }
    });
  }

  test("thinking never reaches the answer", async () => {
    const { service } = harness(() => streamed([ANTHROPIC_STREAM]));
    const { result, chunks } = await run(service, ask("anthropic"));
    expect(result.text).not.toContain("secret plan");
    expect(chunks.join("")).not.toContain("secret plan");
    const g = harness(() => streamed([GOOGLE_STREAM]));
    expect((await run(g.service, ask("google"))).result.text).not.toContain("thinking about it");
  });

  test("stop reasons: the token limit is 'length', a filter or refusal is an error", async () => {
    const openaiLength = sse([
      { data: { type: "response.output_text.delta", delta: "Partial" } },
      { data: { type: "response.incomplete", response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } } },
    ]);
    expect((await run(harness(() => streamed([openaiLength])).service, ask("openai"))).result).toEqual({ text: "Partial", stopReason: "length" });
    const openaiFilter = sse([{ data: { type: "response.incomplete", response: { incomplete_details: { reason: "content_filter" } } } }]);
    expect((await run(harness(() => streamed([openaiFilter])).service, ask("openai"))).result.stopReason).toBe("error");

    const anthropicLength = sse([
      { data: { type: "content_block_delta", delta: { type: "text_delta", text: "Partial" } } },
      { data: { type: "message_delta", delta: { stop_reason: "max_tokens" } } },
      { data: { type: "message_stop" } },
    ]);
    expect((await run(harness(() => streamed([anthropicLength])).service, ask("anthropic"))).result).toEqual({ text: "Partial", stopReason: "length" });
    const refusal = sse([{ data: { type: "message_delta", delta: { stop_reason: "refusal" } } }, { data: { type: "message_stop" } }]);
    expect((await run(harness(() => streamed([refusal])).service, ask("anthropic"))).result).toMatchObject({ stopReason: "error", error: "Claude declined to answer this." });

    const googleLength = sse([{ data: { candidates: [{ content: { parts: [{ text: "Partial" }] }, finishReason: "MAX_TOKENS" }] } }]);
    expect((await run(harness(() => streamed([googleLength])).service, ask("google"))).result).toEqual({ text: "Partial", stopReason: "length" });
    const safety = sse([{ data: { candidates: [{ finishReason: "SAFETY" }] } }]);
    expect((await run(harness(() => streamed([safety])).service, ask("google"))).result).toMatchObject({ stopReason: "error", error: "Gemini stopped this answer (safety)." });
    // Gemini's stream may simply end.
    const plain = sse([{ data: { candidates: [{ content: { parts: [{ text: "Done" }] } }] } }]);
    expect((await run(harness(() => streamed([plain])).service, ask("google"))).result).toEqual({ text: "Done", stopReason: "end" });
  });

  test("errors inside a stream", async () => {
    const overloaded = sse([{ event: "error", data: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } } }]);
    expect((await run(harness(() => streamed([overloaded])).service, ask("anthropic"))).result).toMatchObject({ stopReason: "error", errorCode: "rate" });
    const failed = sse([{ data: { type: "response.failed", response: { error: { code: "context_length_exceeded", message: "Your input exceeds the context window" } } } }]);
    expect((await run(harness(() => streamed([failed])).service, ask("openai"))).result).toMatchObject({ stopReason: "error", errorCode: "context" });
    // A stream from OpenAI or Anthropic that ends without saying how was cut off.
    const cut = sse([{ data: { type: "response.output_text.delta", delta: "Half" } }]);
    expect((await run(harness(() => streamed([cut])).service, ask("openai"))).result).toMatchObject({ text: "Half", stopReason: "error", errorCode: "network" });
  });
});

describe("what goes to each provider", () => {
  const req = ask("openai", { system: "Be brief.", messages: [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello!" }, { role: "user", content: "List two fruits" }], maxTokens: 100, temperature: 0.4, json: true });

  test("OpenAI: the Responses API, the key as a bearer, JSON mode, no temperature (reasoning models refuse it), nothing stored", () => {
    const b = buildRequest("openai", req, KEYS.openai);
    expect(b.url).toBe("https://api.openai.com/v1/responses");
    expect(b.headers).toEqual({ "content-type": "application/json", authorization: `Bearer ${KEYS.openai}` });
    const body = JSON.parse(b.body);
    expect(body).toMatchObject({ model: DEFAULT_MODELS.openai, stream: true, store: false, text: { format: { type: "json_object" } }, max_output_tokens: 100 + 2048 });
    expect(body.instructions).toContain("Be brief.");
    expect(body.instructions).toMatch(/JSON/);
    expect(body.input).toEqual(req.messages);
    expect(body).not.toHaveProperty("temperature");
  });

  test("Anthropic: x-api-key and the API version, no temperature, no thinking parameters", () => {
    const b = buildRequest("anthropic", { ...req, provider: "anthropic", model: "claude-haiku-5-5" }, KEYS.anthropic);
    expect(b.url).toBe("https://api.anthropic.com/v1/messages");
    expect(b.headers).toEqual({ "content-type": "application/json", "x-api-key": KEYS.anthropic, "anthropic-version": "2023-06-01" });
    const body = JSON.parse(b.body);
    expect(body).toMatchObject({ model: "claude-haiku-5-5", stream: true, max_tokens: 100 + 2048 });
    expect(body.system).toContain("Be brief.");
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("thinking");
    // Without maxTokens there's still a limit (Anthropic requires one).
    expect(JSON.parse(buildRequest("anthropic", ask("anthropic"), KEYS.anthropic).body).max_tokens).toBeGreaterThan(0);
  });

  test("Google: x-goog-api-key (never the address), roles user and model, JSON as the response type", () => {
    const b = buildRequest("google", { ...req, provider: "google" }, KEYS.google);
    expect(b.url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODELS.google}:streamGenerateContent?alt=sse`);
    expect(b.url).not.toContain(KEYS.google);
    expect(b.headers).toEqual({ "content-type": "application/json", "x-goog-api-key": KEYS.google });
    const body = JSON.parse(b.body);
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(["user", "model", "user"]);
    expect(body.generationConfig).toEqual({ temperature: 0.4, maxOutputTokens: 100 + 2048, responseMimeType: "application/json" });
    expect(body.systemInstruction.parts[0].text).toContain("Be brief.");
  });

  test("the key is only in its header: not in the address, not in the body", async () => {
    for (const provider of ["openai", "anthropic", "google"] as AiKeyProvider[]) {
      const { service, sent } = harness(() => streamed([provider === "openai" ? OPENAI_STREAM : provider === "anthropic" ? ANTHROPIC_STREAM : GOOGLE_STREAM]));
      const { result } = await run(service, ask(provider));
      expect(sent).toHaveLength(1);
      const s = sent[0]!;
      expect(s.url).not.toContain(KEYS[provider]);
      expect(s.init.body).not.toContain(KEYS[provider]);
      const carrying = Object.entries(s.init.headers).filter(([, v]) => v.includes(KEYS[provider]));
      expect(carrying.map(([k]) => k)).toEqual([provider === "openai" ? "authorization" : provider === "anthropic" ? "x-api-key" : "x-goog-api-key"]);
      expect(JSON.stringify(result)).not.toContain(KEYS[provider]);
    }
  });
});

describe("errors", () => {
  const reply = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  test("HTTP answers map to codes and plain words", async () => {
    const r401 = await run(harness(reply(401, { error: { message: "Incorrect API key provided", code: "invalid_api_key" } })).service, ask("openai"));
    expect(r401.result).toEqual({ text: "", stopReason: "error", errorCode: "auth", error: "The OpenAI key was refused. Check it in Settings > AI." });
    const r403 = await run(harness(reply(403, { error: { type: "permission_error", message: "nope" } })).service, ask("anthropic"));
    expect(r403.result).toMatchObject({ errorCode: "auth", error: "The Anthropic key was refused. Check it in Settings > AI." });
    const google = await run(harness(reply(400, { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } })).service, ask("google"));
    expect(google.result).toMatchObject({ errorCode: "auth", error: "The Google key was refused. Check it in Settings > AI." });
    expect((await run(harness(reply(429, { error: { message: "Rate limit reached", code: "rate_limit_exceeded" } })).service, ask("openai"))).result.errorCode).toBe("rate");
    expect((await run(harness(reply(429, { error: { message: "You exceeded your current quota", code: "insufficient_quota" } })).service, ask("openai"))).result).toMatchObject({ errorCode: "rate", error: "The OpenAI account is out of credit or over its quota." });
    expect((await run(harness(reply(400, { error: { message: "Your input exceeds the context window of this model.", code: "context_length_exceeded" } })).service, ask("openai"))).result.errorCode).toBe("context");
    expect((await run(harness(reply(400, { type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 1200000 tokens > 1000000 maximum" } })).service, ask("anthropic"))).result.errorCode).toBe("context");
    expect((await run(harness(reply(404, { error: { message: "model not found" } })).service, ask("openai", { model: "gpt-nope" }))).result).toMatchObject({ errorCode: "invalid" });
    expect((await run(harness(reply(529, { error: { type: "overloaded_error" } })).service, ask("anthropic"))).result.errorCode).toBe("unavailable");
  });

  test("a network failure, and a missing key", async () => {
    const down = harness(() => Promise.reject(new TypeError("fetch failed")));
    expect((await run(down.service, ask("anthropic"))).result).toEqual({ text: "", stopReason: "error", errorCode: "network", error: "Foli AI couldn't reach Anthropic. Check the connection." });
    const none = harness(() => streamed([OPENAI_STREAM]), {});
    expect((await run(none.service, ask("openai"))).result).toMatchObject({ errorCode: "auth", error: "Add your OpenAI key in Settings > AI first." });
    expect(none.sent).toHaveLength(0);
  });

  test("a provider that echoes the key back never gets it to the page", async () => {
    for (const provider of ["openai", "anthropic", "google"] as AiKeyProvider[]) {
      const echo = harness(() => new Response(JSON.stringify({ error: { message: `Bad request for key ${KEYS[provider]}` } }), { status: 400 }));
      const { result } = await run(echo.service, ask(provider));
      expect(result.stopReason).toBe("error");
      expect(JSON.stringify(result)).not.toContain(KEYS[provider]);
      const inStream = harness(() => streamed([sse([{ data: { type: "error", error: { type: "api_error", message: `oops ${KEYS[provider]}` } } }])]));
      expect(JSON.stringify((await run(inStream.service, ask(provider === "google" ? "anthropic" : provider))).result)).not.toContain(KEYS.anthropic);
      const tested = await echo.service.testKey(provider);
      expect(tested.ok).toBe(false);
      expect(JSON.stringify(tested)).not.toContain(KEYS[provider]);
    }
  });
});

describe("cancelling", () => {
  test("cancel aborts the request and ends with the text so far", async () => {
    let signal: AbortSignal | undefined;
    const { service } = harness(({ init }) => {
      signal = init.signal;
      return streamed([sse([{ data: { type: "content_block_delta", delta: { type: "text_delta", text: "Once upon" } } }])], 200, { hang: true });
    });
    const chunks: string[] = [];
    const g = service.generate(ask("anthropic"), (t) => {
      chunks.push(t);
      g.cancel();
    });
    expect(await g.done).toEqual({ text: "Once upon", stopReason: "cancelled" });
    expect(signal?.aborted).toBe(true);
  });

  test("cancel before the answer starts", async () => {
    const { service } = harness(({ init }) => new Promise<Response>((_r, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    const g = service.generate(ask("google"), () => undefined);
    g.cancel();
    expect(await g.done).toEqual({ text: "", stopReason: "cancelled" });
  });

  test("a stream that goes quiet counts as lost", async () => {
    const sent: Sent[] = [];
    const service = new AiService({ fetch: async (url, init) => (sent.push({ url, init }), streamed([], 200, { hang: true })), secrets: memorySecrets({ "ai.openai": KEYS.openai }), helper: () => null, idleMs: 50 });
    expect((await run(service, ask("openai"))).result).toMatchObject({ stopReason: "error", errorCode: "network" });
  });
});

describe("the host allowlist", () => {
  test("only https on exactly the three providers' hosts", () => {
    expect(allowedAiUrl("https://api.openai.com/v1/responses")).toBe(true);
    expect(allowedAiUrl("https://api.anthropic.com/v1/messages", "anthropic")).toBe(true);
    expect(allowedAiUrl("https://generativelanguage.googleapis.com/v1beta/models/x:streamGenerateContent?alt=sse", "google")).toBe(true);
    for (const bad of [
      "http://api.openai.com/v1/responses",
      "https://api.openai.com:8443/v1/responses",
      "https://user:pw@api.openai.com/v1/responses",
      "https://api.openai.com.evil.com/v1/responses",
      "https://evil.com/api.openai.com",
      "https://app.folevi.com/api/ai",
      "https://folevi.com/",
      "https://x.convex.cloud/",
      "wss://api.openai.com/",
      "app://folevi/",
      "not a url",
    ]) {
      expect(allowedAiUrl(bad)).toBe(false);
    }
    // Each provider only its own host.
    expect(allowedAiUrl("https://api.openai.com/v1/messages", "anthropic")).toBe(false);
  });

  test("a crafted model id can't move the request", () => {
    for (const model of ["../x", "..", ".", "x?key=1", "x#y", "a/b", "models%2F..%2Fx", "x y", "", "a".repeat(81), "https://evil.com"]) {
      expect(checkRequest(ask("google", { model })).ok).toBe(false);
      if (model) expect(() => buildRequest("google", ask("google", { model }), KEYS.google)).toThrow();
    }
    const ok = buildRequest("google", ask("google", { model: "gemini-4-argon" }), KEYS.google);
    expect(new URL(ok.url).pathname).toBe("/v1beta/models/gemini-4-argon:streamGenerateContent");
  });

  test("redirects are refused, never followed", async () => {
    const redirected = harness(() => {
      const res = new Response("", { status: 200 });
      Object.defineProperty(res, "redirected", { value: true });
      Object.defineProperty(res, "url", { value: "https://evil.com/steal" });
      return res;
    });
    expect((await run(redirected.service, ask("openai"))).result).toMatchObject({ stopReason: "error", errorCode: "network" });
    const moved = harness(() => new Response("", { status: 307, headers: { location: "https://evil.com/" } }));
    expect((await run(moved.service, ask("anthropic"))).result.stopReason).toBe("error");
    expect(moved.sent).toHaveLength(1);
    // With `redirect: "error"` the session's fetch itself fails on one: that's a network error.
    const failing = harness(() => Promise.reject(new TypeError("redirect mode is set to error")));
    expect((await run(failing.service, ask("openai"))).result.errorCode).toBe("network");
  });
});

describe("checking requests", () => {
  test("a good request passes with only its own fields", () => {
    const r = checkRequest({ provider: "openai", model: "gpt-6-luna", system: "s", messages: [{ role: "user", content: "hi", extra: 1 }], maxTokens: 10, temperature: 0, json: true, schema: { type: "object" }, other: "dropped" });
    expect(r).toEqual({ ok: true, req: { provider: "openai", model: "gpt-6-luna", system: "s", messages: [{ role: "user", content: "hi" }], maxTokens: 10, temperature: 0, json: true, schema: { type: "object" } } });
  });

  test("everything else is refused", async () => {
    const m = [{ role: "user", content: "hi" }];
    const bad: unknown[] = [
      null,
      "text",
      [],
      { messages: m },
      { provider: "folevi", messages: m },
      { provider: "openai", messages: [] },
      { provider: "openai", messages: Array.from({ length: 65 }, () => ({ role: "user", content: "x" })) },
      { provider: "openai", messages: [{ role: "system", content: "x" }] },
      { provider: "openai", messages: [{ role: "user", content: 42 }] },
      { provider: "openai", messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] },
      { provider: "openai", messages: [{ role: "user", content: "x".repeat(400 * 1024 + 1) }] },
      { provider: "openai", system: "x".repeat(300 * 1024), messages: [{ role: "user", content: "y".repeat(150 * 1024) }] },
      { provider: "openai", messages: m, maxTokens: 0 },
      { provider: "openai", messages: m, maxTokens: 32769 },
      { provider: "openai", messages: m, maxTokens: 1.5 },
      { provider: "openai", messages: m, temperature: -0.1 },
      { provider: "openai", messages: m, temperature: 2.1 },
      { provider: "openai", messages: m, temperature: Number.NaN },
      { provider: "openai", messages: m, json: "yes" },
      { provider: "openai", messages: m, system: 5 },
      { provider: "openai", messages: m, model: 7 },
      { provider: "openai", messages: m, schema: { big: "x".repeat(33 * 1024) } },
    ];
    for (const b of bad) expect(checkRequest(b).ok, JSON.stringify(b)?.slice(0, 120)).toBe(false);
    // Refused before anything is sent.
    const { service, sent } = harness(() => streamed([OPENAI_STREAM]));
    const { result } = await run(service, bad[5]);
    expect(result).toMatchObject({ stopReason: "error", errorCode: "invalid" });
    expect(sent).toHaveLength(0);
    // 64 turns ending with the person's is fine.
    expect(checkRequest({ provider: "openai", messages: Array.from({ length: 64 }, (_v, i) => ({ role: i % 2 ? "assistant" : "user", content: "x" })).reverse() }).ok).toBe(true);
  });
});

describe("testing a key", () => {
  test("one tiny, non-streaming request with the stored key", async () => {
    for (const provider of ["openai", "anthropic", "google"] as AiKeyProvider[]) {
      const { service, sent } = harness(() => new Response("{}", { status: 200 }));
      expect(await service.testKey(provider)).toEqual({ ok: true });
      const body = JSON.parse(sent[0]!.init.body);
      if (provider === "openai") expect(body).toMatchObject({ stream: false, max_output_tokens: 16 });
      if (provider === "anthropic") expect(body).toMatchObject({ stream: false, max_tokens: 8 });
      if (provider === "google") {
        expect(sent[0]!.url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODELS.google}:generateContent`);
        expect(body.generationConfig.maxOutputTokens).toBe(8);
      }
    }
  });

  test("a refused key, a missing one, an unknown provider", async () => {
    const refused = harness(() => new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 }));
    expect(await refused.service.testKey("openai")).toEqual({ ok: false, error: "The OpenAI key was refused. Check it in Settings > AI." });
    const none = harness(() => new Response("{}"), {});
    expect(await none.service.testKey("google")).toEqual({ ok: false, error: "Add your Google key in Settings > AI first." });
    expect(await none.service.testKey("on-device")).toEqual({ ok: false, error: "Foli AI can't use that provider." });
    expect(await none.service.testKey("folevi")).toMatchObject({ ok: false });
    expect(none.sent).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- IPC

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function ipc(opts: { service?: AiService | null; allowed?: boolean } = {}) {
  const handlers = new Map<string, Handler>();
  const secrets = memorySecrets({ "auth.session": "SESSION-TOKEN" });
  const pages = new Map<string, { sent: unknown[][]; gone: (() => void)[] }>();
  registerAiIpc((c, l) => handlers.set(c, l), {
    service: () => (opts.service === undefined ? harness(() => streamed([OPENAI_STREAM])).service : opts.service),
    secrets: () => secrets,
    allowed: (e) => (opts.allowed ?? true) && (e as { ok?: boolean }).ok !== false,
    sender: (e) => {
      const key = (e as { page?: string }).page ?? "1";
      let p = pages.get(key);
      if (!p) pages.set(key, (p = { sent: [], gone: [] }));
      const page = p;
      return { key, send: (...args) => void page.sent.push(args), onGone: (cb) => void page.gone.push(cb) };
    },
  });
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({ page: "1" }, ...args);
  return { handlers, secrets, pages, call };
}

describe("the page's calls", () => {
  test("exactly these channels are registered, and the preload calls each of them", () => {
    const { handlers } = ipc();
    const { chunk, ...invoked } = AI_CHANNELS;
    expect([...handlers.keys()].sort()).toEqual(Object.values(invoked).sort());
    const preload = readFileSync(join(__dirname, "preload.ts"), "utf8");
    for (const channel of Object.values(AI_CHANNELS)) expect(preload).toContain(`"${channel}"`);
    expect(chunk).toBe("shell:ai-chunk");
    // The page's side has no way to a key or the account session.
    expect(preload).not.toMatch(/safeStorage|auth\.session|secrets\.ts|x-api-key|x-goog-api-key|api\.openai|api\.anthropic|googleapis/i);
  });

  test("secrets: only the three ai. names, never auth.session; write-only; trimmed and checked", async () => {
    const { call, secrets } = ipc();
    for (const name of ["auth.session", "ai.other", "", null, 42, "AI.OPENAI", "ai.openai "]) {
      expect(await call(AI_CHANNELS.secretsHas, name)).toBe(false);
      expect(await call(AI_CHANNELS.secretsSet, name, "sk-x")).toMatchObject({ ok: false });
      expect(await call(AI_CHANNELS.secretsDelete, name)).toMatchObject({ ok: false });
    }
    expect(secrets.map.get("auth.session")).toBe("SESSION-TOKEN");
    expect(await call(AI_CHANNELS.secretsSet, "ai.openai", `  ${KEYS.openai}\n`)).toEqual({ ok: true });
    expect(secrets.map.get("ai.openai")).toBe(KEYS.openai);
    expect(await call(AI_CHANNELS.secretsHas, "ai.openai")).toBe(true);
    for (const value of ["", "   ", "has space inside", "x".repeat(4097), 12345, null, "tab\tkey", "naïve"]) {
      expect(await call(AI_CHANNELS.secretsSet, "ai.google", value)).toMatchObject({ ok: false, error: "That doesn't look like an API key." });
    }
    expect(await call(AI_CHANNELS.secretsDelete, "ai.openai")).toEqual({ ok: true });
    expect(await call(AI_CHANNELS.secretsHas, "ai.openai")).toBe(false);
    // Nothing answers a key back.
    for (const h of [AI_CHANNELS.secretsHas, AI_CHANNELS.secretsSet, AI_CHANNELS.secretsDelete]) expect(JSON.stringify(await call(h, "ai.anthropic", KEYS.anthropic))).not.toContain(KEYS.anthropic);
    expect(cleanKey(" abc ")).toBe("abc");
  });

  test("a page that isn't the bundled interface gets nothing", async () => {
    const { handlers, secrets } = ipc({ allowed: false });
    secrets.map.set("ai.openai", KEYS.openai);
    expect(await handlers.get(AI_CHANNELS.secretsHas)!({}, "ai.openai")).toBe(false);
    expect(await handlers.get(AI_CHANNELS.secretsSet)!({}, "ai.openai", "sk-new")).toMatchObject({ ok: false });
    expect(secrets.map.get("ai.openai")).toBe(KEYS.openai);
    expect(await handlers.get(AI_CHANNELS.capabilities)!({})).toEqual({ onDevice: false, onDeviceStatus: "unknown", keys: {} });
    expect(await handlers.get(AI_CHANNELS.generate)!({}, "a1", ask("openai"))).toMatchObject({ stopReason: "error", errorCode: "unavailable" });
    expect(await handlers.get(AI_CHANNELS.testKey)!({}, "openai")).toMatchObject({ ok: false });
  });

  test("generate streams chunks to the page under the request's id and resolves with the result", async () => {
    const { call, pages } = ipc();
    const result = (await call(AI_CHANNELS.generate, "abc_1", ask("openai"))) as AiResult;
    expect(result).toEqual({ text: "Héllo, wörld 👋", stopReason: "end" });
    const sent = pages.get("1")!.sent;
    expect(sent.every((s) => s[0] === AI_CHANNELS.chunk && s[1] === "abc_1")).toBe(true);
    expect(sent.map((s) => s[2]).join("")).toBe("Héllo, wörld 👋");
    expect(await call(AI_CHANNELS.generate, "bad id!", ask("openai"))).toMatchObject({ errorCode: "invalid" });
    expect(await call(AI_CHANNELS.generate, "x", { provider: "openai", messages: "no" })).toMatchObject({ errorCode: "invalid" });
  });

  test("cancel by id, and a closed window's generations stop", async () => {
    const hanging = harness(() => streamed([sse([{ data: { type: "response.output_text.delta", delta: "Hi" } }])], 200, { hang: true })).service;
    const { call, handlers, pages } = ipc({ service: hanging });
    const first = call(AI_CHANNELS.generate, "one", ask("openai")) as Promise<AiResult>;
    const second = handlers.get(AI_CHANNELS.generate)!({ page: "2" }, "one", ask("openai")) as Promise<AiResult>;
    await new Promise((r) => setTimeout(r, 20));
    // The same id from another page is another request; the same id twice from one page is refused.
    expect(await call(AI_CHANNELS.generate, "one", ask("openai"))).toMatchObject({ error: "That request is already running." });
    // Another page can't cancel this page's request.
    await handlers.get(AI_CHANNELS.cancel)!({ page: "3" }, "one");
    await call(AI_CHANNELS.cancel, "one");
    expect(await first).toEqual({ text: "Hi", stopReason: "cancelled" });
    for (const cb of pages.get("2")!.gone) cb();
    expect(await second).toEqual({ text: "Hi", stopReason: "cancelled" });
  });
});

// ---------------------------------------------------------------- the on-device helper

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A stand-in for folevi-ai speaking its protocol (a Node script). */
function fakeHelper(): string {
  const dir = mkdtempSync(join(tmpdir(), "folevi-ai-"));
  dirs.push(dir);
  const path = join(dir, "folevi-ai");
  writeFileSync(
    path,
    `#!${process.execPath}
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const running = new Map();
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    const r = JSON.parse(line);
    if (r.op === "availability") out({ id: r.id, availability: "available", contextTokens: 4096 });
    else if (r.op === "countTokens") out({ id: r.id, tokens: 7 });
    else if (r.op === "cancel") { const t = running.get(r.id); if (t) { clearInterval(t.timer); out({ id: r.id, done: true, text: t.text, stopReason: "cancelled" }); running.delete(r.id); } }
    else if (r.op === "generate") {
      const last = r.messages[r.messages.length - 1].content;
      if (last === "die") process.exit(3);
      if (last === "slow") {
        const t = { text: "", timer: setInterval(() => { t.text += "."; out({ id: r.id, delta: "." }); }, 5) };
        running.set(r.id, t);
        continue;
      }
      if (last === "long") { out({ id: r.id, done: true, text: "", stopReason: "error", error: "This is too long for Apple's on-device model.", errorCode: "context" }); continue; }
      const echo = JSON.stringify({ system: r.system ?? null, json: r.json, maxTokens: r.maxTokens ?? null, temperature: r.temperature ?? null, turns: r.messages.length });
      out({ id: r.id, delta: "Hel" }); out({ id: r.id, delta: "lo " + echo });
      out({ id: r.id, done: true, text: "Hello " + echo, stopReason: "end" });
    }
  }
});
`,
  );
  chmodSync(path, 0o755);
  return path;
}

describe("Apple's on-device model (the helper protocol)", () => {
  const service = (helper: HelperClient | null, keys: Partial<Record<string, string>> = { "ai.google": KEYS.google }) =>
    new AiService({ fetch: () => Promise.reject(new Error("no network in this test")), secrets: memorySecrets(keys), helper: () => helper });

  test("capabilities: on-device from the helper, and which keys are set (never the keys)", async () => {
    const helper = new HelperClient({ path: fakeHelper() });
    try {
      const caps = await service(helper).capabilities();
      expect(caps).toEqual({ onDevice: true, onDeviceStatus: "available", onDeviceContext: 4096, keys: { "ai.openai": false, "ai.anthropic": false, "ai.google": true } });
      expect(JSON.stringify(caps)).not.toContain(KEYS.google);
      expect(await service(helper).countTokens("hello")).toBe(7);
    } finally {
      helper.dispose();
    }
  });

  test("no helper binary: on-device is off and 'unknown'; a generation says it's unavailable", async () => {
    const helper = new HelperClient({ path: "/nonexistent/folevi-ai" });
    const s = service(helper);
    expect(await s.capabilities()).toMatchObject({ onDevice: false, onDeviceStatus: "unknown" });
    expect((await run(s, ask("on-device"))).result).toMatchObject({ stopReason: "error", errorCode: "unavailable" });
    expect(await s.countTokens("12345678")).toBe(2);
    expect((await service(null).capabilities()).onDeviceStatus).toBe("unknown");
  });

  test("a generation streams, with the request's system, JSON rule and limits passed on", async () => {
    const helper = new HelperClient({ path: fakeHelper() });
    try {
      const { result, chunks } = await run(service(helper), ask("on-device", { system: "Be kind.", json: true, maxTokens: 50, temperature: 0.3, model: "ignored-on-device" }));
      expect(result.stopReason).toBe("end");
      expect(chunks.join("")).toBe(result.text.replace(/^Hello /, "Hello "));
      const echo = JSON.parse(result.text.slice("Hello ".length));
      expect(echo).toMatchObject({ json: true, maxTokens: 50, temperature: 0.3, turns: 1 });
      expect(echo.system).toContain("Be kind.");
      expect(echo.system).toMatch(/JSON/);
      // Several in flight at once.
      const many = await Promise.all([1, 2, 3].map(() => run(service(helper), ask("on-device"))));
      expect(many.map((m) => m.result.stopReason)).toEqual(["end", "end", "end"]);
      // The helper's context error comes through as "context".
      expect((await run(service(helper), ask("on-device", { messages: [{ role: "user", content: "long" }] }))).result).toMatchObject({ stopReason: "error", errorCode: "context" });
    } finally {
      helper.dispose();
    }
  });

  test("cancel stops the helper's generation with the text so far", async () => {
    const helper = new HelperClient({ path: fakeHelper() });
    try {
      const chunks: string[] = [];
      let started: () => void = () => undefined;
      const first = new Promise<void>((r) => (started = r));
      const g = service(helper).generate(ask("on-device", { messages: [{ role: "user", content: "slow" }] }), (t) => {
        chunks.push(t);
        if (chunks.length === 3) started();
      });
      await first;
      g.cancel();
      const result = await g.done;
      expect(result.stopReason).toBe("cancelled");
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.text).toBe(chunks.join("").slice(0, result.text.length));
    } finally {
      helper.dispose();
    }
  });

  test("a helper that dies ends its requests, and the next request starts it again", async () => {
    const helper = new HelperClient({ path: fakeHelper() });
    try {
      const s = service(helper);
      const slow = s.generate(ask("on-device", { messages: [{ role: "user", content: "slow" }] }), () => undefined);
      const dying = await run(s, ask("on-device", { messages: [{ role: "user", content: "die" }] }));
      expect(dying.result).toMatchObject({ stopReason: "error", errorCode: "unavailable" });
      expect((await slow.done).stopReason).toBe("error");
      expect((await run(s, ask("on-device"))).result.stopReason).toBe("end");
    } finally {
      helper.dispose();
    }
  });
});

const REAL = join(__dirname, "..", "native-build", "folevi-ai");
describe.skipIf(process.env.FOLEVI_AI_REAL !== "1" || !existsSync(REAL))("the real folevi-ai (FOLEVI_AI_REAL=1)", () => {
  test("availability and one short generation on this Mac", { timeout: 60_000 }, async () => {
    const helper = new HelperClient({ path: REAL });
    try {
      const s = new AiService({ fetch: () => Promise.reject(new Error("offline")), secrets: memorySecrets(), helper: () => helper });
      const caps = await s.capabilities();
      console.log("folevi-ai capabilities:", JSON.stringify(caps));
      if (!caps.onDevice) return;
      const { result, chunks } = await run(s, ask("on-device", { messages: [{ role: "user", content: "Say hello in five words" }], maxTokens: 40 }));
      console.log("folevi-ai generation:", JSON.stringify(result));
      expect(result.stopReason).toBe("end");
      expect(result.text.length).toBeGreaterThan(0);
      expect(chunks.join("")).toBe(result.text);
    } finally {
      helper.dispose();
    }
  });
});
