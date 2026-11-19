// @vitest-environment jsdom
// Dragging a block with a finger (blockDrag.ts): a touch the system takes away puts the block back, and a drag
// always ends, also when the grip that was pressed has left the page (it is taken away while a block is dragged,
// and a touch's events only go to the element it began on).
import { afterEach, describe, expect, test, vi } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { ALL_MARKS, ALL_NODES } from "@/components/editor/extensions";
import { BlockIdentity, BlockKeymap } from "@/components/editor/plugins";
import { beginPointerDrag, isDragging } from "@/components/editor/blockDrag";

const p = (id: string, text: string): JSONContent => ({ type: "paragraph", attrs: { id, depth: 0 }, content: [{ type: "text", text }] });

function setUp() {
  const e = new Editor({ extensions: [...ALL_NODES, ...ALL_MARKS, UndoRedo, BlockIdentity, BlockKeymap], content: { type: "doc", content: [p("a", "one"), p("b", "two"), p("c", "three")] } });
  document.body.appendChild(e.view.dom);
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }));
  if (!("CSS" in globalThis)) vi.stubGlobal("CSS", { escape: (s: string) => s });
  const grip = document.createElement("button");
  document.body.appendChild(grip);
  const onDrop = vi.fn(() => null);
  const onEnd = vi.fn();
  const press = () =>
    beginPointerDrag({ editor: e, payload: { kind: "block", index: 0 }, event: { button: 0, pointerType: "touch", clientX: 10, clientY: 10, target: grip } as unknown as PointerEvent, onDrop, onEnd, liftAt: { x: 10, y: 10 } });
  return { e, grip, onDrop, onEnd, press, frame: () => frames.splice(0).forEach((cb) => cb(0)) };
}
const touch = (type: string, x = 12, y = 60) => Object.assign(new Event(type, { bubbles: true, cancelable: true }), { touches: type === "touchmove" ? [{ clientX: x, clientY: y }] : [], changedTouches: [{ clientX: x, clientY: y }] });

describe("dragging a block with a finger", () => {
  afterEach(() => {
    // (Any drag a failing test left running.)
    window.dispatchEvent(touch("touchcancel"));
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  test("a touch the system takes away puts the block back: nothing is dropped", () => {
    const { e, onDrop, onEnd, press, frame } = setUp();
    press();
    frame();
    expect(isDragging()).toBe(true);
    window.dispatchEvent(touch("touchmove"));
    frame();
    window.dispatchEvent(touch("touchcancel"));
    expect(onDrop).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledExactlyOnceWith(false);
    expect(isDragging()).toBe(false);
    expect(document.documentElement.classList.contains("fb-dragging")).toBe(false);
    e.destroy();
  });

  test("the drag ends when the finger lifts after the grip it began on has left the page", () => {
    const { e, grip, onEnd, press, frame } = setUp();
    press();
    frame();
    // The grip is taken away while a block is dragged: the rest of the touch's events go to it, not the page.
    grip.remove();
    grip.dispatchEvent(touch("touchmove"));
    frame();
    grip.dispatchEvent(touch("touchend"));
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(isDragging()).toBe(false);
    e.destroy();
  });

  test("a new press while a finger drag never got its end calls it off, and the next one starts", () => {
    const { e, onEnd, press, frame } = setUp();
    press();
    frame();
    expect(isDragging()).toBe(true);
    // No touchend ever came. The person presses the grip again.
    press();
    expect(isDragging()).toBe(false);
    expect(onEnd).toHaveBeenCalledExactlyOnceWith(false);
    press();
    expect(isDragging()).toBe(true);
    window.dispatchEvent(touch("touchcancel"));
    e.destroy();
  });
});
