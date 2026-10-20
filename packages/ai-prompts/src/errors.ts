/** What can go wrong reading a reply, with the code the server reports it under (convex/lib/errors.ts). */
export type PromptErrorCode = "invalid_argument";

/**
 * A reply that can't be used, with the message the person sees. The server turns it into its own error
 * (convex/lib/ai/studyTools.ts `orFail`); the local backend shows the message as is.
 */
export class PromptError extends Error {
  readonly code: PromptErrorCode;
  constructor(code: PromptErrorCode, message: string) {
    super(message);
    this.name = "PromptError";
    this.code = code;
  }
}
