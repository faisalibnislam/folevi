// What each AI model can do, and what it costs (docs/AI_ASSISTANT.md, "Provider layer"). The server
// checks a request against the model it would use; the client only offers what the active model can do
// (aiChat.capabilities). Prices are the one place model costs live: credits (lib/credits.ts) read them.

/** Price per token, in nano-dollars (1e-9 USD). */
export interface TokenPrice {
  inputNanoPerToken: number;
  outputNanoPerToken: number;
}

/**
 * What Google charges per token, in nano-dollars (1e-9 USD), at the January 2027 list prices (paid tier,
 * prompts up to 200k tokens). Thinking tokens are billed as output. Update these, with the date, when
 * Google's prices change; credits follow automatically.
 *
 *   gemini-3.8-flash:          $1.50 per 1M input tokens, $7.50 per 1M output tokens
 *   gemini-flash-lite-latest:  $0.30 per 1M input tokens, $2.50 per 1M output tokens
 *
 * A model not listed here is priced as Flash (the dearer of the two).
 */
export const GEMINI_PRICES = {
  flash: { inputNanoPerToken: 1_500, outputNanoPerToken: 7_500 },
  flashLite: { inputNanoPerToken: 300, outputNanoPerToken: 2_500 },
} as const;

/**
 * Grounding with Google Search, per search query, in nano-dollars, on top of the call's tokens. Gemini 3 and
 * newer bill each query the model runs (one grounded prompt can run several, listed in the reply's
 * groundingMetadata.webSearchQueries): $14 per 1,000 queries, after 5,000 free a month that credits don't
 * count on. Checked on 2026-10-10 at ai.google.dev/gemini-api/docs/pricing; check it again when Google's
 * prices change (Gemini 2.5 billed $35 per 1,000 grounded prompts instead).
 */
export const SEARCH_GROUNDING_NANO_PER_QUERY = 14_000_000;

/** Embeddings (gemini-embedding-001): $0.15 per 1M input tokens. Platform-paid, never charged to credits. */
export const EMBEDDING_PRICE: TokenPrice = { inputNanoPerToken: 150, outputNanoPerToken: 0 };

export interface ModelCapabilities {
  /** Which provider serves it (only "gemini" for now). */
  provider: "gemini";
  /** Writes text (every chat model). */
  text: boolean;
  /** Reads images and PDFs. */
  vision: boolean;
  /** Reads audio (transcription). */
  audioIn: boolean;
  /** Function calling (the agent's tools). */
  tools: boolean;
  /** Structured (JSON) output. */
  json: boolean;
  /** Long documents in one prompt. */
  longContext: boolean;
  /** Google Search grounding (web research). */
  searchGrounding: boolean;
  /** Turns text into vectors (semantic search). */
  embeddings: boolean;
  /** Tokens a prompt may hold. */
  contextWindow: number;
  prices: TokenPrice;
}

const CHAT_MODEL: Omit<ModelCapabilities, "prices"> = {
  provider: "gemini",
  text: true,
  vision: true,
  audioIn: true,
  tools: true,
  json: true,
  longContext: true,
  searchGrounding: true,
  embeddings: false,
  contextWindow: 1_048_576,
};

/** The registry, matched in order on the model's name; the last entry is the default (priced as Flash). */
const REGISTRY: { match: RegExp; caps: ModelCapabilities }[] = [
  {
    match: /embedding/i,
    caps: { ...CHAT_MODEL, text: false, vision: false, audioIn: false, tools: false, json: false, longContext: false, searchGrounding: false, embeddings: true, contextWindow: 2_048, prices: EMBEDDING_PRICE },
  },
  // Flash-Lite: the same inputs as Flash, no search grounding on the cheap path.
  { match: /lite/i, caps: { ...CHAT_MODEL, searchGrounding: false, prices: GEMINI_PRICES.flashLite } },
  { match: /./, caps: { ...CHAT_MODEL, prices: GEMINI_PRICES.flash } },
];

/** What `model` can do and what it costs. Unknown models get Flash's capabilities and prices. */
export function capabilitiesOf(model: string): ModelCapabilities {
  return (REGISTRY.find((r) => r.match.test(model)) ?? REGISTRY[REGISTRY.length - 1]!).caps;
}

/** The price of `model`'s tokens (chat models: Flash-Lite or Flash). */
export const priceOf = (model: string): TokenPrice => capabilitiesOf(model).prices;