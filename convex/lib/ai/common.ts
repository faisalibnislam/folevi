// What every provider adapter (lib/ai/gemini.ts, openai.ts, anthropic.ts) shares: the safety rules at the end
// of every system prompt, reading a refusal, usage estimates when a provider sent none, deadlines, and the
// person-readable errors. Pure apart from timers.
//
// Privacy: prompts, note text and answers are never logged by any adapter. Only the event, model, status
// and token counts are.
import { fail } from "../errors";
import { tokensForChars, type CallUsage } from "../credits";
import type { GenerateRequest, Part } from "./provider";
import { attachmentTokens } from "./attachments";
import { DECLINE_RULE, MAX_FREE_REFUSAL_CHARS, readDecline, SAFETY_RULE, type RefusalKind } from "@folevi/ai-prompts/safety";

/**
 * Every system prompt ends with the safety rules (docs/AI_GUARDRAILS.md), whichever feature built it; a
 * text reply is also asked to mark a refusal (a JSON reply can't carry the marker; the provider's own
 * filter still applies).
 */
export const systemWithSafety = (req: Pick<GenerateRequest, "system" | "json">) => `${req.system}\n\n${SAFETY_RULE}${req.json ? "" : ` ${DECLINE_RULE}`}`;

/**
 * What a reply declined, if it did: the marker the model wrote, or the provider's own filter (`filtered`).
 * A short refusal is free; a long reply that carries a marker is still charged (lib/credits.ts settleHold).
 */
export function refusalOf(raw: string, filtered: boolean): { text: string; refused?: { kind: RefusalKind; free: boolean } } {
  const { text, declined } = readDecline(raw);
  const kind: RefusalKind | null = declined ?? (filtered ? "filtered" : null);
  return kind ? { text, refused: { kind, free: text.trim().length <= MAX_FREE_REFUSAL_CHARS } } : { text };
}

/** The model's turn with any refusal marker taken out of its text (it goes back to the model in a tool loop). */
export const withoutMarker = (parts: Part[]): Part[] => parts.map((p) => ("text" in p && !("functionCall" in p) ? { ...p, text: readDecline(p.text).text } : p));

export const emptyMessage = (filtered: boolean) => (filtered ? "The AI couldn't help with that request." : "The AI returned nothing. Try rephrasing.");

/** A file sent inline, as characters' worth of its tokens (lib/ai/attachments.ts estimates them). */
function inlineChars(d: { mimeType: string; data: string }): number {
  const kind = d.mimeType.startsWith("image/") ? "image" : d.mimeType.startsWith("audio/") ? "audio" : "pdf";
  return attachmentTokens(kind, Math.floor((d.data.length * 3) / 4)) * 4;
}

/** Characters sent in a request (for a usage estimate when none came back). */
export function charsSent(req: GenerateRequest): number {
  let n = req.system.length + req.prompt.length;
  for (const p of [...(req.contents ?? []).flatMap((c) => c.parts), ...(req.attachments ?? [])]) {
    if ("text" in p) n += p.text.length;
    else if ("functionCall" in p) n += JSON.stringify(p.functionCall.args).length;
    else if ("functionResponse" in p) n += JSON.stringify(p.functionResponse.response).length;
    else if ("inlineData" in p) n += inlineChars(p.inlineData);
    // A file the Gemini Files API holds (fileData) has no size here: Gemini's usage counts it.
  }
  return n;
}

/** A call's usage estimated from the characters sent and received (a stream stopped before its usage arrived). */
export const estimatedUsage = (model: string, req: GenerateRequest, text: string): CallUsage => ({ model, promptTokens: tokensForChars(charsSent(req)), outputTokens: tokensForChars(text.length), thoughtsTokens: 0 });

/** No answer to a request at all within this long (a streamed reply's first bytes): the call is given up. */
export const RESPONSE_TIMEOUT_MS = 60_000;
/** A whole reply that isn't streamed (a flowchart's JSON can take a while to think through). */
export const REPLY_TIMEOUT_MS = 120_000;
/** A stream that goes quiet this long between pieces has stalled. */
export const STREAM_IDLE_MS = 30_000;
/** However well a stream is flowing, it ends by then (well inside an action's time limit). */
export const STREAM_TOTAL_MS = 5 * 60_000;
export const TOO_SLOW = "The AI took too long to answer. Try again shortly.";
export const NOT_SET_UP = "Foli AI isn't set up on this server yet.";
export const UNREACHABLE = "Foli AI couldn't be reached. Try again shortly.";
export const BUSY = "The AI is busy right now. Try again in a minute.";
export const KEY_REFUSED = "Foli AI isn't available right now (the server's AI key was refused).";

/**
 * One controller for Stop and for the deadlines (no answer, a stalled stream, a stream running too long),
 * so a hung connection can't hold the action, and the person's credit hold, until the platform kills it.
 * `timedOut` tells a deadline from Stop.
 */
export class Deadline {
  readonly controller = new AbortController();
  timedOut = false;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private readonly total: ReturnType<typeof setTimeout>;
  constructor(readonly stream: boolean) {
    this.total = setTimeout(() => this.expire(), stream ? STREAM_TOTAL_MS : REPLY_TIMEOUT_MS);
    this.waitAtMost(stream ? RESPONSE_TIMEOUT_MS : REPLY_TIMEOUT_MS);
  }
  get signal() {
    return this.controller.signal;
  }
  private expire() {
    this.timedOut = true;
    this.controller.abort();
  }
  /** The next piece must come within `ms`. */
  waitAtMost(ms: number) {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.expire(), ms);
  }
  /** Stop pressed: aborts without counting as a timeout. */
  stop() {
    this.controller.abort();
  }
  clear() {
    clearTimeout(this.idle);
    clearTimeout(this.total);
  }
}

/** The person-readable error for a provider's HTTP status (after it was logged with the status only). */
export function failForStatus(status: number | undefined): never {
  if (status === 429 || status === 529) fail("rate_limited", BUSY);
  if (status === 401 || status === 403) fail("maintenance", KEY_REFUSED);
  fail("maintenance", UNREACHABLE);
}

/** A JSON reply without the code fence some models wrap it in. */
export function unfenced(text: string): string {
  const m = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/i.exec(text);
  return m ? m[1]!.trim() : text;
}

/** A tool's JSON schema as OpenAI and Anthropic take it (always an object schema). */
export function objectSchema(parameters: Record<string, unknown> | undefined): Record<string, unknown> {
  return parameters && parameters.type === "object" ? parameters : { type: "object", properties: {} };
}

/** Bytes of a base64 string, roughly (for the inline size check). */
export const base64Bytes = (data: string) => Math.floor((data.length * 3) / 4);
