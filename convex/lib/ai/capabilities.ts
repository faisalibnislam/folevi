// What each AI model can do, and what it costs (docs/AI_ASSISTANT.md, "Provider layer"). The server
// checks a request against the model it would use; the client only offers what the active model can do
// (aiChat.capabilities). Prices are the one place model costs live: credits (lib/credits.ts) read them.

/** Price per token, in nano-dollars (1e-9 USD). */
export interface TokenPrice {
  inputNanoPerToken: number;
  outputNanoPerToken: number;
  /** Input tokens read from the provider's prompt cache (when it prices them apart). */
  cachedInputNanoPerToken?: number;
  /** Input tokens written to the prompt cache (Anthropic charges 1.25x input for its 5-minute cache). */
  cacheWriteNanoPerToken?: number;
  /** A dearer rate for prompts over `aboveTokens` input tokens (the whole call is billed at it). */
  long?: { aboveTokens: number; price: Omit<TokenPrice, "long"> };
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
  /** Which provider serves it. */
  provider: "gemini" | "openai" | "anthropic";
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
  /** Web search inside a call (Google Search grounding, OpenAI's web_search tool, Claude's web search tool). */
  searchGrounding: boolean;
  /** What one web search costs, in nano-dollars, on top of the tokens. */
  searchNanoPerQuery: number;
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
  searchNanoPerQuery: SEARCH_GROUNDING_NANO_PER_QUERY,
  embeddings: false,
  contextWindow: 1_048_576,
};

/**
 * OpenAI, at its list prices checked on 2026-11-25 (developers.openai.com/api/docs/pricing, standard tier,
 * prompts up to 272k tokens; the window is kept there so the dearer long-context rate never applies):
 *
 *   gpt-6-luna:     $0.10 in, $0.01 cached, $0.50 out per 1M tokens
 *   gpt-6.1-terra:  $1.00 in, $0.05 cached, $5.00 out
 *   gpt-6.1-sol, gpt-6.2-sol: $2.00 in, $0.10 cached, $10.00 out (gpt-6-sol: $0.20 cached)
 *   gpt-6.2-astra:  $8.00 in, $0.40 cached, $40.00 out
 *   gpt-6-astra:    $10.00 in, $1.00 cached, $50.00 out
 *
 * Web search: $10 per 1,000 calls (the pages it reads are billed as the model's input tokens). A GPT model
 * not listed is priced as GPT-6 Astra, the dearest.
 */
const usd = (inPerM: number, cachedPerM: number, outPerM: number, writePerM?: number): TokenPrice => ({
  inputNanoPerToken: inPerM * 1_000,
  outputNanoPerToken: outPerM * 1_000,
  cachedInputNanoPerToken: cachedPerM * 1_000,
  ...(writePerM !== undefined ? { cacheWriteNanoPerToken: writePerM * 1_000 } : {}),
});
export const OPENAI_PRICES = {
  luna: usd(0.1, 0.01, 0.5),
  terra: usd(1, 0.05, 5),
  sol: usd(2, 0.1, 10),
  sol6: usd(2, 0.2, 10),
  astra62: usd(8, 0.4, 40),
  astra: usd(10, 1, 50),
} as const;
/** OpenAI's web search tool: $10 per 1,000 calls. */
export const OPENAI_SEARCH_NANO_PER_QUERY = 10_000_000;

/**
 * Anthropic, at its list prices checked on 2026-11-25 (the claude-api reference, cached 2026-11-03). Cache
 * writes (5-minute cache) cost 1.25x input; cache reads as listed, else 0.1x input.
 *
 *   claude-haiku-5-5:  $0.10 in, $0.50 out per 1M tokens (prompts up to 100k; $0.50 / $2.50 beyond)
 *   claude-sonnet-5-5: $2 in, $0.10 cache read, $10 out
 *   claude-opus-5-5:   $4 in, $0.20 cache read, $20 out
 *   older ones as their own list prices; an unknown Claude model is priced as Fable 5.1 ($10 / $50), the dearest.
 *
 * Web search: $10 per 1,000 searches.
 */
const claude = (inPerM: number, outPerM: number, readPerM = inPerM / 10): TokenPrice => usd(inPerM, readPerM, outPerM, inPerM * 1.25);
export const ANTHROPIC_PRICES = {
  haiku55: { ...claude(0.1, 0.5), long: { aboveTokens: 100_000, price: claude(0.5, 2.5) } },
  sonnet55: claude(2, 10, 0.1),
  sonnet5: claude(2, 10),
  sonnet46: claude(3, 15),
  opus55: claude(4, 20, 0.2),
  opus: claude(5, 25),
  fable52: claude(8, 40, 0.2),
  fable: claude(10, 50),
  haiku45: claude(1, 5),
} as const;
export const ANTHROPIC_SEARCH_NANO_PER_QUERY = 10_000_000;

const OPENAI_MODEL: Omit<ModelCapabilities, "prices"> = {
  provider: "openai",
  text: true,
  vision: true,
  audioIn: false,
  tools: true,
  json: true,
  longContext: true,
  searchGrounding: true,
  searchNanoPerQuery: OPENAI_SEARCH_NANO_PER_QUERY,
  embeddings: false,
  contextWindow: 272_000,
};

const ANTHROPIC_MODEL: Omit<ModelCapabilities, "prices"> = {
  ...OPENAI_MODEL,
  provider: "anthropic",
  searchNanoPerQuery: ANTHROPIC_SEARCH_NANO_PER_QUERY,
  contextWindow: 1_000_000,
};

/** The registry, matched in order on the model's name; the last entry is the default (priced as Flash). */
const REGISTRY: { match: RegExp; caps: ModelCapabilities }[] = [
  // OpenAI
  { match: /^gpt-6-luna/i, caps: { ...OPENAI_MODEL, prices: OPENAI_PRICES.luna } },
  { match: /^gpt-6(\.\d+)?-terra/i, caps: { ...OPENAI_MODEL, prices: OPENAI_PRICES.terra } },
  { match: /^gpt-6-sol/i, caps: { ...OPENAI_MODEL, prices: OPENAI_PRICES.sol6 } },
  { match: /^gpt-6\.\d+-sol/i, caps: { ...OPENAI_MODEL, prices: OPENAI_PRICES.sol } },
  { match: /^gpt-6\.\d+-astra/i, caps: { ...OPENAI_MODEL, prices: OPENAI_PRICES.astra62 } },
  { match: /^(gpt|o\d|chatgpt)/i, caps: { ...OPENAI_MODEL, prices: OPENAI_PRICES.astra } },
  // Anthropic
  { match: /^claude-haiku-5-5/i, caps: { ...ANTHROPIC_MODEL, prices: ANTHROPIC_PRICES.haiku55 } },
  { match: /^claude-haiku-4-5/i, caps: { ...ANTHROPIC_MODEL, contextWindow: 200_000, prices: ANTHROPIC_PRICES.haiku45 } },
  { match: /^claude-sonnet-5-5/i, caps: { ...ANTHROPIC_MODEL, prices: ANTHROPIC_PRICES.sonnet55 } },
  { match: /^claude-sonnet-5/i, caps: { ...ANTHROPIC_MODEL, prices: ANTHROPIC_PRICES.sonnet5 } },
  { match: /^claude-sonnet-4-6/i, caps: { ...ANTHROPIC_MODEL, prices: ANTHROPIC_PRICES.sonnet46 } },
  { match: /^claude-opus-5-5/i, caps: { ...ANTHROPIC_MODEL, prices: ANTHROPIC_PRICES.opus55 } },
  { match: /^claude-opus-(5|4-[678])/i, caps: { ...ANTHROPIC_MODEL, prices: ANTHROPIC_PRICES.opus } },
  { match: /^claude-fable-5-2/i, caps: { ...ANTHROPIC_MODEL, prices: ANTHROPIC_PRICES.fable52 } },
  { match: /^claude/i, caps: { ...ANTHROPIC_MODEL, prices: ANTHROPIC_PRICES.fable } },
  // Gemini
  {
    match: /embedding/i,
    caps: { ...CHAT_MODEL, text: false, vision: false, audioIn: false, tools: false, json: false, longContext: false, searchGrounding: false, embeddings: true, contextWindow: 2_048, prices: EMBEDDING_PRICE },
  },
  // Flash-Lite: the same inputs as Flash, no search grounding on the cheap path.
  { match: /lite/i, caps: { ...CHAT_MODEL, searchGrounding: false, prices: GEMINI_PRICES.flashLite } },
  { match: /./, caps: { ...CHAT_MODEL, prices: GEMINI_PRICES.flash } },
];

/** Which provider serves `model` (by its name). */
export const providerOfModel = (model: string): ModelCapabilities["provider"] => capabilitiesOf(model).provider;

/** What `model` can do and what it costs. Unknown models get Flash's capabilities and prices. */
export function capabilitiesOf(model: string): ModelCapabilities {
  return (REGISTRY.find((r) => r.match.test(model)) ?? REGISTRY[REGISTRY.length - 1]!).caps;
}

/** The price of `model`'s tokens. */
export const priceOf = (model: string): TokenPrice => capabilitiesOf(model).prices;