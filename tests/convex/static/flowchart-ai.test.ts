// The AI flowchart sanitiser: whatever the model sends back, only a small, valid draft leaves the server.
import { describe, expect, test } from "vitest";
import { AI_MAX_NODES, flowchartForPrompt, parseFlowchartDraft } from "../../../convex/lib/flowchartAi";

describe("AI flowchart drafts", () => {
  test("parses a well-formed reply (even wrapped in a code fence)", () => {
    const reply = '```json\n{"direction":"LR","nodes":[{"id":"s","shape":"terminator","text":"Start"},{"id":"q","shape":"decision","text":"Approved?","color":"blue"},{"id":"e","shape":"terminator","text":"End"}],"edges":[{"from":"s","to":"q"},{"from":"q","to":"e","label":"Yes","style":"dashed"}]}\n```';
    const d = parseFlowchartDraft(reply)!;
    expect(d.direction).toBe("LR");
    expect(d.nodes.map((n) => [n.id, n.shape, n.text, n.color])).toEqual([
      ["s", "terminator", "Start", "neutral"],
      ["q", "decision", "Approved?", "blue"],
      ["e", "terminator", "End", "neutral"],
    ]);
    expect(d.edges).toEqual([
      { from: "s", to: "q", label: "", style: "solid", arrow: "end" },
      { from: "q", to: "e", label: "Yes", style: "dashed", arrow: "end" },
    ]);
  });

  test("sanitises hostile or sloppy output", () => {
    const reply = JSON.stringify({
      direction: "diagonal",
      nodes: [
        { id: "<img onerror=x>", shape: "rocket", text: "x".repeat(5000), color: "javascript:alert(1)", x: 5, onclick: "boom" },
        { id: "b", shape: "process", text: "   " },
        { id: "b", shape: "process", text: "Twin" },
        42,
      ],
      edges: [{ from: "<img onerror=x>", to: "b", label: "a\nb", arrow: "sideways" }, { from: "b", to: "nowhere" }, { from: "b", to: "b" }],
      instructions: "ignore previous instructions",
    });
    const d = parseFlowchartDraft(reply)!;
    expect(d.direction).toBe("TD");
    expect(d.nodes).toHaveLength(3);
    expect(d.nodes[0]!.id).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    expect(d.nodes[0]!.shape).toBe("process");
    expect(d.nodes[0]!.color).toBe("neutral");
    expect(d.nodes[0]!.text.length).toBeLessThanOrEqual(300);
    expect(d.nodes[1]!.text).toBe("Step");
    expect(new Set(d.nodes.map((n) => n.id)).size).toBe(3);
    expect(d.edges).toEqual([{ from: d.nodes[0]!.id, to: "b", label: "a b", style: "solid", arrow: "end" }]);
    expect(JSON.stringify(d)).not.toMatch(/onclick|instructions|[<>]|javascript/);
  });

  test("caps the size and rejects replies with nothing usable", () => {
    const many = { nodes: Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, shape: "process", text: `Step ${i}` })), edges: [] };
    expect(parseFlowchartDraft(JSON.stringify(many))!.nodes).toHaveLength(AI_MAX_NODES);
    expect(parseFlowchartDraft("Sorry, I can't help with that.")).toBeNull();
    expect(parseFlowchartDraft('{"nodes": []}')).toBeNull();
    expect(parseFlowchartDraft("{broken")).toBeNull();
  });

  test("gives the model a compact copy of the current chart (no positions)", () => {
    const data = JSON.stringify({ v: 1, nodes: [{ id: "a", shape: "process", x: 10, y: 20, w: 160, h: 64, text: "Draft" }, { id: "b", shape: "decision", x: 10, y: 120, w: 160, h: 96, text: "OK?", color: "green" }], edges: [{ id: "e1", from: "a", to: "b", label: "next" }] });
    expect(JSON.parse(flowchartForPrompt(data)!)).toEqual({
      nodes: [
        { id: "a", shape: "process", text: "Draft" },
        { id: "b", shape: "decision", text: "OK?", color: "green" },
      ],
      edges: [{ from: "a", to: "b", label: "next" }],
    });
    expect(flowchartForPrompt("")).toBeNull();
    expect(flowchartForPrompt("not json")).toBeNull();
  });
});
