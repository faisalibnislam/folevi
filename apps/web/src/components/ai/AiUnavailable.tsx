"use client";

import { AppLink } from "@/lib/app/router";
import { AiIcon } from "./AiIcon";
import type { AiAccess } from "./useAi";

// What an AI surface shows when AI can't be used where you are (docs/AI_ASSISTANT.md milestone 9): turned
// off (how to turn it on), or not part of the plan here (what the plan with AI includes, and Upgrade). The
// server refuses AI requests in both cases anyway; this only explains.

/** What the plans with AI include, in a line. */
export const AI_INCLUDES = "Answers from your notes with links, writing help, an agent that tidies up and edits notes (always showing changes first), study tools and research.";

export function aiUnavailableCopy(ai: Pick<AiAccess, "setting" | "context">): { title: string; body: string; link: { href: string; label: string } | null } {
  if (!ai.setting) {
    return { title: "Foli is turned off", body: "You turned Foli off, so nothing is sent to AI. Turn it on again in Settings > AI.", link: { href: "/settings/ai", label: "Open AI settings" } };
  }
  if (ai.context === "workspace") {
    return { title: "Foli isn't part of this workspace's plan", body: `Plans with Foli include ${AI_INCLUDES.charAt(0).toLowerCase()}${AI_INCLUDES.slice(1, -1)}. A workspace owner or admin can change the plan.`, link: { href: "/settings/billing", label: "See plans" } };
  }
  if (ai.context === "shared") {
    return { title: "Foli isn't available on this note", body: "It's shared from a place whose plan doesn't include Foli, and your own plan doesn't cover it either.", link: { href: "/settings/billing", label: "See plans" } };
  }
  return { title: "Foli isn't part of your plan", body: `Core doesn't include Foli. Pro and Pro AI do: ${AI_INCLUDES.charAt(0).toLowerCase()}${AI_INCLUDES.slice(1)}`, link: { href: "/settings/billing", label: "Upgrade" } };
}

/** The plan-gated or turned-off state of an AI surface. `compact` for a sidebar panel. */
export function AiUnavailable({ ai, compact = false, headingLevel = 2 }: { ai: Pick<AiAccess, "setting" | "context">; compact?: boolean; headingLevel?: 1 | 2 | 3 }) {
  const copy = aiUnavailableCopy(ai);
  const Heading = `h${headingLevel}` as "h1" | "h2" | "h3";
  if (compact) {
    return (
      <section data-testid="ai-unavailable" aria-label={copy.title} className="space-y-2 rounded-[12px] bg-[var(--glass-hover)] p-3.5 text-sm">
        <Heading className="flex items-center gap-2 text-[13.5px] font-semibold text-heading">
          <AiIcon size={14} aria-hidden /> {copy.title}
        </Heading>
        <p className="text-[12.5px] leading-snug text-muted">{copy.body}</p>
        {copy.link ? (
          <AppLink href={copy.link.href} className="ui-btn ui-btn-secondary inline-flex h-8 items-center px-3 text-[12.5px]">
            {copy.link.label}
          </AppLink>
        ) : null}
      </section>
    );
  }
  return (
    <div data-testid="ai-unavailable" className="mx-auto max-w-md px-6 py-24 text-center">
      <AiIcon size={28} aria-hidden className="mx-auto" />
      <Heading className="ui-display mt-4 text-[26px]">{copy.title}</Heading>
      <p className="mt-2 text-[14px] text-muted">{copy.body}</p>
      {copy.link ? (
        <AppLink href={copy.link.href} className="ui-btn ui-btn-secondary mt-6 inline-flex h-9 items-center px-4 text-sm">
          {copy.link.label}
        </AppLink>
      ) : null}
    </div>
  );
}
