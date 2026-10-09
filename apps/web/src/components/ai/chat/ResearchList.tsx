"use client";

import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";
import { formatRelative } from "@/lib/format";
import { useAiAccess } from "../useAi";

const STATUS: Record<string, string> = { running: "Running", done: "Ready", failed: "Didn't finish", cancelled: "Cancelled" };

/**
 * Your research jobs here (the AI page's sidebar), latest first: each opens the conversation holding its
 * report. With none yet, a line on how to start one (only where Research is available: the web is on in
 * Settings > AI and the model can search).
 */
export function ResearchList({ activeId, onNavigate }: { activeId: string | null; onNavigate?: () => void }) {
  const { scope } = useAppState();
  const jobs = useQuery(api.aiResearch.list, { scope });
  const caps = useQuery(api.aiChat.capabilities, {});
  const ai = useAiAccess();
  if (!jobs) return null;
  if (!jobs.length) {
    if (!ai.on || !caps?.prefs.webResearch || !caps.searchGrounding) return null;
    return (
      <section aria-label="Research" className="flex-none border-t border-line/70 px-2.5 pb-3 pt-2.5">
        <p className="ui-caps px-2.5 pb-1">Research</p>
        <p className="px-2.5 text-[12.5px] leading-snug text-muted">Reports you start show up here. Pick Research under the box, then ask a question. It takes a few minutes.</p>
      </section>
    );
  }
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
