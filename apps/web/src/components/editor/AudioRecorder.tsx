"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, PhoneCall, Square, X } from "lucide-react";
import { errorMessage, useToast } from "@/components/ui/Toast";
import { desktop, deviceName } from "@/lib/desktop";
import { inIosApp } from "@/lib/nativeApp";
import { callProblem, canRecordCalls, mixAudio, type RecordingSource } from "@/lib/callCapture";

/*
 * The "/Audio recording" panel: records from the microphone with MediaRecorder and hands the finished
 * recording to the editor, which stores it like any attachment (saved on the device first, uploaded when
 * online). Nothing leaves the browser until Save. Cancel, or closing the panel, throws the audio away.
 * In the Mac app it first asks what to record: the microphone, or a call (the microphone mixed with this
 * Mac's sound, lib/callCapture.ts), with a reminder to tell the people on the call. The Windows app the same,
 * with the PC's sound.
 */

/** Longest recording, so a forgotten recorder can't fill the storage quota. */
export const MAX_RECORDING_MS = 3 * 60 * 60_000;
/**
 * Longest recording in bytes: under the 100 MB a recording may be (convex/lib/images.ts MAX_FILE_BYTES).
 * Three hours at 64 kbit/s is about 86 MB, so this only stops a recorder that writes more than it was asked.
 */
export const MAX_RECORDING_BYTES = 95 * 1024 * 1024;
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
  // The Mac app: microphone or call, before anything is asked for.
  | { kind: "choose" }
  | { kind: "asking" }
  | { kind: "recording" }
  | { kind: "paused" }
  | { kind: "saving" }
  // Recording ended without Save (the microphone went away) or saving failed: the audio waits for Save.
  | { kind: "stopped"; file: File; seconds: number; message: string }
  | { kind: "error"; message: string; settings?: boolean };

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
  // Calls can be recorded in a Mac app that says so (older installed apps can't), and in the Windows app.
  const [calls] = useState(() => canRecordCalls(desktop()) && Boolean(navigator.mediaDevices?.getDisplayMedia));
  // "Mac" or "PC" in the choice's words.
  const [windows] = useState(() => desktop()?.platform === "windows");
  const [phase, setPhase] = useState<Phase>(() =>
    canRecordAudio()
      ? calls
        ? { kind: "choose" }
        : { kind: "asking" }
      : {
          kind: "error",
          message: "This browser can’t record audio. Try a recent Chrome, Safari, Edge or Firefox.",
        },
  );
  const [source, setSource] = useState<RecordingSource>("mic");
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  const recorder = useRef<MediaRecorder | null>(null);
  // Every stream in use (the microphone, and for a call this Mac's sound), stopped when recording ends.
  const streams = useRef<MediaStream[]>([]);
  const chunks = useRef<Blob[]>([]);
  const bytes = useRef(0);
  // Bumped when the panel unmounts (or React re-runs its effect): a start still waiting then gives up.
  const generation = useRef(0);
  const audioCtx = useRef<AudioContext | null>(null);
  const frame = useRef(0);
  // Time is counted only while recording, so pauses don't count towards the length.
  const clock = useRef({ total: 0, since: 0 });
  // Cancel throws the audio away; Save (or reaching the length limit) stores it. A recording that ends any
  // other way (the microphone unplugged, its permission taken back) is kept for the person to save.
  const discard = useRef(false);
  const requested = useRef(false);
  const toast = useToast();
  // The latest callbacks, for when the recorder finishes (after renders this effect never sees).
  const handlers = useRef({ onSave, onClose, toast });
  useEffect(() => {
    handlers.current = { onSave, onClose, toast };
  }, [onSave, onClose, toast]);

  const now = () =>
    clock.current.total + (clock.current.since ? performance.now() - clock.current.since : 0);

  const release = useCallback(() => {
    cancelAnimationFrame(frame.current);
    streams.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streams.current = [];
    void audioCtx.current?.close().catch(() => undefined);
    audioCtx.current = null;
  }, []);

  // The panel closes only once the recording is in the note; if that fails it stays open to try again.
  const store = useCallback(async (file: File, seconds: number) => {
    setPhase({ kind: "saving" });
    try {
      await handlers.current.onSave(file, seconds);
    } catch (error) {
      handlers.current.toast.show(errorMessage(error), { tone: "error" });
      setPhase({ kind: "stopped", file, seconds, message: "The recording couldn’t be added to the note. Try saving again." });
      return;
    }
    handlers.current.onClose();
  }, []);

  /**
   * Starts recording from `from`: the microphone, or a call (this Mac's sound first, while the click that
   * chose it still counts as one, then the microphone, mixed into one stream).
   */
  const begin = useCallback(async (from: RecordingSource) => {
    const gen = generation.current;
    const stale = () => gen !== generation.current;
    setSource(from);
    setPhase({ kind: "asking" });
    let system: MediaStream | null = null;
    if (from === "call") {
      try {
        system = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
        // Only the sound is kept: the picture is never recorded.
        for (const t of system.getVideoTracks()) {
          t.stop();
          system.removeTrack(t);
        }
        if (!system.getAudioTracks().length) throw new DOMException("No sound came with the capture.", "NoSystemAudio");
        // Without Screen & System Audio Recording the capture may start without the call's sound: check first.
        const access = await desktop()?.screenAccess?.();
        if (access && access !== "granted") throw new DOMException("Screen recording isn't allowed.", "NotAllowedError");
      } catch (error) {
        system?.getTracks().forEach((t) => t.stop());
        if (!stale()) {
          const problem = callProblem(error, desktop()?.platform);
          setPhase({ kind: "error", message: problem.message, settings: problem.settings });
        }
        return;
      }
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (stale()) {
        media.getTracks().forEach((t) => t.stop());
        system?.getTracks().forEach((t) => t.stop());
        return;
      }
      streams.current = system ? [media, system] : [media];
      const ctx = new AudioContext();
      audioCtx.current = ctx;
      void ctx.resume().catch(() => undefined);
      // A level meter, so it's clear the microphone (and the call) is heard.
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      let recorded = media;
      if (system) recorded = mixAudio(ctx, [media, system], analyser);
      else ctx.createMediaStreamSource(media).connect(analyser);
      const type = recordingType();
      const rec = new MediaRecorder(
        recorded,
        type ? { mimeType: type, audioBitsPerSecond: 64_000 } : undefined,
      );
      rec.ondataavailable = (e) => {
        if (e.data.size) {
          chunks.current.push(e.data);
          bytes.current += e.data.size;
        }
      };
      rec.onstop = () => {
        clock.current = { total: now(), since: 0 };
        release();
        if (discard.current) return;
        const mime = (rec.mimeType || type || "audio/webm").split(";")[0]!;
        const blob = new Blob(chunks.current, { type: mime });
        const file = new File([blob], recordingName(mime), { type: mime });
        const seconds = now() / 1000;
        setElapsed(now());
        if (requested.current) void store(file, seconds);
        else
          setPhase({
            kind: "stopped",
            file,
            seconds,
            message: system
              ? "The call’s sound or the microphone stopped (sharing ended, or a permission was turned off). What was recorded so far is kept."
              : "The microphone stopped (it was disconnected or its permission was turned off). What was recorded so far is kept.",
          });
      };
      // Most browsers stop the recorder when its microphone goes away; this makes sure of it (and for a
      // call, when this Mac's sound stops coming).
      for (const track of [...media.getAudioTracks(), ...(system?.getAudioTracks() ?? [])])
        track.addEventListener("ended", () => {
          if (rec.state !== "inactive") rec.stop();
        });
      recorder.current = rec;
      rec.start(1000);
      clock.current = { total: 0, since: performance.now() };
      setPhase({ kind: "recording" });

      const data = new Uint8Array(analyser.fftSize);
      let last = 0;
      const tick = (t: number) => {
        frame.current = requestAnimationFrame(tick);
        if (t - last < 80) return;
        last = t;
        setElapsed(now());
        if ((now() >= MAX_RECORDING_MS || bytes.current >= MAX_RECORDING_BYTES) && rec.state !== "inactive") {
          requested.current = true;
          setPhase({ kind: "saving" });
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
      system?.getTracks().forEach((t) => t.stop());
      if (stale()) return;
      release();
      setPhase({ kind: "error", message: micProblem(error) });
    }
    // `now`, `release` and `store` only read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Without a choice to make, ask for the microphone and start at once: the slash command was the "record" click.
  useEffect(() => {
    if (canRecordAudio() && !calls) void begin("mic");
    return () => {
      // A counter, meant to have moved on: a start still waiting sees it and gives up.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      // Unmounting without Save discards the recording.
      if (recorder.current && recorder.current.state !== "inactive" && !requested.current) {
        discard.current = true;
        recorder.current.stop();
      }
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
  // In the iOS app the microphone goes quiet while Folevi is in the background (iOS lets an app in the
  // background record only with a background mode the app doesn't have). So the recording pauses when Folevi
  // leaves the screen, rather than filling with silence, and goes on when it's back.
  const latest = useRef({ pause, resume });
  latest.current = { pause, resume };
  const pausedAway = useRef(false);
  useEffect(() => {
    if (!inIosApp()) return;
    const onVisibility = () => {
      const state = recorder.current?.state;
      if (document.hidden && state === "recording") {
        pausedAway.current = true;
        latest.current.pause();
      } else if (!document.hidden && pausedAway.current) {
        pausedAway.current = false;
        if (state === "paused") {
          latest.current.resume();
          toast.show("The recording paused while Folevi was in the background. It’s recording again.");
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [toast]);
  const save = () => {
    const rec = recorder.current;
    if (!rec || rec.state === "inactive") return;
    clock.current = { total: now(), since: 0 };
    requested.current = true;
    setPhase({ kind: "saving" });
    rec.stop();
  };
  const cancel = () => {
    discard.current = true;
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    release();
    onClose();
  };

  const live = phase.kind === "recording" || phase.kind === "paused";
  const stopped = phase.kind === "stopped" ? phase : null;
  // Leaving the page would lose audio that isn't in the note yet: the browser asks first.
  const unsaved = live || phase.kind === "saving" || phase.kind === "stopped";
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);
  return (
    <div
      className="grid gap-3 p-2.5 text-sm"
      onKeyDown={(e) => {
        // Escape only closes before anything is recorded, so a stray key can't throw a recording away.
        if (e.key === "Escape" && !unsaved) {
          e.preventDefault();
          e.stopPropagation();
          cancel();
        }
      }}
    >
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className={`grid size-8 flex-none place-items-center rounded-chip ${phase.kind === "recording" ? "bg-[color-mix(in_oklab,#e5484d_16%,transparent)] text-[#e5484d]" : "bg-sunken text-muted"}`}
        >
          {source === "call" ? <PhoneCall size={16} /> : <Mic size={16} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-heading">
            {phase.kind === "choose"
              ? "Record audio"
              : phase.kind === "asking"
              ? source === "call"
                ? "Waiting for the call’s sound…"
                : "Waiting for the microphone…"
              : phase.kind === "paused"
                ? "Paused"
                : phase.kind === "saving"
                  ? "Saving…"
                  : phase.kind === "stopped"
                    ? "Recording stopped"
                    : phase.kind === "error"
                    ? "Can’t record"
                    : source === "call"
                      ? "Recording the call"
                      : "Recording"}
          </p>
          {unsaved ? (
            <p className="text-xs tabular-nums text-muted" aria-live="off">
              {formatDuration(elapsed / 1000)}
              <span className="text-faint"> / {formatDuration(MAX_RECORDING_MS / 1000)}</span>
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={cancel}
          aria-label={live || stopped ? "Cancel and discard the recording" : "Close"}
          title={live || stopped ? "Discard" : "Close"}
          className="grid size-8 flex-none place-items-center rounded-chip text-muted hover:bg-[var(--glass-hover)] hover:text-heading"
        >
          <X size={15} aria-hidden />
        </button>
      </div>

      {phase.kind === "choose" ? (
        <div className="grid gap-2">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Record from">
            <button
              type="button"
              onClick={() => void begin("mic")}
              aria-label="Microphone"
              className="ui-btn ui-btn-secondary h-auto flex-col gap-0.5 whitespace-normal rounded-control px-3 py-2.5 text-center text-[13px]"
            >
              <Mic size={16} aria-hidden className="mb-0.5" />
              <span>Microphone</span>
              <span className="text-[11.5px] font-normal text-muted">Voice notes and memos</span>
            </button>
            <button
              type="button"
              onClick={() => void begin("call")}
              aria-label={windows ? "Call (mic and PC sound)" : "Call (mic and Mac sound)"}
              className="ui-btn ui-btn-secondary h-auto flex-col gap-0.5 whitespace-normal rounded-control px-3 py-2.5 text-center text-[13px]"
            >
              <PhoneCall size={16} aria-hidden className="mb-0.5" />
              <span>Call</span>
              <span className="text-[11.5px] font-normal text-muted">Your mic and {windows ? "this PC’s" : "this Mac’s"} sound</span>
            </button>
          </div>
          <p className="text-xs text-muted">
            A call recording has your microphone and everything {deviceName(windows ? "windows" : "mac")} plays. Let everyone on the call know you’re recording.
          </p>
        </div>
      ) : phase.kind === "error" ? (
        <div className="grid gap-2">
          <p className="rounded-control bg-danger-soft px-3 py-2 text-[13px] text-danger" role="alert">
            {phase.message}
          </p>
          {phase.settings && desktop()?.openSystemSettings ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => desktop()?.openSystemSettings?.("screen-recording")}
                className="ui-btn ui-btn-secondary h-9 px-3 text-[13px]"
              >
                Open System Settings
              </button>
              <button
                type="button"
                onClick={() => void begin("call")}
                className="ui-btn ui-btn-ghost ml-auto h-9 px-3 text-[13px]"
              >
                Try again
              </button>
            </div>
          ) : null}
        </div>
      ) : stopped ? (
        <p className="rounded-control bg-sunken px-3 py-2 text-[13px] text-ink" role="alert">
          {stopped.message}
        </p>
      ) : (
        <div
          className="flex h-10 items-center gap-[3px] rounded-control bg-sunken px-2.5"
          aria-hidden
        >
          {levels.map((level, i) => (
            <span
              key={i}
              className={`w-full rounded-chip transition-[height] duration-75 ${phase.kind === "recording" ? "bg-[#e5484d]" : "bg-line-strong"}`}
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
      {stopped ? (
        <div className="flex items-center gap-2">
          <button type="button" onClick={cancel} className="ui-btn ui-btn-secondary h-9 px-3 text-[13px]">
            Discard
          </button>
          <button
            type="button"
            onClick={() => void store(stopped.file, stopped.seconds)}
            className="ui-btn ui-btn-primary ml-auto h-9 px-3.5 text-[13px]"
          >
            Save recording
          </button>
        </div>
      ) : null}
      {live ? (
        <p className="text-xs text-muted">
          {source === "call" ? "Let everyone on the call know you’re recording. " : ""}
          The recording is added to this note when you save. It counts towards your storage.
        </p>
      ) : null}
    </div>
  );
}
