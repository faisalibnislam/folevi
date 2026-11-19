// The audio recorder's limits and interruptions (components/editor/AudioRecorder.tsx), with a stand-in
// MediaRecorder: a recording stops at its longest even when the page gets no animation frames (a hidden tab),
// one too large for the server is never handed to the note, a microphone that goes quiet pauses the recording
// rather than filling it with silence, and WebKit is asked for MP4 first.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toast = { show: vi.fn() };
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toast, errorMessage: () => "Something went wrong. Please try again." }));

const { AudioRecorder, MAX_RECORDING_BYTES, MIC_INTERRUPT_GRACE_MS, recordingFull, recordingProblem, recordingType, MAX_RECORDING_MS } = await import("@/components/editor/AudioRecorder");

class FakeRecorder {
  static made: FakeRecorder[] = [];
  static isTypeSupported = () => true;
  state: "inactive" | "recording" | "paused" = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: unknown, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? "audio/webm";
    FakeRecorder.made.push(this);
  }
  start() {
    this.state = "recording";
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.onstop?.();
  }
  /** A second of sound arriving: only its size matters here. */
  piece(size: number) {
    this.ondataavailable?.({ data: { size } as Blob });
  }
}

class FakeAudioContext {
  createAnalyser = () => ({ fftSize: 0, getByteTimeDomainData: () => undefined });
  createMediaStreamSource = () => ({ connect: () => undefined });
  resume = () => Promise.resolve();
  close = () => Promise.resolve();
}

let track: EventTarget & { stop(): void };
let root: Root | null = null;
let clock = 0;
const onSave = vi.fn<(file: File, seconds: number) => Promise<void>>(async () => undefined);
const onClose = vi.fn();

async function open(): Promise<FakeRecorder> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<AudioRecorder onSave={onSave} onClose={onClose} />));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  const rec = FakeRecorder.made[FakeRecorder.made.length - 1];
  expect(rec?.state).toBe("recording");
  return rec!;
}

const heading = () => document.body.querySelector("p.font-medium")?.textContent;

beforeEach(() => {
  FakeRecorder.made = [];
  clock = 1000;
  onSave.mockClear();
  onClose.mockClear();
  toast.show.mockClear();
  track = Object.assign(new EventTarget(), { stop: () => undefined });
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => stream } });
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  // A page in the background: no animation frame ever comes.
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the recorder's limits hold without animation frames (a hidden tab)", () => {
  test("the limits themselves", () => {
    expect(recordingFull(0, 0)).toBe(false);
    expect(recordingFull(MAX_RECORDING_MS, 0)).toBe(true);
    expect(recordingFull(0, MAX_RECORDING_BYTES)).toBe(true);
  });

  test("past the size limit the recording stops and is saved, as each piece arrives", async () => {
    const rec = await open();
    await act(async () => rec.piece(MAX_RECORDING_BYTES - 10));
    expect(rec.state).toBe("recording");
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => rec.piece(4000));
    expect(rec.state).toBe("inactive");
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("past the length limit too", async () => {
    const rec = await open();
    clock += MAX_RECORDING_MS + 1;
    await act(async () => rec.piece(4000));
    expect(rec.state).toBe("inactive");
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  test("a recording the server would refuse is never handed to the note: it's offered as a download", async () => {
    expect(recordingProblem({ size: 51 * 1024 * 1024 })).toMatch(/too large/);
    expect(recordingProblem({ size: 49 * 1024 * 1024 })).toBeNull();
    const rec = await open();
    // A recorder that wrote far more than it was asked to, in one piece: over what the server takes.
    const big = new Blob([new Uint8Array(51 * 1024 * 1024)]);
    await act(async () => rec.ondataavailable?.({ data: big }));
    expect(rec.state).toBe("inactive");
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(heading()).toBe("Recording stopped");
    expect(document.body.textContent).toMatch(/too large to add to a note/);
    const buttons = [...document.body.querySelectorAll("button")].map((b) => b.textContent?.trim());
    expect(buttons).toContain("Download");
    expect(buttons).not.toContain("Save recording");
  });
});

describe("a microphone that goes quiet", () => {
  test("pauses the recording, and it goes on when the microphone is back: the gap isn't counted", async () => {
    const rec = await open();
    clock += 4000;
    await act(async () => void track.dispatchEvent(new Event("mute")));
    expect(rec.state).toBe("paused");
    expect(heading()).toBe("Microphone interrupted");
    clock += 30_000;
    await act(async () => void track.dispatchEvent(new Event("unmute")));
    expect(rec.state).toBe("recording");
    expect(heading()).toBe("Recording");
    clock += 1000;
    const save = [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes("Stop and save"))!;
    await act(async () => save.click());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]![1]).toBeCloseTo(5, 1);
  });

  test("one that stays away is stopped, with what was recorded kept for Save", async () => {
    vi.useFakeTimers();
    const rec = await open();
    await act(async () => void track.dispatchEvent(new Event("mute")));
    expect(rec.state).toBe("paused");
    await act(async () => void vi.advanceTimersByTime(MIC_INTERRUPT_GRACE_MS + 10));
    expect(rec.state).toBe("inactive");
    expect(heading()).toBe("Recording stopped");
    expect(onSave).not.toHaveBeenCalled();
    expect([...document.body.querySelectorAll("button")].map((b) => b.textContent?.trim())).toContain("Save recording");
  });
});

describe("the container asked for", () => {
  test("WebKit records MP4 first even where it says it can record WebM; other browsers keep WebM", () => {
    expect(recordingType(() => true, true)).toBe("audio/mp4");
    expect(recordingType(() => true, false)).toBe("audio/webm;codecs=opus");
    // An engine with no MP4 recorder at all still gets what it has.
    expect(recordingType((t) => t.startsWith("audio/webm"), true)).toBe("audio/webm;codecs=opus");
    expect(recordingType(() => false, true)).toBeUndefined();
  });
});
