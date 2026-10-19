// The mind map's layout and its other shapes (src/mindmapLayout.ts, src/mindmapTree.ts): one deterministic
// tidy tree for the editor, read-only pages and exports; outlines, Markdown lists and Foli AI's JSON trees
// in and out; the ```mindmap fence in Markdown.
import { describe, expect, it } from "vitest";
import {
  MINDMAP_LIMITS,
  blocksToMarkdown,
  depthFirst,
  layoutMindmap,
  markdownToBlocks,
  mindmapColors,
  mindmapDataIssue,
  mindmapFromMarkdown,
  mindmapFromOutline,
  mindmapFromTree,
  mindmapSides,
  mindmapToOutline,
  mindmapToTree,
  mindNodeSize,
  normalizeMindmap,
  parseMindmap,
  serializeMindmap,
  type MindmapData,
  type MindBox,
} from "../src";

let n = 0;
const seq = () => `i${++n}`;

const sample = (layout: MindmapData["layout"] = "both"): MindmapData =>
  normalizeMindmap({
    layout,
    nodes: [
      { id: "r", parent: null, text: "Launch plan" },
      { id: "a", parent: "r", text: "Marketing" },
      { id: "a1", parent: "a", text: "Blog post" },
      { id: "a2", parent: "a", text: "Newsletter" },
      { id: "b", parent: "r", text: "Product" },
      { id: "b1", parent: "b", text: "Beta" },
      { id: "c", parent: "r", text: "Support" },
      { id: "d", parent: "r", text: "Sales" },
    ],
  });

const overlap = (p: MindBox, q: MindBox) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;

describe("layout", () => {
  it("is deterministic and never overlaps ideas, in every layout", () => {
    for (const layout of ["both", "right", "down"] as const) {
      const map = sample(layout);
      const a = layoutMindmap(map);
      const b = layoutMindmap(map);
      expect(a.boxes).toEqual(b.boxes);
      expect(a.boxes).toHaveLength(map.nodes.length);
      expect(a.links).toHaveLength(map.nodes.length - 1);
      for (const [i, p] of a.boxes.entries()) for (const q of a.boxes.slice(i + 1)) expect(overlap(p, q), `${layout}: ${p.id} and ${q.id}`).toBe(false);
    }
  });

  it("centres the central idea, splits branches between both sides, and keeps children beside their parent", () => {
    const l = layoutMindmap(sample("both"));
    const root = l.byId.get("r")!;
    expect(root.x + root.w / 2).toBe(0);
    const sides = ["a", "b", "c", "d"].map((id) => l.byId.get(id)!.side);
    expect(sides).toContain("left");
    expect(sides).toContain("right");
    // Right-side children start right of their parent; left-side ones end left of it.
    for (const b of l.boxes) {
      if (!b.parent) continue;
      const p = l.byId.get(b.parent)!;
      if (b.side === "right") expect(b.x).toBeGreaterThan(p.x + p.w);
      else expect(b.x + b.w).toBeLessThan(p.x);
    }
  });

  it("right-only puts every branch to the right; down puts children below", () => {
    const right = layoutMindmap(sample("right"));
    expect(right.boxes.filter((b) => b.depth > 0).every((b) => b.side === "right")).toBe(true);
    const down = layoutMindmap(sample("down"));
    for (const b of down.boxes) {
      if (!b.parent) continue;
      const p = down.byId.get(b.parent)!;
      expect(b.side).toBe("down");
      expect(b.y).toBeGreaterThan(p.y + p.h);
    }
  });

  it("follows a main branch's side, and balances the rest by height in order", () => {
    const map = sample("both");
    map.nodes.find((x) => x.id === "d")!.side = "right";
    const l = layoutMindmap(map);
    expect(l.byId.get("d")!.side).toBe("right");
    expect(mindmapSides([{ id: "a", height: 10 }, { id: "b", height: 10 }])).toEqual(new Map([["a", "right"], ["b", "left"]]));
    expect(mindmapSides([{ id: "a", height: 10 }, { id: "b", height: 10 }, { id: "c", height: 10 }]).get("b")).toBe("right");
    expect(mindmapSides([{ id: "a", height: 10, side: "left" }, { id: "b", height: 10 }]).get("b")).toBe("right");
  });

  it("hides collapsed branches and counts what's inside; focus shows one branch", () => {
    const map = sample();
    map.nodes.find((x) => x.id === "a")!.collapsed = true;
    const l = layoutMindmap(map);
    expect(l.byId.has("a1")).toBe(false);
    expect(l.byId.get("a")!.hidden).toBe(2);
    expect(l.byId.get("a")!.hasChildren).toBe(true);
    const f = layoutMindmap(sample(), { focus: "a" });
    expect(f.rootId).toBe("a");
    expect(f.boxes.map((b) => b.id).sort()).toEqual(["a", "a1", "a2"]);
    expect(f.byId.get("a")!.depth).toBe(0);
  });

  it("gives each main branch its own colour, inherited below, and keeps chosen ones", () => {
    const map = sample();
    const c = mindmapColors(map);
    expect(c.get("r")).toBe("neutral");
    const main = ["a", "b", "c", "d"].map((id) => c.get(id));
    expect(new Set(main).size).toBe(4);
    expect(c.get("a1")).toBe(c.get("a"));
    map.nodes.find((x) => x.id === "b")!.color = "pink";
    expect(mindmapColors(map).get("b1")).toBe("pink");
  });

  it("wraps long ideas and grows boxes to fit", () => {
    const short = mindNodeSize("Hi", 2);
    const long = mindNodeSize("A much longer idea that certainly needs more than one line to fit", 2);
    expect(long.lines.length).toBeGreaterThan(1);
    expect(long.h).toBeGreaterThan(short.h);
    expect(mindNodeSize("", 1).lines).toEqual(["New idea"]);
    expect(layoutMindmap(normalizeMindmap({ nodes: [] })).bounds).toBeNull();
  });
});

describe("outlines, Markdown and trees", () => {
  it("one top-level item is the centre; several get a new one", () => {
    const one = mindmapFromOutline([{ text: "Trip", depth: 0 }, { text: "Food", depth: 1 }, { text: "Tapas", depth: 2 }, { text: "Hotel", depth: 1 }], { newId: seq });
    expect(mindmapToOutline(one)).toEqual([{ text: "Trip", depth: 0 }, { text: "Food", depth: 1 }, { text: "Tapas", depth: 2 }, { text: "Hotel", depth: 1 }]);
    const many = mindmapFromOutline([{ text: "A", depth: 0 }, { text: "B", depth: 0 }], { centre: "Ideas", newId: seq });
    expect(mindmapToOutline(many)).toEqual([{ text: "Ideas", depth: 0 }, { text: "A", depth: 1 }, { text: "B", depth: 1 }]);
    // A skipped level nests one deeper than the item before.
    const skip = mindmapFromOutline([{ text: "R", depth: 0 }, { text: "deep", depth: 3 }], { newId: seq });
    expect(mindmapToOutline(skip)).toEqual([{ text: "R", depth: 0 }, { text: "deep", depth: 1 }]);
    expect(mindmapDataIssue(serializeMindmap(skip))).toBeNull();
  });

  it("reads nested Markdown lists (bullets, numbers, to-dos, a heading as the centre)", () => {
    const map = mindmapFromMarkdown("# Garden\n- Vegetables\n  - **Tomatoes**\n  - [Beans](https://x.test)\n1. Flowers\n\t- Roses\n- [ ] Tools\n", { newId: seq });
    expect(mindmapToOutline(map)).toEqual([
      { text: "Garden", depth: 0 },
      { text: "Vegetables", depth: 1 },
      { text: "Tomatoes", depth: 2 },
      { text: "Beans", depth: 2 },
      { text: "Flowers", depth: 1 },
      { text: "Roses", depth: 2 },
      { text: "Tools", depth: 1 },
    ]);
  });

  it("turns Foli AI's JSON tree into a valid map, capped, keeping usable ids", () => {
    const tree = { id: "root", text: "Plan", children: [{ id: "root", text: "Dup id" }, { text: "" }, { text: "Ok", color: "green", children: [{ text: "Deep" }] }, "junk", { text: "Bad colour", color: "#f00" }] };
    const map = mindmapFromTree(tree, { newId: seq });
    expect(mindmapDataIssue(serializeMindmap(map))).toBeNull();
    expect(map.nodes[0]!.id).toBe("root");
    expect(map.nodes.map((x) => x.text)).toEqual(["Plan", "Dup id", "Ok", "Deep", "Bad colour"]);
    expect(map.nodes.filter((x) => x.id === "root")).toHaveLength(1);
    expect(map.nodes.find((x) => x.text === "Ok")!.color).toBe("green");
    expect(map.nodes.find((x) => x.text === "Bad colour")!.color).toBeUndefined();
    const wide = { text: "R", children: Array.from({ length: 50 }, (_, i) => ({ text: `c${i}`, children: [{ text: "x" }] })) };
    expect(mindmapFromTree(wide, { maxNodes: 20, newId: seq }).nodes).toHaveLength(20);
    expect(mindmapFromTree(null).nodes).toHaveLength(0);
    // And back to a tree for prompts.
    expect(mindmapToTree(map, undefined, 3)).toEqual({ id: "root", text: "Plan", children: [{ id: expect.any(String), text: "Dup id" }, { id: expect.any(String), text: "Ok", color: "green" }] });
  });

  it("depth-first order reads like the outline", () => {
    const m = normalizeMindmap({ nodes: [{ id: "r", parent: null, text: "R" }, { id: "a", parent: "r", text: "A" }, { id: "b", parent: "r", text: "B" }, { id: "a1", parent: "a", text: "A1" }] });
    expect(depthFirst(m).nodes.map((x) => x.id)).toEqual(["r", "a", "a1", "b"]);
  });

  it("a ```mindmap fence in Markdown becomes a mind map block, and exports back as its list", () => {
    const { blocks } = markdownToBlocks("Intro\n\n```mindmap\n- Launch\n  - Marketing\n    - Blog\n  - Product\n```\n\n```js\nx\n```\n", { titleFromHeading: false });
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "mindmap", "code"]);
    const data = String(blocks[1]!.props.data);
    expect(mindmapDataIssue(data)).toBeNull();
    expect(mindmapToOutline(parseMindmap(data)).map((i) => i.text)).toEqual(["Launch", "Marketing", "Blog", "Product"]);
    expect(blocksToMarkdown(blocks)).toContain("- Launch\n  - Marketing\n    - Blog\n  - Product");
    // An empty fence stays a code block.
    expect(markdownToBlocks("```mindmap\n```\n").blocks[0]!.type).toBe("code");
  });

  it("stays inside the limits", () => {
    const items = Array.from({ length: MINDMAP_LIMITS.maxNodes + 50 }, (_, i) => ({ text: `n${i}`, depth: i === 0 ? 0 : 1 }));
    const map = mindmapFromOutline(items, { newId: seq });
    expect(map.nodes.length).toBe(MINDMAP_LIMITS.maxNodes);
    expect(mindmapDataIssue(serializeMindmap(map))).toBeNull();
  });
});
