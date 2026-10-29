// LocalAiProvider: runs the requests the shared prompt builders make (packages/ai-prompts, the same ones the
// server sends to Gemini) against the model that's active in local mode (state.ts): Apple's model on this
// device, or the person's own key, through the host (shell().ai, which calls the provider straight from the
// device). It plays the part of the server's provider layer (convex/lib/ai/provider.ts): the fast model for
// plumbing calls, the person's saved preferences added to the system prompt (memory.ts), streaming with Stop,
// the safety rules at the end of every system prompt and the refusal marker kept out of the reply (as
// convex/lib/ai/gemini.ts does), and failures turned into the person-readable errors the app shows. There are
// no credits in local mode.
//
// The on-device model is small: every request is fitted to its context (the answer's room first), and one
// that can't fit is refused with a plain message rather than cut mid-instruction. Note text is cut to fit
// before the request is built (`textBudget`), so the instructions always arrive whole.
import type { PromptRequest } from "@folevi/ai-prompts";
import { DECLINE_RULE, readDecline, SAFETY_RULE, visibleSoFar } from "@folevi/ai-prompts/safety";
import type { AiRequest, AiResult, ShellAi } from "@/lib/shell/types";
import { fail } from "../errors";
import { PROVIDERS } from "./catalog";
import type { AiFeature } from "./features";
import { loadedLocalAi, localAiHost, type ActiveModel } from "./state";
import { deviceWords } from "@/lib/shell/words";

/** Characters per token, as the server estimates them (lib/ai/retrieval.ts estimateTokens). */
export const CHARS_PER_TOKEN = 4;
export const estimateTokens = (text: string) => Math.ceil(text.length / CHARS_PER_TOKEN);

/** Room kept free on the device for the model's own framing of the instructions and the turn. */
const FRAMING_TOKENS = 200;
/** The least room an answer gets before a request is called too long. */
const MIN_ANSWER_TOKENS = 256;
/** What `withSafety` adds to every system prompt (at most), counted in each request's room for note text. */
const SAFETY_CHARS = SAFETY_RULE.length + DECLINE_RULE.length + 3;

// (Read once the page loads, when the host is known: Gemini Nano and "this phone" in the Android app.)
const WORDS = deviceWords();
export const NOT_SET_UP =
  WORDS.onDeviceModel === "Gemini Nano"
    ? "Foli AI isn't set up on this phone. Add your own key in Settings > AI."
    : "Foli AI isn't set up on this device. Turn on Apple Intelligence, or add your own key in Settings > AI.";
export const TOO_LONG_ON_DEVICE = `That's too long for Foli AI on ${WORDS.here}. Try a shorter selection, or add your own key in Settings > AI for longer notes.`;
export const OFF_HERE = "Foli AI can't do that with the model on this device. Add your own key in Settings > AI to use it.";

export interface GenerateOptions {
  /** The whole text so far as it streams; returning false stops it (Stop). */
  onDelta?: (soFar: string) => boolean | void;
  signal?: AbortSignal;
  /** The person's saved preferences block (memory.ts memoryPrompt), or null. */
  memory?: string | null;
  /** Earlier turns, before the request's prompt (a chat's conversation is already in the prompt, as on the server). */
  history?: { role: "user" | "assistant"; content: string }[];
}

export interface GenerateOutput {
  text: string;
  /** The person pressed Stop (the text is what was written until then). */
  stopped: boolean;
  /** The answer ran out of room. */
  truncated: boolean;
  provider: ActiveModel["provider"];
  model: string;
}

/** Calls a model: the host's bridge, or a fake in tests (the same shape). */
export type ModelHost = Pick<ShellAi, "generate">;

/** The person's preferences go into every call but quick plumbing ones (search terms) and copying calls. */
export function withMemory(req: PromptRequest, memory: string | null | undefined): PromptRequest {
  if (!memory || req.noMemory || (req.fast && req.json)) return req;
  return { ...req, system: `${req.system}\n\n${memory}` };
}

/**
 * Every system prompt ends with the safety rules (docs/AI_GUARDRAILS.md), as on the server; a text reply is also
 * asked to mark a refusal, which `generate` takes out before anyone sees it.
 */
export function withSafety(req: PromptRequest): PromptRequest {
  return { ...req, system: `${req.system}\n\n${SAFETY_RULE}${req.json ? "" : ` ${DECLINE_RULE}`}` };
}

/** The request as the host takes it, fitted to the model (null when it can't fit). */
export function toHostRequest(req: PromptRequest, active: ActiveModel, history: GenerateOptions["history"] = []): AiRequest | null {
  const asked = Math.max(1, Math.min(req.maxOutputTokens ?? 2048, active.maxOutputTokens));
  let maxTokens = asked;
  if (active.provider === "on-device") {
    const input = estimateTokens(req.system) + estimateTokens(req.prompt) + history.reduce((n, t) => n + estimateTokens(t.content), 0) + FRAMING_TOKENS;
    const room = active.contextTokens - input;
    if (room < Math.min(MIN_ANSWER_TOKENS, asked)) return null;
    maxTokens = Math.min(asked, room);
  }
  return {
    provider: active.provider,
    model: req.fast ? active.fastModel : active.model,
    system: req.system,
    messages: [...history, { role: "user", content: req.prompt }],
    maxTokens,
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.json ? { json: true } : {}),
  };
}

/**
 * How much note text (in characters) a request can carry on the active model, besides `overheadChars` of
 * instructions (and the safety rules) and with `answerTokens` left for the answer: the server's own cap (`serverChars`) for a key,
 * less on the device.
 */
export function textBudget(active: ActiveModel | null, o: { serverChars: number; overheadChars: number; answerTokens: number }): number {
  if (!active || active.provider !== "on-device") return o.serverChars;
  const answer = Math.min(o.answerTokens, active.maxOutputTokens, Math.floor(active.contextTokens / 2));
  const tokens = active.contextTokens - FRAMING_TOKENS - answer - estimateTokens(" ".repeat(o.overheadChars + SAFETY_CHARS));
  return Math.max(0, Math.min(o.serverChars, tokens * CHARS_PER_TOKEN));
}

/** Text cut to `max` characters at a word, marked as cut. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf(" ", max);
  return `${text.slice(0, cut > max * 0.6 ? cut : max).trimEnd()}…`;
}

function failFor(result: AiResult, active: ActiveModel): never {
  const name = PROVIDERS[active.provider].label;
  switch (result.errorCode) {
    case "auth":
      return fail("forbidden", `Your ${name} key was refused. Check it in Settings > AI.`, { reason: "ai_key" });
    case "rate":
      return fail("rate_limited", `${name} asked Foli AI to slow down. Try again in a minute.`);
    case "context":
      return fail("limit_exceeded", active.provider === "on-device" ? TOO_LONG_ON_DEVICE : "That's too long for this model. Try a shorter selection.");
    case "network":
      return fail("maintenance", active.provider === "on-device" ? `Foli AI on ${deviceWords().here} didn't answer. Try again.` : `Foli AI couldn't reach ${name}. Check your connection and try again.`);
    case "unavailable":
      return fail("maintenance", active.provider === "on-device" ? `${deviceWords().onDeviceModel} isn't ready on ${deviceWords().here} right now. Try again later.` : `${name} isn't available right now. Try again later.`);
    default:
      return fail("maintenance", result.error?.trim() ? result.error.slice(0, 300) : "Foli AI couldn't answer that. Try again.");
  }
}

let hostOverride: ModelHost | null = null;

/** Tests: the model calls go to this fake (null restores the host's). */
export function setModelHostForTests(host: ModelHost | null): void {
  hostOverride = host;
}

export class LocalAiProvider {
  /** The active model, or the refusal the app shows when there's none (or it can't do `feature`). */
  async active(feature?: AiFeature): Promise<ActiveModel> {
    const state = await loadedLocalAi();
    if (!state.active) fail("forbidden", NOT_SET_UP, { reason: "ai_not_included" });
    if (feature && !state.features[feature]) fail("forbidden", OFF_HERE, { reason: "ai_not_included" });
    return state.active;
  }

  /** One request to the active model, streamed when `onDelta` is given. */
  async generate(req: PromptRequest, opts: GenerateOptions = {}): Promise<GenerateOutput> {
    const active = await this.active();
    const host = hostOverride ?? localAiHost().ai;
    if (!host) fail("forbidden", NOT_SET_UP, { reason: "ai_not_included" });
    const request = toHostRequest(withSafety(withMemory(req, opts.memory)), active, opts.history);
    if (!request) fail("limit_exceeded", TOO_LONG_ON_DEVICE);
    if (opts.signal?.aborted) return { text: "", stopped: true, truncated: false, provider: active.provider, model: request.model ?? active.model };
    let soFar = "";
    let stopped = false;
    const call = host.generate(request, (chunk) => {
      if (stopped || typeof chunk !== "string") return;
      soFar += chunk;
      if (opts.onDelta && opts.onDelta(visibleSoFar(soFar)) === false) {
        stopped = true;
        call.cancel();
      }
    });
    const onAbort = () => {
      stopped = true;
      call.cancel();
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    let result: AiResult;
    try {
      result = await call.done;
    } catch (e) {
      if (stopped) result = { text: soFar, stopReason: "cancelled" };
      else result = { text: soFar, stopReason: "error", errorCode: "network", error: e instanceof Error ? e.message : undefined };
    } finally {
      opts.signal?.removeEventListener("abort", onAbort);
    }
    if (stopped || result.stopReason === "cancelled") return { text: readDecline(result.text || soFar).text.trim(), stopped: true, truncated: false, provider: active.provider, model: request.model ?? active.model };
    if (result.stopReason === "error") failFor(result, active);
    return { text: readDecline(result.text ?? soFar).text.trim(), stopped: false, truncated: result.stopReason === "length", provider: active.provider, model: request.model ?? active.model };
  }
}

/** The page's provider. */
export const localAi = new LocalAiProvider();
