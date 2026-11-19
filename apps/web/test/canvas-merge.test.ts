// Merging this device's unsaved canvas work with a change from elsewhere (components/editor/canvas/
// canvasMerge.ts), run through the real readers as the canvases do. From the 2026-11-19 canvas audit, V21: a
// reorder made here survives the merge, and a shape changed here that the other side deleted comes back with
// the connectors it had.
import { describe, expect, test } from "vitest";
import { parseFlowchart, parseMindmap, parseWireframe, serializeFlowchart, serializeMindmap, serializeWireframe } from "@folevi/editor-schema";
import { mergeCanvasData } from "@/components/editor/canvas/canvasMerge";

const shape = (id: string, x: number, y: number, text = id.toUpperCase()) => ({ id, shape: "process", x, y, w: 120, h: 60, text });
const chart = (nodes: unknown[], edges: unknown[] = []) => parseFlowchart(JSON.stringify({ v: 2, nodes, edges }));
const BASE = chart([shape("a", 0, 0), shape("x", 300, 0), shape("c", 0, 300)], [{ id: "e1", from: "a", to: "x" }]);
const read = (fc: ReturnType<typeof chart>) => parseFlowchart(serializeFlowchart(fc));

describe("merging a flowchart", () => {
  test("a shape moved here that they deleted comes back with its connector", () => {
    const theirs = { ...BASE, nodes: BASE.nodes.filter((n) => n.id !== "x"), edges: [] };
    const mine = { ...BASE, nodes: BASE.nodes.map((n) => (n.id === "x" ? { ...n, x: 400 } : n)) };
    const merged = read(mergeCanvasData(BASE, theirs, mine));
    expect(merged.nodes.map((n) => n.id).sort()).toEqual(["a", "c", "x"]);
    expect(merged.nodes.find((n) => n.id === "x")!.x).toBe(400);
    expect(merged.edges.map((e) => [e.id, e.from, e.to])).toEqual([["e1", "a", "x"]]);
  });

  test("a connector they deleted on its own stays deleted", () => {
    const theirs = { ...BASE, edges: [] };
    const mine = { ...BASE, nodes: BASE.nodes.map((n) => (n.id === "x" ? { ...n, x: 400 } : n)) };
    const merged = read(mergeCanvasData(BASE, theirs, mine));
    expect(merged.nodes.map((n) => n.id)).toEqual(["a", "x", "c"]);
    expect(merged.edges).toEqual([]);
  });

  test("a shape they deleted that was not touched here stays deleted, with the connector added to it here", () => {
    const theirs = { ...BASE, nodes: BASE.nodes.filter((n) => n.id !== "x"), edges: [] };
    const mine = { ...BASE, edges: [...BASE.edges, { ...BASE.edges[0]!, id: "e2", from: "c", to: "x" }] };
    const merged = read(mergeCanvasData(BASE, theirs, mine));
    expect(merged.nodes.map((n) => n.id)).toEqual(["a", "c"]);
    expect(merged.edges).toEqual([]);
  });

  test("an order changed here (a shape brought to the front) is kept, with their edit and their new shape", () => {
    const mine = { ...BASE, nodes: [BASE.nodes[1]!, BASE.nodes[2]!, BASE.nodes[0]!] };
    const theirs = { ...BASE, nodes: [...BASE.nodes.map((n) => (n.id === "c" ? { ...n, text: "C2" } : n)), { ...BASE.nodes[0]!, id: "n", x: 600 }] };
    const merged = mergeCanvasData(BASE, theirs, mine);
    expect(merged.nodes.map((n) => n.id)).toEqual(["x", "c", "a", "n"]);
    expect(merged.nodes.find((n) => n.id === "c")!.text).toBe("C2");
  });

  test("with no order changed here, theirs is followed", () => {
    const theirs = { ...BASE, nodes: [BASE.nodes[2]!, BASE.nodes[0]!, BASE.nodes[1]!] };
    const mine = { ...BASE, nodes: BASE.nodes.map((n) => (n.id === "a" ? { ...n, text: "A2" } : n)) };
    const merged = mergeCanvasData(BASE, theirs, mine);
    expect(merged.nodes.map((n) => n.id)).toEqual(["c", "a", "x"]);
    expect(merged.nodes.find((n) => n.id === "a")!.text).toBe("A2");
  });
});

describe("merging a mind map and a wireframe", () => {
  test("siblings put in a new order here stay in it while they edit one of them", () => {
    const base = parseMindmap(JSON.stringify({ v: 1, nodes: [{ id: "r", parent: null, text: "root" }, { id: "s1", parent: "r", text: "1" }, { id: "s2", parent: "r", text: "2" }] }));
    const mine = { ...base, nodes: [base.nodes[0]!, base.nodes[2]!, base.nodes[1]!] };
    const theirs = { ...base, nodes: base.nodes.map((n) => (n.id === "s1" ? { ...n, text: "1!" } : n)) };
    const merged = parseMindmap(serializeMindmap(mergeCanvasData(base, theirs, mine)));
    expect(merged.nodes.map((n) => n.id)).toEqual(["r", "s2", "s1"]);
    expect(merged.nodes.find((n) => n.id === "s1")!.text).toBe("1!");
  });

  test("a screen moved here that they deleted comes back with the link to it", () => {
    const base = parseWireframe(
      JSON.stringify({
        v: 1,
        screens: [
          { id: "s1", name: "Home", frame: "phone", x: 0, y: 0, w: 320, h: 640 },
          { id: "s2", name: "Two", frame: "phone", x: 500, y: 0, w: 320, h: 640 },
        ],
        items: [],
        links: [{ id: "l1", from: "s1", to: "s2" }],
      }),
    );
    const theirs = { ...base, screens: base.screens.filter((s) => s.id !== "s2"), links: [] };
    const mine = { ...base, screens: base.screens.map((s) => (s.id === "s2" ? { ...s, x: 700 } : s)) };
    const merged = parseWireframe(serializeWireframe(mergeCanvasData(base, theirs, mine)));
    expect(merged.screens.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(merged.links.map((l) => [l.from, l.to])).toEqual([["s1", "s2"]]);
  });
});
