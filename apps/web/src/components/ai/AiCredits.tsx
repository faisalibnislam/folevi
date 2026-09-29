"use client";

import { useQuery } from "convex/react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";
import { errorMessage } from "@/components/ui/Toast";

// AI credits in the AI panels: a quiet note when credits run low, and the out-of-credits state when a
// request is refused. The server decides (billing.credits, and every AI request); this only shows it.

/** "October 1" (UTC, like the server's messages), with the year when it isn't this year. */
export function creditDate(t: number): string {
  const d = new Date(t);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: d.getUTCFullYear() !== new Date().getUTCFullYear() ? "numeric" : undefined, timeZone: "UTC" });
}

/** "12 AI credits", "1 AI credit". */
export const creditCount = (n: number) => `${n.toLocaleString()} AI ${n === 1 ? "credit" : "credits"}`;

/** Below this many credits, the panels say how many are left (whatever the plan). */
const LOW_CREDITS = 10;

/** What a refused AI request needs the person to know, from the server's ConvexError data. */
export interface AiProblem {
  message: string;
  /** "buy": they can buy more; "upgrade": a bigger plan helps; "none": nothing to offer (a workspace seat). */
  action: "buy" | "upgrade" | "none";
  kind: "out_of_credits" | "not_included" | "other";
}

/** Reads an AI request's error: out of credits (with what helps), AI not included (Core), or anything else. */
export function aiProblem(error: unknown): AiProblem {
  const data = (error as { data?: { code?: string; message?: string; action?: string; reason?: string } })?.data;
  const message = errorMessage(error);
  if (data?.code === "out_of_credits") return { message, kind: "out_of_credits", action: data.action === "buy" || data.action === "upgrade" ? data.action : "none" };
  if (data?.code === "forbidden" && data.reason === "ai_not_included") return { message, kind: "not_included", action: "none" };
  return { message, kind: "other", action: "none" };
}

/** Where to go for more credits or a plan with AI. */
function CreditsLink({ action, className }: { action: "buy" | "upgrade"; className?: string }) {
  return (
    <AppLink href="/settings/billing" className={className ?? "ui-btn ui-btn-secondary h-7 flex-none px-2.5 text-[12px]"}>
      {action === "buy" ? "Buy more" : "Upgrade"}
    </AppLink>
  );
}

/**
 * A refused AI request, in the panel: the server's message, and "Buy more" or "Upgrade" when that helps.
 * Other errors keep the panel's usual look.
 */
export function AiProblemNotice({ problem, className }: { problem: AiProblem; className?: string }) {
  if (problem.kind === "other") {
    return (
      <p role="alert" className={className ?? "rounded-[10px] bg-danger-soft px-3 py-2.5 text-[13px] text-danger"}>
        {problem.message}
      </p>
    );
  }
  return (
    <div role="alert" data-testid="ai-credits-problem" className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] bg-[var(--glass-hover)] px-3 py-2.5 text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--glass-border)] ${className ?? ""}`}>
      <p className="min-w-0 flex-1 basis-56">{problem.message}</p>
      {problem.action !== "none" ? <CreditsLink action={problem.action} /> : null}
    </div>
  );
}

/**
 * The credits that apply where the person is working: the current context, or `documentId`'s own scope
 * (a note from elsewhere). `skip` leaves it unloaded (AI off, or not needed).
 */
export function useAiCredits(opts: { documentId?: string; skip?: boolean } = {}) {
  const { scope } = useAppState();
  return useQuery(api.billing.credits, opts.skip ? "skip" : opts.documentId ? { scope, documentId: opts.documentId } : { scope });
}

/**
 * A quiet line in an AI panel when credits are running low: fewer than 20% of this period's monthly
 * credits left and no bought credits to fall back on, or only a handful left in total. Says how many are
 * left and when they reset, with "Buy more" (Pro, Pro AI) or "Upgrade". Nothing otherwise.
 */
export function AiCreditsNote({ documentId, className }: { documentId?: string; className?: string }) {
  const c = useAiCredits({ documentId });
  if (!c || !c.aiIncluded) return null;
  const low = c.available <= LOW_CREDITS || (c.allowance > 0 && c.monthlyShareLeft < 0.2 && c.packCredits === 0);
  if (!low) return null;
  const left = c.available > 0 ? `${creditCount(c.available)} left${c.account === "seat" ? " in this workspace" : ""}.` : `No AI credits left${c.account === "seat" ? " in this workspace" : ""}.`;
  const when = c.trialing ? `Your trial ends on ${creditDate(c.resetsAt)}.` : `Resets ${creditDate(c.resetsAt)}.`;
  const action = c.canBuy ? "buy" : c.account === "seat" ? null : "upgrade";
  return (
    <div data-testid="ai-credits-note" className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[10px] bg-[var(--glass-hover)] px-3 py-2 text-[12.5px] text-muted ${className ?? ""}`}>
      <p className="min-w-0 flex-1 basis-48">
        {left} {when}
      </p>
      {action ? <CreditsLink action={action} /> : null}
    </div>
  );
}
