"use client";

import { useRef, useState } from "react";
import { Download, Pause, Play } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { formatDuration } from "./AudioRecorder";

const SPEEDS = [1, 1.5, 2];

/**
 * The player for an audio recording, in notes and on public links: the app's own controls (no browser
 * ones) over a hidden <audio>. `duration` is the length measured while recording, since recordings from
 * MediaRecorder often report an unknown length.
 */
export function AudioPlayer({
  src,
  download,
  name,
  size,
  duration,
  status,
  className,
}: {
  src: string | null;
  /** The signed file URL, once uploaded. */
  download?: string | null;
  name: string | null;
  size: number | null;
  duration: number | null;
  /** Upload progress, shown after the size. */
  status?: string | null;
  className?: string;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [problem, setProblem] = useState(false);
  // Recordings from MediaRecorder often report an unknown length, so the one measured while recording wins.
  const [mediaLength, setMediaLength] = useState<number | null>(null);
  const length = duration || mediaLength || 0;

  const toggle = () => {
    const el = audio.current;
    if (!el || !src) return;
    if (el.paused) void el.play().catch(() => setProblem(true));
    else el.pause();
  };
  const seek = (seconds: number) => {
    const el = audio.current;
    if (!el || !length) return;
    el.currentTime = Math.max(0, Math.min(length, seconds));
    setTime(el.currentTime);
  };
  const seekAt = (clientX: number, bar: HTMLElement) => {
    const r = bar.getBoundingClientRect();
    seek(((clientX - r.left) / r.width) * length);
  };
  const progress = length ? Math.min(1, time / length) : 0;

  return (
    <div
      className={`fb-audio flex items-center gap-3 ui-card rounded-[10px] px-3 py-2.5 ${className ?? ""}`}
      contentEditable={false}
    >
      <button
        type="button"
        onClick={toggle}
        disabled={!src}
        aria-label={playing ? "Pause" : "Play"}
        className="grid size-9 flex-none place-items-center rounded-full bg-heading text-canvas transition-opacity disabled:opacity-40"
      >
        {playing ? (
          <Pause size={15} aria-hidden className="fill-current" />
        ) : (
          <Play size={15} aria-hidden className="ml-0.5 fill-current" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name ?? "Audio recording"}</p>
        <div className="mt-1.5 flex items-center gap-2.5">
          <div
            role="slider"
            tabIndex={src ? 0 : -1}
            aria-label="Position"
            aria-valuemin={0}
            aria-valuemax={Math.round(length)}
            aria-valuenow={Math.round(time)}
            aria-valuetext={`${formatDuration(time)} of ${formatDuration(length)}`}
            onPointerDown={(e) => {
              if (!src) return;
              const bar = e.currentTarget;
              bar.setPointerCapture(e.pointerId);
              seekAt(e.clientX, bar);
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                seekAt(e.clientX, e.currentTarget);
            }}
            onKeyDown={(e) => {
              const step =
                e.key === "ArrowRight" || e.key === "ArrowUp"
                  ? 5
                  : e.key === "ArrowLeft" || e.key === "ArrowDown"
                    ? -5
                    : 0;
              if (step) {
                e.preventDefault();
                seek(time + step);
              } else if (e.key === "Home" || e.key === "End") {
                e.preventDefault();
                seek(e.key === "Home" ? 0 : length);
              }
            }}
            className="group relative h-4 flex-1 cursor-pointer touch-none rounded-full outline-none focus-visible:shadow-[0_0_0_2px_var(--color-focus)]"
          >
            <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-line-strong" />
            <span
              className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-heading"
              style={{ width: `${progress * 100}%` }}
            />
            <span
              className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-heading opacity-0 shadow-[0_0_0_2px_var(--color-surface)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              style={{ left: `${progress * 100}%` }}
            />
          </div>
          <span className="flex-none text-xs tabular-nums text-muted">
            {formatDuration(time)} / {formatDuration(length)}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted" role={status ? "status" : undefined}>
          {size ? formatBytes(size) : ""}
          {status
            ? ` · ${status}`
            : problem
              ? " · This recording can’t play in this browser. Download it instead."
              : ""}
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;
          setSpeed(next);
          if (audio.current) audio.current.playbackRate = next;
        }}
        aria-label={`Playback speed ${speed} times`}
        title="Playback speed"
        className="h-8 min-w-11 flex-none rounded-[6px] px-1.5 text-xs font-semibold tabular-nums text-muted hover:bg-[var(--glass-hover)] hover:text-heading"
      >
        {speed}×
      </button>
      {download ? (
        <a
          href={download}
          download={name ?? true}
          aria-label="Download"
          title="Download"
          className="grid size-8 flex-none place-items-center rounded-[6px] text-muted hover:bg-[var(--glass-hover)] hover:text-heading"
        >
          <Download size={15} aria-hidden />
        </a>
      ) : null}
      {src ? (
        <audio
          ref={audio}
          src={src}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d)) setMediaLength(d);
            e.currentTarget.playbackRate = speed;
          }}
          onError={() => setProblem(true)}
          hidden
        />
      ) : null}
    </div>
  );
}
