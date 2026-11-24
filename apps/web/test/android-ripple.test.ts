import { afterEach, describe, expect, test, vi } from "vitest";
import { installPressRipple, pressTarget } from "@/lib/android/ripple";

// Android's press ripple (the owner's light Android touches, 2026-11-24): over Folevi's controls only, drawn in a
// layer of its own, gone after the finger lifts, and never with Reduce Motion.

const press = (el: Element, type: string) => el.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { pointerType: "touch", button: 0, clientX: 10, clientY: 10 }));
const hosts = () => document.querySelectorAll(".ui-ripple-host");

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("press ripple", () => {
  test("ripples on controls, not on text or inside a note", () => {
    document.body.innerHTML = `<button id="b">Go</button><p id="p">Text</p><div class="ProseMirror"><a id="l" href="/x">link</a></div><button id="d" disabled>No</button>`;
    expect(pressTarget(document.getElementById("b"))?.id).toBe("b");
    expect(pressTarget(document.getElementById("p"))).toBeNull();
    expect(pressTarget(document.getElementById("l"))).toBeNull();
    expect(pressTarget(document.getElementById("d"))).toBeNull();
  });

  test("a layer appears on press, leaves the control untouched and goes after the lift", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    document.body.innerHTML = `<button id="b" style="color: rgb(10, 20, 30)">Go</button>`;
    const b = document.getElementById("b")!;
    const stop = installPressRipple();
    press(b, "pointerdown");
    expect(hosts()).toHaveLength(1);
    expect(b.children).toHaveLength(0);
    expect(b.getAttribute("style")).toBe("color: rgb(10, 20, 30)");
    press(b, "pointerup");
    vi.advanceTimersByTime(600);
    expect(hosts()).toHaveLength(0);
    stop();
  });

  test("no ripple with Reduce Motion", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }));
    document.body.innerHTML = `<button id="b">Go</button>`;
    const stop = installPressRipple();
    press(document.getElementById("b")!, "pointerdown");
    expect(hosts()).toHaveLength(0);
    stop();
  });
});
