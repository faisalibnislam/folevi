"use client";

// Foli DNA's time-lapse bar (GraphView.tsx, "Play how it grew"): a floating bar at the bottom of the map with play
// or pause, a track that fills as time passes (ticks for the weeks, months or years in it), the date in a pill over
// the playhead, the first and last dates under the ends, how many notes there are so far, and an x that stops and
// goes back to now. Drag or click the track to jump; Space plays or pauses, the arrow keys step, Home and End go to
// the ends, Escape closes. The Mac and iPad draw the same (GraphScreen.swift, DnaTimelineBar).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Pause, Play, X } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { timelineStep, timelineTicks } from "@/lib/graph/timeline";

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function DnaTimeline({
  start,
  end,
  at,
  playing,
  count,
  onPlay,
  onSeek,
  onClose,
}: {
  start: number;
  end: number;
  at: number;
  playing: boolean;
  count: { shown: number; total: number };
  onPlay: () => void;
  onSeek: (t: number) => void;
  onClose: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const { ticks } = useMemo(() => timelineTicks(start, end), [start, end]);
  const span = Math.max(1, end - start);
  const pos = Math.min(1, Math.max(0, (at - start) / span));
  // Keyboard first: the track takes focus when the bar opens, so Space and the arrows work at once.
  useEffect(() => track.current?.focus({ preventScroll: true }), []);

  const seekTo = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return;
    onSeek(start + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * span);
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setScrubbing(true);
    seekTo(e.clientX);
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const onButton = (e.target as HTMLElement).closest("button");
    if (e.key === " " && !onButton) {
      e.preventDefault();
      onPlay();
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onSeek(timelineStep(start, end, at, 1));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onSeek(timelineStep(start, end, at, -1));
    } else if (e.key === "Home") {
      e.preventDefault();
      onSeek(start);
    } else if (e.key === "End") {
      e.preventDefault();
      onSeek(end);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };
  // The playhead glides on a click or a key; while it plays or is dragged it follows exactly.
  const glide = playing || scrubbing ? "" : "transition-[left,width] duration-200 ease-[var(--ease-folio)] motion-reduce:transition-none";
  const notes = count.total === 1 ? "note" : "notes";

  return (
    <div
      role="group"
      aria-label="How it grew"
      onKeyDown={onKeyDown}
      className="ui-pop pointer-events-auto flex w-full items-center gap-2 rounded-panel py-2 pl-2 pr-1.5 animate-[folio-rise_180ms_var(--ease-folio)] motion-reduce:animate-none"
    >
      <IconButton label={playing ? "Pause" : "Play"} shortcut="Space" onClick={onPlay} className="!h-8 !w-8 flex-none">
        {playing ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}
      </IconButton>
      <div className="min-w-0 flex-1 px-2">
        <div
          ref={track}
          role="slider"
          tabIndex={0}
          aria-label="Date"
          aria-valuemin={start}
          aria-valuemax={end}
          aria-valuenow={Math.round(at)}
          aria-valuetext={day(at)}
          onPointerDown={onPointerDown}
          onPointerMove={(e) => scrubbing && seekTo(e.clientX)}
          onPointerUp={() => setScrubbing(false)}
          onPointerCancel={() => setScrubbing(false)}
          className="group relative h-6 cursor-pointer touch-none outline-none"
        >
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-tiny bg-[var(--glass-hover)] transition-colors duration-150 group-hover:bg-[color-mix(in_oklab,var(--glass-hover),var(--color-ink)_8%)]" />
          {ticks.map((k) => (
            <span
              key={k.at}
              aria-hidden
              className={`absolute top-1/2 w-px -translate-x-1/2 bg-line-strong ${k.major ? "h-3 -translate-y-1/2 opacity-90" : "h-1.5 -translate-y-1/2 opacity-60"}`}
              style={{ left: `${k.pos * 100}%` }}
            />
          ))}
          <div className={`absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-tiny bg-heading ${glide}`} style={{ width: `${pos * 100}%` }} />
          <span
            aria-hidden
            className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-small border-2 border-heading bg-[var(--color-surface-raised)] shadow-sm transition-transform duration-150 group-hover:scale-110 group-focus-visible:ring-2 group-focus-visible:ring-[var(--color-focus)] group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-[var(--color-surface-raised)] ${glide}`}
            style={{ left: `${pos * 100}%` }}
          />
          <span
            aria-hidden
            className={`ui-pop pointer-events-none absolute bottom-[calc(100%+6px)] -translate-x-1/2 whitespace-nowrap rounded-chip px-2 py-0.5 text-footnote font-medium tabular-nums text-heading ${glide}`}
            style={{ left: `clamp(2.75rem, ${pos * 100}%, calc(100% - 2.75rem))` }}
          >
            {day(at)}
          </span>
        </div>
        <div aria-hidden className="mt-0.5 flex justify-between text-caption-1 tabular-nums text-faint">
          <span>{day(start)}</span>
          <span>{day(end)}</span>
        </div>
      </div>
      <p className="flex-none whitespace-nowrap px-1 text-footnote tabular-nums text-muted" aria-live="off">
        {count.shown} of {count.total} {notes}
      </p>
      <IconButton label="Close the time-lapse" onClick={onClose} className="!h-8 !w-8 flex-none">
        <X size={15} aria-hidden />
      </IconButton>
    </div>
  );
}
