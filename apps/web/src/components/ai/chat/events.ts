// What other parts of the app tell Foli AI's chat, apart from the chat's own code (which loads when the chat is
// first opened, so the app shell must not import it for a name).

/** Puts the keyboard in the open chat's composer (⌘J on the Foli AI page). */
export const AI_FOCUS_EVENT = "folevi:ai-focus";

/** A question for the open note's Foli AI panel (the native apps' `ai { action: "ask", prompt }`). */
export const AI_ASK_EVENT = "folevi:ai-ask";

let pendingAsk: string | null = null;

/** Asks the note's Foli AI panel `prompt`: the panel takes it when it opens, or at once if it's open. */
export function askNoteAi(prompt: string): void {
  pendingAsk = prompt;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AI_ASK_EVENT));
}

/** The question waiting for the panel, once (null when there's none). */
export function takeNoteAiAsk(): string | null {
  const p = pendingAsk;
  pendingAsk = null;
  return p;
}
