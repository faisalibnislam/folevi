// Milestone 8's writing tasks (docs/AI_ASSISTANT.md): meeting summaries, flashcards and quizzes, and the
// decision and brainstorming frameworks. Checking and tidying what comes back is pure and shared with the
// local backend: packages/ai-prompts studyTools.ts. Here a reply that can't be used is the server's own error.
import { PromptError } from "@folevi/ai-prompts";
import { finishTool as finishToolPure } from "@folevi/ai-prompts/studyTools";
import { fail } from "../errors";

export * from "@folevi/ai-prompts/studyTools";

/** Runs a reply check, reporting a reply that can't be used as the server's error (same code and message). */
export function orFail<T>(run: () => T): T {
  try {
    return run();
  } catch (e) {
    if (e instanceof PromptError) fail(e.code, e.message);
    throw e;
  }
}

/** What each milestone 8 task gives back, checked and tidied. `text` is the reply (fences already removed). */
export function finishTool(task: string, raw: string, text: string): string {
  return orFail(() => finishToolPure(task, raw, text));
}
