// Foli AI for flowcharts beyond drawing a whole chart (convex/flowchartAi.ts): a chart from a note or text,
// the next steps or missing branches around a selection, an explanation, clearer labels and an arrangement.
// Every reply is checked before it leaves the server and the usual gates apply. Gemini is a stubbed `fetch`.
import { afterEach, describe, expect, test, vi } from "vitest";
import { flowchart, newEdge, serializeFlowchart, withLabel, type FlowNode } from "@folevi/editor-schema";
import { api } from "../../convex/_generated/api";
import { para, person, setup, ulid } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GEMINI_API_KEY;
});

/** Stubs Gemini with one reply for every call; returns the request bodies sent. */
function gemini(reply: unknown) {
  process.env.GEMINI_API_KEY = "test-key";
  const calls: string[] = [];
  const fn = vi.fn(async (_url: string, init: { body: string }) => {
    calls.push(init.body);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: typeof reply === "string" ? reply : JSON.stringify(reply) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 600, candidatesTokenCount: 120 } }), { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fn };
}

const node = (id: string, text: string, shape: FlowNode["shape"] = "process"): FlowNode => ({ id, shape, x: 0, y: 0, w: 160, h: 64, text, color: "neutral" });
const DATA = serializeFlowchart(
  flowchart({
    nodes: [node("s", "Start", "terminator"), node("q", "Approved?", "decision"), node("a", "Ship it")],
    edges: [{ ...newEdge("s", "q"), id: "e1" }, { ...withLabel(newEdge("q", "a"), "Yes"), id: "e2" }],
  }),
);

describe("flowchart Foli AI actions", () => {
  test("from text or a note the person can open; a draft like ai.flowchart's", async () => {
    const t = setup();
    const a = await person(t, "flow-text@example.com");
    const b = await person(t, "flow-text-b@example.com");
    const doc = await a.as.mutation(api.documents.create, { scope: a.scope, title: "Onboarding" });
    const draftReply = { direction: "TD", nodes: [{ id: "s", shape: "terminator", text: "Start" }, { id: "w", shape: "manualInput", text: "Fill in the form" }], edges: [{ from: "s", to: "w" }] };
    // An empty note has nothing to draw.
    const { fn } = gemini(draftReply);
    await expect(a.as.action(api.flowchartAi.fromText, { scope: a.scope, documentId: doc.id })).rejects.toThrow(/no text to make a flowchart/);
    await a.as.mutation(api.sync.push, {
      scope: a.scope,
      deviceId: "device-flow-1",
      ops: [
        { opId: ulid(), kind: "block.upsert", documentId: doc.id, block: para("B1", "First fill in the form", "a"), baseRevision: null, fields: ["content", "position"] },
        { opId: ulid(), kind: "block.upsert", documentId: doc.id, block: para("B2", "Then meet the team", "b"), baseRevision: null, fields: ["content", "position"] },
      ] as never,
    });
    const { calls } = gemini(draftReply);
    const draft = await a.as.action(api.flowchartAi.fromText, { scope: a.scope, documentId: doc.id });
    expect(draft.nodes.map((n) => n.shape)).toEqual(["terminator", "manualInput"]);
    expect(calls[0]).toContain("untrusted_note");
    expect(calls[0]).toContain("meet the team");
    // Someone else can't have it read.
    await expect(b.as.action(api.flowchartAi.fromText, { scope: b.scope, documentId: doc.id })).rejects.toThrow(/not found/i);
    // Selected text needs no note.
    const sel = await a.as.action(api.flowchartAi.fromText, { scope: a.scope, text: "- Pack\n- Travel" });
    expect(sel.edges).toHaveLength(1);
    await expect(a.as.action(api.flowchartAi.fromText, { scope: a.scope, text: "   " })).rejects.toThrow(/Write or select the steps/);
    gemini("I can't draw that.");
    await expect(a.as.action(api.flowchartAi.fromText, { scope: a.scope, text: "Something" })).rejects.toThrow(/couldn't find steps/);
    expect(fn).toBeDefined();
  });

  test("extend returns only new shapes and connectors around the selection", async () => {
    const t = setup();
    const a = await person(t, "flow-extend@example.com");
    const { calls, fn } = gemini({ nodes: [{ id: "n1", shape: "process", text: "Rework" }, { id: "a", text: "Clash" }], edges: [{ from: "q", to: "n1", label: "No" }, { from: "n1", to: "q" }], labels: [{ edge: "e1", label: "Go" }] });
    const ext = await a.as.action(api.flowchartAi.extend, { scope: a.scope, data: DATA, nodeIds: ["q"], kind: "branches" });
    expect(ext.nodes).toEqual([{ id: "n1", shape: "process", text: "Rework", color: "neutral" }]);
    expect(ext.edges.map((e) => [e.from, e.to, e.label])).toEqual([
      ["q", "n1", "No"],
      ["n1", "q", ""],
    ]);
    expect(ext.labels).toEqual([{ id: "e1", label: "Go" }]);
    expect(calls[0]).toContain("Fill in the missing branches");
    // Refused before anything is sent: nothing selected, shapes gone, no chart.
    const sent = fn.mock.calls.length;
    await expect(a.as.action(api.flowchartAi.extend, { scope: a.scope, data: DATA, nodeIds: [], kind: "next" })).rejects.toThrow(/Select a shape/);
    await expect(a.as.action(api.flowchartAi.extend, { scope: a.scope, data: DATA, nodeIds: ["ghost"], kind: "next" })).rejects.toThrow(/aren't in the flowchart/);
    await expect(a.as.action(api.flowchartAi.extend, { scope: a.scope, data: "", nodeIds: ["a"], kind: "next" })).rejects.toThrow(/no flowchart yet/);
    expect(fn.mock.calls.length).toBe(sent);
    gemini({ nodes: [{ id: "x", text: "Joins nothing" }] });
    await expect(a.as.action(api.flowchartAi.extend, { scope: a.scope, data: DATA, nodeIds: ["a"], kind: "next" })).rejects.toThrow(/couldn't add steps/);
  });

  test("explain carries the check's findings; labels and arrange keep to the chart", async () => {
    const t = setup();
    const a = await person(t, "flow-explain@example.com");
    const ex = gemini({ summary: "An approval flow.", steps: ["Start", "Check approval"], decisions: ["Approved orders ship."], gaps: [] });
    const out = await a.as.action(api.flowchartAi.explain, { scope: a.scope, data: DATA });
    expect(out.markdown).toContain("**Main path**");
    // "Ship it" is a dead end and the decision has one way out: the model hears it from the check.
    expect(ex.calls[0]).toContain("dead end");
    expect(ex.calls[0]).toContain("only one way out");

    gemini({ shapes: [{ id: "a", text: "Ship the order" }, { id: "ghost", text: "x" }], connectors: [{ id: "e2", label: "Yes" }] });
    const labels = await a.as.action(api.flowchartAi.labels, { scope: a.scope, data: DATA });
    expect(labels).toEqual({ shapes: [{ id: "a", text: "Ship the order", before: "Ship it", why: "" }], connectors: [] });

    gemini({ direction: "LR", rows: [["s"], ["q"], ["a", "ghost"]] });
    expect(await a.as.action(api.flowchartAi.arrange, { scope: a.scope, data: DATA })).toEqual({ direction: "LR", rows: [["s"], ["q"], ["a"]] });
    const one = serializeFlowchart(flowchart({ nodes: [node("s", "Start", "terminator")] }));
    await expect(a.as.action(api.flowchartAi.arrange, { scope: a.scope, data: one })).rejects.toThrow(/Add a few connected shapes/);
    gemini("no");
    await expect(a.as.action(api.flowchartAi.explain, { scope: a.scope, data: DATA })).rejects.toThrow(/couldn't explain/);

    // Turned off in settings: every task is refused before anything is sent.
    await a.as.mutation(api.users.updateProfile, { aiEnabled: false });
    const off = gemini({ summary: "x" });
    await expect(a.as.action(api.flowchartAi.explain, { scope: a.scope, data: DATA })).rejects.toThrow(/turned off/);
    await expect(a.as.action(api.flowchartAi.labels, { scope: a.scope, data: DATA })).rejects.toThrow(/turned off/);
    await expect(a.as.action(api.flowchartAi.arrange, { scope: a.scope, data: DATA })).rejects.toThrow(/turned off/);
    await expect(a.as.action(api.flowchartAi.extend, { scope: a.scope, data: DATA, nodeIds: ["a"], kind: "next" })).rejects.toThrow(/turned off/);
    await expect(a.as.action(api.flowchartAi.fromText, { scope: a.scope, text: "Pack, travel" })).rejects.toThrow(/turned off/);
    expect(off.fn.mock.calls.length).toBe(0);
  });

  test("ai.flowchart draws frames and lanes when asked, as new fields older apps ignore", async () => {
    const t = setup();
    const a = await person(t, "flow-lanes@example.com");
    const { calls } = gemini({
      direction: "LR",
      lanes: [{ id: "c", title: "Customer" }, { id: "s", title: "Shop" }],
      laneOrient: "rows",
      nodes: [{ id: "a", shape: "terminator", text: "Order", in: "c" }, { id: "b", shape: "database", text: "Save", in: "s" }],
      edges: [{ from: "a", to: "b" }],
    });
    const draft = await a.as.action(api.ai.flowchart, { scope: a.scope, mode: "create", instruction: "Ordering, with swimlanes for the customer and the shop" });
    expect(draft.lanes?.map((l) => l.title)).toEqual(["Customer", "Shop"]);
    expect(draft.nodes.map((n) => [n.shape, n.parent])).toEqual([
      ["terminator", draft.lanes![0]!.id],
      ["database", draft.lanes![1]!.id],
    ]);
    // The old fields are all still there, as they were.
    expect(draft.edges).toEqual([{ from: draft.nodes[0]!.id, to: draft.nodes[1]!.id, label: "", style: "solid", arrow: "end" }]);
    expect(calls[0]).toContain("swimlanes");
  });
});
