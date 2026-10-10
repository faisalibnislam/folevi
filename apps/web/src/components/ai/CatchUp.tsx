"use client";

import { useAction } from "convex/react";
import { useEffect, useState } from "react";
import { AiIcon } from "@/components/ai/AiIcon";
import { FileText, RotateCcw, X } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";
import { AiMarkdown, StreamingText } from "./AiMarkdown";
import { useAiStream } from "./useAiStream";
import { AiCreditsNote, AiProblemNotice, aiProblem, type AiProblem } from "./AiCredits";

interface Brief {
  answer: string;
  sources: { id: string; title: string }[];
  at: number;
}
// Per context: "personal" or the workspace id (scopeIdKey).
const key = (scopeKey: string) => `folevi:catchup:${scopeKey}`;

/**
 * Home's "Catch me up": a short AI brief of this week's notes and what's due, citing the notes. Generated
 * on request (never automatically), kept for this browser session.
 */
export function CatchUp() {
  const { scope, scopeKey, today } = useAppState();
  const brief = useAction(api.ai.brief);
  const stream = useAiStream();
  const [data, setData] = useState<Brief | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AiProblem | null>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(key(scopeKey));
      setData(saved ? (JSON.parse(saved) as Brief) : null);
    } catch {
      setData(null);
    }
  }, [scopeKey]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const streamId = await stream.begin().catch(() => undefined);
      const r = await brief({ scope, today, streamId });
      await stream.finish(r.answer);
      const next = { ...r, at: Date.now() };
      setData(next);
      try {
        sessionStorage.setItem(key(scopeKey), JSON.stringify(next));
      } catch {
        /* storage unavailable: keep it in memory */
      }
    } catch (e) {
      setError(aiProblem(e));
    } finally {
      stream.end();
      setBusy(false);
    }
  };

  const clear = () => {
    setData(null);
    try {
      sessionStorage.removeItem(key(scopeKey));
    } catch {
      /* ignore */
    }
  };

  if (!data && !busy) {
    return (
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void run()}
          className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[var(--glass-active)] px-4 text-[13.5px] font-semibold text-heading shadow-[var(--glass-edge),0_1px_3px_rgb(0_0_0/0.06)] transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[var(--glass-edge),0_3px_8px_rgb(0_0_0/0.08)]"
        >
          <AiIcon size={15} aria-hidden /> Catch me up
        </button>
        <span className="text-[12.5px] text-muted">A quick AI brief of this week’s notes and what’s due.</span>
        {error ? <AiProblemNotice problem={error} className={error.kind === "other" ? "w-full text-[13px] text-danger" : "w-full max-w-xl"} /> : <AiCreditsNote className="w-full max-w-xl" />}
      </div>
    );
  }

  return (
    <section aria-label="Catch-up brief" className="mt-6 rounded-[18px] bg-[var(--glass-active)] p-5 shadow-[var(--glass-edge),var(--glass-shadow)]">
      <div className="mb-2 flex items-center gap-2">
        <AiIcon size={15} aria-hidden className="text-[#7c6cf0]" />
        <h2 className="ui-display flex-1 text-[18px]">Your week</h2>
        {data && !busy ? (
          <>
            <button type="button" onClick={() => void run()} aria-label="Refresh brief" title="Refresh" className="grid h-8 w-8 place-items-center rounded-[6px] text-muted hover:bg-[var(--glass-hover)] hover:text-heading">
              <RotateCcw size={14} aria-hidden />
            </button>
            <button type="button" onClick={clear} aria-label="Close brief" title="Close" className="grid h-8 w-8 place-items-center rounded-[6px] text-muted hover:bg-[var(--glass-hover)] hover:text-heading">
              <X size={15} aria-hidden />
            </button>
          </>
        ) : null}
      </div>
      {busy && stream.text ? (
        <div aria-busy="true">
          <StreamingText text={stream.text} />
        </div>
      ) : busy ? (
        <div className="space-y-2.5 py-1" aria-live="polite">
          <p className="text-[13px] text-muted">Reading this week’s notes…</p>
          {[90, 75, 82, 60].map((w) => (
            <div key={w} className="h-3 animate-pulse rounded-[6px] bg-[linear-gradient(90deg,color-mix(in_oklab,#8b7cf6_20%,transparent),color-mix(in_oklab,#f58ab8_16%,transparent))] motion-reduce:animate-none" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : data ? (
        <>
          <AiMarkdown markdown={data.answer} />
          {data.sources.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {data.sources.map((s, i) => (
                <AppLink key={s.id} href={`/d/${s.id}`} className="inline-flex max-w-full items-center gap-1.5 rounded-[6px] bg-[var(--glass-hover)] px-2.5 py-1 text-[12.5px] text-ink hover:bg-[var(--glass-active)] hover:text-heading">
                  <span className="font-semibold text-muted">{i + 1}</span>
                  <FileText size={12} aria-hidden className="flex-none text-muted" />
                  <span className="truncate">{s.title}</span>
                </AppLink>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
      {error ? <AiProblemNotice problem={error} className={error.kind === "other" ? "mt-2 text-[13px] text-danger" : "mt-3"} /> : data && !busy ? <AiCreditsNote className="mt-3" /> : null}
    </section>
  );
}
