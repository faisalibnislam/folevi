"use client";

import { useAction } from "convex/react";
import { lazy, Suspense, useEffect, useState } from "react";
import { AiIcon } from "@/components/ai/AiIcon";
import { FileText, RotateCcw, X } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";
import { catchUpKey } from "@/lib/ai/catchUpStore";
import { useAiStream } from "./useAiStream";
import { AiCreditsNote, AiProblemNotice, aiProblem, type AiProblem } from "./AiCredits";

// The brief's drawing (Markdown as read-only blocks) is most of this card's code: it loads when a brief is asked
// for or one was kept this session, so the card itself can be on Home from its first frame.
const loadMarkdown = () => import("./AiMarkdown");
const AiMarkdown = lazy(() => loadMarkdown().then((m) => ({ default: m.AiMarkdown })));
const StreamingText = lazy(() => loadMarkdown().then((m) => ({ default: m.StreamingText })));

interface Brief {
  answer: string;
  sources: { id: string; title: string }[];
  at: number;
}

/**
 * Home's "Catch me up": a short AI brief of this week's notes and what's due, citing the notes. Generated
 * on request (never automatically), kept for this browser session.
 */
export function CatchUp({ row = false }: { /** A list row (the iPhone app's Home) until there's a brief to show. */ row?: boolean } = {}) {
  const { scope, scopeKey, today, profile } = useAppState();
  // The account's own key for this place: a brief is never read back under another account (lib/ai/catchUpStore.ts).
  const key = catchUpKey(profile.id, scopeKey);
  const brief = useAction(api.ai.brief);
  const stream = useAiStream();
  // The brief kept for this visit is read before the first frame, so Home doesn't draw the short row and then swap
  // it for the brief, pushing everything under it down (the iPhone remounts Home on every visit).
  const [data, setData] = useState<Brief | null>(() => savedBrief(key));
  const [shownFor, setShownFor] = useState(key);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AiProblem | null>(null);
  if (shownFor !== key) {
    setShownFor(key);
    setData(savedBrief(key));
  }
  useEffect(() => {
    if (data) void loadMarkdown();
  }, [data]);

  const run = async () => {
    void loadMarkdown();
    setBusy(true);
    setError(null);
    try {
      const streamId = await stream.begin().catch(() => undefined);
      const r = await brief({ scope, today, streamId });
      await stream.finish(r.answer);
      const next = { ...r, at: Date.now() };
      setData(next);
      try {
        sessionStorage.setItem(key, JSON.stringify(next));
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
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  };

  if (!data && !busy && row) {
    return (
      <div className="mx-4">
        {/* Its own card on Home in the tiles' light fill (no edge or shadow), the Foli AI flower and what it does in a line under its name. */}
        <button
          type="button"
          onClick={() => void run()}
          aria-label="Catch me up"
          aria-description="A quick Foli AI brief of this week’s notes and what’s due"
          className="ui-key-focus flex min-h-[68px] w-full items-center gap-3 rounded-container bg-[var(--iphone-card)] px-4 py-3 text-left outline-none transition-[background-color,transform] duration-150 hover:bg-[var(--glass-hover)] active:scale-[0.96] active:bg-[var(--liquid-press)] active:duration-0 motion-reduce:active:scale-100"
        >
          <span aria-hidden className="grid h-9 w-9 flex-none place-items-center">
            <AiIcon size={28} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-body font-semibold leading-[22px] text-heading">Catch me up</span>
            <span className="text-subheadline leading-5 text-muted">A quick brief of this week’s notes</span>
          </span>
        </button>
        {error ? <AiProblemNotice problem={error} className={error.kind === "other" ? "mx-1 mt-2 text-subheadline text-danger" : "mx-1 mt-2"} /> : null}
      </div>
    );
  }

  if (!data && !busy) {
    return (
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void run()}
          className="inline-flex h-10 items-center gap-2 rounded-control bg-[var(--glass-active)] px-4 text-body font-semibold text-heading shadow-[var(--glass-edge),0_1px_3px_rgb(0_0_0/0.06)] transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[var(--glass-edge),0_3px_8px_rgb(0_0_0/0.08)]"
        >
          <AiIcon size={15} aria-hidden /> Catch me up
        </button>
        <span className="text-subheadline text-muted">A quick AI brief of this week’s notes and what’s due.</span>
        {error ? <AiProblemNotice problem={error} className={error.kind === "other" ? "w-full text-subheadline text-danger" : "w-full"} /> : <AiCreditsNote className="w-full" />}
      </div>
    );
  }

  return (
    <section aria-label="Catch-up brief" className={`${row ? "mx-4" : "mt-6"} rounded-container bg-[var(--glass-active)] p-5 shadow-[var(--glass-edge),var(--glass-shadow)]`}>
      <div className="mb-2 flex items-center gap-2">
        <AiIcon size={15} aria-hidden className="text-[#7c6cf0]" />
        <h2 className="ui-display flex-1 text-title-3">Your week</h2>
        {data && !busy ? (
          <>
            <button type="button" onClick={() => void run()} aria-label="Refresh brief" title="Refresh" className="grid h-8 w-8 place-items-center rounded-chip text-muted hover:bg-[var(--glass-hover)] hover:text-heading">
              <RotateCcw size={14} aria-hidden />
            </button>
            <button type="button" onClick={clear} aria-label="Close brief" title="Close" className="grid h-8 w-8 place-items-center rounded-chip text-muted hover:bg-[var(--glass-hover)] hover:text-heading">
              <X size={15} aria-hidden />
            </button>
          </>
        ) : null}
      </div>
      {busy && stream.text ? (
        <div aria-busy="true">
          <Suspense fallback={null}>
            <StreamingText text={stream.text} />
          </Suspense>
        </div>
      ) : busy ? (
        <div className="space-y-2.5 py-1" aria-live="polite">
          <p className="text-subheadline text-muted">Reading this week’s notes…</p>
          {[90, 75, 82, 60].map((w) => (
            <div key={w} className="h-3 animate-pulse rounded-chip bg-[linear-gradient(90deg,color-mix(in_oklab,#8b7cf6_20%,transparent),color-mix(in_oklab,#f58ab8_16%,transparent))] motion-reduce:animate-none" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : data ? (
        <>
          <Suspense fallback={null}>
            <AiMarkdown markdown={data.answer} />
          </Suspense>
          {data.sources.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {data.sources.map((s, i) => (
                <AppLink key={s.id} href={`/d/${s.id}`} className="inline-flex max-w-full items-center gap-1.5 rounded-chip bg-[var(--glass-hover)] px-2.5 py-1 text-subheadline text-ink hover:bg-[var(--glass-active)] hover:text-heading">
                  <span className="font-semibold text-muted">{i + 1}</span>
                  <FileText size={12} aria-hidden className="flex-none text-muted" />
                  <span className="truncate">{s.title}</span>
                </AppLink>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
      {error ? <AiProblemNotice problem={error} className={error.kind === "other" ? "mt-2 text-subheadline text-danger" : "mt-3"} /> : data && !busy ? <AiCreditsNote className="mt-3" /> : null}
    </section>
  );
}

/** This visit's brief for an account's place (its catchUpKey), kept in sessionStorage, or null. */
function savedBrief(key: string): Brief | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = sessionStorage.getItem(key);
    return saved ? (JSON.parse(saved) as Brief) : null;
  } catch {
    return null;
  }
}
