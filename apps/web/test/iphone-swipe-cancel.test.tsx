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
  const touch = async (type: string, xs: number[]) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "touches", { value: xs.map((x) => ({ clientX: x, clientY: 10 })) });
    await act(async () => { row.dispatchEvent(event); });
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
