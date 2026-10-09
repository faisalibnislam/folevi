// The knowledge graph on the web (docs/AI_ASSISTANT.md milestone 7): the /graph route, the in-house force
// layout and the view's maths, the list fallback, and a note's Related list.
import { afterEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { parseRoute } from "@/lib/app/router";
import { APP_ROUTE_HEADS } from "@/lib/app/routes";
import { boundsOf, clampZoom, degrees, fitTransform, graphList, matchNodes, neighbours, radiusFor, seedPosition, Simulation, toScreen, zoomAround, MAX_ZOOM, MIN_ZOOM } from "@/lib/graph/layout";
import { noteHref, RelatedList } from "@/components/doc/RelatedPanel";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("route", () => {
  test("/graph is the graph page", () => {
    expect(parseRoute("/graph")).toEqual({ name: "graph" });
    expect(APP_ROUTE_HEADS.has("graph")).toBe(true);
  });
});

describe("layout", () => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  const edges = [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
    { source: "a", target: "c" },
    { source: "d", target: "e" },
    { source: "a", target: "ghost" },
  ];
  const dist = (p: Map<string, { x: number; y: number }>, x: string, y: string) => Math.hypot(p.get(x)!.x - p.get(y)!.x, p.get(x)!.y - p.get(y)!.y);

  test("the same graph lays out the same way, settles, and keeps linked notes close", () => {
    const one = new Simulation(ids, edges);
    one.run();
    const two = new Simulation(ids, edges);
    two.run();
    expect(one.settled).toBe(true);
    expect([...one.positions()]).toEqual([...two.positions()]);
    const p = one.positions();
    // Linked pairs end up closer than a node and one it has no path to.
    expect(dist(p, "a", "b")).toBeLessThan(dist(p, "a", "e"));
    expect(dist(p, "d", "e")).toBeLessThan(dist(p, "d", "c"));
    // Nothing on top of anything else, nothing flung far away.
    for (const x of ids) for (const y of ids) if (x < y) expect(dist(p, x, y)).toBeGreaterThan(5);
    for (const q of p.values()) expect(Math.hypot(q.x, q.y)).toBeLessThan(2_000);
    // An unknown end of an edge is ignored.
    expect(p.has("ghost")).toBe(false);
  });

  test("a refreshed graph keeps the places of nodes it already had", () => {
    const first = new Simulation(ids, edges);
    first.run();
    const before = first.positions();
    const next = new Simulation([...ids, "g"], [...edges, { source: "g", target: "f" }], { previous: before });
    expect(next.alpha).toBeLessThan(1);
    expect(next.nodes.find((n) => n.id === "a")).toMatchObject(before.get("a")!);
    expect(next.nodes.find((n) => n.id === "g")).toMatchObject(seedPosition("g", 6));
  });

  test("fit, zoom and screen positions", () => {
    const b = boundsOf([
      { x: -100, y: -50 },
      { x: 300, y: 150 },
    ])!;
    expect(b).toEqual({ minX: -100, minY: -50, maxX: 300, maxY: 150 });
    const t = fitTransform(b, 800, 600);
    for (const corner of [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.maxY },
    ]) {
      const s = toScreen(t, corner);
      expect(s.x).toBeGreaterThanOrEqual(39.9);
      expect(s.x).toBeLessThanOrEqual(760.1);
      expect(s.y).toBeGreaterThanOrEqual(39.9);
      expect(s.y).toBeLessThanOrEqual(560.1);
    }
    expect(fitTransform(null, 800, 600)).toEqual({ x: 400, y: 300, k: 1 });
    // Zooming keeps the point under the pointer where it was.
    const z = zoomAround({ x: 10, y: 20, k: 1 }, 2, 200, 100);
    const world = { x: (200 - 10) / 1, y: (100 - 20) / 1 };
    expect(toScreen(z, world)).toEqual({ x: 200, y: 100 });
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(zoomAround({ x: 0, y: 0, k: MAX_ZOOM }, 2, 50, 50).k).toBe(MAX_ZOOM);
  });

  test("degrees, sizes, neighbours and search", () => {
    const d = degrees(edges);
    expect(d.get("a")).toBe(3);
    expect(radiusFor(0, false)).toBe(6);
    expect(radiusFor(1_000, true)).toBe(20);
    expect([...neighbours(edges, "b")].sort()).toEqual(["a", "c"]);
    const nodes = [
      { id: "1", label: "Café plans" },
      { id: "2", label: "Project Atlas kickoff" },
      { id: "3", label: "Atlas budget" },
    ];
    expect([...matchNodes(nodes, "cafe")]).toEqual(["1"]);
    expect([...matchNodes(nodes, "atlas  KICK")]).toEqual(["2"]);
    expect(matchNodes(nodes, "  ").size).toBe(0);
  });

  test("the list fallback: notes first, each with what it's connected to", () => {
    const nodes = [
      { id: "e:atlas", kind: "project", label: "Project Atlas" },
      { id: "n2", kind: "note", label: "Budget" },
      { id: "n1", kind: "note", label: "Atlas kickoff" },
      { id: "n3", kind: "note", label: "Loose note" },
    ];
    const list = graphList(nodes, [
      { source: "n1", target: "n2", kind: "link", inferred: false },
      { source: "e:atlas", target: "n1", kind: "mention", inferred: true },
      { source: "e:atlas", target: "n2", kind: "mention", inferred: true },
      { source: "n1", target: "gone", kind: "link", inferred: false },
    ]);
    expect(list.map((e) => e.label)).toEqual(["Atlas kickoff", "Budget", "Loose note", "Project Atlas"]);
    expect(list[0]!.connections.map((c) => [c.label, c.edge])).toEqual([
      ["Budget", "link"],
      ["Project Atlas", "mention"],
    ]);
    expect(list[2]!.connections).toEqual([]);
    expect(list[3]!.connections.map((c) => c.id)).toEqual(["n1", "n2"]);
    expect(graphList(nodes, [], "budget").map((e) => e.id)).toEqual(["n2"]);
  });
});

describe("the Related list", () => {
  function render(ui: React.ReactNode) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(ui));
    return { host, unmount: () => act(() => root.unmount()) };
  }
  const note = (id: string, title: string) => ({ id, title, icon: null });

  test("related notes with reasons, duplicates and contradictions, each opening its note", () => {
    const onOpen = vi.fn();
    const { host, unmount } = render(
      <RelatedList
        related={{ full: true, note: null, items: [{ ...note("N2", "Atlas budget"), reasons: ["Links here", "Both mention Project Atlas"], linked: true }] }}
        duplicates={{ full: true, note: null, items: [{ a: note("N1", "Plan"), b: note("N3", "Plan (copy)"), score: 0.97 }] }}
        contradictions={{
          full: true,
          note: null,
          items: [{ kind: "contradicts", from: { ...note("N1", "Plan"), blockId: "B1", quote: "The launch is on Friday." }, to: { ...note("N4", "Update"), blockId: "B9", quote: "The launch is on Monday." }, reason: "Different days" }],
        }}
        onOpen={onOpen}
      />,
    );
    expect(host.textContent).toContain("Links here · Both mention Project Atlas");
    expect([...host.querySelectorAll("h3")].map((h) => h.textContent)).toEqual(["Doesn't agree with", "Possible duplicates", "Related notes"]);
    expect(host.querySelector("q")?.textContent).toBe("The launch is on Friday.");
    const update = host.querySelector<HTMLAnchorElement>(`a[href="${noteHref("N4", "B9")}"]`)!;
    expect(update.getAttribute("href")).toBe("/d/N4#block-B9");
    act(() => update.click());
    expect(onOpen).toHaveBeenCalledWith("N4", "B9");
    act(() => host.querySelector<HTMLAnchorElement>('a[href="/d/N3"]')!.click());
    expect(onOpen).toHaveBeenLastCalledWith("N3", undefined);
    expect(host.textContent).not.toContain("Nothing related yet");
    unmount();
  });

  test("quiet when there's nothing, with the plan note below Pro", () => {
    const { host, unmount } = render(
      <RelatedList
        related={{ full: false, note: "The full graph, with topics, people and similar notes, is part of Pro.", items: [] }}
        duplicates={{ full: false, note: null, items: [] }}
        contradictions={{ full: false, note: null, items: [] }}
        onOpen={() => undefined}
      />,
    );
    expect(host.querySelectorAll("h3")).toHaveLength(0);
    expect(host.textContent).toContain("Nothing related yet.");
    expect(host.textContent).toContain("part of Pro");
    unmount();
    const loading = render(<RelatedList related={undefined} duplicates={undefined} contradictions={undefined} onOpen={() => undefined} />);
    expect(loading.host.textContent).toContain("Looking for related notes");
    loading.unmount();
  });
});
