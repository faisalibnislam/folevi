"use client";

import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";
import { formatRelative } from "@/lib/format";

const STATUS: Record<string, string> = { running: "Running", done: "Ready", failed: "Didn't finish", cancelled: "Cancelled" };

/**
 * Your research jobs here (the AI page's sidebar), latest first: each opens the conversation holding its
 * report. Nothing shows until there's one.
 */
export function ResearchList({ activeId, onNavigate }: { activeId: string | null; onNavigate?: () => void }) {
  const { scope } = useAppState();
  const jobs = useQuery(api.aiResearch.list, { scope });
  if (!jobs?.length) return null;
  return (
    <section aria-label="Research" className="max-h-[40%] flex-none overflow-y-auto border-t border-line/70 px-2.5 pb-3 pt-2.5">
      <p className="ui-caps px-2.5 pb-1">Research</p>
      <ul className="space-y-0.5">
        {jobs.map((j) => (
          <li key={j.id}>
            <AppLink
              href={`/ai/${j.conversationId}`}
              onClick={onNavigate}
              aria-current={j.conversationId === activeId ? "page" : undefined}
              className={`flex flex-col rounded-[6px] px-2.5 py-1.5 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus ${
                j.conversationId === activeId ? "bg-[var(--glass-active)] text-heading shadow-[var(--glass-edge)]" : "text-ink/90 hover:bg-[var(--glass-hover)] hover:text-heading"
              }`}
            >
              <span className="truncate">{j.question || "Research"}</span>
              <span className="flex items-center gap-1.5 text-[11.5px] text-faint">
                {j.status === "running" ? <Loader2 size={11} className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
                {STATUS[j.status] ?? j.status}
                <span aria-hidden>·</span>
                {formatRelative(j.finishedAt ?? j.createdAt)}
              </span>
            </AppLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
