// The writing assistant (docs/AI_ASSISTANT.md milestone 4): what each writing task asks of the model, how
// the request is put together, and how its answer is tidied and checked before it reaches the person. The
// action is `ai.write` (convex/ai.ts); saving a generated page or template is `aiWriting.saveDraft`.
//
// The prompts and checks are pure and shared with the local backend: packages/ai-prompts writing.ts. Here
// requests are the provider layer's, and a reply that can't be used is the server's own error.
import { finishWriting as finishWritingPure, writingRequest as writingRequestPure, type WritingInput, type WritingTask } from "@folevi/ai-prompts/writing";
import type { GenerateRequest } from "./provider";
import { orFail } from "./studyTools";

export * from "@folevi/ai-prompts/writing";

/** The request for a writing task: system prompt, the note and text as data, the person's request, the job. */
export function writingRequest(input: WritingInput, fast: boolean): GenerateRequest {
  return writingRequestPure(input, fast);
}

/**
 * What the person gets back: tidied per task (a title is one line; a page has its title split off). A mind
 * map comes back as the block's own data (`mindmap`, through the strict check), with `text` its ```mindmap
 * fence for wherever Markdown goes (a new note, a copy).
 */
export function finishWriting(task: WritingTask, raw: string): { text: string; title?: string; mindmap?: string } {
  return orFail(() => finishWritingPure(task, raw));
}
