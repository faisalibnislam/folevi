// The deterministic flowchart check (flowchartCheck.ts): what it finds, what it leaves alone, and the layout
// numbers behind "Tidy up with Foli AI".
import { describe, expect, test } from "vitest";
import { checkFlowchart, flowchart, layoutFlowchart, layoutNeedsHelp, layoutStats, newEdge, withLabel, type FlowEdge, type FlowNode, type FlowShape } from "../src";

let y = 0;
const node = (id: string, text: string, shape: FlowShape = "process", extra: Partial<FlowNode> = {}): FlowNode => ({ id, shape, x: 0, y: (y += 100), w: 160, h: 64, text, color: "neutral", ...extra });
const edge = (from: string, to: string, label = "", extra: Partial<FlowEdge> = {}) => ({ ...withLabel(newEdge(from, to), label), ...extra });
const kinds = (fc: ReturnType<typeof flowchart>) => checkFlowchart(fc).map((i) => [i.kind, i.nodes.join(",")]);

describe("checkFlowchart", () => {
  test("a clean flow has nothing to report", () => {
    const fc = flowchart({
      nodes: [node("s", "Start", "terminator"), node("a", "Fill in the form"), node("q", "Valid?", "decision"), node("e", "Done", "terminator"), node("tip", "Remember to save", "note")],
      edges: [edge("s", "a"), edge("a", "q"), edge("q", "e", "Yes"), edge("q", "a", "No")],
    });
    expect(checkFlowchart(fc)).toEqual([]);
    expect(checkFlowchart(flowchart())).toEqual([]);
  });

  test("dead ends, unlabelled branches and one-way decisions", () => {
    const fc = flowchart({
      nodes: [node("s", "Start", "terminator"), node("q", "Approved?", "decision"), node("a", "Ship it"), node("b", "Rework"), node("q2", "Urgent?", "decision"), node("c", "Call them"), node("e", "End", "terminator")],
      edges: [edge("s", "q"), edge("q", "a", "Yes"), edge("q", "b"), edge("b", "q2"), edge("q2", "c"), edge("c", "e")],
    });
    const issues = checkFlowchart(fc);
    expect(issues.map((i) => [i.kind, i.nodes.join(",")])).toEqual([
      ["deadEnd", "a"],
      ["oneWayDecision", "q2"],
      ["unlabelledBranch", "q"],
    ]);
    const branch = issues.find((i) => i.kind === "unlabelledBranch")!;
    expect(branch.edges).toEqual([fc.edges[2]!.id]);
    expect(branch.message).toBe("A branch out of the decision “Approved?” has no label (such as Yes or No).");
    expect(issues[0]!.message).toContain("“Ship it” is a dead end");
    // Steps whose words say the flow ends, and off-page links, aren't dead ends.
    const ends = flowchart({ nodes: [node("s", "Start", "terminator"), node("a", "Order cancelled"), node("b", "Continue", "offPage")], edges: [edge("s", "a"), edge("s", "b")] });
    expect(kinds(ends)).toEqual([]);
  });

  test("shapes nothing leads to, and shapes that aren't connected", () => {
    const fc = flowchart({
      nodes: [node("s", "Start", "terminator"), node("a", "Pack"), node("e", "End", "terminator"), node("x", "Orphan step"), node("y", "Its follow up"), node("z", "Lonely")],
      edges: [edge("s", "a"), edge("a", "e"), edge("x", "y"), edge("y", "e")],
    });
    expect(kinds(fc)).toEqual([
      ["unreachable", "x,y"],
      ["unconnected", "z"],
    ]);
    expect(checkFlowchart(fc)[0]!.message).toBe("Nothing leads to “Orphan step” and the 1 shape after it.");
    // No start shape: every shape nothing leads into is a start, so nothing is unreachable.
    const noStart = flowchart({ nodes: [node("a", "Open"), node("b", "Read"), node("c", "Write")], edges: [edge("a", "b"), edge("c", "b"), edge("b", "a", "", { start: "arrow", end: "none" })] });
    expect(kinds(noStart).filter(([k]) => k === "unreachable")).toEqual([]);
    // Shapes alone on a canvas with no connectors yet are just being drawn.
    expect(kinds(flowchart({ nodes: [node("a", "One"), node("b", "Two")] }))).toEqual([]);
  });

  test("loops with no way out, but not loops that leave or reach an end", () => {
    const stuck = flowchart({
      nodes: [node("s", "Start", "terminator"), node("a", "Try again"), node("b", "Wait"), node("c", "Check")],
      edges: [edge("s", "a"), edge("a", "b"), edge("b", "c"), edge("c", "a")],
    });
    const issues = checkFlowchart(stuck);
    expect(issues.map((i) => i.kind)).toEqual(["loopNoExit"]);
    expect(issues[0]!.nodes).toEqual(["a", "b", "c"]);
    expect(issues[0]!.edges).toHaveLength(3);
    const leaves = flowchart({ nodes: [...stuck.nodes, node("e", "End", "terminator")], edges: [...stuck.edges, edge("c", "e")] });
    expect(kinds(leaves)).toEqual([]);
  });

  test("shapes with no text, except symbols, images and icons", () => {
    const fc = flowchart({
      nodes: [node("s", "Start", "terminator"), node("a", ""), node("j", "", "connector"), node("i", "", "process", { icon: { name: "user" } }), node("e", "End", "terminator")],
      edges: [edge("s", "a"), edge("a", "j"), edge("j", "i"), edge("i", "e")],
    });
    expect(kinds(fc)).toEqual([["noText", "a"]]);
  });

  test("a connector drawn backwards leads the way its head points", () => {
    const fc = flowchart({ nodes: [node("s", "Start", "terminator"), node("a", "Step"), node("e", "End", "terminator")], edges: [edge("s", "a"), edge("e", "a", "", { start: "arrow", end: "none" })] });
    expect(kinds(fc)).toEqual([]);
  });
});

describe("layoutStats", () => {
  test("counts overlapping shapes and crossings, and says when a smarter tidy is worth offering", () => {
    const pile = flowchart({ nodes: [node("a", "A", "process", { y: 0 }), node("b", "B", "process", { y: 10 }), node("c", "C", "process", { y: 400 })], edges: [edge("a", "c")] });
    expect(layoutStats(pile).overlaps).toBe(1);
    expect(layoutNeedsHelp(layoutStats(pile), 1)).toBe(true);
    const tidy = layoutFlowchart(pile);
    expect(layoutStats(tidy)).toEqual({ crossings: 0, overlaps: 0 });
    expect(layoutNeedsHelp(layoutStats(tidy), 1)).toBe(false);
    expect(layoutNeedsHelp({ crossings: 3, overlaps: 0 }, 10)).toBe(true);
    expect(layoutNeedsHelp({ crossings: 3, overlaps: 0 }, 40)).toBe(false);
  });
});
