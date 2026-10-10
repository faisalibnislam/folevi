"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Mic, Pause, Play, Square, X } from "lucide-react";
import { cx } from "../ui";
import { autoplay } from "./autoplay";

/*
 * Audio recordings (components/editor/AudioRecorder.tsx and AudioPlayer.tsx), playing by itself: "/rec"
 * picks Audio recording, the recorder counts and shows a level meter, Stop and save puts the player in the
 * note and it plays. Visitors can play, pause and seek the sample. Nothing records: the levels are made up.
 */

const LENGTH = 42;
const BARS = 30;
const NAME = "Recording 2026-10-01 09.12.webm";
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

type Phase = { kind: "typing"; text: string } | { kind: "recording"; seconds: number; paused: boolean } | { kind: "player" };

export function AudioDemo() {
  const [phase, setPhase] = useState<Phase>({ kind: "player" });
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: BARS }, (_, i) => 0.25 + 0.5 * Math.abs(Math.sin(i * 1.7))));
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [auto, setAuto] = useState(true);
  const root = useRef<HTMLDivElement>(null);

  // The level meter moves while recording, like a voice.
  useEffect(() => {
    if (phase.kind !== "recording" || phase.paused) return;
    const id = setInterval(() => setLevels((l) => [...l.slice(1), Math.min(1, 0.15 + Math.random() * 0.85 * (0.6 + 0.4 * Math.sin(Date.now() / 300)))]), 90);
    return () => clearInterval(id);
  }, [phase]);

  // The player's position moves while playing.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setTime((t) => {
        if (t + 0.25 >= LENGTH) {
          setPlaying(false);
          return LENGTH;
        }
        return t + 0.25;
      });
    }, 250);
    return () => clearInterval(id);
  }, [playing]);

  useEffect(() => {
    if (!auto) return;
    return autoplay(root.current, async (sleep) => {
      for (;;) {
        setPlaying(false);
        setTime(0);
        for (const text of ["", "/", "/r", "/re", "/rec"]) {
          setPhase({ kind: "typing", text });
          await sleep(text ? 220 : 900);
        }
        await sleep(700);
        for (let s = 0; s <= 6; s++) {
          setPhase({ kind: "recording", seconds: s, paused: false });
          await sleep(s === 3 ? 0 : 800);
          if (s === 3) {
            setPhase({ kind: "recording", seconds: s, paused: true });
            await sleep(1300);
          }
        }
        setPhase({ kind: "player" });
        await sleep(900);
        setPlaying(true);
        await sleep(4200);
        setPlaying(false);
        await sleep(2400);
      }
    });
  }, [auto]);

  const take = () => setAuto(false);
  const progress = time / LENGTH;

  return (
    <div ref={root} onPointerDown={take} onKeyDown={take} role="group" aria-label="A sample of audio recordings: type /rec, record, then play the recording in the note." className="mk-app-pop mx-auto min-h-[340px] w-full max-w-[520px] rounded-[18px] px-5 pb-6 pt-6 text-[14px] text-ink">
      <p className="mk-display text-[22px] text-(--color-heading)">Standup, Tuesday</p>
      <p className="mt-2">Quick voice note after the call.</p>

      {phase.kind === "typing" ? (
        <div className="relative mt-2">
          <p className="h-6 leading-6">
            {phase.text || <span className="text-faint">Type / for blocks</span>}
            <span className="mx-px inline-block h-[17px] w-px translate-y-[3px] animate-pulse bg-(--color-heading)" />
          </p>
          {phase.text === "/rec" ? (
            <p className="mk-app-pop mk-appear absolute left-0 top-[calc(100%+6px)] flex w-[240px] items-center gap-2.5 rounded-[14px] px-2.5 py-2 text-[13px] text-(--color-heading)">
              <span className="grid size-6 place-items-center rounded-[6px] bg-(--color-surface) shadow-(--shadow-control)">
                <Mic size={14} />
              </span>
              Audio recording
            </p>
          ) : null}
        </div>
      ) : phase.kind === "recording" ? (
        <div className="mk-app-pop mk-appear mt-3 grid gap-3 rounded-[14px] p-3 text-[13px]">
          <div className="flex items-center gap-2.5">
            <span className={cx("grid size-8 place-items-center rounded-[6px]", phase.paused ? "bg-(--glass-hover) text-muted" : "bg-[color-mix(in_oklab,#e5484d_16%,transparent)] text-[#e5484d]")}>
              <Mic size={16} />
            </span>
            <div className="flex-1">
              <p className="font-medium text-(--color-heading)">{phase.paused ? "Paused" : "Recording"}</p>
              <p className="text-[12px] tabular-nums text-muted">
                {fmt(phase.seconds)}
                <span className="text-faint"> / 1:00:00</span>
              </p>
            </div>
            <X size={15} className="text-muted" />
          </div>
          <div className="flex h-10 items-center gap-[3px] rounded-[10px] bg-(--color-surface-sunken) px-2.5">
            {levels.map((l, i) => (
              <span key={i} className={cx("w-full rounded-[6px] transition-[height] duration-75", phase.paused ? "bg-(--color-line-strong)" : "bg-[#e5484d]")} style={{ height: `${Math.max(8, l * 100)}%` }} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
              {phase.paused ? <Play size={14} /> : <Pause size={14} />} {phase.paused ? "Resume" : "Pause"}
            </span>
            <span className="mk-btn mk-btn-primary ml-auto h-9 gap-1.5 px-3.5">
              <Square size={12} className="fill-current" /> Stop and save
            </span>
          </div>
        </div>
      ) : (
        <div className="mk-appear mt-3 flex items-center gap-3 rounded-[10px] px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => {
              take();
              if (!playing && time >= LENGTH) setTime(0);
              setPlaying((p) => !p);
            }}
            className="grid size-9 flex-none place-items-center rounded-[6px] bg-(--color-heading) text-(--color-canvas)"
          >
            {playing ? <Pause size={15} className="fill-current" /> : <Play size={15} className="ml-0.5 fill-current" />}
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-medium">{NAME}</p>
            <div className="mt-1.5 flex items-center gap-2.5">
              <div
                role="slider"
                tabIndex={0}
                aria-label="Position"
                aria-valuemin={0}
                aria-valuemax={LENGTH}
                aria-valuenow={Math.round(time)}
                aria-valuetext={`${fmt(time)} of ${fmt(LENGTH)}`}
                onPointerDown={(ev) => {
                  take();
                  const r = ev.currentTarget.getBoundingClientRect();
                  setTime(Math.max(0, Math.min(LENGTH, ((ev.clientX - r.left) / r.width) * LENGTH)));
                }}
                onKeyDown={(ev) => {
                  if (ev.key === "ArrowRight") setTime((t) => Math.min(LENGTH, t + 5));
                  if (ev.key === "ArrowLeft") setTime((t) => Math.max(0, t - 5));
                }}
                className="relative h-4 flex-1 cursor-pointer outline-none focus-visible:shadow-[0_0_0_2px_var(--color-focus)]"
              >
                <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-[4px] bg-(--color-line-strong)" />
                <span className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-[4px] bg-(--color-heading) transition-[width] duration-200" style={{ width: `${progress * 100}%` }} />
              </div>
              <span className="text-[12px] tabular-nums text-muted">
                {fmt(time)} / {fmt(LENGTH)}
              </span>
            </div>
            <p className="mt-0.5 text-[12px] text-muted">338 KB</p>
          </div>
          <span className="h-8 min-w-11 rounded-[6px] px-1.5 text-center text-[12px] font-semibold leading-8 text-muted">1×</span>
          <Download size={15} className="text-muted" />
        </div>
      )}
    </div>
  );
}
