// @vitest-environment jsdom
// Drawing on the whiteboard with the real view in a real note (the 2026-11-19 canvas audit: V5, V6, V13, V14):
// the Apple Pencil is kept from scrolling the note, a finger scrolls over a sheet that is not being worked on
// and never drops a stroke under way, strokes are stored thin and whole, a stroke that does not fit leaves
// nothing to undo, and drawing redraws one path a frame instead of the whole sheet for every point.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor, type JSONContent } from "@tiptap/core";
import { EditorContent, ReactNodeViewRenderer } from "@tiptap/react";
import type { WhiteboardStroke } from "@folevi/editor-schema";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class Observer {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", Observer);
if (!window.matchMedia) vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
// No layout: the sheet is 1000 by 400 at the page's corner, so a sheet point is its client point.
Element.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 400);
const captured = new Map<number, Element>();
Object.assign(Element.prototype, {
  setPointerCapture(this: Element, id: number) {
    captured.set(id, this);
  },
  releasePointerCapture(id: number) {
    captured.delete(id);
  },
  hasPointerCapture(this: Element, id: number) {
    return captured.get(id) === this;
  },
});

// How often the sheet's strokes and the stroke being drawn are turned into paths.
const drawn = { strokes: 0, draft: 0 };
vi.mock("@folevi/editor-schema", async (original) => {
  const actual = await original<typeof import("@folevi/editor-schema")>();
  return {
    ...actual,
    strokeD: (...args: Parameters<typeof actual.strokeD>) => {
      drawn.strokes += 1;
      return actual.strokeD(...args);
    },
    strokePath: (...args: Parameters<typeof actual.strokePath>) => {
      drawn.draft += 1;
      return actual.strokePath(...args);
    },
  };
});
vi.mock("convex/react", () => ({ useConvex: () => ({}), useAction: () => vi.fn(), useMutation: () => vi.fn(), useQuery: () => undefined }));

const { LIMITS, parseWhiteboard, serializeWhiteboard, whiteboardDataIssue } = await import("@folevi/editor-schema");
const { ALL_MARKS, ALL_NODES } = await import("@/components/editor/extensions");
const { BlockIdentity } = await import("@/components/editor/plugins");
const { NoteHistory } = await import("@/components/editor/noteHistory");
const { ToastProvider } = await import("@/components/ui/Toast");
const { WhiteboardView } = await import("@/components/editor/WhiteboardView");
const { stylusTouch } = await import("@/components/editor/whiteboard/ops");

const para = (id: string, text: string): JSONContent => ({ type: "paragraph", attrs: { id, depth: 0 }, content: text ? [{ type: "text", text }] : [] });
const sheetOf = (strokes: WhiteboardStroke[]): JSONContent => ({ type: "whiteboard", attrs: { id: "w", depth: 0, data: strokes.length ? serializeWhiteboard({ strokes }) : "", height: 400 } });
const line = (y: number): WhiteboardStroke => ({ points: [[100, y], [300, y + 40]], color: "ink", width: 2.5 });

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let editor: Editor | null = null;

async function mount(strokes: WhiteboardStroke[] = []): Promise<Editor> {
  const views = ALL_NODES.map((n) => (n.name === "whiteboard" ? n.extend({ addNodeView: () => ReactNodeViewRenderer(WhiteboardView, { stopEvent: () => true }) }) : n));
  const made = new Editor({ extensions: [...views, ...ALL_MARKS, NoteHistory.configure({ newGroupDelay: 1 }), BlockIdentity], content: { type: "doc", content: [para("a", "one"), sheetOf(strokes)] } });
  editor = made;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <ToastProvider>
        <EditorContent editor={made} />
      </ToastProvider>,
    ),
  );
  await frame();
  return made;
}
/** A frame, and what React draws after it. */
const frame = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => setTimeout(r, 0));
  });
/** Long enough for a stroke to be saved (400 ms). */
const saved = () => act(async () => void (await new Promise((r) => setTimeout(r, 480))));
const strokesOf = (e: Editor) => {
  let data = "";
  e.state.doc.forEach((n) => {
    if (n.attrs.id === "w") data = String(n.attrs.data);
  });
  expect(whiteboardDataIssue(data)).toBeNull();
  return parseWhiteboard(data).strokes;
};
const sheet = () => host!.querySelector<SVGSVGElement>(".fb-whiteboard-canvas")!;
const undoButton = () => host!.querySelector<HTMLButtonElement>('.fb-whiteboard button[aria-label="Undo"]')!;

interface Pointer {
  pointerId: number;
  pointerType: string;
  isPrimary?: boolean;
}
function fire(type: string, p: Pointer, x: number, y: number, more: object = {}) {
  const event = Object.assign(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === "pointerup" ? 0 : 1, isPrimary: p.isPrimary ?? true, pointerId: p.pointerId, pointerType: p.pointerType, clientX: x, clientY: y }), more);
  act(() => void sheet().dispatchEvent(event));
  if (type === "pointerup" || type === "pointercancel") captured.delete(p.pointerId);
}
/** Many points of one pen movement, as a browser hands them over between two frames. */
const samples = (points: [number, number][]) => ({ getCoalescedEvents: () => points.map(([clientX, clientY]) => ({ clientX, clientY })) });
const MOUSE: Pointer = { pointerId: 1, pointerType: "mouse" };
const PEN: Pointer = { pointerId: 2, pointerType: "pen" };
/** A whole stroke along `points`. */
function draw(p: Pointer, points: [number, number][]) {
  fire("pointerdown", p, ...points[0]!);
  for (const [x, y] of points.slice(1)) fire("pointermove", p, x, y);
  fire("pointerup", p, ...points.at(-1)!);
}

beforeEach(() => {
  drawn.strokes = 0;
  drawn.draft = 0;
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  editor?.destroy();
  root = null;
  editor = null;
  host = null;
  captured.clear();
  document.body.innerHTML = "";
});

describe("the Apple Pencil on the sheet (V5)", () => {
  const touchstart = (touchType: string) => Object.assign(new Event("touchstart", { bubbles: true, cancelable: true }), { changedTouches: [{ touchType }] });

  test("a touch from a pen is told apart from a finger's", () => {
    expect(stylusTouch({ changedTouches: [{ touchType: "stylus" }] })).toBe(true);
    expect(stylusTouch({ changedTouches: [{ touchType: "direct" }, { touchType: "stylus" }] })).toBe(true);
    expect(stylusTouch({ changedTouches: [{ touchType: "direct" }] })).toBe(false);
    expect(stylusTouch({ changedTouches: [{}] })).toBe(false);
    expect(stylusTouch({})).toBe(false);
  });

  test("the sheet keeps the pen's touch from scrolling the note, and leaves a finger's alone", async () => {
    await mount();
    const pen = touchstart("stylus");
    sheet().dispatchEvent(pen);
    expect(pen.defaultPrevented).toBe(true);
    const finger = touchstart("direct");
    sheet().dispatchEvent(finger);
    expect(finger.defaultPrevented).toBe(false);
  });

  test("a pen draws on a sheet that is not being worked on; fingers then scroll until the keyboard leaves the whiteboard", async () => {
    const e = await mount();
    draw(PEN, [[100, 100], [160, 130], [220, 100]]);
    await saved();
    expect(strokesOf(e)).toHaveLength(1);
    expect(sheet().hasAttribute("data-pen-only")).toBe(true);
    draw({ pointerId: 5, pointerType: "touch" }, [[100, 200], [200, 240]]);
    await saved();
    expect(strokesOf(e)).toHaveLength(1);
    act(() => (document.activeElement as HTMLElement).blur());
    expect(sheet().hasAttribute("data-pen-only")).toBe(false);
  });
});

describe("a finger on the sheet (V6)", () => {
  const FINGER: Pointer = { pointerId: 7, pointerType: "touch" };

  test("over a sheet that is not being worked on it draws nothing; a tap makes the sheet the one being worked on", async () => {
    const e = await mount();
    expect(sheet().hasAttribute("data-active")).toBe(false);
    // A swipe the browser takes for scrolling the note.
    fire("pointerdown", FINGER, 100, 100);
    fire("pointermove", FINGER, 100, 160);
    fire("pointercancel", FINGER, 100, 160);
    await saved();
    expect(strokesOf(e)).toEqual([]);
    expect(host!.querySelector("[data-wb-draft]")).toBeNull();
    expect(sheet().hasAttribute("data-active")).toBe(false);
    // A tap.
    fire("pointerdown", FINGER, 100, 100);
    fire("pointerup", FINGER, 100, 100);
    await saved();
    expect(strokesOf(e)).toEqual([]);
    expect(sheet().hasAttribute("data-active")).toBe(true);
    // Now the finger draws.
    draw(FINGER, [[100, 100], [160, 130], [220, 100]]);
    await saved();
    expect(strokesOf(e)).toHaveLength(1);
  });

  test("a second finger while one is drawing neither drops the stroke nor starts another", async () => {
    const e = await mount();
    fire("pointerdown", FINGER, 100, 100);
    fire("pointerup", FINGER, 100, 100);
    fire("pointerdown", FINGER, 100, 100);
    fire("pointermove", FINGER, 200, 100);
    const second: Pointer = { pointerId: 8, pointerType: "touch", isPrimary: false };
    fire("pointerdown", second, 600, 300);
    fire("pointermove", second, 640, 320);
    fire("pointermove", FINGER, 300, 200);
    fire("pointerup", second, 640, 320);
    fire("pointerup", FINGER, 300, 200);
    await saved();
    const strokes = strokesOf(e);
    expect(strokes).toHaveLength(1);
    expect(strokes[0]!.points).toEqual([[100, 100], [196, 100], [200, 100], [203, 103], [300, 200]]);
  });

  test("the mouse draws at once, as before", async () => {
    const e = await mount();
    draw(MOUSE, [[100, 100], [200, 100]]);
    await saved();
    expect(strokesOf(e)).toHaveLength(1);
    expect(sheet().hasAttribute("data-active")).toBe(true);
  });
});

describe("how strokes are kept (V13)", () => {
  test("a stroke is stored as the few whole points that carry its shape", async () => {
    const e = await mount();
    // 200 points along a straight line, each with decimals.
    draw(MOUSE, Array.from({ length: 200 }, (_, i): [number, number] => [100.3 + i * 2.1, 50.7 + i * 0.9]));
    await saved();
    const [stroke] = strokesOf(e);
    expect(stroke!.points).toHaveLength(2);
    expect(stroke!.points!.flat().every(Number.isInteger)).toBe(true);
  });

  test("a very long stroke carries on as a second stroke instead of no longer following the pen, and one Undo takes back all of it", async () => {
    const e = await mount();
    // 3,400 points zigzagging across the sheet without lifting.
    const path = Array.from({ length: 3400 }, (_, i): [number, number] => [20 + ((i * 2) % 900), 40 + Math.floor((i * 2) / 900) * 12 + (i % 2) * 6]);
    fire("pointerdown", MOUSE, ...path[0]!);
    fire("pointermove", MOUSE, ...path.at(-1)!, samples(path.slice(1)));
    fire("pointerup", MOUSE, ...path.at(-1)!);
    await saved();
    const strokes = strokesOf(e);
    expect(strokes).toHaveLength(2);
    // The line reaches where the pen stopped.
    expect(strokes[1]!.points!.at(-1)).toEqual(path.at(-1));
    act(() => undoButton().click());
    await saved();
    expect(strokesOf(e)).toEqual([]);
  });

  test("a stroke that does not fit is not kept, says so once, and leaves nothing for Undo to take back", async () => {
    // A sheet with room for almost nothing more.
    const filler: WhiteboardStroke[] = [];
    for (let i = 0; serializeWhiteboard({ strokes: filler }).length < LIMITS.maxWhiteboardDataLength - 6000; i++) {
      filler.push({ points: Array.from({ length: 400 }, (_, j): [number, number] => [(i * 7 + j * 3) % 997, (i * 13 + j * 5) % 389]), color: "ink", width: 2.5 });
    }
    const e = await mount(filler);
    // A scribble that needs more room than is left.
    draw(MOUSE, Array.from({ length: 1500 }, (_, i): [number, number] => [(i * 37) % 991, (i * 53) % 383]));
    await saved();
    expect(strokesOf(e)).toHaveLength(filler.length);
    expect(undoButton().disabled).toBe(true);
    expect([...document.querySelectorAll('[role="alert"]')].map((el) => el.textContent)).toEqual(["This whiteboard is full. Erase something to make room."]);
    expect(host!.querySelector("[data-wb-draft]")).toBeNull();
  });
});

describe("what is redrawn while drawing (V14)", () => {
  test("the strokes already on the sheet are not drawn again for the points of a new one", async () => {
    await mount([line(40), line(120), line(200)]);
    expect(drawn.strokes).toBeGreaterThanOrEqual(3);
    drawn.strokes = 0;
    fire("pointerdown", MOUSE, 400, 100);
    for (let i = 1; i <= 40; i++) {
      fire("pointermove", MOUSE, 400 + i * 4, 100 + (i % 5) * 6);
      if (i % 8 === 0) await frame();
    }
    expect(drawn.strokes).toBe(0);
    expect(host!.querySelector("[data-wb-draft]")).not.toBeNull();
    fire("pointerup", MOUSE, 560, 100);
  });

  test("the line being drawn is redrawn once a frame, however many points arrive in it", async () => {
    await mount([line(40)]);
    fire("pointerdown", MOUSE, 400, 100);
    await frame();
    drawn.draft = 0;
    for (let i = 1; i <= 12; i++) fire("pointermove", MOUSE, 400 + i * 4, 100 + i);
    expect(drawn.draft).toBe(0);
    await frame();
    expect(drawn.draft).toBe(1);
    fire("pointerup", MOUSE, 448, 112);
  });
});
