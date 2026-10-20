// Present and Follow a path (interactions/walkthrough.tsx, chrome/WalkBar.tsx): what a walk lights, the
// scoped style rules that dim the rest, the ways on along a path, what the bars announce, and the
// read-only view's picture (FlowchartStatic.tsx).
import { describe, expect, test } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { flowGraph, flowchart, newEdge, pathsBetween, serializeFlowchart, type FlowNode, type FlowShape } from "@folevi/editor-schema";

const walkthrough = await import("@/components/editor/flowchart/interactions/walkthrough");
const bar = await import("@/components/editor/flowchart/chrome/WalkBar");
const staticView = await import("@/components/editor/flowchart/FlowchartStatic");
const { walkLight, walkCss, waysOn } = walkthrough;

const node = (id: string, x: number, y: number, shape: FlowShape = "process", extra: Partial<FlowNode> = {}): FlowNode => ({ id, shape, x, y, w: 120, h: 56, text: id, color: "neutral", ...extra });
const edge = (id: string, from: string, to: string, label = "") => ({ ...newEdge(from, to), id, labels: label ? [{ text: label, at: 0.5 }] : [] });
const fc = flowchart({
  nodes: [node("start", 200, 0, "terminator"), node("check", 200, 120, "decision"), node("fix", 420, 120), node("ship", 200, 240), node("done", 200, 360, "terminator")],
  edges: [edge("e1", "start", "check"), edge("e2", "check", "ship", "Yes"), edge("e3", "check", "fix", "No"), edge("e4", "fix", "check"), edge("e5", "ship", "done")],
});
const graph = flowGraph(fc);

describe("what a walk lights", () => {
  test("presenting: the current shape and the connector into it; the trail and the ways on half", () => {
    const walk = { kind: "present" as const, trail: [{ node: "start", via: null }, { node: "check", via: "e1" }], path: null, ownFull: true };
    const light = walkLight(graph, walk);
    expect(light.on).toEqual({ nodes: ["check"], edges: ["e1"] });
    expect(new Set(light.near.nodes)).toEqual(new Set(["start", "check", "ship", "fix"]));
    expect(new Set(light.near.edges)).toEqual(new Set(["e1", "e2", "e3"]));
    expect(light.ring).toEqual(["check"]);
    expect(waysOn(graph, walk).map((s) => s.to)).toEqual(["ship", "fix"]);
  });
  test("along a path, only the path's next step is a way on", () => {
    const path = pathsBetween(fc, "fix", "done")[0]!;
    const walk = { kind: "present" as const, trail: [{ node: "fix", via: null }, { node: "check", via: "e4" }], path, ownFull: false };
    expect(waysOn(graph, walk).map((s) => s.edge.id)).toEqual(["e2"]);
    expect(waysOn(graph, { ...walk, trail: [...walk.trail, { node: "ship", via: "e2" }, { node: "done", via: "e5" }] })).toEqual([]);
  });
  test("paths: one path, or all of them, with rings on the two ends", () => {
    const paths = [
      { nodes: ["start", "check", "ship", "done"], edges: ["e1", "e2", "e5"] },
      { nodes: ["start", "check", "fix"], edges: ["e1", "e3"], loop: { edge: "e4", to: "check" } },
    ];
    const one = walkLight(graph, { kind: "paths", from: "start", to: null, paths, index: 1, all: false, ownFull: false });
    expect(new Set(one.on.nodes)).toEqual(new Set(["start", "check", "fix"]));
    expect(new Set(one.on.edges)).toEqual(new Set(["e1", "e3", "e4"]));
    expect(one.ring).toEqual(["start"]);
    const all = walkLight(graph, { kind: "paths", from: "start", to: "done", paths, index: 0, all: true, ownFull: false });
    expect(all.on.nodes).toHaveLength(5);
    expect(all.ring).toEqual(["start", "done"]);
  });
  test("picking the ends dims nothing", () => {
    expect(walkLight(graph, { kind: "pick", from: "check", ownFull: false })).toEqual({ on: { nodes: [], edges: [] }, near: { nodes: [], edges: [] }, ring: ["check"] });
  });
});

describe("the dimming rules", () => {
  test("are scoped to the canvas, light by id, colour the lit connectors, and skip ids that aren't plain", () => {
    const css = walkCss("abc", { on: { nodes: ["n1"], edges: ["e1"] }, near: { nodes: ["n2", 'x"]{}*{color:red'], edges: [] }, ring: [] });
    expect(css).toContain('.fc-canvas.fc-canvas[data-fc-walk="abc"] [data-fc-node="n1"]');
    expect(css).toContain('[data-fc-edge="e1"]{--fc-ec:var(--fc-select)!important}');
    expect(css).toContain('[data-fc-node="n2"]{opacity:var(--fc-walk-near)}');
    expect(css).not.toContain("color:red");
    expect(walkCss("abc", { on: { nodes: [], edges: [] }, near: { nodes: [], edges: [] }, ring: [] })).toBe("");
  });
});

describe("the bars", () => {
  test("say where the walk is and where it can go", () => {
    expect(bar.presentAnnouncement(2, "In stock?", [{ id: "e2", label: "Yes", to: "Ship" }, { id: "e3", label: "", to: "Fix" }])).toBe("Step 2: In stock?. 2 ways on: 1, Yes, to Ship; 2, to Fix.");
    expect(bar.presentAnnouncement(1, "Start", [{ id: "e1", label: "", to: "Check" }])).toBe("Step 1: Start. Next: Check.");
    expect(bar.presentAnnouncement(5, "Done", [])).toBe("Step 5: Done. End of the flow.");
  });
  test("the present bar numbers the ways on and has a 44 point class on touch", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const chosen: number[] = [];
    await act(async () => {
      root.render(
        createElement(bar.PresentBar, {
          step: 2,
          name: "In stock?",
          ways: [
            { id: "e2", label: "Yes", to: "Ship" },
            { id: "e3", label: "No", to: "Fix" },
          ],
          onPath: false,
          canBack: true,
          onBack: () => undefined,
          onNext: () => undefined,
          onChoose: (i: number) => chosen.push(i),
          onRestart: () => undefined,
          onEnd: () => undefined,
          refocus: () => undefined,
        }),
      );
    });
    const ways = [...host.querySelectorAll<HTMLButtonElement>(".fc-walk-way")];
    expect(ways.map((b) => b.getAttribute("aria-label"))).toEqual(["1: Yes, to Ship", "2: No, to Fix"]);
    await act(async () => ways[1]!.click());
    expect(chosen).toEqual([1]);
    expect(host.querySelector('[role="status"]')?.textContent).toContain("2 ways on");
    act(() => root.unmount());
    host.remove();
  });
});

describe("the read-only picture", () => {
  test("renders on the server: the exports' light and dark drawings, the summary, images from fileUrls", () => {
    const withImage = flowchart({ nodes: [node("a", 0, 0, "process", { image: { fileId: "f1" }, w: 160, h: 140, text: "Photo" })], frames: [{ id: "fr", x: -20, y: -40, w: 220, h: 220, title: "Team", color: "blue" }] });
    const html = renderToString(createElement(staticView.FlowchartStatic, { data: serializeFlowchart(withImage), height: 440, fileUrls: { f1: "https://files.test/f1.png" } }));
    expect(html).toContain('role="img"');
    expect(html).toContain("Flowchart with 1 shape: Photo");
    expect(html).toContain('class="fc-static-light"');
    expect(html).toContain('class="fc-static-dark"');
    expect(html.match(/href="https:\/\/files.test\/f1.png"/g)).toHaveLength(2);
    expect(html.match(/>Team</g)).toHaveLength(2);
  });
  test("an empty chart says so", () => {
    expect(renderToString(createElement(staticView.FlowchartStatic, { data: "", height: 440 }))).toContain("Empty flowchart");
  });
  test("svgParts reads the drawing and its box", () => {
    expect(staticView.svgParts('<svg xmlns="x" viewBox="-24 -10.5 300 200" width="300"><g>hi</g></svg>')).toEqual({ inner: "<g>hi</g>", box: { x: -24, y: -10.5, w: 300, h: 200 } });
    expect(staticView.svgParts("<div></div>")).toBeNull();
  });
});
