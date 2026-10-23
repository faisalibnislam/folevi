// Recording a call in the Mac app (lib/callCapture.ts): offered only by a Mac app that says it can. The native
// recorder itself is in mac-capabilities.test.ts.
import { describe, expect, test } from "vitest";
import { canRecordCalls } from "@/lib/callCapture";

describe("recording a call", () => {
  test("offered only in a Mac app that has call capture (older installed apps and browsers record the microphone)", () => {
    expect(canRecordCalls({ platform: "mac", callCapture: true })).toBe(true);
    expect(canRecordCalls({ platform: "mac" })).toBe(false);
    expect(canRecordCalls({ platform: "mac", callCapture: "yes" as unknown as boolean })).toBe(false);
    expect(canRecordCalls(null)).toBe(false);
  });
});
