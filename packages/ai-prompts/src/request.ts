/**
 * A request to a model, as the prompt builders write it: the system prompt, the question, and how to answer.
 * The server's provider layer (convex/lib/ai/provider.ts `GenerateRequest`) and the local one take it as is.
 */
export interface PromptRequest {
  system: string;
  /** A single question (one user turn). */
  prompt: string;
  /** The fast, cheap model (titles, search terms, short rewrites). */
  fast?: boolean;
  /** Structured output: the reply is JSON. */
  json?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
  /** Leave out the person's saved preferences (memory.ts): calls that copy content out (translating) aren't shaped by them. */
  noMemory?: boolean;
}
