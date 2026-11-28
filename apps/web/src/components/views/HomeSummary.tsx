"use client";

// Home's Foli AI summary (the owner, 28 November 2026, Home design version 16): the opening's lede under the greeting,
// a sentence or two on the week and three points, each linking to the note (or the open tasks) it comes from, from
// the notes edited since Monday (convex/ai.ts homeSummary). Home shows it only while Foli AI is on. It is written once a day per place and
// kept for this tab's visit under the Catch me up brief's prefix (lib/ai/catchUpStore.ts), so it goes when the
// account signs out; Refresh writes it again.
import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";
import { catchUpKey } from "@/lib/ai/catchUpStore";
import { useAiAction } from "@/components/ai/useAiAction";
import { AiProblemNotice, aiProblem, type AiProblem } from "@/components/ai/AiCredits";
import { FOLDER_COLORS } from "@/lib/folderColors";
import { AiIcon } from "@/components/ai/AiIcon";

type Point = { text: string; note?: { id: string; title: string }; tasks?: boolean };
type Kept = { summary: string; points: Point[]; edited: number; at: number; day: string };

/** Local midnight at the start of this week (Monday). */
export function weekStart(now = new Date()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** The dots before the three points, in folder colours (sage, clay, indigo, near the design's). */
const DOTS = ["sage", "clay", "indigo"].map((id, i) => FOLDER_COLORS.find((c) => c.id === id)?.hex ?? FOLDER_COLORS[i % FOLDER_COLORS.length]!.hex);

const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function keptFor(key: string, today: string): Kept | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    const kept = raw ? (JSON.parse(raw) as Kept) : null;
    return kept && kept.day === today ? kept : null;
  } catch {
    return null;
  }
}

/** The Foli AI summary block: its heading (Refresh, Ask a follow-up) and the summary. */
export function HomeSummary() {
  const { scope, scopeKey, today, profile } = useAppState();
  const key = `${catchUpKey(profile.id, scopeKey)}:home`;
  const summarize = useAiAction(api.ai.homeSummary);
  const [data, setData] = useState<Kept | null>(() => keptFor(key, today));
  const [shownFor, setShownFor] = useState(key);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AiProblem | null>(null);
  const asked = useRef<string | null>(null);
  if (shownFor !== key) {
    setShownFor(key);
    setData(keptFor(key, today));
  }

  const run = useCallback(async () => {
    asked.current = key;
    setBusy(true);
    setError(null);
    try {
      const r = await summarize({ scope, today, since: weekStart() });
      const next: Kept = { ...r, at: Date.now(), day: today };
      setData(next);
      try {
        sessionStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage unavailable: keep it in memory */
      }
    } catch (e) {
      setError(aiProblem(e));
    } finally {
      setBusy(false);
    }
  }, [key, scope, today, summarize]);

  // Written once a day per place, the first time Home is opened with Foli AI on.
  useEffect(() => {
    if (!data && asked.current !== key) void run();
  }, [data, key, run]);

  return (
    <section aria-labelledby="home-summary-title">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-footnote text-muted">
        <AiIcon size={14} aria-hidden />
        <h2 id="home-summary-title" className="text-footnote font-semibold text-ink">
          Foli AI summary
        </h2>
        {data && !busy ? (
          <>
            <span>
              · {data.edited ? `from ${data.edited === 1 ? "1 note" : `${data.edited} notes`} edited since Monday · ` : ""}updated {clock(data.at)}
            </span>
            <button type="button" onClick={() => void run()} aria-label="Refresh the summary" title="Refresh" className="ui-btn ui-btn-quiet size-control-sm p-0">
              <RotateCcw size={12} aria-hidden />
            </button>
          </>
        ) : null}
      </div>
      <SummaryBody data={data} busy={busy} error={error} />
      <AppLink href="/ai" className="mt-3 inline-block text-subheadline font-medium text-muted hover:text-heading">
        Ask a follow-up →
      </AppLink>
    </section>
  );
}

function SummaryBody({ data, busy, error }: { data: Kept | null; busy: boolean; error: AiProblem | null }) {
  if (error && !data) return <AiProblemNotice problem={error} className={error.kind === "other" ? "mt-2.5 text-subheadline text-muted" : "mt-2.5"} />;
  if (!data || busy) {
    return (
      <div className="mt-3 space-y-2.5" aria-live="polite" aria-busy="true">
        <p className="text-subheadline text-muted">Reading this week’s notes…</p>
        {[92, 78, 84, 60].map((w) => (
          <div key={w} className="h-3 animate-pulse rounded-chip bg-[var(--glass-hover)] motion-reduce:animate-none" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }
  return (
    <div className="mt-2.5 flex flex-col gap-3">
      <p className="text-pretty font-serif text-title-3 font-normal leading-normal text-ink">{data.summary}</p>
      {data.points.length ? (
        <ul className="flex flex-col gap-2">
          {data.points.map((p, i) => (
            <li key={i} className="flex items-baseline gap-2.5 text-subheadline text-ink">
              <span aria-hidden className="size-1.5 flex-none -translate-y-px rounded-tiny" style={{ background: DOTS[i % DOTS.length] }} />
              <span>
                {p.text}{" "}
                {p.note ? (
                  <AppLink href={`/d/${p.note.id}`} className="text-muted underline decoration-[var(--color-line)] underline-offset-[3px] hover:text-heading">
                    {p.note.title}
                  </AppLink>
                ) : p.tasks ? (
                  <AppLink href="/tasks" className="text-muted underline decoration-[var(--color-line)] underline-offset-[3px] hover:text-heading">
                    My tasks
                  </AppLink>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <AiProblemNotice problem={error} className={error.kind === "other" ? "text-subheadline text-muted" : ""} /> : null}
    </div>
  );
}
