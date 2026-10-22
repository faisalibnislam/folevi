// lib/native/ui.ts and lib/native/lift.ts: each wrapper uses the app's piece when the bridge has it and
// Folevi's own version when it doesn't (the website, an older app), and the lifted preview's three steps reach
// the app in order from a real hold (lib/touchContextMenu.ts).
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { askText, chooseAction, confirmAction, feel, hasNative, onKeyboardFrame, pickColor, pickDate, prepareFeel, screenRect, shareContent } from "@/lib/native/ui";
import { installTouchContextMenu } from "@/lib/touchContextMenu";
import type { NativeBridge, NativeKeyboardFrame } from "@/lib/nativeApp";

type Call = { method: string; arg?: unknown };

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
// jsdom has no modal dialogs.
Object.assign(HTMLDialogElement.prototype, {
  showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  },
  close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  },
});

/** Waits (real time) until `find` gives something. */
async function eventually<T>(find: () => T | null | undefined, ms = 3000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const found = find();
    if (found) return found;
    if (Date.now() > until) throw new Error("not found in time");
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** The newest dialog's button named `name` (one being taken away may still be there for a moment). */
const button = (name: string) => eventually(() => [...document.querySelectorAll("button")].reverse().find((b) => b.textContent?.trim() === name && !b.disabled));
const click = async (name: string) => (await button(name)).click();

/** Types into a React-controlled field. */
function type(field: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function installBridge(extra: Partial<NativeBridge> & Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const record =
    (method: string, answer?: unknown) =>
    (arg?: unknown) => {
      calls.push({ method, arg });
      return typeof answer === "function" ? (answer as (a: unknown) => unknown)(arg) : answer;
    };
  const bridge = {
    platform: "ios",
    version: "1.0",
    haptic: record("haptic"),
    setStatusBar: () => undefined,
    openExternal: async () => true,
    getSettings: async () => null,
    setSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }),
    onCommand: () => () => undefined,
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, typeof v === "function" ? (arg: unknown) => (calls.push({ method: k, arg }), (v as (a: unknown) => unknown)(arg)) : v])),
  };
  Object.defineProperty(window, "foleviNative", { value: bridge, configurable: true, writable: true });
  return calls;
}

// (Folevi's own dialogs load on first use; loaded ahead here, as a first import of them takes a while in jsdom.)
beforeAll(async () => {
  await import("@/lib/native/fallbacks");
}, 120_000);

afterEach(() => {
  delete (window as { foleviNative?: unknown }).foleviNative;
  document.body.innerHTML = "";
});

describe("haptics", () => {
  test("moments map to the generator §2.5 names, and an older app gets the nearest kind it knows", () => {
    let calls = installBridge({ hapticPrepare: () => undefined });
    feel("choose");
    feel("threshold");
    feel("destructive");
    prepareFeel("menu");
    expect(calls).toEqual([
      { method: "haptic", arg: "selection" },
      { method: "haptic", arg: "rigid" },
      { method: "haptic", arg: "warning" },
      { method: "hapticPrepare", arg: "medium" },
    ]);
    calls = installBridge();
    feel("choose");
    feel("threshold");
    feel("land");
    expect(calls.map((c) => c.arg)).toEqual(["light", "medium", "light"]);
  });

  test("nothing happens in a browser", () => {
    expect(() => feel("menu")).not.toThrow();
    expect(hasNative("alert")).toBe(false);
  });
});

describe("alerts and action sheets", () => {
  test("confirmAction: a native alert with Cancel first; destructive confirmations are felt", async () => {
    const calls = installBridge({ alert: async () => ({ id: "confirm" }), hapticPrepare: () => undefined });
    await expect(confirmAction({ title: 'Delete "Ideas"?', message: "Its notes go to the Trash.", confirm: "Delete", destructive: true })).resolves.toBe(true);
    expect(calls[0]).toEqual({
      method: "alert",
      arg: {
        title: 'Delete "Ideas"?',
        message: "Its notes go to the Trash.",
        actions: [
          { id: "cancel", title: "Cancel", style: "cancel" },
          { id: "confirm", title: "Delete", style: "destructive" },
        ],
      },
    });
    expect(calls[1]).toEqual({ method: "haptic", arg: "warning" });
  });

  test("confirmAction as a sheet anchors on iPad, and a dismissed one is false", async () => {
    const calls = installBridge({ actionSheet: async () => null });
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    await expect(confirmAction({ title: "Discard changes?", confirm: "Discard", destructive: true, style: "sheet", anchor })).resolves.toBe(false);
    const arg = calls[0]!.arg as { anchor: unknown; actions: unknown[] };
    expect(calls[0]!.method).toBe("actionSheet");
    expect(arg.anchor).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(arg.actions).toHaveLength(2);
  });

  test("confirmAction without the app: Folevi's dialog, answered by its buttons", async () => {
    const answer = confirmAction({ title: "Sign out?", confirm: "Sign out" });
    await click("Sign out");
    await expect(answer).resolves.toBe(true);
    await eventually(() => !document.querySelector("[data-native-fallback]"));
    const second = confirmAction({ title: "Sign out?", confirm: "Sign out" });
    await click("Cancel");
    await expect(second).resolves.toBe(false);
  });

  test("askText: the alert's text trimmed, empty or cancelled is null", async () => {
    let reply: { id: string; text?: string } | null = { id: "confirm", text: "  Brainstorming  " };
    const calls = installBridge({ alert: async () => reply });
    await expect(askText({ title: "Rename folder", value: "Ideas" })).resolves.toBe("Brainstorming");
    expect((calls[0]!.arg as { field: unknown }).field).toEqual({ value: "Ideas", placeholder: "", capitalize: "sentences" });
    reply = { id: "confirm", text: "   " };
    await expect(askText({ title: "Rename folder" })).resolves.toBeNull();
    reply = null;
    await expect(askText({ title: "Rename folder" })).resolves.toBeNull();
  });

  test("askText without the app: a dialog with the field", async () => {
    const answer = askText({ title: "Rename folder", value: "Ideas", label: "Name" });
    const field = await eventually(() => [...document.querySelectorAll("label")].find((l) => l.textContent === "Name")?.control as HTMLInputElement | undefined);
    expect(field.value).toBe("Ideas");
    type(field, "Plans");
    await click("Save");
    await expect(answer).resolves.toBe("Plans");
  });

  test("chooseAction: the sheet's own Cancel never comes back as a choice", async () => {
    let reply: string | null = "archive";
    const calls = installBridge({ actionSheet: async () => reply });
    const actions = [
      { id: "archive", title: "Archive" },
      { id: "trash", title: "Move to Trash", destructive: true },
    ];
    await expect(chooseAction({ actions })).resolves.toBe("archive");
    const sent = (calls[0]!.arg as { actions: { id: string; style: string }[] }).actions;
    expect(sent.map((a) => a.style)).toEqual(["default", "destructive", "cancel"]);
    reply = sent[2]!.id;
    await expect(chooseAction({ actions })).resolves.toBeNull();
  });

  test("a bridge call that fails falls back to Folevi's dialog", async () => {
    installBridge({ alert: async () => Promise.reject(new Error("no presenter")) });
    const answer = confirmAction({ title: "Leave workspace?", confirm: "Leave" });
    await click("Leave");
    await expect(answer).resolves.toBe(true);
  });
});

describe("pickers and sharing", () => {
  test("pickDate: values of the mode's shape only; cleared only when clearable", async () => {
    let reply: { value: string | null } | null = { value: "2026-10-23" };
    const calls = installBridge({ pickDate: async () => reply });
    await expect(pickDate({ mode: "date", value: "2026-10-22" })).resolves.toEqual({ value: "2026-10-23" });
    expect(calls[0]!.arg).toEqual({ value: "2026-10-22", mode: "date", min: undefined, max: undefined, title: undefined, clearable: false });
    reply = { value: "10:30" };
    await expect(pickDate({ mode: "date" })).resolves.toBeNull();
    reply = { value: null };
    await expect(pickDate({ mode: "time", clearable: true })).resolves.toEqual({ value: null });
    await expect(pickDate({ mode: "time" })).resolves.toBeNull();
  });

  test("pickDate without the app: Folevi's calendar in a dialog", async () => {
    const answer = pickDate({ mode: "date", value: "2026-10-22", clearable: true });
    await click("Clear");
    await expect(answer).resolves.toEqual({ value: null });
    await eventually(() => !document.querySelector("[data-native-fallback]"));
    const second = pickDate({ mode: "dateAndTime", value: "2026-10-22T14:30" });
    await click("Done");
    await expect(second).resolves.toEqual({ value: "2026-10-22T14:30" });
  });

  test("pickColor: only from the app, lower-case hex", async () => {
    await expect(pickColor()).resolves.toBeNull();
    installBridge({ pickColor: async () => "#AABBCC" });
    await expect(pickColor({ value: "#000000" })).resolves.toBe("#aabbcc");
  });

  test("shareContent: the app's sheet, else the browser's, else the link copied", async () => {
    installBridge({ share: async () => true });
    await expect(shareContent({ url: "https://folevi.com/n/1" })).resolves.toBe("shared");
    delete (window as { foleviNative?: unknown }).foleviNative;
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await expect(shareContent({ url: "https://folevi.com/n/1" })).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith("https://folevi.com/n/1");
  });
});

describe("the keyboard", () => {
  test("the app's frames come straight through; without it, Capacitor's events", () => {
    const frames: unknown[] = [];
    let send: ((f: NativeKeyboardFrame) => void) | null = null;
    installBridge({
      onKeyboard: (l: (f: NativeKeyboardFrame) => void) => {
        send = l;
        return () => void (send = null);
      },
    });
    const stop = onKeyboardFrame((f) => frames.push(f));
    send!({ height: 336, duration: 250, curve: "keyboard", visible: true });
    stop();
    expect(send).toBeNull();
    delete (window as { foleviNative?: unknown }).foleviNative;
    const stop2 = onKeyboardFrame((f) => frames.push(f));
    window.dispatchEvent(Object.assign(new Event("keyboardWillShow"), { keyboardHeight: 300 }));
    window.dispatchEvent(new Event("keyboardWillHide"));
    stop2();
    expect(frames).toEqual([
      { height: 336, duration: 250, curve: "keyboard", visible: true },
      { height: 300, duration: 250, curve: "keyboard", visible: true },
      { height: 0, duration: 250, curve: "keyboard", visible: false },
    ]);
  });
});

test("screenRect: rectangles in the visual viewport's pixels", () => {
  expect(screenRect({ x: 10.123, y: 20, width: 30, height: 40 })).toEqual({ x: 10.12, y: 20, width: 30, height: 40 });
});

describe("the lifted preview of a long press", () => {
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  let userAgent: PropertyDescriptor | undefined;
  let stop: () => void = () => undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    userAgent = Object.getOwnPropertyDescriptor(window.navigator, "userAgent");
    Object.defineProperty(window.navigator, "userAgent", { value: IPHONE, configurable: true });
    HTMLElement.prototype.showPopover ??= function () {};
    HTMLElement.prototype.hidePopover ??= function () {};
  });
  afterEach(() => {
    stop();
    vi.useRealTimers();
    if (userAgent) Object.defineProperty(window.navigator, "userAgent", userAgent);
  });

  function touch(target: Element, type: string, at: { x: number; y: number } | null) {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, "touches", { value: at ? [{ clientX: at.x, clientY: at.y }] : [] });
    target.dispatchEvent(e);
  }

  function card() {
    document.body.innerHTML = `<div id="card" data-ctx-host style="border-top-left-radius: 18px">Card</div>`;
    const el = document.getElementById("card")!;
    el.getBoundingClientRect = () => new DOMRect(16, 100, 180, 120);
    // A menu opens for it, as AppContextMenu's does.
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      document.body.appendChild(menu);
    });
    return el;
  }

  test("arm (a picture at rest), lift once the menu is there, then settle back when it closes", async () => {
    const calls = installBridge({ liftArm: () => undefined, lift: async () => true, liftDrop: async () => undefined });
    stop = installTouchContextMenu();
    const el = card();
    touch(el, "touchstart", { x: 50, y: 150 });
    vi.advanceTimersByTime(130);
    expect(calls.find((c) => c.method === "liftArm")?.arg).toEqual({ id: expect.stringMatching(/^lift-/), rect: { x: 16, y: 100, width: 180, height: 120 }, radius: 18 });
    vi.advanceTimersByTime(400);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    const id = (calls.find((c) => c.method === "liftArm")!.arg as { id: string }).id;
    expect(calls.find((c) => c.method === "lift")?.arg).toEqual({ id, from: 0.97 });
    expect(calls.some((c) => c.method === "haptic" && c.arg === "medium")).toBe(true);
    // The page behind the menu is frosted, and the card steps out of sight under its picture.
    expect(document.querySelector("[data-lift-backdrop]")).not.toBeNull();
    expect(el.style.visibility).toBe("hidden");
    touch(el, "touchend", null);
    document.querySelector('[role="menu"]')!.remove();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(calls.find((c) => c.method === "liftDrop")?.arg).toEqual({ id, to: "back" });
    expect(el.style.visibility).toBe("");
    expect(document.querySelector("[data-lift-backdrop]")).toBeNull();
  });

  test("a tap or a scroll lets the picture go without lifting it", async () => {
    const calls = installBridge({ liftArm: () => undefined, lift: async () => true, liftDrop: async () => undefined });
    stop = installTouchContextMenu();
    const el = card();
    touch(el, "touchstart", { x: 50, y: 150 });
    vi.advanceTimersByTime(200);
    touch(el, "touchend", null);
    touch(el, "touchstart", { x: 50, y: 150 });
    vi.advanceTimersByTime(60);
    touch(el, "touchmove", { x: 50, y: 190 });
    vi.advanceTimersByTime(1000);
    expect(calls.filter((c) => c.method === "liftArm")).toHaveLength(1);
    expect(calls.filter((c) => c.method === "lift")).toHaveLength(0);
    expect(calls.filter((c) => c.method === "liftDrop").map((c) => (c.arg as { to: string }).to)).toEqual(["fade"]);
  });

  test("without the app's piece only the page's own lift runs", async () => {
    const calls = installBridge();
    stop = installTouchContextMenu();
    const el = card();
    touch(el, "touchstart", { x: 50, y: 150 });
    vi.advanceTimersByTime(600);
    expect(el.hasAttribute("data-held-lift")).toBe(true);
    expect(document.querySelector("[data-lift-backdrop]")).toBeNull();
    expect(calls.map((c) => c.method)).toEqual(["haptic"]);
  });
});
