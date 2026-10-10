"use client";

import { AppLink } from "@/lib/app/router";
import { creditCount } from "./AiCredits";

// Meet Foli (Foli is the AI assistant's name): what it does in this place, that it never changes a note
// without showing it first, where requests go and what they cost. The welcome of an empty chat, in the
// floating chat and on the AI page.

/** Where the introduction is shown: it changes the first line. */
export type AiIntroPlace = "note" | "folder" | "personal" | "workspace";

export const AI_INTRO: Record<AiIntroPlace, { lead: string }> = {
  note: {
    lead: "In a note, Foli works on that note: it can summarize it, pull out the action items, rewrite what you select and answer questions about it.",
  },
  folder: {
    lead: "Here Foli answers from the notes in this folder, with links to the notes it used.",
  },
  personal: {
    lead: "Ask Foli about your notes, or for a summary or a first draft. Answers link to the notes they come from. Ask it to tidy up or edit notes, and it shows the changes for you to approve first.",
  },
  workspace: {
    lead: "Ask Foli about this workspace's notes. Answers only use notes you can open, and link to them. Ask it to tidy up or edit notes, and it shows the changes for you to approve first.",
  },
};

/** What Foli does in this place, that it shows changes first, where requests go and what they cost. */
export function AiIntroBody({ place, credits, size = "sm" }: { place: AiIntroPlace; credits?: number | null; size?: "sm" | "md" }) {
  const text = size === "md" ? "text-[13.5px]" : "text-[12.5px]";
  return (
    <>
      <p className={`mt-1.5 ${text} leading-snug text-ink`}>{AI_INTRO[place].lead}</p>
      <ul className={`mt-2 list-disc space-y-1 pl-4 ${text} leading-snug text-muted`}>
        <li>Foli never changes a note without showing you the change first.</li>
        <li>What you ask, and the notes it needs, go to Google Gemini. Nothing is sent until you ask.</li>
        <li>
          Each request uses AI credits{typeof credits === "number" ? ` (you have ${creditCount(credits)} left)` : ""}.{" "}
          <AppLink href="/settings/ai" className="text-ink underline underline-offset-2 hover:text-heading">
            AI settings
          </AppLink>
        </li>
      </ul>
    </>
  );
}
