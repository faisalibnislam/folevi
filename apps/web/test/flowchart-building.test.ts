// Building a flowchart faster: quick add (the + arrows and Tab), sibling branches (Shift+Tab), shapes
// created where a connector was dropped, arrow-key neighbours, and the shape picker.
import { describe, expect, test } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { flowchart, newEdge, rectsOverlap, type FlowchartData, type FlowNode } from "@folevi/editor-schema";

const building = await import("@/components/editor/flowchart/building");
const picker = await import("@/components/editor/flowchart/chrome/ShapePicker");
const { addConnectedAt, circleHitsRect, connectionHandles, containerGrabRects, flowSide, neighbourInDirection, nextShapeKind, quickAdd, quickBranch } = building;

const node = (id: string, x = 0, y = 0, extra: Partial<FlowNode> = {}): FlowNode => ({ id, shape: "process", x, y, w: 160, h: 64, text: id, color: "neutral", ...extra });
const chart = (nodes: FlowNode[], edges: [string, string][] = []): FlowchartData => flowchart({ nodes, edges: edges.map(([from, to], i) => newEdge(from, to, { id: `e${i}`, fromSide: "bottom", toSide: "top" })) });
const byId = (fc: FlowchartData, id: string) => fc.nodes.find((n) => n.id === id)!;
const noOverlaps = (fc: FlowchartData) => {
  for (const a of fc.nodes) for (const b of fc.nodes) if (a !== b && rectsOverlap(a, b)) return false;
  return true;
};

describe("next shape kind", () => {
  test("is the same kind, except a process after a start or end pill or bare text", () => {
    expect(nextShapeKind("process")).toBe("process");
    expect(nextShapeKind("decision")).toBe("decision");
    expect(nextShapeKind("database")).toBe("database");
    expect(nextShapeKind("terminator")).toBe("process");
    expect(nextShapeKind("text")).toBe("process");
  });
});

describe("quick add", () => {
  test("adds the next shape below, connected from that side, centred under the source and clear of it", () => {
    const fc = chart([node("a", 0, 0, { color: "blue" })]);
    const res = quickAdd(fc, "a", "bottom")!;
    const added = byId(res.doc, res.id);
    expect(added.shape).toBe("process");
    expect(added.color).toBe("blue");
    expect(added.text).toBe("");
    expect(added.x + added.w / 2).toBe(80);
    expect(added.y).toBeGreaterThan(64);
    const edge = res.doc.edges.find((e) => e.id === res.edge)!;
    expect(edge).toMatchObject({ from: "a", to: res.id, fromSide: "bottom", toSide: "top" });
    expect(noOverlaps(res.doc)).toBe(true);
  });

  test("keeps the source's size for the same kind, and the library size for another", () => {
    const fc = chart([node("a", 0, 0, { w: 240, h: 96 }), node("s", 400, 0, { shape: "terminator", w: 160, h: 56 })]);
    const same = quickAdd(fc, "a", "right")!;
    expect(byId(same.doc, same.id)).toMatchObject({ w: 240, h: 96 });
    const after = quickAdd(fc, "s", "bottom")!;
    expect(byId(after.doc, after.id)).toMatchObject({ shape: "process", w: 160, h: 64 });
  });

  test("a second add from the same side goes beside the first child, in the same row", () => {
    let fc = chart([node("a", 0, 0)]);
    const first = quickAdd(fc, "a", "bottom")!;
    fc = first.doc;
    const second = quickAdd(fc, "a", "bottom")!;
    const one = byId(second.doc, first.id);
    const two = byId(second.doc, second.id);
    expect(two.y).toBe(one.y);
    expect(two.x).toBeGreaterThan(one.x + one.w);
    expect(noOverlaps(second.doc)).toBe(true);
  });

  test("never lands on a shape already in the way", () => {
    const fc = chart([node("a", 0, 0), node("b", 0, 128), node("c", 200, 128), node("d", -200, 128)]);
    const res = quickAdd(fc, "a", "bottom")!;
    expect(noOverlaps(res.doc)).toBe(true);
  });

  test("stops at the shape limit and for a missing source", () => {
    expect(quickAdd(chart([node("a")]), "nope", "bottom")).toBeNull();
    const many = chart(Array.from({ length: 500 }, (_, i) => node(`n${i}`, (i % 25) * 200, Math.floor(i / 25) * 100)));
    expect(quickAdd(many, "n0", "bottom")).toBeNull();
  });

  test("a shape inside a frame or lane stays in it", () => {
    const fc = chart([node("a", 0, 0, { parent: "lane1" })]);
    const res = quickAdd(fc, "a", "right")!;
    expect(byId(res.doc, res.id).parent).toBe("lane1");
  });
});

describe("flow direction and branches", () => {
  test("a top-down chart grows down, a left-to-right one grows right", () => {
    expect(flowSide(chart([node("a", 0, 0), node("b", 0, 200)], [["a", "b"]]))).toBe("bottom");
    const lr = flowchart({ nodes: [node("a", 0, 0), node("b", 300, 0), node("c", 600, 0)], edges: [newEdge("a", "b", { fromSide: "right", toSide: "left" }), newEdge("b", "c", { fromSide: "right", toSide: "left" })] });
    expect(flowSide(lr)).toBe("right");
  });

  test("Shift+Tab adds a sibling: another child of the same parent, beside it", () => {
    const start = chart([node("a", 0, 0)]);
    const child = quickAdd(start, "a", "bottom")!;
    const res = quickBranch(child.doc, child.id)!;
    const c = byId(res.doc, child.id);
    const sib = byId(res.doc, res.id);
    expect(sib.y).toBe(c.y);
    expect(Math.abs(sib.x - c.x)).toBeGreaterThanOrEqual(c.w);
    const edge = res.doc.edges.find((e) => e.id === res.edge)!;
    expect(edge).toMatchObject({ from: "a", to: res.id });
    expect(noOverlaps(res.doc)).toBe(true);
  });

  test("a sibling of a shape nothing leads to sits beside it, unconnected", () => {
    const res = quickBranch(chart([node("a", 0, 0)]), "a")!;
    expect(res.edge).toBeNull();
    expect(res.doc.edges).toHaveLength(0);
    expect(byId(res.doc, res.id).x).toBeGreaterThan(160);
  });
});

describe("a connector dropped on empty canvas", () => {
  test("the chosen shape's facing side sits where it was let go, connected", () => {
    const fc = chart([node("a", 0, 0)]);
    const res = addConnectedAt(fc, "a", "right", "decision", { x: 400, y: 32 })!;
    const d = byId(res.doc, res.id);
    expect(d.shape).toBe("decision");
    expect(Math.abs(d.x - 400)).toBeLessThanOrEqual(8);
    expect(Math.abs(d.y + d.h / 2 - 32)).toBeLessThanOrEqual(8);
    expect(res.doc.edges.find((e) => e.id === res.edge)).toMatchObject({ from: "a", to: res.id, fromSide: "right", toSide: "left" });
  });
});

describe("arrow keys", () => {
  // a → b → c down the middle; x off to the right of b; y far down-left.
  const fc = chart([node("a", 0, 0), node("b", 0, 160), node("c", 0, 320), node("x", 300, 170), node("y", -500, 700)], [["a", "b"], ["b", "c"]]);

  test("move along connectors in their direction", () => {
    expect(neighbourInDirection(fc, "a", "bottom")).toBe("b");
    expect(neighbourInDirection(fc, "b", "bottom")).toBe("c");
    expect(neighbourInDirection(fc, "c", "top")).toBe("b");
  });

  test("reach unconnected neighbours to the side, and nothing where there is nothing", () => {
    expect(neighbourInDirection(fc, "b", "right")).toBe("x");
    expect(neighbourInDirection(fc, "x", "left")).toBe("b");
    expect(neighbourInDirection(fc, "a", "top")).toBeNull();
    expect(neighbourInDirection(fc, "a", "left")).toBeNull();
  });

  test("prefer a connected shape over a slightly nearer loose one", () => {
    const g = chart([node("a", 0, 0), node("near", 40, 150), node("linked", 0, 190)], [["a", "linked"]]);
    expect(neighbourInDirection(g, "a", "bottom")).toBe("linked");
  });
});

describe("frames and swimlanes", () => {
  test("their title bands and lane headers are where the + arrows keep off", () => {
    const fc = flowchart({
      nodes: [node("a", 40, 60, { parent: "f" })],
      frames: [{ id: "f", x: 0, y: 0, w: 400, h: 300, title: "Sign up", color: "neutral" }, { id: "g", x: 500, y: 0, w: 200, h: 200, title: "", color: "neutral" }],
      pools: [{ id: "p", x: 0, y: 400, orient: "rows", title: "Team", length: 600, lanes: [{ id: "l1", title: "Sales", size: 160, color: "neutral" }, { id: "l2", title: "Ops", size: 160, color: "neutral" }] }],
    });
    const rects = containerGrabRects(fc);
    expect(rects[0]).toEqual({ x: 0, y: 0, w: 400, h: 32 });
    expect(rects[1]!.h).toBe(12);
    // The pool's title band and both lane headers.
    expect(rects).toHaveLength(5);
    // The selected shape's top arrow, 40 above it, lands on the frame's title band.
    expect(rects.some((r) => circleHitsRect({ x: 120, y: 20 }, 14, r))).toBe(true);
    expect(rects.some((r) => circleHitsRect({ x: 120, y: 200 }, 14, r))).toBe(false);
  });

  test("connection points that would cover a frame's or lane's title band stay hidden", () => {
    const fc = flowchart({
      nodes: [node("a", 40, 44, { parent: "f" }), node("b", 40, 160, { parent: "f" }), node("c", 60, 460)],
      edges: [],
      frames: [{ id: "f", x: 0, y: 0, w: 400, h: 300, title: "Sign up", color: "neutral" }],
      pools: [{ id: "p", x: 0, y: 400, orient: "rows", title: "Team", length: 600, lanes: [{ id: "l1", title: "Sales", size: 160, color: "neutral" }] }],
    });
    const grabs = containerGrabRects(fc);
    const sides = (id: string) => connectionHandles(byId(fc, id), 14, 12, grabs).map((h) => h.side);
    // Just under the frame's title: the top point would sit on the band.
    expect(sides("a")).toEqual(["right", "bottom", "left"]);
    // Clear of the band: all four.
    expect(sides("b")).toEqual(["top", "right", "bottom", "left"]);
    // Next to the lane's header: the left point would sit on it.
    expect(sides("c")).not.toContain("left");
    // Each point sits just outside the middle of its side.
    expect(connectionHandles(byId(fc, "b"), 14, 12, grabs)[0]).toEqual({ side: "top", at: { x: 120, y: 146 } });
    // With nothing to keep off, every side has one.
    expect(connectionHandles(byId(fc, "a"), 14, 12, [])).toHaveLength(4);
  });
});

describe("shape picker", () => {
  const mount = (onPick: (s: string) => void, onClose: (refocus: boolean) => void = () => {}) => {
    const el = document.createElement("div");
    document.body.append(el);
    const root = createRoot(el);
    act(() => root.render(createElement(picker.ShapePicker, { left: 0, top: 0, maxHeight: 300, onPick, onClose })));
    return { el, root };
  };
  const type = (input: HTMLInputElement, value: string) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const key = (input: HTMLInputElement, k: string) => act(() => void input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));

  test("lists recent shapes first, searches, and picks with the keyboard", () => {
    window.localStorage.removeItem("folevi.flowchart.recentShapes");
    picker.rememberShape("database");
    expect(picker.recentShapes()[0]).toBe("database");
    const picked: string[] = [];
    const { el, root } = mount((s) => picked.push(s));
    const options = () => [...el.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    expect(options()[0]).toBe("Database");
    expect(el.textContent).toContain("Recent");
    const input = el.querySelector("input")!;
    expect(input.getAttribute("role")).toBe("combobox");
    expect(document.activeElement).toBe(input);
    type(input, "decis");
    expect(options()[0]).toBe("Decision");
    key(input, "Enter");
    expect(picked).toEqual(["decision"]);
    type(input, "doc");
    key(input, "ArrowDown");
    key(input, "Enter");
    expect(picked[1]).toBe("documents");
    type(input, "zzzz");
    expect(el.textContent).toContain("No shape matches");
    act(() => root.unmount());
    el.remove();
  });

  test("Escape closes and gives the keyboard back", () => {
    const closed: boolean[] = [];
    const { el, root } = mount(
      () => {},
      (r) => closed.push(r),
    );
    key(el.querySelector("input")!, "Escape");
    expect(closed).toEqual([true]);
    act(() => root.unmount());
    el.remove();
  });

  test("remembers at most five recent shapes, newest first, ignoring junk in storage", () => {
    window.localStorage.setItem("folevi.flowchart.recentShapes", JSON.stringify(["nope", 3, "delay"]));
    expect(picker.recentShapes()).toEqual(["delay"]);
    for (const s of ["process", "decision", "io", "note", "circle", "database"] as const) picker.rememberShape(s);
    expect(picker.recentShapes()).toEqual(["database", "circle", "note", "io", "decision"]);
  });
});
