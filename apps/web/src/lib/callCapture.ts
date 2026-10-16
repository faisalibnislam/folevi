// Recording a call in the Mac app (apps/desktop): the microphone and everything this Mac plays, mixed into
// one recording. The page asks for the screen with sound (getDisplayMedia); the Mac app answers with the
// whole screen and its system audio ("loopback"), and the recorder drops the picture at once, keeping only
// the sound. macOS asks for Screen & System Audio Recording permission the first time. In a browser, or in
// a Mac app from before call capture (no `callCapture` on its bridge), only the microphone is offered.
import type { DesktopBridge } from "./desktop";

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
