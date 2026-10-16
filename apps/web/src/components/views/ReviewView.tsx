"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { FileText, Layers } from "lucide-react";
import type { WireScope } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { ViewChrome } from "@/components/app/Shell";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { errorMessage, useToast } from "@/components/ui/Toast";
import { RATINGS, cardCount, intervalLabel, intervalWords, reviewKey, useReviewWindow, type Rating } from "@/components/study/review";
import { EmptyState } from "@/components/ui/EmptyState";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import { haptic } from "@/lib/nativeApp";

type Target = { scope?: WireScope; documentId?: string };
/** The new-cards-a-day choices (convex/lib/study.ts NEW_PER_DAY_OPTIONS). */
const NEW_PER_DAY_OPTIONS = [0, 10, 20, 30, 50, 100] as const;

/**
 * Reviews: the flashcards and quiz questions due today from every note you can read (or one place, or one
 * note with ?note=), one at a time. Show the answer (Space), then say how well you knew it (1 to 4); the
 * button shows when the card comes back. Scheduling is FSRS on the server (convex/study.ts).
 */
export function ReviewView() {
  const { workspaces } = useAppState();
  const { search } = useAppRouter();
  const noteId = search.get("note");
  const [where, setWhere] = useState("all");
  // A workspace you've left falls back to everywhere.
  const place = where === "all" || where === "personal" || workspaces.some((ws) => ws.id === where) ? where : "all";
  const target: Target = noteId ? { documentId: noteId } : place === "all" ? {} : place === "personal" ? { scope: { kind: "personal" } } : { scope: { kind: "workspace", workspaceId: place } };
  const picker =
    !noteId && workspaces.length ? (
      <Select aria-label="What to review" value={place} onChange={(e) => setWhere(e.target.value)} className="h-8 text-[13px]">
        <option value="all">Everywhere</option>
        <option value="personal">Personal</option>
        {workspaces.map((ws) => (
          <option key={ws.id} value={ws.id}>
            {ws.name}
          </option>
        ))}
      </Select>
    ) : null;
  // A fresh session (progress, cards done) for each deck.
  return <Session key={noteId ?? place} target={target} picker={picker} />;
}

function Session({ target, picker }: { target: Target; picker: React.ReactNode }) {
  const w = useReviewWindow();
  const data = useQuery(api.study.queue, { ...target, ...w, limit: 20 });
  const review = useMutation(api.study.review);
  const setNewPerDay = useMutation(api.study.setNewPerDay);
  const toast = useToast();
  // Cards answered this session, by card and the review they were answered at: one rated "Again" comes back
  // (with a newer review) when it's due.
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set());
  const [reviewed, setReviewed] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [said, setSaid] = useState("");
  const region = useRef<HTMLDivElement>(null);
  const keyOf = (c: { blockId: string; lastReview: number | null }) => `${c.blockId}:${c.lastReview ?? "new"}`;
  const card = data?.cards.find((c) => !done.has(keyOf(c)));
  const answered = data ? data.cards.filter((c) => done.has(keyOf(c))).length : 0;
  const left = data ? Math.max(0, data.counts.due + data.counts.new - answered) : 0;

  const rate = (rating: Rating) => {
    if (!card || !revealed) return;
    setDone((prev) => new Set(prev).add(keyOf(card)));
    setRevealed(false);
    setReviewed((n) => n + 1);
    setSaid(`${RATINGS.find((r) => r.id === rating)!.label}. Back in ${intervalWords(card.intervals[rating])}.`);
    region.current?.focus({ preventScroll: true });
    review({ blockId: card.blockId, rating, lastReview: card.lastReview }).catch((e) => toast.show(errorMessage(e), { tone: "error" }));
  };
  const reveal = () => {
    if (!card) return;
    setRevealed(true);
    setSaid("Answer shown.");
  };

  // On a touch screen: a tap on the card shows the answer; then a swipe right is Good and a swipe left
  // Again (the card follows the finger and is felt when it goes), or a rating button as before.
  const touch = useMediaQuery("(pointer: coarse)");
  const drag = useRef<{ id: number; x: number; y: number; dx: number; moved: boolean } | null>(null);
  const [dx, setDx] = useState(0);
  const SWIPE = 96;
  const onCardDown = (e: React.PointerEvent<HTMLElement>) => {
    if (!touch || e.pointerType === "mouse" || (e.target as HTMLElement).closest("a, button")) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, moved: false };
  };
  const onCardMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (!d.moved && Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.3 && revealed) {
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (!d.moved) return;
    d.dx = mx;
    setDx(mx);
  };
  const onCardUp = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId) return;
    setDx(0);
    if (!d.moved) {
      // A tap: the answer.
      if (!revealed && e.type === "pointerup" && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10) reveal();
      return;
    }
    if (Math.abs(d.dx) >= SWIPE) {
      haptic(d.dx > 0 ? "success" : "warning");
      rate(d.dx > 0 ? "good" : "again");
    }
  };

  // Space shows the answer, 1 to 4 rate it: anywhere on the page except in a field or another control.
  const act = useRef({ reveal, rate, revealed });
  useEffect(() => {
    act.current = { reveal, rate, revealed };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof HTMLElement ? e.target : null;
      const inside = !t || t === document.body || Boolean(region.current?.contains(t));
      if (!inside || t?.closest("input, textarea, select, [contenteditable='true'], [role='listbox'], [role='combobox']")) return;
      // A focused button of ours keeps Enter for itself (Space still shows the answer).
      if (e.key === "Enter" && t?.closest("button, a")) return;
      const action = reviewKey(e, act.current.revealed);
      if (!action) return;
      e.preventDefault();
      if (action.kind === "reveal") act.current.reveal();
      else act.current.rate(action.rating);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    region.current?.focus({ preventScroll: true });
  }, []);

  const title = data?.documentTitle !== undefined && data?.documentTitle !== null ? `Reviews · ${data.documentTitle || "Untitled"}` : "Reviews";
  return (
    <ViewChrome
      title={<h1 className="text-sm font-semibold">Reviews</h1>}
      subtitle={data ? (left ? `${cardCount(left)} to review` : "All caught up") : undefined}
      tabTitle={title}
      actions={
        <>
          {picker}
          {/* How many new cards start each day, everywhere (a note's own review isn't held to it). */}
          {data && !target.documentId ? (
            <Select
              aria-label="New cards a day"
              value={String(data.newPerDay)}
              onChange={(e) => void setNewPerDay({ value: Number(e.target.value) }).catch((err) => toast.show(errorMessage(err), { tone: "error" }))}
              className="h-8 text-[13px]"
            >
              {NEW_PER_DAY_OPTIONS.map((n) => (
                <option key={n} value={String(n)}>
                  {n === 0 ? "No new cards" : `${n} new cards a day`}
                </option>
              ))}
            </Select>
          ) : null}
        </>
      }
    >
      <div ref={region} tabIndex={-1} aria-label="Review cards" role="region" className="mx-auto max-w-2xl px-4 pb-[max(4rem,var(--fab-clearance))] pt-6 outline-none sm:px-8">
        {target.documentId && data ? (
          <p className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
            <span>
              Cards in{" "}
              <AppLink href={`/d/${target.documentId}`} className="font-medium text-ink underline-offset-2 hover:underline">
                {data.documentTitle || "Untitled"}
              </AppLink>
            </span>
            <AppLink href="/review" className="font-medium text-ink underline-offset-2 hover:underline">
              Review everything
            </AppLink>
          </p>
        ) : null}
        {data === undefined ? (
          <div role="status" aria-busy aria-label="Loading" className="h-64 animate-pulse rounded-container bg-[var(--glass-hover)] motion-reduce:animate-none" />
        ) : data === null ? (
          <Empty title="This note isn't available" body="It may have been moved to Trash, or you no longer have access to it." />
        ) : card ? (
          <>
            <div className="mb-3 flex items-center justify-between gap-3 text-[12.5px] text-muted">
              <span>
                Card {reviewed + 1} of {reviewed + left}
              </span>
              {card.isNew ? <span className="rounded-chip bg-[var(--glass-hover)] px-2 py-0.5 text-[11.5px] font-medium text-ink">New</span> : null}
            </div>
            <div
              role="progressbar"
              aria-label="Reviewed this session"
              aria-valuemin={0}
              aria-valuemax={reviewed + left}
              aria-valuenow={reviewed}
              className="mb-5 h-1.5 overflow-hidden rounded-tiny bg-[var(--glass-active)]"
            >
              <div className="h-full rounded-chip bg-heading transition-[width] motion-reduce:transition-none" style={{ width: `${reviewed + left ? (reviewed / (reviewed + left)) * 100 : 0}%` }} />
            </div>
            <article
              aria-roledescription="flashcard"
              aria-label={`Card: ${card.front}`}
              onPointerDown={onCardDown}
              onPointerMove={onCardMove}
              onPointerUp={onCardUp}
              onPointerCancel={onCardUp}
              style={dx ? { transform: `translateX(${dx}px) rotate(${dx / 40}deg)`, transition: "none" } : undefined}
              className={`relative rounded-container bg-[var(--glass-active)] p-6 shadow-[var(--glass-edge),var(--glass-shadow)] transition-transform duration-200 motion-reduce:transition-none sm:p-8 ${touch ? "touch-pan-y select-none" : ""}`}
            >
              {dx ? (
                <span aria-hidden className={`absolute top-4 rounded-chip px-2 py-0.5 text-[12px] font-semibold ${dx > 0 ? "right-4 bg-[var(--color-moss-soft,var(--glass-hover))] text-heading" : "left-4 bg-[var(--glass-hover)] text-danger"}`} style={{ opacity: Math.min(1, Math.abs(dx) / SWIPE) }}>
                  {dx > 0 ? "Good" : "Again"}
                </span>
              ) : null}
              <p className="ui-display whitespace-pre-wrap text-[22px] leading-snug text-heading">{card.front || "Untitled card"}</p>
              {revealed ? (
                <div className="mt-5 border-t border-line/70 pt-5">
                  <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{card.back || "Nothing inside this card yet."}</p>
                </div>
              ) : null}
              <AppLink href={`/d/${card.documentId}#block-${card.blockId}`} className="mt-6 inline-flex max-w-full items-center gap-1.5 text-[12.5px] text-muted hover:text-heading">
                <FileText size={12} aria-hidden className="flex-none" />
                <span className="truncate">{card.documentTitle || "Untitled"}</span>
              </AppLink>
            </article>
            <div className="mt-5">
              {revealed ? (
                <div role="group" aria-label="How well did you know it?" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {RATINGS.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      aria-keyshortcuts={r.key}
                      aria-label={`${r.label}, back in ${intervalWords(card.intervals[r.id])}`}
                      onClick={() => rate(r.id)}
                      className={`ui-btn ${r.id === "good" ? "ui-btn-primary" : "ui-btn-secondary"} flex h-auto flex-col gap-0.5 py-2.5`}
                    >
                      <span className="text-[13.5px] font-semibold">{r.label}</span>
                      <span className="text-[11.5px] opacity-70">{intervalLabel(card.intervals[r.id])}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <Button variant="primary" onClick={reveal} aria-keyshortcuts="Space" className="w-full">
                  Show answer
                </Button>
              )}
              <p className="mt-3 text-center text-[11.5px] text-faint">
                {touch ? (revealed ? "Swipe the card right for Good, left for Again." : "Tap the card to see the answer.") : revealed ? "Keys: 1 Again, 2 Hard, 3 Good, 4 Easy." : "Key: Space shows the answer."}
              </p>
            </div>
          </>
        ) : reviewed ? (
          <Empty title="Done for now" body={`You reviewed ${cardCount(reviewed)}.${data.counts.later ? ` ${cardCount(data.counts.later)} more later today.` : ""}`} />
        ) : (
          <Empty
            title="Nothing to review"
            body={`Cards from your notes come back here when they're due.${data.counts.later ? ` ${cardCount(data.counts.later)} later today.` : ""}`}
            hint={data.hasCards ? undefined : "To make cards, ask Foli AI for flashcards on a note, or turn a toggle into a flashcard from its block menu."}
          />
        )}
        <p role="status" aria-live="polite" className="sr-only">
          {said}
        </p>
      </div>
    </ViewChrome>
  );
}

function Empty({ title, body, hint }: { title: string; body: string; hint?: string }) {
  return <EmptyState icon={Layers} title={title} body={body} hint={hint} />;
}
