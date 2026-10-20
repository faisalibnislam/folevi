// Generated flowcharts for property tests and benchmarks (seeded, so every run sees the same charts).
import {
  FLOWCHART_SHAPE_SIZE,
  flowchart,
  newEdge,
  type FlowchartData,
  type FlowEdge,
  type FlowNode,
  type FlowShape,
} from "../../src";

export const fnode = (
  id: string,
  shape: FlowShape = "process",
  text = id,
  extra: Partial<FlowNode> = {},
): FlowNode => ({
  id,
  shape,
  x: 0,
  y: 0,
  ...FLOWCHART_SHAPE_SIZE[shape],
  text,
  color: "neutral",
  ...extra,
});
export const fedge = (from: string, to: string, label?: string): FlowEdge =>
  newEdge(from, to, { id: `${from}-${to}`, labels: label ? [{ text: label, at: 0.5 }] : [] });

/** A seeded random number generator (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A process-like chart: a main line with decisions that branch, rejoin and sometimes loop back. */
export function processChart(seed: number, steps: number): FlowchartData {
  const r = rng(seed);
  const nodes: FlowNode[] = [fnode("s0", "terminator", "Start")];
  const edges: FlowEdge[] = [];
  const open: string[] = ["s0"];
  for (let i = 1; i < steps; i++) {
    const decision = r() < 0.3;
    const id = `s${i}`;
    nodes.push(
      fnode(
        id,
        decision ? "decision" : r() < 0.2 ? "io" : "process",
        decision ? `Check ${i}?` : `Step ${i}`,
      ),
    );
    const from = open.splice(Math.floor(r() * open.length), 1)[0] ?? `s${i - 1}`;
    const fromNode = nodes.find((n) => n.id === from)!;
    const yesNo =
      fromNode.shape === "decision"
        ? edges.some((e) => e.from === from)
          ? "No"
          : "Yes"
        : undefined;
    edges.push(fedge(from, id, yesNo));
    if (
      fromNode.shape === "decision" &&
      !edges.filter((e) => e.from === from).some((e) => e.labels[0]?.text === "No")
    )
      open.push(from);
    open.push(id);
    // Branches rejoin, and now and then loop back.
    if (r() < 0.15 && i > 3) edges.push(fedge(id, `s${Math.floor(r() * (i - 1))}`, "retry"));
    if (r() < 0.2 && open.length > 2) {
      const other = open.splice(Math.floor(r() * open.length), 1)[0]!;
      if (other !== id) edges.push(fedge(other, id));
    }
  }
  return flowchart({
    nodes,
    edges: edges.filter((e, i) => edges.findIndex((x) => x.id === e.id) === i),
  });
}
