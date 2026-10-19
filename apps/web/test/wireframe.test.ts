// The wireframe block's drawing (components/editor/wireframe/draw.ts), export (svg.ts) and edits (ops.ts).
import { describe, expect, test } from "vitest";
import { WIREFRAME_COMPONENTS, serializeWireframe, wireframeDataIssue, wireframeFromDraft, type WireframeData } from "@folevi/editor-schema";
import { drawItem, fitText, linkPaths, wireframeBounds, wireframeToSvg, wrapText } from "@/components/editor/wireframe/draw";
import { wireframeScreenSvg, wireframeSvg } from "@/components/editor/wireframe/svg";
import {
  WireHistory,
  addLink,
  addPart,
  addScreen,
  align,
  deleteSelection,
  distribute,
  duplicate,
  moveItems,
  placeScreens,
  replaceScreen,
  resizeScreen,
  setFrame,
  snapBox,
} from "@/components/editor/wireframe/ops";

const valid = (wf: WireframeData) => expect(wireframeDataIssue(serializeWireframe(wf))).toBeNull();

function sample(): WireframeData {
  return wireframeFromDraft({
    screens: [
      { id: "a", name: "Sign in", frame: "phone", parts: [{ id: "h", kind: "heading", text: "Welcome <back>" }, { id: "b", kind: "button", text: "Sign in", goesTo: "Home" }] },
      { id: "c", name: "Home", frame: "phone", parts: [{ id: "n", kind: "navBar", text: "Home" }] },
    ],
  });
}

describe("drawing", () => {
  test("every part draws in both looks, the same way every time, with what people wrote escaped", () => {
    for (const style of ["clean", "sketch"] as const) {
      for (const kind of WIREFRAME_COMPONENTS) {
        const it = { id: `x-${kind}`, screen: "s", kind, x: 0, y: 0, w: 240, h: 160, text: `<script>alert(1)</script>\nTwo & "three"` };
        const svg = drawItem(it, style, { w: 390, h: 844, frame: "phone" });
        expect(svg.length).toBeGreaterThan(20);
        expect(svg).not.toMatch(/<script/);
        expect(svg).not.toContain("NaN");
        expect(drawItem(it, style)).toBe(drawItem(it, style));
      }
    }
    const clean = drawItem({ id: "b", screen: "s", kind: "button", x: 0, y: 0, w: 120, h: 48, text: "Go" }, "clean");
    const sketch = drawItem({ id: "b", screen: "s", kind: "button", x: 0, y: 0, w: 120, h: 48, text: "Go" }, "sketch");
    expect(clean).toContain("<rect");
    expect(sketch).toContain("<path");
    expect(sketch).not.toBe(clean);
  });

  test("text fits: shortened with an ellipsis, wrapped into lines", () => {
    expect(fitText("Short", 200, 14, false)).toBe("Short");
    expect(fitText("A very long button label indeed", 60, 14, false)).toMatch(/…$/);
    const lines = wrapText("one two three four five six seven eight nine ten", 60, 14, false, 3);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toMatch(/…$/);
  });

  test("export: a standalone SVG of every screen, or one, with its own light stylesheet", () => {
    const wf = sample();
    const svg = wireframeToSvg(wf)!;
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect(svg).toContain("<style>");
    expect(svg).toContain("Welcome &lt;back&gt;");
    expect(svg).not.toContain("Welcome <back>");
    expect(svg).toContain("Sign in");
    expect(svg).toContain("s-link");
    expect(wireframeToSvg({ ...wf, style: "sketch" })!).toContain('font-family:"Mali"');
    const data = serializeWireframe(wf);
    expect(wireframeSvg(data, 520)).toBe(svg);
    const one = wireframeScreenSvg(data, "c")!;
    expect(one).toContain("Home");
    expect(one).not.toContain("Sign in");
    expect(wireframeScreenSvg(data, "nope")).toBeNull();
    expect(wireframeSvg("", 520)).toBeNull();
    expect(wireframeBounds(wf)!.w).toBeGreaterThan(780);
    expect(linkPaths(wf)).toHaveLength(1);
  });
});

describe("edits", () => {
  test("screens go to the right of the others; parts stack under the last one", () => {
    let wf = sample();
    const s = addScreen(wf, "browser")!;
    wf = s.doc;
    const browser = wf.screens.find((x) => x.id === s.id)!;
    expect(browser.x).toBeGreaterThan(wf.screens[1]!.x + wf.screens[1]!.w);
    expect(browser.name).toBe("Screen 3");
    const p1 = addPart(wf, s.id, "input")!;
    const p2 = addPart(p1.doc, s.id, "button")!;
    const [i1, i2] = [p1.id, p2.id].map((id) => p2.doc.items.find((i) => i.id === id)!);
    expect(i2!.y).toBeGreaterThan(i1!.y + i1!.h);
    valid(p2.doc);
  });

  test("a part dropped over another screen moves onto it, and stays inside it", () => {
    const wf = sample();
    const b = wf.items.find((i) => i.id === "b")!;
    const home = wf.screens.find((s) => s.id === "c")!;
    const moved = moveItems(wf, new Map([["b", { x: b.x, y: b.y }]]), home.x - wf.screens[0]!.x, 0);
    expect(moved.items.find((i) => i.id === "b")!.screen).toBe("c");
    const off = moveItems(wf, new Map([["b", { x: b.x, y: b.y }]]), 0, 99_999);
    const kept = off.items.find((i) => i.id === "b")!;
    expect(kept.screen).toBe("a");
    expect(kept.y + kept.h).toBeLessThanOrEqual(844);
    valid(off);
  });

  test("resizing a screen keeps its parts inside; a new frame takes its size", () => {
    const wf = sample();
    const small = resizeScreen(wf, "a", { x: 0, y: 0, w: 200, h: 300 });
    for (const it of small.items.filter((i) => i.screen === "a")) expect(it.x + it.w).toBeLessThanOrEqual(200);
    valid(small);
    const tablet = setFrame(wf, ["a"], "tablet");
    expect(tablet.screens[0]).toMatchObject({ frame: "tablet", w: 820, h: 1180 });
  });

  test("deleting a screen takes its parts and every link to or from them", () => {
    const wf = sample();
    expect(wf.links).toHaveLength(1);
    const out = deleteSelection(wf, { screens: ["c"], items: [], links: [] });
    expect(out.screens.map((s) => s.id)).toEqual(["a"]);
    expect(out.links).toEqual([]);
    expect(out.items.some((i) => i.screen === "c")).toBe(false);
    const noButton = deleteSelection(wf, { screens: [], items: ["b"], links: [] });
    expect(noButton.links).toEqual([]);
  });

  test("duplicating copies parts beside themselves, and screens with their parts and inner links", () => {
    const wf = sample();
    const parts = duplicate(wf, { screens: [], items: ["h"], links: [] });
    expect(parts.doc.items).toHaveLength(wf.items.length + 1);
    const both = addLink(wf, "a", "c")!.doc;
    const screens = duplicate(both, { screens: ["a", "c"], items: [], links: [] });
    expect(screens.doc.screens).toHaveLength(4);
    expect(screens.doc.items).toHaveLength(wf.items.length * 2);
    expect(screens.doc.links).toHaveLength(both.links.length * 2);
    valid(screens.doc);
  });

  test("align and distribute; one part aligns to its screen", () => {
    let wf = sample();
    for (const [x, y] of [[80, 420], [150, 470], [300, 440]] as const) wf = addPart(wf, "a", "avatar", { x, y })!.doc;
    const ids = wf.items.filter((i) => i.kind === "avatar").map((i) => i.id);
    const top = align(wf, ids, "top");
    expect(new Set(top.items.filter((i) => ids.includes(i.id)).map((i) => i.y)).size).toBe(1);
    const spaced = distribute(top, ids, "x");
    const xs = spaced.items.filter((i) => ids.includes(i.id)).map((i) => i.x).sort((p, q) => p - q);
    expect(Math.abs(xs[1]! - xs[0]! - (xs[2]! - xs[1]!))).toBeLessThanOrEqual(1);
    const centred = align(wf, ["b"], "center");
    const b = centred.items.find((i) => i.id === "b")!;
    expect(Math.round(b.x + b.w / 2)).toBe(195);
  });

  test("links go to other screens only, once", () => {
    const wf = sample();
    expect(addLink(wf, "b", "a")).toBeNull();
    expect(addLink(wf, "b", "c")!.doc).toBe(wf);
    expect(addLink(wf, "c", "b")).toBeNull();
    expect(addLink(wf, "c", "a")!.doc.links).toHaveLength(2);
  });

  test("Foli AI's screens get new ids and a place; refine swaps one screen's parts", () => {
    const wf = sample();
    const incoming = wireframeFromDraft({ screens: [{ id: "a", name: "Variant", parts: [{ id: "h", kind: "text", text: "Hi" }] }] });
    const placed = placeScreens(wf, incoming, { x: 2000, y: 0 });
    expect(placed.ids).toHaveLength(1);
    expect(placed.ids[0]).not.toBe("a");
    expect(placed.doc.screens.find((s) => s.id === placed.ids[0])!.x).toBe(2000);
    valid(placed.doc);
    const refined = replaceScreen(wf, "a", incoming);
    expect(refined.items.filter((i) => i.screen === "a").map((i) => i.text)).toEqual(["Hi"]);
    expect(refined.screens.find((s) => s.id === "a")!.name).toBe("Sign in");
    // The button that linked out is gone, and so is its link.
    expect(refined.links).toEqual([]);
    valid(refined);
  });

  test("snapping: to the nearest line within reach, with a guide; else to the grid", () => {
    const r = snapBox({ x: 13, y: 52, w: 100, h: 40 }, { x: [16], y: [] }, 6, 4, { x: [0, 390], y: [0, 844] });
    expect(r.dx).toBe(3);
    expect(r.guides).toEqual([{ axis: "x", at: 16, from: 0, to: 844 }]);
    expect(r.dy).toBe(0);
  });

  test("history: undo, redo, and quick nudges as one step", () => {
    const h = new WireHistory<number>();
    h.push(1, "nudge", 0);
    h.push(2, "nudge", 100);
    expect(h.undo(3)).toBe(1);
    expect(h.redo(1)).toBe(3);
    expect(h.canUndo).toBe(true);
  });
});
