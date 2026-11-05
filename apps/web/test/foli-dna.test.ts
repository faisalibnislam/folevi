// Foli DNA's analysis (lib/graph/analysis.ts): filters, the view around a note, clusters, bridges, hubs, time and
// the Markdown and SVG exports. The same results drive the web page and, through the engine, the native apps.
import { describe, expect, it } from "vitest";
import { asOf, bridges, cleanSettings, clusters, filterGraph, hubs, localGraph, newSince, orphans, stepsFrom, timeSpan, toMarkdown, toSvg, within, clusterCircle, fitPoints, labelPlan, shortLabel } from "@/lib/graph/analysis";
import { Simulation } from "@/lib/graph/layout";

const note = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: "note", label: id.toUpperCase(), ...extra });
const link = (source: string, target: string, createdAt?: number) => ({ source, target, kind: "link", inferred: false, createdAt });

// Two triangles (a b c, x y z) joined by c - x, an entity mentioned by a, and a lone note.
const NODES = [
  note("a", { folderId: "f1", tagIds: ["t1"], createdAt: 1, updatedAt: 100 }),
  note("b", { folderId: "f1", tagIds: [], createdAt: 2, updatedAt: 50 }),
  note("c", { folderId: "f1", tagIds: [], createdAt: 3, updatedAt: 60 }),
  note("x", { folderId: "f2", tagIds: ["t1"], createdAt: 4, updatedAt: 70 }),
  note("y", { folderId: "f2", tagIds: [], createdAt: 5, updatedAt: 80 }),
  note("z", { folderId: "f2", tagIds: [], createdAt: 6, updatedAt: 90 }),
  note("lone", { folderId: null, tagIds: [], createdAt: 7, updatedAt: 10 }),
  { id: "e:sam", kind: "person", label: "Sam" },
];
const EDGES = [link("a", "b", 10), link("b", "c", 11), link("c", "a", 12), link("x", "y", 13), link("y", "z", 14), link("z", "x", 15), link("c", "x", 16), { source: "e:sam", target: "a", kind: "mention", inferred: true }];

describe("filters", () => {
  it("a folder keeps its notes and the entities they mention", () => {
    const r = filterGraph(NODES, EDGES, { folders: ["f1"] });
    expect(r.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c", "e:sam"]);
    expect(r.edges.every((e) => ["a", "b", "c", "e:sam"].includes(e.source) && ["a", "b", "c", "e:sam"].includes(e.target))).toBe(true);
  });
  it("tags, edited since and links only", () => {
    expect(filterGraph(NODES, EDGES, { tags: ["t1"] }).nodes.map((n) => n.id).sort()).toEqual(["a", "e:sam", "x"]);
    expect(filterGraph(NODES, EDGES, { editedSince: 75 }).nodes.map((n) => n.id).sort()).toEqual(["a", "e:sam", "y", "z"]);
    const links = filterGraph(NODES, EDGES, { linksOnly: true });
    expect(links.nodes.some((n) => n.kind !== "note")).toBe(false);
    expect(links.edges.every((e) => e.kind === "link")).toBe(true);
  });
  it("unlinked notes can be hidden, and are listed", () => {
    expect(orphans(NODES, EDGES).map((n) => n.id)).toEqual(["lone"]);
    expect(filterGraph(NODES, EDGES, { hideOrphans: true }).nodes.map((n) => n.id)).not.toContain("lone");
  });
});

describe("around one note", () => {
  it("depth 1, 2 and 3 steps out", () => {
    expect(localGraph(NODES, EDGES, "a", 1).nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c", "e:sam"]);
    expect(localGraph(NODES, EDGES, "a", 2).nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c", "e:sam", "x"]);
    expect(localGraph(NODES, EDGES, "a", 3).nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c", "e:sam", "x", "y", "z"]);
    expect(localGraph(NODES, EDGES, "missing", 2).nodes).toEqual([]);
    expect(stepsFrom(EDGES, "a", 3).get("y")).toBe(3);
  });
  it("focus mode keeps two steps", () => {
    expect([...within(EDGES, "b", 2)].sort()).toEqual(["a", "b", "c", "e:sam", "x"]);
  });
});

describe("clusters, bridges and hubs", () => {
  it("finds the two triangles, names them, and the notes that join them", () => {
    const found = clusters(NODES, EDGES);
    expect(found.clusters.length).toBe(2);
    const of = found.of;
    expect(of.get("a")).toBe(of.get("b"));
    expect(of.get("x")).toBe(of.get("z"));
    expect(of.get("a")).not.toBe(of.get("x"));
    expect(of.has("lone")).toBe(false);
    // The cluster with Sam in it is named for Sam.
    expect(found.clusters.map((c) => c.name)).toContain("Sam");
    const across = bridges(EDGES, of);
    expect(across.has("c")).toBe(true);
    expect(across.has("x")).toBe(true);
    expect(across.has("b")).toBe(false);
  });
  it("is the same every time", () => {
    expect(clusters(NODES, EDGES)).toEqual(clusters([...NODES].reverse(), [...EDGES].reverse()));
  });
  it("hubs are the best connected first", () => {
    expect(hubs(NODES, EDGES, 2).map((h) => h.id)).toEqual(["a", "c"]);
  });
});

describe("time", () => {
  it("the map as it stood, its span, and what's new", () => {
    const then = asOf(NODES, EDGES, 3);
    expect(then.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c", "e:sam"]);
    expect(then.edges.filter((e) => e.kind === "link")).toEqual([]);
    expect(asOf(NODES, EDGES, 12).edges.filter((e) => e.kind === "link").length).toBe(3);
    expect(timeSpan(NODES)).toEqual({ start: 1, end: 7 });
    const fresh = newSince(NODES, EDGES, 15);
    expect([...fresh.nodes].sort()).toEqual(["c", "x", "z"]);
  });
});

describe("settings, export and layout", () => {
  it("settings read back cleanly", () => {
    expect(cleanSettings({ colorBy: "folder", spacing: 9, filter: { folders: ["f1", 3] }, arrows: true })).toMatchObject({ colorBy: "folder", spacing: 2, arrows: true, filter: { folders: ["f1"] } });
    expect(cleanSettings("junk")).toMatchObject({ colorBy: "kind", spacing: 1, pull: 1, clusters: true });
  });
  it("Markdown and SVG", () => {
    const md = toMarkdown(NODES.slice(0, 2), [link("a", "b")]);
    expect(md).toContain("- [[A]]\n  - links to [[B]]");
    const svg = toSvg(NODES.slice(0, 2), [link("a", "b")], new Map([["a", { x: 0, y: 0 }], ["b", { x: 50, y: 0 }]]), { note: "#777777" }, { radius: () => 6, labelled: new Set(["a"]) });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain(">A</text>");
    expect(svg).toContain("<line");
  });
  it("pinned nodes stay where they were put", () => {
    const sim = new Simulation(["a", "b", "c"], [link("a", "b"), link("b", "c")], { pinned: new Map([["a", { x: 300, y: -200 }]]) });
    sim.run(400);
    expect(sim.positions().get("a")).toEqual({ x: 300, y: -200 });
  });
});

describe("labels and fitting (the 1.2.32 report: bare dots, a cluster name under the bar)", () => {
  // Twenty dots in a row 40px apart, with labels about 60px wide: every other one has room.
  const ids = Array.from({ length: 20 }, (_, i) => `n${i}`);
  const center = (id: string) => ({ x: 20 + Number(id.slice(1)) * 40, y: 50 });
  const base = { center, radius: () => 5, width: () => 60 };
  it("labels every node whose label has room, and no two overlap", () => {
    const got = labelPlan(ids, base);
    expect(got.size).toBe(10);
    const xs = [...got].map((id) => center(id).x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(60);
  });
  it("what must be labelled is, the map's edges and blocked room are kept clear", () => {
    expect(labelPlan(ids, { ...base, width: () => 2000, always: new Set(["n7"]) })).toEqual(new Set(["n7"]));
    const inside = labelPlan(ids, { ...base, bounds: { x: 0, y: 0, w: 300, h: 100 } });
    expect([...inside].every((id) => center(id).x + 30 <= 300 && center(id).x - 30 >= 0)).toBe(true);
    expect(labelPlan(ids, { ...base, blocked: [{ x: 0, y: 0, w: 900, h: 100 }] }).size).toBe(0);
  });
  it("a hub may sit beside another dot; others may not", () => {
    const two = ["hub", "dot"];
    const c = (id: string) => (id === "hub" ? { x: 100, y: 50 } : { x: 120, y: 66 });
    expect(labelPlan(two, { center: c, radius: () => 5, width: () => 60 }).has("hub")).toBe(false);
    expect(labelPlan(two, { center: c, radius: () => 5, width: () => 60, preferred: new Set(["hub"]) }).has("hub")).toBe(true);
  });
  it("the fit takes in each cluster's wash and the room for its name", () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
    const c = clusterCircle(pts)!;
    expect(c.r).toBeGreaterThan(28);
    const all = fitPoints(pts, [pts]);
    expect(Math.min(...all.map((p) => p.y))).toBeLessThan(c.y - c.r - 20);
    expect(clusterCircle(pts.slice(0, 2))).toBeNull();
  });
  it("long titles are cut with an ellipsis", () => {
    expect(shortLabel("Mebel, The complete feature roadmap for a professional AI-powered furniture design app")).toBe("Mebel, The complete feature roadmap for…");
    expect(shortLabel("")).toBe("Untitled");
  });
});
