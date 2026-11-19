// @vitest-environment jsdom
// Fingers and the Apple Pencil on the canvases (the 2026-11-19 canvas audit: V4, V7, V16, V17, V22, V23),
// with each block's real view mounted in a real note. jsdom has no layout and no touch screen, so these pin the
// bookkeeping (which pointers are down, who has the keyboard, what is saved when); how it feels is checked on
// an iPad and an iPhone.
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor, type JSONContent } from "@tiptap/core";
import { EditorContent, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { parseFlowchart, parseMindmap, parseWireframe, serializeFlowchart, serializeMindmap, serializeWireframe, sync, type SyncState } from "@folevi/editor-schema";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// What jsdom leaves out that the canvases use.
class Observer {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", Observer);
vi.stubGlobal("IntersectionObserver", Observer);
if (!window.matchMedia) vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
if (!(globalThis as { CSS?: { escape?: unknown } }).CSS?.escape) vi.stubGlobal("CSS", { escape: (s: string) => s });
// No layout: every box is the same 900 by 500 at the page's corner (so a canvas point is its client point).
Element.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 900, 500);
// Pointer capture: which element holds each pointer, as a browser keeps it.
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

vi.mock("convex/react", () => ({ useConvex: () => ({}), useAction: () => vi.fn(), useMutation: () => vi.fn(), useQuery: () => undefined }));
const engine = { state: sync.emptySyncState() as SyncState, subscribe: () => () => undefined, resolveConflict: vi.fn() };
vi.mock("@/lib/app/state", async (original) => ({ ...(await original<object>()), useAppState: () => ({ profile: { id: "acct" }, engine, outbox: null }) }));

vi.mock("@/lib/app/router", async (original) => ({ ...(await original<object>()), useAppRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), pathname: "/" }) }));
// Foli AI is off here (it needs an account behind it).
vi.mock("@/components/ai/useAi", async (original) => ({ ...(await original<object>()), useAiEnabled: () => false, useNoteAi: () => null, useAiFeature: () => false }));

const { ALL_MARKS, ALL_NODES } = await import("@/components/editor/extensions");
const { BlockIdentity } = await import("@/components/editor/plugins");
const { NoteHistory } = await import("@/components/editor/noteHistory");
const { ToastProvider } = await import("@/components/ui/Toast");
const { MindmapView } = await import("@/components/editor/mindmap/MindmapView");
const { FlowchartView } = await import("@/components/editor/flowchart/FlowchartView");
const { WireframeView } = await import("@/components/editor/wireframe/WireframeView");
const { StickiesView } = await import("@/components/editor/stickies/StickiesView");
const { listenPinch } = await import("@/components/editor/canvas/wheel");
const { notePress, pinchPair } = await import("@/components/editor/canvas/pointers");
const { NodeSelection } = await import("@tiptap/pm/state");

const para = (id: string, text: string): JSONContent => ({ type: "paragraph", attrs: { id, depth: 0 }, content: text ? [{ type: "text", text }] : [] });
const block = (type: string, id: string, data: string): JSONContent => ({ type, attrs: { id, depth: 0, data, height: 400 } });
const VIEWS: Record<string, ComponentType<ReactNodeViewProps>> = { mindmap: MindmapView, flowchart: FlowchartView, wireframe: WireframeView, stickies: StickiesView };

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let editor: Editor | null = null;

/** A note with the canvas blocks' real views, drawn in the page. */
async function mount(content: JSONContent[]): Promise<Editor> {
  const views = ALL_NODES.map((n) => (VIEWS[n.name] ? n.extend({ addNodeView: () => ReactNodeViewRenderer(VIEWS[n.name]!, { stopEvent: () => true }) }) : n));
  const made = new Editor({ extensions: [...views, ...ALL_MARKS, NoteHistory.configure({ newGroupDelay: 1 }), BlockIdentity], content: { type: "doc", content } });
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
  await settle();
  return made;
}
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => setTimeout(r, 0));
  });
const dataOf = (e: Editor, id: string) => {
  let found = "";
  e.state.doc.forEach((n) => {
    if (n.attrs.id === id) found = String(n.attrs.data);
  });
  return found;
};

afterEach(() => {
  if (root) act(() => root!.unmount());
  editor?.destroy();
  root = null;
  editor = null;
  host = null;
  captured.clear();
  document.body.innerHTML = "";
});

let nextTouch = 10;
/** One pointer event on `el`, bubbling as in a browser. A captured pointer's later events go to its holder. */
function fire(el: Element, type: string, init: PointerEventInit & { pointerId: number; pointerType: string }) {
  const target = type === "pointerdown" ? el : (captured.get(init.pointerId) ?? el);
  act(() => void target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === "pointerup" ? 0 : 1, isPrimary: true, clientX: 50, clientY: 50, ...init })));
  if (type === "pointerup" || type === "pointercancel") captured.delete(init.pointerId);
}
/** A finger pressed on `el` (and, unless `held`, lifted): a tap. Returns the pointer's id. */
function touch(el: Element, opts: { held?: boolean; at?: [number, number]; primary?: boolean } = {}): number {
  const pointerId = nextTouch++;
  const [clientX, clientY] = opts.at ?? [50, 50];
  fire(el, "pointerdown", { pointerId, pointerType: "touch", isPrimary: opts.primary ?? true, clientX, clientY });
  if (!opts.held) fire(el, "pointerup", { pointerId, pointerType: "touch", isPrimary: opts.primary ?? true, clientX, clientY });
  return pointerId;
}

const MAP = serializeMindmap(parseMindmap(JSON.stringify({ v: 1, nodes: [{ id: "r", parent: null, text: "Root" }, { id: "k1", parent: "r", text: "One" }, { id: "k2", parent: "r", text: "Two" }] })));

const FLOW = serializeFlowchart(
  parseFlowchart(
    JSON.stringify({
      v: 2,
      nodes: [
        { id: "a", shape: "process", x: 100, y: 100, w: 120, h: 60, text: "A" },
        { id: "b", shape: "process", x: 400, y: 300, w: 120, h: 60, text: "B" },
      ],
      edges: [],
    }),
  ),
);
const WIRE = serializeWireframe(
  parseWireframe(JSON.stringify({ v: 1, screens: [{ id: "s1", name: "Home", frame: "phone", x: 0, y: 0, w: 320, h: 640 }], items: [{ id: "i1", screen: "s1", kind: "button", x: 20, y: 40, w: 100, h: 40, text: "Go" }], links: [] })),
);
const one = <T extends Element = HTMLElement>(selector: string) => {
  const el = host!.querySelector<T>(selector);
  if (!el) throw new Error(`nothing matches ${selector}`);
  return el;
};
const shapeX = (e: Editor, id: string) => parseFlowchart(dataOf(e, "f")).nodes.find((n) => n.id === id)!.x;
const itemX = (e: Editor) => parseWireframe(dataOf(e, "w")).items[0]!.x;
/** Long enough for a finished change to be saved (400 ms). */
const saved = () => act(async () => void (await new Promise((r) => setTimeout(r, 480))));

describe("a mind map under fingers (V4)", () => {
  const idea = (id: string) => one<SVGGElement>(`[data-mm-node="${id}"]`);
  const view = () => one<SVGGElement>(".mm-svg > g").getAttribute("transform");

  test("a tap on + is held by the map itself, so its release is heard after + has left the page", async () => {
    await mount([para("a", "one"), block("mindmap", "m", MAP)]);
    touch(idea("k1"));
    expect(idea("k1").hasAttribute("data-selected")).toBe(true);
    const before = view();
    const add = one<SVGGElement>('[data-mm-add="k1"]');
    const finger = nextTouch++;
    fire(add, "pointerdown", { pointerId: finger, pointerType: "touch" });
    // The press took + off the page (the new idea's text box is there instead): only a captured pointer's
    // release still comes to the map.
    expect(add.isConnected).toBe(false);
    expect(captured.get(finger)).toBe(one(".mm-svg"));
    fire(add, "pointerup", { pointerId: finger, pointerType: "touch" });
    expect(host!.querySelector(".mm-canvas textarea")).not.toBeNull();
    // The next finger is one finger: it selects, and nothing zooms.
    touch(idea("k2"));
    expect(idea("k2").hasAttribute("data-selected")).toBe(true);
    expect(view()).toBe(before);
  });

  test("a finger whose release was never heard is forgotten at the next touch (no phantom pinch)", async () => {
    await mount([para("a", "one"), block("mindmap", "m", MAP)]);
    touch(idea("k1"));
    const before = view();
    // Pressed, and the release goes nowhere (as WebKit sends it to an element that has left the page).
    touch(one('[data-mm-add="k1"]'), { held: true });
    const finger = touch(idea("k2"), { held: true, at: [200, 200] });
    expect(idea("k2").hasAttribute("data-selected")).toBe(true);
    fire(idea("k2"), "pointermove", { pointerId: finger, pointerType: "touch", clientX: 230, clientY: 200 });
    fire(idea("k2"), "pointermove", { pointerId: finger, pointerType: "touch", clientX: 260, clientY: 200 });
    fire(idea("k2"), "pointerup", { pointerId: finger, pointerType: "touch", clientX: 260, clientY: 200 });
    // One finger moved: the map panned with it. It did not zoom.
    expect(view()).not.toBe(before);
    expect(view()).toMatch(/scale\(1\)$/);
  });

  test("a pinch event that does not say where it is leaves the view usable (V16)", async () => {
    await mount([para("a", "one"), block("mindmap", "m", MAP)]);
    const svg = one(".mm-svg");
    act(() => void svg.dispatchEvent(Object.assign(new Event("gesturestart", { cancelable: true }), { scale: 1 })));
    act(() => void svg.dispatchEvent(Object.assign(new Event("gesturechange", { cancelable: true }), { scale: 1.5 })));
    expect(view()).not.toContain("NaN");
    expect(view()).toMatch(/scale\(1\.5\)$/);
  });
});

describe("a trackpad pinch and fingers (V16)", () => {
  const gesture = (type: string, extra: object) => Object.assign(new Event(type, { cancelable: true }), extra);

  test("a pinch with no place zooms about the middle; one from fingers already on the canvas is left to them", () => {
    const el = document.body.appendChild(document.createElement("div"));
    const zooms: number[][] = [];
    const stop = listenPinch(el, { scale: () => 2, zoomAt: (k, x, y) => zooms.push([k, x, y]) });
    el.dispatchEvent(gesture("gesturestart", { scale: 1 }));
    el.dispatchEvent(gesture("gesturechange", { scale: 1.5, clientX: 100, clientY: 40 }));
    el.dispatchEvent(gesture("gesturechange", { scale: 1.5 }));
    el.dispatchEvent(gesture("gesturechange", { scale: Number.NaN, clientX: 100, clientY: 40 }));
    expect(zooms).toEqual([
      [3, 100, 40],
      [3, 450, 250],
    ]);
    // Two fingers on the screen: the canvas zooms from its own pointer events.
    el.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 5, pointerType: "touch", isPrimary: true, bubbles: true }));
    el.dispatchEvent(gesture("gesturechange", { scale: 4, clientX: 100, clientY: 40 }));
    expect(zooms).toHaveLength(2);
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 5, pointerType: "touch" }));
    el.dispatchEvent(gesture("gesturechange", { scale: 0.5, clientX: 100, clientY: 40 }));
    expect(zooms.at(-1)).toEqual([1, 100, 40]);
    stop();
    el.dispatchEvent(gesture("gesturechange", { scale: 4, clientX: 0, clientY: 0 }));
    expect(zooms).toHaveLength(3);
  });
});

describe("which presses are a pinch (V17)", () => {
  const press = (pointerId: number, pointerType: string, isPrimary = true) => ({ pointerId, pointerType, isPrimary, clientX: pointerId, clientY: 0 });

  test("two fingers are; a palm beside the pen is not, and is not listed", () => {
    const pts = new Map();
    expect(notePress(pts, press(1, "touch"))).toBe("press");
    expect(notePress(pts, press(2, "touch", false))).toBe("pinch");
    expect(pinchPair(pts)!.map((p) => p.x)).toEqual([1, 2]);
    pts.clear();
    expect(notePress(pts, press(1, "pen"))).toBe("press");
    expect(notePress(pts, press(2, "touch"))).toBe("palm");
    expect([...pts.keys()]).toEqual([1]);
    expect(pinchPair(pts)).toBeNull();
  });

  test("the mouse and a finger are not; a first finger forgets fingers left over from before", () => {
    const pts = new Map();
    notePress(pts, press(1, "mouse"));
    expect(notePress(pts, press(2, "touch"))).toBe("press");
    pts.clear();
    notePress(pts, press(7, "touch"));
    // (Its release was never heard.)
    expect(notePress(pts, press(8, "touch"))).toBe("press");
    expect([...pts.keys()]).toEqual([8]);
  });

  test("in a flowchart, a palm landing while the pen drags a shape leaves the drag alone", async () => {
    const e = await mount([para("a", "one"), block("flowchart", "f", FLOW)]);
    const shape = one<SVGGElement>('[data-fc-node="a"]');
    fire(shape, "pointerdown", { pointerId: 1, pointerType: "pen", clientX: 150, clientY: 120 });
    fire(shape, "pointermove", { pointerId: 1, pointerType: "pen", clientX: 250, clientY: 120 });
    await settle();
    // The hand comes to rest on the glass.
    touch(one(".fc-svg"), { held: true, at: [600, 400] });
    fire(shape, "pointermove", { pointerId: 1, pointerType: "pen", clientX: 310, clientY: 120 });
    await settle();
    fire(shape, "pointerup", { pointerId: 1, pointerType: "pen", clientX: 310, clientY: 120 });
    await saved();
    expect(shapeX(e, "a")).toBeGreaterThan(200);
  });
});

describe("a finger on a canvas that does not have the keyboard (V7)", () => {
  const cases: [string, JSONContent, string, string][] = [
    ["mind map", block("mindmap", "m", MAP), '[data-mm-node="k1"]', ".mm-canvas"],
    ["flowchart", block("flowchart", "f", FLOW), '[data-fc-node="a"]', ".fc-card"],
    ["wireframe", block("wireframe", "w", WIRE), '[data-wf-item="i1"]', ".fb-wireframe .fb-vcard"],
    ["sticky notes", block("stickies", "s", ""), ".st-canvas", ".fb-stickies .fb-vcard"],
  ];
  for (const [name, node, target, card] of cases) {
    test(`${name}: a touch the browser takes away (the note scrolled) leaves it without the keyboard; a tap gives it`, async () => {
      await mount([para("a", "one"), node]);
      const finger = touch(one(target), { held: true });
      fire(one(target), "pointercancel", { pointerId: finger, pointerType: "touch" });
      expect(one(card).hasAttribute("data-active")).toBe(false);
      touch(one(target));
      await settle();
      expect(one(card).hasAttribute("data-active")).toBe(true);
    });
  }

  test("the mouse gives it the keyboard at the press, as before", async () => {
    await mount([para("a", "one"), block("flowchart", "f", FLOW)]);
    fire(one('[data-fc-node="a"]'), "pointerdown", { pointerId: 1, pointerType: "mouse" });
    await settle();
    expect(one(".fc-card").hasAttribute("data-active")).toBe(true);
  });
});

describe("a tap that wobbles is not a move (V23)", () => {
  const undo = (block: string) => one<HTMLButtonElement>(`${block} button[aria-label="Undo"]`);
  /** A press on `el`, a slide of `by` pixels, and the release. */
  async function slide(el: Element, pointerType: string, by: number) {
    fire(el, "pointerdown", { pointerId: 1, pointerType, clientX: 150, clientY: 120 });
    fire(el, "pointermove", { pointerId: 1, pointerType, clientX: 150 + by, clientY: 120 });
    await settle();
    fire(el, "pointerup", { pointerId: 1, pointerType, clientX: 150 + by, clientY: 120 });
    await settle();
  }

  test("flowchart: five pixels under a finger change nothing and leave nothing to undo; under the mouse it is a move", async () => {
    await mount([para("a", "one"), block("flowchart", "f", FLOW)]);
    await slide(one('[data-fc-node="a"]'), "touch", 5);
    expect(undo(".fb-flowchart").disabled).toBe(true);
    await slide(one('[data-fc-node="a"]'), "touch", 40);
    expect(undo(".fb-flowchart").disabled).toBe(false);
  });

  test("flowchart: the mouse still moves a shape by five pixels", async () => {
    await mount([para("a", "one"), block("flowchart", "f", FLOW)]);
    await slide(one('[data-fc-node="a"]'), "mouse", 5);
    expect(undo(".fb-flowchart").disabled).toBe(false);
  });

  test("wireframe: the same for a part", async () => {
    await mount([para("a", "one"), block("wireframe", "w", WIRE)]);
    await slide(one('[data-wf-item="i1"]'), "touch", 5);
    expect(undo(".fb-wireframe").disabled).toBe(true);
    await slide(one('[data-wf-item="i1"]'), "touch", 40);
    expect(undo(".fb-wireframe").disabled).toBe(false);
  });
});

describe("leaving a canvas saves what is pending (V22)", () => {
  async function drag(el: Element, by: number) {
    fire(el, "pointerdown", { pointerId: 1, pointerType: "mouse", clientX: 150, clientY: 120 });
    fire(el, "pointermove", { pointerId: 1, pointerType: "mouse", clientX: 150 + by, clientY: 120 });
    await settle();
    fire(el, "pointerup", { pointerId: 1, pointerType: "mouse", clientX: 150 + by, clientY: 120 });
  }

  test("flowchart: the keyboard leaving it writes the chart at once", async () => {
    const e = await mount([para("a", "one"), block("flowchart", "f", FLOW)]);
    await drag(one('[data-fc-node="a"]'), 80);
    expect(shapeX(e, "a")).toBe(100);
    act(() => (document.activeElement as HTMLElement).blur());
    expect(shapeX(e, "a")).toBeGreaterThan(150);
  });

  test("flowchart: Escape back to the note writes the chart before the block is selected", async () => {
    const e = await mount([para("a", "one"), block("flowchart", "f", FLOW)]);
    await drag(one('[data-fc-node="a"]'), 80);
    const order: string[] = [];
    e.on("transaction", ({ transaction }) => {
      if (transaction.docChanged) order.push("chart");
      else if (transaction.selectionSet && transaction.selection instanceof NodeSelection) order.push("selected");
    });
    const escape = () => act(() => void one(".fc-canvas").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    // (The first Escape lets go of the shape, the second leaves the canvas.)
    escape();
    escape();
    expect(order.slice(0, 2)).toEqual(["chart", "selected"]);
    expect(shapeX(e, "a")).toBeGreaterThan(150);
  });

  test("wireframe: the keyboard leaving it writes the wireframe at once", async () => {
    const e = await mount([para("a", "one"), block("wireframe", "w", WIRE)]);
    await drag(one('[data-wf-item="i1"]'), 60);
    expect(itemX(e)).toBe(20);
    act(() => (document.activeElement as HTMLElement).blur());
    expect(itemX(e)).toBeGreaterThan(40);
  });
});
