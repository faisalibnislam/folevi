"use client";

import { useId, useState } from "react";
import { useMutation } from "convex/react";
import { X } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";
import { AiIcon } from "./AiIcon";
import { creditCount, useAiCredits } from "./AiCredits";
import { useAiAccess } from "./useAi";

// Foli's first-time introduction (Foli is the AI assistant's name) (docs/AI_ASSISTANT.md milestone 9): a small card inside whichever AI
// surface someone opens first (the floating chat, the AI page, a note's AI panel), never a modal. It says
// what the AI can do there, that it never changes a note without showing it first, where requests go and
// what they cost, with a few starter prompts that fit the place. Dismissing it (or using a starter) is
// remembered on the server (profiles.aiIntroDismissedAt), so it doesn't come back on another surface or
// device. Not shown while AI is off or not on the plan.

/** Where the introduction is shown: it changes the first line and the starter prompts. */
export type AiIntroPlace = "note" | "folder" | "personal" | "workspace";

export const AI_INTRO: Record<AiIntroPlace, { lead: string; starters: string[] }> = {
  note: {
    lead: "In a note, Foli works on that note: it can summarize it, pull out the action items, rewrite what you select and answer questions about it.",
    starters: ["Summarize this note", "List the action items", "What's still unclear here?"],
  },
  folder: {
    lead: "Here Foli answers from the notes in this folder, with links to the notes it used.",
    starters: ["What's in this folder?", "Which decisions were made here?", "What's left to do here?"],
  },
  personal: {
    lead: "Ask Foli about your notes, or for a summary or a first draft. Answers link to the notes they come from. In Agent mode, Foli can tidy up and edit notes for you.",
    starters: ["What did I work on this week?", "Which of my notes have open tasks?", "Summarize my latest notes"],
  },
  workspace: {
    lead: "Ask Foli about this workspace's notes. Answers only use notes you can open, and link to them. In Agent mode, Foli can tidy up and edit notes for you.",
    starters: ["What did we decide this week?", "What's still open in our notes?", "Summarize the latest changes"],
  },
};

/**
 * Whether the introduction shows for this person: AI on and included here, and not dismissed. `dismiss`
 * hides it at once and remembers it on the server.
 */
export function useAiIntro(): { show: boolean; dismiss: () => void } {
  const { profile } = useAppState();
  const ai = useAiAccess();
  const setSeen = useMutation(api.users.setAiIntroSeen);
  const [hidden, setHidden] = useState(false);
  const seen = (profile as { aiIntroSeen?: boolean }).aiIntroSeen === true;
  return {
    show: ai.on && !seen && !hidden,
    dismiss: () => {
      setHidden(true);
      void setSeen({ seen: true }).catch(() => undefined);
    },
  };
}

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

/** The card itself (no data of its own, so it can be shown and tested without a server). */
export function AiIntroCard({
  place,
  credits,
  onStarter,
  onDismiss,
  className = "",
}: {
  place: AiIntroPlace;
  /** Credits left where you are, when known. */
  credits?: number | null;
  onStarter?: (prompt: string) => void;
  onDismiss: () => void;
  className?: string;
}) {
  const uid = useId();
  const copy = AI_INTRO[place];
  return (
    <section aria-labelledby={`${uid}-title`} data-testid="ai-intro" className={`rounded-[12px] bg-[var(--glass-hover)] p-3.5 text-left shadow-[inset_0_0_0_1px_var(--glass-border)] ${className}`}>
      <div className="flex items-start gap-2">
        <AiIcon size={16} aria-hidden className="mt-0.5 flex-none" />
        <h3 id={`${uid}-title`} className="min-w-0 flex-1 text-[13.5px] font-semibold text-heading">
          Meet Foli
        </h3>
        <button type="button" aria-label="Dismiss the introduction" title="Dismiss" onClick={onDismiss} className="-mr-1 -mt-1 grid h-7 w-7 flex-none place-items-center rounded-[6px] text-muted hover:bg-[var(--glass-active)] hover:text-heading">
          <X size={14} aria-hidden />
        </button>
      </div>
      <AiIntroBody place={place} credits={credits} />
      {onStarter ? (
        <>
          <p className="mb-1.5 mt-3 text-[12px] font-medium text-muted">Try one</p>
          <div className="flex flex-wrap gap-1.5">
            {copy.starters.map((s) => (
              <button key={s} type="button" onClick={() => onStarter(s)} className="rounded-full bg-[var(--glass-active)] px-2.5 py-1 text-left text-[12.5px] text-ink shadow-[inset_0_0_0_1px_var(--glass-border)] hover:text-heading">
                {s}
              </button>
            ))}
          </div>
        </>
      ) : null}
      <button type="button" onClick={onDismiss} className="ui-btn ui-btn-secondary mt-3 h-8 px-3 text-[12.5px]">
        Got it
      </button>
    </section>
  );
}

/**
 * The introduction in an AI surface, the first time only. A starter prompt is handed to the surface (it
 * fills the box, or runs the action for a note) and counts as having seen it.
 */
export function AiIntro({ place, onStarter, documentId, className }: { place: AiIntroPlace; onStarter?: (prompt: string) => void; documentId?: string; className?: string }) {
  const { show, dismiss } = useAiIntro();
  const credits = useAiCredits({ documentId, skip: !show });
  if (!show) return null;
  return (
    <AiIntroCard
      place={place}
      credits={credits?.aiIncluded ? credits.available : null}
      onDismiss={dismiss}
      onStarter={
        onStarter
          ? (s) => {
              dismiss();
              onStarter(s);
            }
          : undefined
      }
      className={className}
    />
  );
}
