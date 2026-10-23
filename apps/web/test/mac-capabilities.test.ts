// The native Mac app's capabilities on the page (lib/desktop/capabilities.ts, lib/callCapture.ts): which app
// commands the page answers, a note from text, and a call recorded by the app shaped like a MediaRecorder.
import { describe, expect, test, vi } from "vitest";
import { asCapabilityCommand, noteFromText, type NativeCallRecorder } from "@/lib/desktop/capabilities";
import { CALL_PERMISSION, NativeCallRecording, callRecordingAvailable, nativeCallProblem, nativeCallRecorder } from "@/lib/callCapture";

describe("the app's commands", () => {
  test("only well-formed capability commands are answered", () => {
    expect(asCapabilityCommand({ type: "share", id: "a1" })).toEqual({ type: "share", id: "a1" });
    expect(asCapabilityCommand({ type: "add-task", id: "a1", text: "Milk", dueDate: "2026-10-24" })).toMatchObject({ type: "add-task" });
    expect(asCapabilityCommand({ type: "add-task", id: "a1", text: "Milk", dueDate: "tomorrow" })).toBeNull();
    expect(asCapabilityCommand({ type: "new-note-with-text", id: "a1" })).toBeNull();
    expect(asCapabilityCommand({ type: "print" })).toBeNull();
    expect(asCapabilityCommand({ type: "navigate", path: "/" })).toBeNull();
    expect(asCapabilityCommand(null)).toBeNull();
  });

  test("a note from text: the first line is its title", () => {
    expect(noteFromText("Groceries\nMilk\nEggs")).toEqual({ title: "Groceries", body: "Milk\nEggs" });
    expect(noteFromText("# Heading\r\nBody")).toEqual({ title: "Heading", body: "Body" });
    expect(noteFromText("  Just a line  ")).toEqual({ title: "Just a line", body: "" });
    const long = "word ".repeat(40).trim();
    expect(noteFromText(long)).toEqual({ title: long.slice(0, 80).trim(), body: long });
    expect(noteFromText("   ").title).toBe("Untitled");
  });
});

function fakeRecorder() {
  let level: ((l: number) => void) | null = null;
  let ended: ((r: string) => void) | null = null;
  const blob = new Blob(["m4a"], { type: "audio/mp4" });
  const native: NativeCallRecorder = {
    start: vi.fn(async () => true as const),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(async () => ({ blob, seconds: 3 })),
    cancel: vi.fn(),
    onLevel: (cb) => ((level = cb), () => (level = null)),
    onEnded: (cb) => ((ended = cb), () => (ended = null)),
  };
  return { native, blob, level: (l: number) => level?.(l), end: () => ended?.("sharing") };
}

describe("a call recorded by the native Mac app", () => {
  test("offered only when the app records calls itself", () => {
    const { native } = fakeRecorder();
    expect(callRecordingAvailable({ platform: "mac", callCapture: true, recordCall: native })).toBe(true);
    expect(callRecordingAvailable({ platform: "mac", callCapture: true })).toBe(false);
    expect(callRecordingAvailable({ platform: "mac", recordCall: native })).toBe(false);
    expect(callRecordingAvailable(null)).toBe(false);
    expect(nativeCallRecorder({ platform: "mac", callCapture: true, recordCall: native })).toBe(native);
    expect(nativeCallRecorder({ platform: "mac", callCapture: true })).toBeNull();
  });

  test("starts, pauses, resumes and hands the whole recording over on stop", async () => {
    const f = fakeRecorder();
    const rec = new NativeCallRecording(f.native);
    const data = vi.fn();
    const stopped = vi.fn();
    rec.ondataavailable = data;
    rec.onstop = stopped;
    await rec.start();
    expect(rec.state).toBe("recording");
    f.level(0.5);
    expect(rec.level()).toBe(0.5);
    rec.pause();
    expect(rec.state).toBe("paused");
    expect(rec.level()).toBe(0);
    expect(f.native.pause).toHaveBeenCalled();
    rec.resume();
    expect(f.native.resume).toHaveBeenCalled();
    rec.stop();
    rec.stop();
    await vi.waitFor(() => expect(stopped).toHaveBeenCalledTimes(1));
    expect(data).toHaveBeenCalledWith({ data: f.blob });
    expect(f.native.stop).toHaveBeenCalledTimes(1);
  });

  test("a recording that ends on its own stops; a discarded one is thrown away by the app", async () => {
    const f = fakeRecorder();
    const rec = new NativeCallRecording(f.native);
    const stopped = vi.fn();
    rec.onstop = stopped;
    await rec.start();
    f.end();
    await vi.waitFor(() => expect(stopped).toHaveBeenCalled());
    expect(rec.state).toBe("inactive");

    const g = fakeRecorder();
    const other = new NativeCallRecording(g.native);
    const data = vi.fn();
    other.ondataavailable = data;
    await other.start();
    other.discard();
    expect(g.native.cancel).toHaveBeenCalled();
    expect(g.native.stop).not.toHaveBeenCalled();
    expect(data).not.toHaveBeenCalled();
  });

  test("what a refusal tells the person", () => {
    expect(nativeCallProblem({ code: "permission", message: "x" })).toEqual({ message: CALL_PERMISSION, settings: true });
    expect(nativeCallProblem({ code: "microphone", message: "Folevi can't use your microphone." })).toEqual({ message: "Folevi can’t use your microphone.", settings: false });
    expect(nativeCallProblem({ code: "busy" }).message).toMatch(/another window/);
    expect(nativeCallProblem(new Error("x")).settings).toBe(false);
  });
});
