// Recording a call in the Mac app (lib/callCapture.ts): offered only by a Mac app that says it can, what a
// failed capture tells the person, and the microphone and this Mac's sound mixed into one stream.
import { describe, expect, test, vi } from "vitest";
import { CALL_PERMISSION, callProblem, canRecordCalls, mixAudio, type Mixer } from "@/lib/callCapture";

describe("recording a call", () => {
  test("offered only in a Mac app that has call capture (older installed apps and browsers record the microphone)", () => {
    expect(canRecordCalls({ platform: "mac", callCapture: true })).toBe(true);
    expect(canRecordCalls({ platform: "mac" })).toBe(false);
    expect(canRecordCalls({ platform: "mac", callCapture: "yes" as unknown as boolean })).toBe(false);
    expect(canRecordCalls(null)).toBe(false);
  });

  test("the Windows app records calls too (everything the PC plays); a failure there never points to a Mac setting", () => {
    expect(canRecordCalls({ platform: "windows", callCapture: true })).toBe(true);
    expect(canRecordCalls({ platform: "windows" })).toBe(false);
    for (const name of ["NotAllowedError", "AbortError", "NoSystemAudio", "NotFoundError"]) {
      expect(callProblem(new DOMException("x", name), "windows")).toEqual({ message: expect.stringMatching(/couldn’t be recorded.*microphone only/), settings: false });
    }
  });

  test("a refused or silent capture points to the Screen & System Audio Recording permission; anything else says so plainly", () => {
    for (const name of ["NotAllowedError", "AbortError", "NotReadableError", "SecurityError", "NoSystemAudio"]) {
      expect(callProblem(new DOMException("x", name))).toEqual({ message: CALL_PERMISSION, settings: true });
    }
    expect(CALL_PERMISSION).toBe("Folevi needs Screen & System Audio Recording permission to hear the call. Turn it on in System Settings > Privacy & Security, then try again.");
    expect(callProblem(new DOMException("x", "NotFoundError"))).toEqual({ message: expect.stringMatching(/couldn’t be recorded.*microphone only/), settings: false });
    expect(callProblem("boom").settings).toBe(false);
  });

  test("the microphone and this Mac's sound go into one destination, which is what's recorded; the meter hears both", () => {
    const mixed = { id: "mixed" } as unknown as MediaStream;
    const destination = { stream: mixed };
    const sources: { stream: MediaStream; connect: ReturnType<typeof vi.fn> }[] = [];
    const ctx = {
      createMediaStreamDestination: vi.fn(() => destination),
      createMediaStreamSource: vi.fn((stream: MediaStream) => {
        const source = { stream, connect: vi.fn() };
        sources.push(source);
        return source;
      }),
    } as unknown as Mixer;
    const mic = { id: "mic" } as unknown as MediaStream;
    const mac = { id: "mac" } as unknown as MediaStream;
    const meter = { id: "meter" } as unknown as AudioNode;
    expect(mixAudio(ctx, [mic, mac], meter)).toBe(mixed);
    expect(sources.map((s) => s.stream)).toEqual([mic, mac]);
    for (const s of sources) {
      expect(s.connect).toHaveBeenCalledWith(destination);
      expect(s.connect).toHaveBeenCalledWith(meter);
    }
  });
});
