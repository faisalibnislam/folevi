// Foli AI on the flowchart, in the app: its results as chart edits (components/editor/flowchart/aiOps.ts:
// drawn charts with frames and lanes, extensions placed beside the selection, labels, arrangements, Tidy up
// and its animation), and the local-mode handlers (lib/local/ai/functions/blocks.ts) against a fake model:
// the shared requests and checks, explain and labels on the on-device model with the chart cut to fit it,
// and the heavier tasks only with the person's own key.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { checkFlowchart, flowchart, newEdge, serializeFlowchart, withLabel, type FlowchartData, type FlowNode } from "@folevi/editor-schema";
import { EXPLAIN_SYSTEM, explainRequest, extendRequest, flowchartForPrompt, labelsRequest, parseArrangeReply, parseExtendReply, parseFlowchartDraft } from "@folevi/ai-prompts/flowchart";
import { api } from "@/lib/convex/api";
import { LocalBackend, LocalClient, MemoryStore } from "@/lib/local";
import { configureLocalAiHost, localAiState, refreshLocalAi, setLocalAiChoice } from "@/lib/local/ai/state";
import { featuresFor } from "@/lib/local/ai/features";
import { OFF_HERE, textBudget } from "@/lib/local/ai/provider";
import { resetStreams } from "@/lib/local/ai/streams";
import { applyLabels, arrangeChart, draftChart, placeExtension, tidyChart, tweenCharts } from "@/components/editor/flowchart/aiOps";
import { fakeHost, type FakeHost } from "./local-ai-fake";

const node = (id: string, text: string, shape: FlowNode["shape"] = "process", extra: Partial<FlowNode> = {}): FlowNode => ({ id, shape, x: 0, y: 0, w: 160, h: 64, text, color: "neutral", ...extra });
const overlaps = (fc: FlowchartData) => {
  const out: string[] = [];
  fc.nodes.forEach((a, i) => fc.nodes.slice(i + 1).forEach((b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y && out.push(`${a.id}/${b.id}`)));
  return out;
};
/** A small laid-out chart: Start, a decision with one answer, a step, an end. */
function chart(): FlowchartData {
  return tidyChart(
    flowchart({
      nodes: [node("s", "Start", "terminator"), node("q", "Approved?", "decision"), node("a", "Ship it"), node("e", "Done", "terminator")],
      edges: [{ ...newEdge("s", "q"), id: "e1" }, { ...withLabel(newEdge("q", "a"), "Yes"), id: "e2" }, { ...newEdge("a", "e"), id: "e3" }],
    }),
    { direction: "TD", keepPlacement: false },
  );
}

describe("drawn charts", () => {
  test("frames and lanes from a draft hold their shapes, laid out where the chart was", () => {
    const draft = parseFlowchartDraft(
      JSON.stringify({
        direction: "LR",
        lanes: [{ id: "c", title: "Customer" }, { id: "w", title: "Warehouse" }],
        nodes: [{ id: "o", shape: "terminator", text: "Order", in: "c" }, { id: "p", shape: "process", text: "Pick items", in: "w" }, { id: "d", shape: "terminator", text: "Delivered", in: "c" }],
        edges: [{ from: "o", to: "p" }, { from: "p", to: "d" }],
      }),
    )!;
    const fc = draftChart(draft, chart(), "create");
    expect(fc.pools).toHaveLength(1);
    expect(fc.pools[0]!.lanes.map((l) => l.title)).toEqual(["Customer", "Warehouse"]);
    expect(fc.nodes.map((n) => n.parent)).toEqual(["c", "w", "c"]);
    expect(overlaps(fc)).toEqual([]);
    const framed = draftChart({ nodes: [{ id: "a", shape: "process", text: "A", parent: "f" }, { id: "b", shape: "process", text: "B" }], edges: [{ from: "a", to: "b" }], frames: [{ id: "f", title: "Stage 1" }] }, flowchart(), "create");
    const f = framed.frames[0]!;
    const a = framed.nodes.find((n) => n.id === "a")!;
    expect(a.parent).toBe("f");
    expect(a.x >= f.x && a.y >= f.y && a.x + a.w <= f.x + f.w && a.y + a.h <= f.y + f.h).toBe(true);
  });

  test("an update keeps the chart's frames and its shapes' sizes and colours when the reply names none", () => {
    const current = flowchart({ nodes: [node("a", "One", "process", { parent: "f", color: "blue", w: 200 })], frames: [{ id: "f", x: 0, y: 0, w: 400, h: 300, title: "Stage", color: "green" }] });
    const next = draftChart({ nodes: [{ id: "a", shape: "process", text: "One" }, { id: "b", shape: "process", text: "Two" }], edges: [{ from: "a", to: "b" }] }, current, "update");
    expect(next.frames.map((x) => x.title)).toEqual(["Stage"]);
    const a = next.nodes.find((n) => n.id === "a")!;
    expect([a.parent, a.color, a.w]).toEqual(["f", "blue", 200]);
  });
});

describe("extending from the selection", () => {
  test("new shapes join beside the selection, the selected shape stays put, and nothing overlaps", () => {
    const fc = chart();
    const q = fc.nodes.find((n) => n.id === "q")!;
    const ext = parseExtendReply(JSON.stringify({ nodes: [{ id: "x", text: "Rework" }, { id: "a", text: "Clash" }], edges: [{ from: "q", to: "x", label: "No" }, { from: "x", to: "q" }], labels: [{ edge: "e1", label: "Go" }] }), fc, ["q"])!;
    const placed = placeExtension(fc, ext, ["q"], "TD")!;
    expect(placed.nodes).toHaveLength(1);
    expect(placed.doc.nodes.find((n) => n.id === "q")).toEqual(q);
    expect(overlaps(placed.doc)).toEqual([]);
    const x = placed.doc.nodes.find((n) => n.id === placed.nodes[0])!;
    // Beside the decision's answer, not far down the chart.
    expect(Math.abs(x.y - fc.nodes.find((n) => n.id === "a")!.y)).toBeLessThan(120);
    expect(placed.doc.edges.find((e) => e.id === "e1")!.labels.map((l) => l.text)).toEqual(["Go"]);
    expect(placed.doc.edges).toHaveLength(fc.edges.length + 2);
    // The check is happy now: the decision has two labelled ways out.
    expect(checkFlowchart(placed.doc).filter((i) => i.kind === "oneWayDecision" || i.kind === "unlabelledBranch")).toEqual([]);
  });

  test("ids never clash, repeated connectors are dropped, and a shape landing in a lane joins it", () => {
    const fc = flowchart({
      nodes: [node("a", "One", "process", { x: 140, y: 60, parent: "l1" })],
      pools: [{ id: "p", x: 0, y: 0, orient: "rows", title: "", length: 1600, lanes: [{ id: "l1", title: "Team", size: 400, color: "neutral" }] }],
    });
    const placed = placeExtension(fc, { nodes: [{ id: "a", shape: "process", text: "Two" }, { id: "p", shape: "nope", text: "Three" }], edges: [{ from: "a", to: "a" }, { from: "p", to: "a" }], labels: [] }, ["a"], "LR")!;
    const ids = placed.doc.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(placed.nodes.every((id) => id !== "a" && id !== "p")).toBe(true);
    expect(placed.doc.nodes.filter((n) => placed.nodes.includes(n.id)).every((n) => n.parent === "l1")).toBe(true);
    expect(placeExtension(fc, { nodes: [], edges: [], labels: [{ id: "ghost", label: "x" }] }, ["a"])).toBeNull();
  });
});

describe("labels, arranging and tidy up", () => {
  test("labels apply in one change and drop stale formatting", () => {
    const fc = flowchart({ nodes: [node("a", "Ship", "process", { rich: [{ text: [{ type: "text", text: "Ship", marks: [{ type: "bold" }] }] }] })], edges: [] });
    const next = applyLabels(fc, [{ id: "a", text: "Ship the release to everyone who signed up for the beta" }], []);
    expect(next.nodes[0]!.text).toBe("Ship the release to everyone who signed up for the beta");
    expect(next.nodes[0]!.rich).toBeUndefined();
    expect(next.nodes[0]!.h).toBeGreaterThanOrEqual(fc.nodes[0]!.h);
  });

  test("the model's ranks seed the layout: its order across the flow wins", () => {
    const fc = flowchart({
      nodes: [node("s", "Start", "terminator"), node("l", "Left"), node("r", "Right")],
      edges: [newEdge("s", "l"), newEdge("s", "r")],
    });
    const arranged = (rows: string[][]) => {
      const out = arrangeChart(fc, parseArrangeReply(JSON.stringify({ direction: "TD", rows }), fc)!);
      const x = (id: string) => out.nodes.find((n) => n.id === id)!.x;
      return x("l") < x("r") ? "l-r" : "r-l";
    };
    expect(arranged([["s"], ["l", "r"]])).toBe("l-r");
    expect(arranged([["s"], ["r", "l"]])).toBe("r-l");
    expect(overlaps(arrangeChart(fc, { direction: "LR", rows: [["s"], ["r", "l"]] }))).toEqual([]);
  });

  test("tidy up in either direction, and the move between arrangements", () => {
    const fc = chart();
    const lr = tidyChart(fc, { direction: "LR", keepPlacement: true });
    const span = (c: FlowchartData) => ({ w: Math.max(...c.nodes.map((n) => n.x)) - Math.min(...c.nodes.map((n) => n.x)), h: Math.max(...c.nodes.map((n) => n.y)) - Math.min(...c.nodes.map((n) => n.y)) });
    expect(span(fc).h).toBeGreaterThan(span(fc).w);
    expect(span(lr).w).toBeGreaterThan(span(lr).h);
    // The chart stays where it was.
    expect(Math.min(...lr.nodes.map((n) => n.x))).toBe(Math.min(...fc.nodes.map((n) => n.x)));
    const half = tweenCharts(fc, lr, 0.5);
    const a0 = fc.nodes[2]!;
    const a1 = lr.nodes[2]!;
    expect(half.nodes[2]!.x).toBe(Math.round(a0.x + (a1.x - a0.x) / 2));
    expect(tweenCharts(fc, lr, 1)).toBe(lr);
    expect(half.edges).toBe(lr.edges);
  });
});

// ------------------------------------------------------------------------------------------ local mode

const SCOPE = { kind: "personal" } as const;

async function library(host: FakeHost) {
  configureLocalAiHost(() => ({ ai: host.ai, secrets: host.secrets }));
  await refreshLocalAi();
  const backend = new LocalBackend(new MemoryStore(), { deviceId: "dev_flow_ai" });
  const client = new LocalClient(backend);
  await client.local.setup({ timeZone: "UTC", locale: "en", displayName: "Sam", seed: false });
  return client;
}
const sent = (r: { system?: string; messages: { content: string }[] }) => ({ system: r.system, prompt: r.messages[r.messages.length - 1]!.content });
const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { data?: { code: string; message: string } }).data ?? { code: "thrown", message: String(e) };
  }
};

describe("flowchart Foli AI in local mode", () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* no storage */
    }
    resetStreams();
  });
  afterEach(() => configureLocalAiHost(null));

  test("explaining and clearer labels are offered on the on-device model; drawing, extending and arranging need a key", () => {
    expect([featuresFor("on-device").flowchartExplain, featuresFor("on-device").flowchart]).toEqual([true, false]);
    expect([featuresFor("anthropic").flowchartExplain, featuresFor("anthropic").flowchart]).toEqual([true, true]);
    expect(featuresFor(null).flowchartExplain).toBe(false);
  });

  test("on the device: explain and labels run with the chart cut to fit; extend is refused before anything is sent", async () => {
    const host = fakeHost({ onDevice: true });
    const client = await library(host);
    const big = serializeFlowchart(flowchart({ nodes: Array.from({ length: 120 }, (_, i) => node(`n${i}`, `A long step label that takes room number ${i}`)), edges: Array.from({ length: 119 }, (_, i) => newEdge(`n${i}`, `n${i + 1}`)) }));
    host.answer(() => JSON.stringify({ summary: "A long chain.", steps: ["Start"], decisions: [], gaps: [] }));
    const out = await client.action(api.flowchartAi.explain, { scope: SCOPE, data: big });
    expect(out.summary).toBe("A long chain.");
    const room = textBudget(localAiState().active, { serverChars: 1_000_000, overheadChars: EXPLAIN_SYSTEM.length + 600, answerTokens: 1024 });
    const current = flowchartForPrompt(big, { maxChars: Math.max(400, room) })!;
    expect(current.length).toBeLessThan(big.length);
    expect(sent(host.requests[0]!).system).toBe(EXPLAIN_SYSTEM);
    expect(sent(host.requests[0]!).prompt.startsWith(`<flowchart>\n${current}\n</flowchart>`)).toBe(true);

    const small = serializeFlowchart(chart());
    host.answer(() => JSON.stringify({ shapes: [{ id: "a", text: "Ship the release" }], connectors: [] }));
    expect(await client.action(api.flowchartAi.labels, { scope: SCOPE, data: small })).toEqual({ shapes: [{ id: "a", text: "Ship the release", before: "Ship it", why: "" }], connectors: [] });
    expect(sent(host.requests[1]!)).toEqual({ system: labelsRequest({ current: flowchartForPrompt(small, { ids: true })! }).system, prompt: labelsRequest({ current: flowchartForPrompt(small, { ids: true })! }).prompt });

    const count = host.requests.length;
    expect(await errorOf(client.action(api.flowchartAi.extend, { scope: SCOPE, data: small, nodeIds: ["a"], kind: "next" }))).toMatchObject({ code: "forbidden", message: OFF_HERE });
    expect(await errorOf(client.action(api.flowchartAi.arrange, { scope: SCOPE, data: small }))).toMatchObject({ code: "forbidden", message: OFF_HERE });
    expect(host.requests).toHaveLength(count);
  });

  test("with a key: extend, arrange and drawing from text send the shared requests and return the server's shapes", async () => {
    const host = fakeHost({ keys: ["ai.openai"] });
    const client = await library(host);
    await setLocalAiChoice({ provider: "openai", model: "gpt-6-astra" });
    const data = serializeFlowchart(chart());
    const fc = chart();
    const reply = JSON.stringify({ nodes: [{ id: "x", text: "Rework" }], edges: [{ from: "q", to: "x", label: "No" }], labels: [] });
    host.answer(() => reply);
    const ext = await client.action(api.flowchartAi.extend, { scope: SCOPE, data, nodeIds: ["q"], kind: "branches" });
    expect(ext).toEqual(parseExtendReply(reply, fc, ["q"]));
    expect(sent(host.requests[0]!).prompt).toBe(extendRequest({ current: flowchartForPrompt(data, { ids: true })!, selected: [{ id: "q", text: "Approved?" }], kind: "branches", instruction: "" }).prompt);
    host.answer(() => JSON.stringify({ direction: "LR", rows: [["s", "q"], ["a", "e"]] }));
    expect(await client.action(api.flowchartAi.arrange, { scope: SCOPE, data })).toEqual({ direction: "LR", rows: [["s", "q"], ["a", "e"]] });
    const draft = JSON.stringify({ nodes: [{ id: "a", text: "Pack" }, { id: "b", text: "Go" }], edges: [{ from: "a", to: "b" }] });
    host.answer(() => draft);
    expect(await client.action(api.flowchartAi.fromText, { scope: SCOPE, text: "- Pack\n- Go" })).toEqual(parseFlowchartDraft(draft));
    expect(await errorOf(client.action(api.flowchartAi.fromText, { scope: SCOPE, text: " " }))).toMatchObject({ message: "Write or select the steps first." });
    // The explanation names what the deterministic check found.
    host.answer(() => JSON.stringify({ summary: "x" }));
    await client.action(api.flowchartAi.explain, { scope: SCOPE, data });
    expect(sent(host.requests.at(-1)!).prompt).toBe(explainRequest({ current: flowchartForPrompt(data)!, issues: checkFlowchart(fc).map((i) => i.message) }).prompt);
  });
});
