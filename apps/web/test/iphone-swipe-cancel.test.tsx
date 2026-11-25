import { afterEach, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SwipeRow } from "@/components/iphone/Swipe";

vi.mock("@/lib/native/ui", () => ({ feel: vi.fn(), prepareFeel: vi.fn() }));
let root: Root;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = "";
});

async function setup() {
  const action = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<SwipeRow trailing={[{ label: "Delete", icon: null, tone: "red", danger: true, onAction: action }]}><span>Note</span></SwipeRow>));
  const row = host.firstElementChild as HTMLElement;
  Object.defineProperty(row, "offsetWidth", { value: 300 });
  // Fingers as Pointer Events (what the row listens to): `xs` are the fingers down after this event, the first
  // finger is pointer 1, a second one pointer 2.
  let down: number[] = [];
  const pointer = async (type: string, id: number, x: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: "touch" }, clientX: { value: x }, clientY: { value: 10 }, isPrimary: { value: id === 1 } });
    await act(async () => { row.dispatchEvent(event); });
  };
  const touch = async (type: string, xs: number[]) => {
    if (type === "touchstart") {
      for (let i = down.length; i < xs.length; i++) await pointer("pointerdown", i + 1, xs[i]!);
    } else if (type === "touchmove") {
      for (let i = 0; i < xs.length; i++) await pointer("pointermove", i + 1, xs[i]!);
    } else if (type === "touchend") {
      for (let i = 0; i < down.length; i++) await pointer("pointerup", i + 1, 0);
    } else if (type === "touchcancel") {
      for (let i = 0; i < down.length; i++) await pointer("pointercancel", i + 1, 0);
    }
    down = type === "touchend" || type === "touchcancel" ? [] : xs;
  };
  return { action, touch, row };
}

test("an interrupted full swipe never performs its destructive action", async () => {
  const { action, touch, row } = await setup();
  await touch("touchstart", [290]);
  await touch("touchmove", [20]);
  await touch("touchcancel", []);
  expect(action).not.toHaveBeenCalled();
  expect(row.querySelector("[data-swipe-actions]")).toBeNull();
});

test("a second finger cancels the swipe instead of completing it", async () => {
  const { action, touch } = await setup();
  await touch("touchstart", [290]);
  await touch("touchmove", [20]);
  await touch("touchstart", [20, 100]);
  await touch("touchend", []);
  expect(action).not.toHaveBeenCalled();
});

test("an intentional full swipe still performs the action once", async () => {
  const { action, touch } = await setup();
  await touch("touchstart", [290]);
  await touch("touchmove", [20]);
  await touch("touchend", []);
  expect(action).toHaveBeenCalledTimes(1);
});

test("a vertical drag is the list's scroll, never a swipe", async () => {
  const { action, touch, row } = await setup();
  expect(row.style.touchAction).toContain("pan-y");
  const vertical = new Event("pointermove", { bubbles: true });
  await touch("touchstart", [150]);
  Object.defineProperties(vertical, { pointerId: { value: 1 }, pointerType: { value: "touch" }, clientX: { value: 152 }, clientY: { value: 80 } });
  await act(async () => { row.dispatchEvent(vertical); });
  await touch("touchmove", [10]);
  await touch("touchend", []);
  expect(action).not.toHaveBeenCalled();
  expect(row.querySelector("[data-swipe-actions]")).toBeNull();
});
