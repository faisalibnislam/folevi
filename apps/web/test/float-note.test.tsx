// "Float this note" (lib/app/float.ts, components/app/FloatNote.tsx, components/app/floatMenu.tsx): where a note can
// float, the menu item, the desktop apps' calls, Chrome's Picture-in-Picture window and the floating page's bar.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  FLOAT_DEFAULT_SIZE,
  PipFloats,
  clampFloatSize,
  closeFloat,
  floatIdOf,
  floatKind,
  floatNote,
  floatPath,
  openInMainWindow,
  readFloatSize,
  routeFromFloat,
  saveFloatSize,
  setFloatOpenMain,
} from "@/lib/app/float";
import { floatMenuItems } from "@/components/app/floatMenu";
import { FloatBar } from "@/components/app/FloatNote";
import { parseRoute } from "@/lib/app/router";
import { APP_ROUTE_HEADS } from "@/lib/app/routes";

type Bridge = Record<string, unknown>;
const setBridge = (b: Bridge | null) => {
  if (b) Object.defineProperty(window, "foleviDesktop", { value: b, configurable: true, writable: true });
  else delete (window as { foleviDesktop?: unknown }).foleviDesktop;
};
const setPip = (pip: unknown) => {
  if (pip) Object.defineProperty(window, "documentPictureInPicture", { value: pip, configurable: true, writable: true });
  else delete (window as { documentPictureInPicture?: unknown }).documentPictureInPicture;
};

beforeEach(() => {
  window.history.replaceState(null, "", "/documents");
  localStorage.clear();
});
let root: Root | null = null;
let host: HTMLElement | null = null;
async function render(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
}
const byLabel = (label: string) => host!.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const click = (el: Element) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  setBridge(null);
  setPip(null);
  setFloatOpenMain(null);
  window.history.replaceState(null, "", "/documents");
});

describe("where a note can float", () => {
  const env = { bridge: null, pip: false, inApp: false, floating: false };
  test("the desktop apps that answer floatNote", () => {
    expect(floatKind({ ...env, bridge: { floatNote: () => undefined } })).toBe("desktop");
  });
  test("an older desktop app without it: nowhere (not Chrome's window, even in WebView2)", () => {
    expect(floatKind({ ...env, bridge: {}, pip: true })).toBeNull();
  });
  test("Chrome and Edge: Picture-in-Picture", () => {
    expect(floatKind({ ...env, pip: true })).toBe("pip");
  });
  test("Safari and Firefox (no Document Picture-in-Picture): nowhere", () => {
    expect(floatKind(env)).toBeNull();
  });
  test("the iPhone, iPad and Android apps: nowhere", () => {
    expect(floatKind({ ...env, pip: true, inApp: true })).toBeNull();
  });
  test("a floating note's own window floats nothing more", () => {
    expect(floatKind({ ...env, pip: true, floating: true })).toBeNull();
    expect(floatKind({ ...env, bridge: { floatNote: () => undefined }, floating: true })).toBeNull();
  });
  test("reads the page: the bridge, the browser, the path", () => {
    expect(floatKind()).toBeNull();
    setPip({ requestWindow: vi.fn() });
    expect(floatKind()).toBe("pip");
    window.history.replaceState(null, "", "/float/N1");
    expect(floatKind()).toBeNull();
  });
});

describe("the floating page's address", () => {
  test("/float/<id> both ways", () => {
    expect(floatPath("01ABC")).toBe("/float/01ABC");
    expect(floatIdOf("/float/01ABC")).toBe("01ABC");
    expect(floatIdOf("/float/01ABC/")).toBe("01ABC");
    expect(floatIdOf("/float/")).toBeNull();
    expect(floatIdOf("/d/01ABC")).toBeNull();
    expect(floatIdOf("/float/%E0%A4%A")).toBeNull();
  });
  test("is an app route", () => {
    expect(APP_ROUTE_HEADS.has("float")).toBe(true);
    expect(parseRoute("/float/01ABC")).toEqual({ name: "float", id: "01ABC" });
    expect(parseRoute("/float")).toEqual({ name: "not_found" });
  });
});

describe("the menu item", () => {
  test("is left out where a note can't float", () => {
    expect(floatMenuItems({ id: "N1", title: "Plans" })).toEqual([]);
  });
  test("floats the note in the desktop app", () => {
    const floatNoteCall = vi.fn();
    setBridge({ platform: "mac", floatNote: floatNoteCall, openInMain: vi.fn() });
    const items = floatMenuItems({ id: "N1", title: "Plans" });
    expect(items.map((i) => i.label)).toEqual(["Float this note"]);
    items[0]!.onSelect();
    expect(floatNoteCall).toHaveBeenCalledWith({ id: "N1", title: "Plans" });
  });
  test("opens Chrome's Picture-in-Picture window", async () => {
    const requestWindow = vi.fn(() => new Promise<Window>(() => undefined));
    setPip({ requestWindow });
    const items = floatMenuItems({ id: "N1", title: "Plans" });
    expect(items).toHaveLength(1);
    items[0]!.onSelect();
    expect(requestWindow).toHaveBeenCalledWith({ width: FLOAT_DEFAULT_SIZE.width, height: FLOAT_DEFAULT_SIZE.height });
  });
});

describe("remembered sizes", () => {
  test("per note, within bounds", () => {
    expect(readFloatSize("N1")).toEqual(FLOAT_DEFAULT_SIZE);
    saveFloatSize("N1", { width: 500, height: 700 });
    expect(readFloatSize("N1")).toEqual({ width: 500, height: 700 });
    expect(readFloatSize("N2")).toEqual(FLOAT_DEFAULT_SIZE);
    expect(clampFloatSize({ width: 10, height: 99999 })).toEqual({ width: 260, height: 1200 });
    localStorage.setItem("folevi:float-size:N3", "not json");
    expect(readFloatSize("N3")).toEqual(FLOAT_DEFAULT_SIZE);
  });
});

/** A real window for the Picture-in-Picture one: an iframe's (jsdom gives it a document, events and a size). */
function fakePipWindow(): Window {
  const holder = document.createElement("iframe");
  document.body.appendChild(holder);
  const win = holder.contentWindow!;
  let closed = false;
  Object.defineProperty(win, "closed", { get: () => closed, configurable: true });
  Object.defineProperty(win, "close", { value: () => ((closed = true), holder.remove()), configurable: true });
  Object.defineProperty(win, "focus", { value: vi.fn(), configurable: true });
  return win;
}

describe("Chrome's Picture-in-Picture window", () => {
  test("one window, a frame per note, a switcher from two, the same note brought forward", async () => {
    const win = fakePipWindow();
    const requestWindow = vi.fn(async () => win);
    const floats = new PipFloats(() => ({ requestWindow, window: null }));
    await floats.open({ id: "A", title: "Alpha" });
    const frames = () => Array.from(win.document.querySelectorAll("iframe"));
    expect(requestWindow).toHaveBeenCalledTimes(1);
    expect(frames()).toHaveLength(1);
    expect(new URL(frames()[0]!.src).pathname + new URL(frames()[0]!.src).search).toBe("/float/A?pip=1");
    expect(win.document.querySelector<HTMLElement>("[data-float-switcher]")!.hidden).toBe(true);
    expect(win.document.title).toBe("Alpha");

    await floats.open({ id: "B", title: "Beta" });
    expect(requestWindow).toHaveBeenCalledTimes(1);
    expect(frames()).toHaveLength(2);
    expect(floats.active).toBe("B");
    expect(frames().map((f) => f.hidden)).toEqual([true, false]);
    const switcher = win.document.querySelector<HTMLElement>("[data-float-switcher]")!;
    expect(switcher.hidden).toBe(false);
    expect(Array.from(switcher.querySelectorAll("button")).map((b) => [b.textContent, b.getAttribute("aria-current")])).toEqual([
      ["Alpha", "false"],
      ["Beta", "true"],
    ]);

    // Floating a note that's already floating brings it forward: no new frame.
    await floats.open({ id: "A", title: "Alpha" });
    expect(frames()).toHaveLength(2);
    expect(floats.active).toBe("A");
    expect(win.focus).toHaveBeenCalled();

    // The switcher shows the other note.
    click(switcher.querySelectorAll("button")[1]!);
    expect(floats.active).toBe("B");

    // Closing one shows the other; closing the last closes the window.
    floats.close("B");
    expect(floats.active).toBe("A");
    expect(switcher.hidden).toBe(true);
    floats.close("A");
    expect(win.closed).toBe(true);
    expect(floats.win).toBeNull();
  });

  test("hears only its own frames: Close, a new name, Open in main window", async () => {
    const win = fakePipWindow();
    const floats = new PipFloats(() => ({ requestWindow: async () => win, window: null }));
    await floats.open({ id: "A", title: "Alpha" });
    await floats.open({ id: "B", title: "Beta" });
    const frameOf = (id: string) => floats.notes.get(id)!.frame;
    const send = (data: unknown, source: Window | null, origin = window.location.origin) =>
      win.dispatchEvent(new MessageEvent("message", { data, source, origin }));

    // From somewhere else: nothing happens.
    send({ folevi: "float", action: "close", id: "A" }, null);
    send({ folevi: "float", action: "close", id: "A" }, frameOf("A").contentWindow, "https://elsewhere.example");
    send({ folevi: "float", action: "close", id: "A" }, frameOf("B").contentWindow);
    expect(floats.notes.size).toBe(2);

    send({ folevi: "float", action: "title", id: "B", title: "Beta 2" }, frameOf("B").contentWindow);
    expect(floats.notes.get("B")!.title).toBe("Beta 2");
    expect(win.document.title).toBe("Beta 2");

    const openMain = vi.fn();
    setFloatOpenMain(openMain);
    send({ folevi: "float", action: "open-main", id: "B", path: "//evil.example" }, frameOf("B").contentWindow);
    expect(openMain).toHaveBeenLastCalledWith("/d/B");
    send({ folevi: "float", action: "open-main", id: "B", path: "/folders/F1" }, frameOf("B").contentWindow);
    expect(openMain).toHaveBeenLastCalledWith("/folders/F1");

    send({ folevi: "float", action: "close", id: "A" }, frameOf("A").contentWindow);
    expect([...floats.notes.keys()]).toEqual(["B"]);
  });

  test("remembers the size of the note it shows", async () => {
    const win = fakePipWindow();
    Object.defineProperty(win, "innerWidth", { value: 333, configurable: true });
    Object.defineProperty(win, "innerHeight", { value: 444, configurable: true });
    const floats = new PipFloats(() => ({ requestWindow: async () => win, window: null }));
    await floats.open({ id: "A", title: "Alpha" });
    floats.close("A");
    expect(readFloatSize("A")).toEqual({ width: 333, height: 444 });
  });

  test("opens at the note's remembered size", async () => {
    saveFloatSize("A", { width: 420, height: 640 });
    const requestWindow = vi.fn(async () => fakePipWindow());
    await new PipFloats(() => ({ requestWindow, window: null })).open({ id: "A", title: "" });
    expect(requestWindow).toHaveBeenCalledWith({ width: 420, height: 640 });
  });
});

describe("inside a floating note", () => {
  test("links open in the main window; the floating note stays", () => {
    const openInMain = vi.fn();
    setBridge({ platform: "windows", openInMain });
    expect(routeFromFloat("/d/OTHER")).toBe(false);
    window.history.replaceState(null, "", "/float/N1");
    expect(routeFromFloat("/d/OTHER")).toBe(true);
    expect(openInMain).toHaveBeenCalledWith("/d/OTHER");
    expect(routeFromFloat("/float/N1?x=1")).toBe(false);
    expect(routeFromFloat("https://example.com/d/X")).toBe(false);
  });

  test("Close and Open in main window reach the desktop app", () => {
    const closeWindow = vi.fn();
    const openInMain = vi.fn();
    setBridge({ platform: "mac", closeWindow, openInMain });
    closeFloat("N1");
    openInMainWindow("N1");
    expect(closeWindow).toHaveBeenCalled();
    expect(openInMain).toHaveBeenCalledWith("/d/N1");
  });

  test("in Chrome's window they go to the window around the page", () => {
    window.history.replaceState(null, "", "/float/N1?pip=1");
    const parent = { postMessage: vi.fn() };
    const spy = vi.spyOn(window, "parent", "get").mockReturnValue(parent as unknown as Window);
    closeFloat("N1");
    openInMainWindow("N1");
    expect(parent.postMessage).toHaveBeenNthCalledWith(1, { folevi: "float", action: "close", id: "N1" }, window.location.origin);
    expect(parent.postMessage).toHaveBeenNthCalledWith(2, { folevi: "float", action: "open-main", id: "N1", path: "/d/N1" }, window.location.origin);
    spy.mockRestore();
  });

  test("the bar: the name, the pin where the app has one, Open in main window, Close", async () => {
    const floatOnTop = vi.fn(async (on?: boolean) => (on === undefined ? true : on));
    const openInMain = vi.fn();
    const closeWindow = vi.fn();
    setBridge({ platform: "mac", floatOnTop, openInMain, closeWindow });
    await render(<FloatBar id="N1" title="Groceries" />);
    expect(host!.querySelector("h1")!.textContent).toBe("Groceries");
    const pin = byLabel("Always on top")!;
    expect(pin.getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      click(pin);
    });
    expect(floatOnTop).toHaveBeenLastCalledWith(false);
    expect(pin.getAttribute("aria-pressed")).toBe("false");
    click(byLabel("Open in main window")!);
    expect(openInMain).toHaveBeenCalledWith("/d/N1");
    click(byLabel("Close")!);
    expect(closeWindow).toHaveBeenCalled();
  });

  test("no pin where the window is always on top anyway (Chrome's)", async () => {
    await render(<FloatBar id="N1" title="" />);
    expect(host!.querySelector("h1")!.textContent).toBe("Untitled");
    expect(byLabel("Always on top")).toBeNull();
    expect(byLabel("Open in main window")).not.toBeNull();
  });
});

describe("floatNote", () => {
  test("does nothing where a note can't float", () => {
    expect(() => floatNote({ id: "N1", title: "" })).not.toThrow();
  });
});
