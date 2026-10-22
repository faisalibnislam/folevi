// Recording a call in the Mac app: the microphone and everything this Mac plays, mixed into one recording.
// - The Electron app (apps/desktop): the page asks for the screen with sound (getDisplayMedia); the app answers
//   with the whole screen and its system audio ("loopback"), the recorder drops the picture at once, keeping only
//   the sound, and mixes it with the microphone here (mixAudio).
// - The native Mac app (apps/mac): WebKit's getDisplayMedia has no system sound, so the app records and mixes
//   both itself (CallRecorder.swift) and hands the finished recording over (foleviDesktop.recordCall, used through
//   NativeCallRecording below, shaped like the parts of MediaRecorder the recorder panel uses).
// macOS asks for Screen & System Audio Recording permission the first time. In a browser, or in a Mac app from
// before call capture (no `callCapture` on its bridge), only the microphone is offered.
import type { DesktopBridge } from "./desktop";
import { macDesktop, type MacDesktop, type NativeCallRecorder } from "./desktop/capabilities";

/** Where a recording's sound comes from: the microphone, or a call (the microphone and this Mac's sound). */
export type RecordingSource = "mic" | "call";

/** Whether calls can be recorded here: only in a Mac app that says it can. */
export function canRecordCalls(bridge: Pick<DesktopBridge, "platform" | "callCapture"> | null): boolean {
  return Boolean(bridge && bridge.platform === "mac" && bridge.callCapture === true);
}

export const CALL_PERMISSION =
  "Folevi needs Screen & System Audio Recording permission to hear the call. Turn it on in System Settings > Privacy & Security, then try again.";
const CALL_FAILED = "The call’s sound couldn’t be recorded. Try again, or record from the microphone only.";

/**
 * What went wrong getting this Mac's sound, as a sentence, and whether System Settings would fix it. A
 * refusal (or a capture that can't start, which is how macOS answers without the permission) points to
 * the permission; so does a capture that came back without any sound.
 */
export function callProblem(error: unknown): { message: string; settings: boolean } {
  const name = error instanceof DOMException ? error.name : error instanceof Error ? error.name : "";
  if (["NotAllowedError", "SecurityError", "NotReadableError", "AbortError", "NoSystemAudio"].includes(name)) return { message: CALL_PERMISSION, settings: true };
  return { message: CALL_FAILED, settings: false };
}

/** The parts of an AudioContext mixing needs (a test passes its own). */
export type Mixer = Pick<AudioContext, "createMediaStreamSource" | "createMediaStreamDestination">;

/**
 * Mixes the sound of several streams into one: each goes into a single destination, whose stream is what
 * gets recorded. `also` hears every stream too (the level meter).
 */
export function mixAudio(ctx: Mixer, streams: MediaStream[], also?: AudioNode): MediaStream {
  const destination = ctx.createMediaStreamDestination();
  for (const stream of streams) {
    const source = ctx.createMediaStreamSource(stream);
    source.connect(destination);
    if (also) source.connect(also);
  }
  return destination.stream;
}

/**
 * Whether the recorder offers calls: a Mac app that can capture them, either natively (the native Mac app) or
 * through getDisplayMedia (the Electron app).
 */
export function callRecordingAvailable(
  bridge: Pick<MacDesktop, "platform" | "callCapture" | "recordCall"> | null = macDesktop(),
  displayMedia = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia),
): boolean {
  return canRecordCalls(bridge) && (Boolean(bridge?.recordCall) || displayMedia);
}

/** The native Mac app's recorder, when it records calls itself. */
export function nativeCallRecorder(bridge: Pick<MacDesktop, "platform" | "callCapture" | "recordCall"> | null = macDesktop()): NativeCallRecorder | null {
  return canRecordCalls(bridge) && bridge?.recordCall ? bridge.recordCall : null;
}

const MIC_REFUSED = "Folevi can’t use your microphone. Allow it in System Settings > Privacy & Security > Microphone, then try again.";

/** What a native recording that couldn't start tells the person, and whether System Settings would fix it. */
export function nativeCallProblem(error: unknown): { message: string; settings: boolean } {
  const e = error && typeof error === "object" ? (error as { code?: unknown; message?: unknown }) : {};
  if (e.code === "permission") return { message: CALL_PERMISSION, settings: true };
  if (e.code === "microphone") return { message: typeof e.message === "string" && e.message ? e.message.replace(/'/g, "’") : MIC_REFUSED, settings: false };
  if (e.code === "busy") return { message: "Folevi is already recording a call in another window.", settings: false };
  return { message: CALL_FAILED, settings: false };
}

/**
 * A call recorded by the native Mac app, shaped like the parts of MediaRecorder the recorder panel uses: `state`,
 * pause, resume and stop (the whole recording comes in one ondataavailable, then onstop), plus `level()` for the
 * meter. A recording that ends on its own (sharing stopped) stops as a MediaRecorder whose track ended would;
 * `discard()` throws it away (onstop still comes, with no data).
 */
export class NativeCallRecording {
  state: "inactive" | "recording" | "paused" = "inactive";
  readonly mimeType = "audio/mp4";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  private latest = 0;
  private stops: (() => void)[] = [];

  constructor(private readonly native: NativeCallRecorder) {}

  /** Starts; rejects as the app refused (nativeCallProblem says it in words). */
  async start(): Promise<void> {
    await this.native.start();
    this.state = "recording";
    this.stops.push(
      this.native.onLevel((level) => {
        this.latest = level;
      }),
      this.native.onEnded(() => {
        if (this.state !== "inactive") this.stop();
      }),
    );
  }

  /** The meter's level now (0 while paused). */
  level(): number {
    return this.state === "recording" ? this.latest : 0;
  }

  pause() {
    if (this.state !== "recording") return;
    this.state = "paused";
    this.native.pause();
  }

  resume() {
    if (this.state !== "paused") return;
    this.state = "recording";
    this.native.resume();
  }

  stop() {
    if (!this.finish()) return;
    void this.native.stop().then(
      (r) => {
        if (r) this.ondataavailable?.({ data: r.blob });
        this.onstop?.();
      },
      () => this.onstop?.(),
    );
  }

  discard() {
    if (!this.finish()) return;
    this.native.cancel();
    this.onstop?.();
  }

  private finish(): boolean {
    if (this.state === "inactive") return false;
    this.state = "inactive";
    this.stops.forEach((s) => s());
    this.stops = [];
    return true;
  }
}
