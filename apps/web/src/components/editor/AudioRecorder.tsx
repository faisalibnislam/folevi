"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, Square, X } from "lucide-react";

/*
 * The "/Audio recording" panel: records from the microphone with MediaRecorder and hands the finished
 * recording to the editor, which stores it like any attachment (saved on the device first, uploaded when
 * online). Nothing leaves the browser until Save. Cancel, or closing the panel, throws the audio away.
 */

/** Longest recording, so a forgotten recorder can't fill the storage quota. */
export const MAX_RECORDING_MS = 60 * 60_000;
const BARS = 36;

/** The first container this browser records, most compatible first (Chrome/Firefox: WebM, Safari: MP4). */
function recordingType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) =>
    MediaRecorder.isTypeSupported(t),
  );
}

export function canRecordAudio(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

const EXTENSION: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
};

/** "Recording 2026-09-30 21.05.webm": sorts by date in Finder and in a ZIP export. */
export function recordingName(mime: string, at = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}.${pad(at.getMinutes())}`;
  return `Recording ${stamp}.${EXTENSION[mime] ?? "webm"}`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

type Phase =
  | { kind: "asking" }
  | { kind: "recording" }
  | { kind: "paused" }
  | { kind: "saving" }
  | { kind: "error"; message: string };

function micProblem(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Folevi can’t use your microphone. Allow it in your browser’s site settings, then try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "No microphone was found. Connect one and try again.";
  if (name === "NotReadableError")
    return "Another app is using your microphone. Close it and try again.";
  return "The recording couldn’t start. Try again.";
}

export function AudioRecorder({
  onSave,
  onClose,
}: {
  onSave: (file: File, durationSeconds: number) => Promise<void> | void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>(() =>
    canRecordAudio()
      ? { kind: "asking" }
      : {
          kind: "error",
          message: "This browser can’t record audio. Try a recent Chrome, Safari, Edge or Firefox.",
        },
  );
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const audioCtx = useRef<AudioContext | null>(null);
  const frame = useRef(0);
  // Time is counted only while recording, so pauses don't count towards the length.
  const clock = useRef({ total: 0, since: 0 });
  const keep = useRef(false);
  // The latest callbacks, for when the recorder finishes (after renders this effect never sees).
  const handlers = useRef({ onSave, onClose });
  useEffect(() => {
    handlers.current = { onSave, onClose };
  }, [onSave, onClose]);

  const now = () =>
    clock.current.total + (clock.current.since ? performance.now() - clock.current.since : 0);

  const release = useCallback(() => {
    cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void audioCtx.current?.close().catch(() => undefined);
    audioCtx.current = null;
  }, []);

  // Ask for the microphone and start at once: the slash command was the "record" click.
  useEffect(() => {
    if (!canRecordAudio()) return;
    let cancelled = false;
    (async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        if (cancelled) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = media;
        const type = recordingType();
        const rec = new MediaRecorder(
          media,
          type ? { mimeType: type, audioBitsPerSecond: 64_000 } : undefined,
        );
        rec.ondataavailable = (e) => {
          if (e.data.size) chunks.current.push(e.data);
        };
        rec.onstop = () => {
          release();
          if (!keep.current) return;
          const mime = (rec.mimeType || type || "audio/webm").split(";")[0]!;
          const blob = new Blob(chunks.current, { type: mime });
          const file = new File([blob], recordingName(mime), { type: mime });
          void Promise.resolve(handlers.current.onSave(file, now() / 1000)).finally(() =>
            handlers.current.onClose(),
          );
        };
        recorder.current = rec;
        rec.start(1000);
        clock.current = { total: 0, since: performance.now() };
        setPhase({ kind: "recording" });

        // A level meter, so it's clear the microphone is hearing something.
        const ctx = new AudioContext();
        audioCtx.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(media).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        let last = 0;
        const tick = (t: number) => {
          frame.current = requestAnimationFrame(tick);
          if (t - last < 80) return;
          last = t;
          setElapsed(now());
          if (now() >= MAX_RECORDING_MS && rec.state !== "inactive") {
            keep.current = true;
            rec.stop();
            return;
          }
          if (rec.state !== "recording") return;
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
          setLevels((prev) => [...prev.slice(1), Math.min(1, peak * 1.8)]);
        };
        frame.current = requestAnimationFrame(tick);
      } catch (error) {
        if (!cancelled) setPhase({ kind: "error", message: micProblem(error) });
      }
    })();
    return () => {
      cancelled = true;
      // Unmounting without Save discards the recording.
      if (recorder.current && recorder.current.state !== "inactive" && !keep.current)
        recorder.current.stop();
      release();
    };
    // Runs once per panel; the callbacks are read from `handlers` when the recording ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pause = () => {
    const rec = recorder.current;
    if (!rec || rec.state !== "recording") return;
    rec.pause();
    clock.current = { total: now(), since: 0 };
    setPhase({ kind: "paused" });
  };
  const resume = () => {
    const rec = recorder.current;
    if (!rec || rec.state !== "paused") return;
    rec.resume();
    clock.current = { ...clock.current, since: performance.now() };
    setPhase({ kind: "recording" });
  };
  const save = () => {
    const rec = recorder.current;
    if (!rec || rec.state === "inactive") return;
    clock.current = { total: now(), since: 0 };
    keep.current = true;
    setPhase({ kind: "saving" });
    rec.stop();
  };
  const cancel = () => {
    keep.current = false;
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    release();
    onClose();
  };

  const live = phase.kind === "recording" || phase.kind === "paused";
  return (
    <div
      className="grid gap-3 p-2.5 text-sm"
      onKeyDown={(e) => {
        // Escape only closes before anything is recorded, so a stray key can't throw a recording away.
        if (e.key === "Escape" && !live && phase.kind !== "saving") {
          e.preventDefault();
          e.stopPropagation();
          cancel();
        }
      }}
    >
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className={`grid size-8 flex-none place-items-center rounded-full ${phase.kind === "recording" ? "bg-[color-mix(in_oklab,#e5484d_16%,transparent)] text-[#e5484d]" : "bg-sunken text-muted"}`}
        >
          <Mic size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-heading">
            {phase.kind === "asking"
              ? "Waiting for the microphone…"
              : phase.kind === "paused"
                ? "Paused"
                : phase.kind === "saving"
                  ? "Saving…"
                  : phase.kind === "error"
                    ? "Can’t record"
                    : "Recording"}
          </p>
          {live || phase.kind === "saving" ? (
            <p className="text-xs tabular-nums text-muted" aria-live="off">
              {formatDuration(elapsed / 1000)}
              <span className="text-faint"> / {formatDuration(MAX_RECORDING_MS / 1000)}</span>
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={cancel}
          aria-label={live ? "Cancel and discard the recording" : "Close"}
          title={live ? "Cancel" : "Close"}
          className="grid size-8 flex-none place-items-center rounded-[6px] text-muted hover:bg-[var(--glass-hover)] hover:text-heading"
        >
          <X size={15} aria-hidden />
        </button>
      </div>

      {phase.kind === "error" ? (
        <p className="rounded-[8px] bg-danger-soft px-3 py-2 text-[13px] text-danger" role="alert">
          {phase.message}
        </p>
      ) : (
        <div
          className="flex h-10 items-center gap-[3px] rounded-[8px] bg-sunken px-2.5"
          aria-hidden
        >
          {levels.map((level, i) => (
            <span
              key={i}
              className={`w-full rounded-full transition-[height] duration-75 ${phase.kind === "recording" ? "bg-[#e5484d]" : "bg-line-strong"}`}
              style={{ height: `${Math.max(8, level * 100)}%` }}
            />
          ))}
        </div>
      )}

      {live || phase.kind === "saving" ? (
        <div className="flex items-center gap-2">
          {phase.kind === "paused" ? (
            <button
              type="button"
              onClick={resume}
              className="ui-btn ui-btn-secondary h-9 px-3 text-[13px]"
            >
              <Play size={14} aria-hidden /> Resume
            </button>
          ) : (
            <button
              type="button"
              onClick={pause}
              disabled={phase.kind !== "recording"}
              className="ui-btn ui-btn-secondary h-9 px-3 text-[13px]"
            >
              <Pause size={14} aria-hidden /> Pause
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={phase.kind === "saving"}
            className="ui-btn ui-btn-primary ml-auto h-9 px-3.5 text-[13px]"
          >
            <Square size={12} aria-hidden className="fill-current" /> Stop and save
          </button>
        </div>
      ) : null}
      {live ? (
        <p className="text-xs text-muted">
          The recording is added to this note when you save. It counts towards your storage.
        </p>
      ) : null}
    </div>
  );
}
