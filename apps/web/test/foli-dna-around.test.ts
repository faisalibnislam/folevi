// Foli DNA around one note (lib/graph/neighbourhood.ts): what a note is connected to and why, the map around it
// with each line labelled, expanding a neighbour, the plain-language panel's words, and the calmer defaults
// (lib/graph/analysis.ts hideAiLines, labelBudget).
import { describe, expect, it } from "vitest";
import { cleanSettings, DEFAULT_SETTINGS, filterGraph, labelBudget } from "@/lib/graph/analysis";
import { connectionsOf, dnaSide, explain, groupConnections, indexGraph, lineLabel, neighbourhood, SHARED_LIMIT } from "@/lib/graph/neighbourhood";
import { nextBoundary, notesSoFar, tickUnit, timelineStep, timelineTicks } from "@/lib/graph/timeline";

const note = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: "note", label: id[0]!.toUpperCase() + id.slice(1), ...extra });
const link = (source: string, target: string) => ({ source, target, kind: "link", inferred: false });

// "pricing" links to plan and launch; notes links to pricing; pricing and faq share #money; pricing, plan and
// memo are in the Work folder; Foli AI finds old similar to pricing; Sam is mentioned in pricing and memo.
const NODES = [
  note("pricing", { folderId: "work", tagIds: ["money"], updatedAt: 9 }),
  note("plan", { folderId: "work", tagIds: [], updatedAt: 8 }),
  note("launch", { folderId: null, tagIds: [], updatedAt: 7 }),
  note("notes", { folderId: null, tagIds: [], updatedAt: 6 }),
  note("faq", { folderId: null, tagIds: ["money"], updatedAt: 5 }),
  note("memo", { folderId: "work", tagIds: [], updatedAt: 4 }),
  note("old", { folderId: null, tagIds: [], updatedAt: 3 }),
  note("far", { folderId: null, tagIds: [], updatedAt: 2 }),
  { id: "e:sam", kind: "person", label: "Sam" },
];
const EDGES = [
  link("pricing", "plan"),
  link("pricing", "launch"),
  link("notes", "pricing"),
  link("launch", "far"),
  { source: "pricing", target: "old", kind: "similar", inferred: true },
  { source: "e:sam", target: "pricing", kind: "mention", inferred: true },
  { source: "e:sam", target: "memo", kind: "mention", inferred: true },
];
const names = { tag: (id: string) => ({ money: "pricing" })[id], folder: (id: string) => ({ work: "Work" })[id] };
const index = indexGraph(NODES, EDGES);

describe("connections", () => {
  it("lists what a note is joined to, written links first, with every reason", () => {
    const c = connectionsOf(index, "pricing");
    expect(c.map((x) => x.id)).toEqual(["plan", "launch", "notes", "e:sam", "old", "faq", "memo"]);
    expect(c.find((x) => x.id === "plan")!.reasons).toEqual([{ kind: "link" }, { kind: "folder", folderId: "work" }]);
    expect(c.find((x) => x.id === "notes")!.reasons).toEqual([{ kind: "backlink" }]);
    expect(c.find((x) => x.id === "e:sam")!.reasons).toEqual([{ kind: "mention" }]);
    expect(c.find((x) => x.id === "old")!.reasons).toEqual([{ kind: "ai", relation: "similar" }]);
    expect(c.find((x) => x.id === "faq")!.reasons).toEqual([{ kind: "tag", tagId: "money" }]);
  });
  it("links only leaves out Foli AI's finds; an entity lists the notes that mention it", () => {
    expect(connectionsOf(index, "pricing", { ai: false }).map((x) => x.id)).not.toContain("old");
    expect(connectionsOf(index, "pricing", { ai: false }).map((x) => x.id)).not.toContain("e:sam");
    expect(connectionsOf(index, "e:sam").map((x) => [x.id, x.reasons[0]!.kind])).toEqual([
      ["pricing", "mentionedIn"],
      ["memo", "mentionedIn"],
    ]);
  });
  it("a big folder or tag gives only its most recently edited notes", () => {
    const many = [note("me", { folderId: "big", updatedAt: 0 }), ...Array.from({ length: 20 }, (_, i) => note(`n${i}`, { folderId: "big", updatedAt: i }))];
    const c = connectionsOf(indexGraph(many, []), "me");
    expect(c).toHaveLength(SHARED_LIMIT);
    expect(c[0]!.id).toBe("n19");
  });
  it("a suggested link is a reason", () => {
    const i = indexGraph(NODES, EDGES, [{ source: "pricing", target: "far", entities: ["Sam", "Atlas"] }]);
    expect(connectionsOf(i, "far").find((x) => x.id === "pricing")!.reasons).toEqual([{ kind: "suggested", entities: ["Sam", "Atlas"] }]);
  });
});

describe("the map around a note", () => {
  it("is the note and one hop, each line saying why", () => {
    const m = neighbourhood(index, "pricing", { names })!;
    expect(m.nodes.map((n) => n.id).sort()).toEqual(["e:sam", "faq", "launch", "memo", "notes", "old", "plan", "pricing"]);
    expect(m.nodes.map((n) => n.id)).not.toContain("far");
    const line = (a: string, b: string) => m.edges.find((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a))!;
    expect(line("pricing", "plan")).toMatchObject({ source: "pricing", target: "plan", kind: "link", label: "links to · same folder" });
    // A backlink keeps its direction: from the other note into the middle.
    expect(line("notes", "pricing")).toMatchObject({ source: "notes", target: "pricing", kind: "link", label: "links here" });
    expect(line("pricing", "faq")).toMatchObject({ kind: "tag", label: "#pricing" });
    expect(line("pricing", "memo")).toMatchObject({ kind: "folder", label: "same folder" });
    expect(line("pricing", "old")).toMatchObject({ kind: "similar", inferred: true, label: "similar" });
    expect(line("pricing", "e:sam")).toMatchObject({ source: "e:sam", target: "pricing", kind: "mention", label: "mentions" });
    // Memo is also mentioned with Sam: that line is kept, unlabelled.
    expect(line("e:sam", "memo")).toMatchObject({ kind: "mention", label: "" });
    // One line per pair.
    const pairs = m.edges.map((e) => [e.source, e.target].sort().join("|"));
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(m.expandable.has("launch")).toBe(true);
    expect(m.expandable.has("e:sam")).toBe(false);
  });
  it("expanding a neighbour adds its own connections", () => {
    const m = neighbourhood(index, "pricing", { expanded: new Set(["launch"]), names })!;
    expect(m.nodes.map((n) => n.id)).toContain("far");
    expect(m.edges.find((e) => e.source === "launch" && e.target === "far")!.label).toBe("links to");
    expect(m.expandable.has("launch")).toBe(false);
  });
  it("a note not in the map gives null; a note with nothing around it is alone", () => {
    expect(neighbourhood(index, "missing")).toBeNull();
    const alone = neighbourhood(indexGraph([note("solo")], []), "solo")!;
    expect(alone.nodes.map((n) => n.id)).toEqual(["solo"]);
    expect(alone.edges).toEqual([]);
  });
  it("labels: both ways, and two reasons at most", () => {
    expect(lineLabel([{ kind: "link" }, { kind: "backlink" }])).toBe("links both ways");
    expect(lineLabel([{ kind: "link" }, { kind: "tag", tagId: "t" }, { kind: "folder", folderId: "f" }], { tag: () => "x" })).toBe("links to · #x");
  });
});

describe("in words", () => {
  it("says why a note is connected, and lists the notes by reason", () => {
    const e = explain(index, "pricing", names);
    expect(e.summary).toBe("Links to 2 notes, linked from 1, mentions Sam, Foli AI finds it related to 1 note, shares the tag #pricing with 1 and is in Work with 2 more.");
    expect(e.groups.map((g) => [g.title, g.ids])).toEqual([
      ["Links to", ["plan", "launch"]],
      ["Linked from", ["notes"]],
      ["Mentions", ["e:sam"]],
      ["Foli AI found", ["old"]],
      ["Also tagged #pricing", ["faq"]],
      ["Also in Work", ["plan", "memo"]],
    ]);
  });
  it("an entity, a note with nothing, and a note that's only linked to", () => {
    expect(explain(index, "e:sam").summary).toBe("Mentioned in 2 notes.");
    expect(explain(indexGraph([note("solo")], []), "solo").summary).toBe("Not connected to anything yet. Type [[ in it to link another note.");
    expect(explain(index, "notes").summary).toBe("Links to 1 note.");
    expect(explain(index, "far").summary).toBe("Linked from 1 note.");
  });
});

describe("a calmer map", () => {
  it("a fresh map hides unlinked notes and Foli AI's weaker lines, but keeps contradictions", () => {
    expect(DEFAULT_SETTINGS.filter).toMatchObject({ hideOrphans: true, hideAiLines: true });
    const edges = [...EDGES, { source: "plan", target: "launch", kind: "contradicts", inferred: true }];
    const r = filterGraph(NODES, edges, DEFAULT_SETTINGS.filter);
    expect(r.edges.some((x) => x.kind === "similar")).toBe(false);
    expect(r.edges.some((x) => x.kind === "contradicts")).toBe(true);
    expect(r.nodes.map((n) => n.id)).not.toContain("old");
    expect(r.nodes.map((n) => n.id)).not.toContain("faq");
    // Saved settings that showed them keep showing them.
    expect(cleanSettings({ filter: { hideOrphans: false } }).filter).toMatchObject({ hideOrphans: false, hideAiLines: false });
  });
  it("fewer labels when zoomed out", () => {
    expect(labelBudget(0.3, 100)).toBe(12);
    expect(labelBudget(0.6, 100)).toBe(30);
    expect(labelBudget(1, 100)).toBe(100);
    expect(labelBudget(0.3, 5)).toBe(5);
  });
});

describe("the floating card (the owner's design A, 6 November 2026)", () => {
  it("groups the connections by their strongest reason, each once, links first and the folder last", () => {
    const groups = groupConnections(connectionsOf(index, "pricing"), names);
    expect(groups.map((g) => [g.title, g.ids])).toEqual([
      ["Links", ["plan", "launch", "notes"]],
      ["Mentions", ["e:sam"]],
      ["Foli AI found", ["old"]],
      ["Tagged #pricing", ["faq"]],
      ["Same folder", ["memo"]],
    ]);
    expect(groups.flatMap((g) => g.ids)).toHaveLength(connectionsOf(index, "pricing").length);
  });
  it("shows Insights around a note when it's switched on (it lost the spot to the connections and did nothing)", () => {
    expect(dnaSide({ centred: true, insights: true, panel: null })).toBe("insights");
    expect(dnaSide({ centred: true, insights: false, panel: null })).toBe("connections");
    expect(dnaSide({ centred: false, insights: true, panel: null })).toBe("insights");
    expect(dnaSide({ centred: false, insights: false, panel: null })).toBeNull();
    // A picked note's panel takes the card, and closing it brings back what was there.
    expect(dnaSide({ centred: true, insights: true, panel: "plan" })).toBe("panel");
  });
});

describe("the time-lapse bar", () => {
  const at = (y: number, m: number, d = 1) => new Date(y, m, d).getTime();
  it("ticks months for a year or two, years past that, weeks or days for a short span", () => {
    expect(tickUnit(at(2026, 0), at(2026, 0, 10))).toBe("day");
    expect(tickUnit(at(2026, 0), at(2026, 1, 15))).toBe("week");
    expect(tickUnit(at(2025, 0), at(2026, 6))).toBe("month");
    expect(tickUnit(at(2020, 0), at(2026, 6))).toBe("year");
    const months = timelineTicks(at(2025, 10, 15), at(2026, 2, 10));
    expect(months.ticks.map((t) => new Date(t.at).getMonth())).toEqual([11, 0, 1, 2]);
    expect(months.ticks.find((t) => new Date(t.at).getMonth() === 0)!.major).toBe(true);
    expect(months.ticks.every((t) => t.pos > 0 && t.pos < 1)).toBe(true);
    expect(timelineTicks(at(2020, 5), at(2026, 5)).ticks.map((t) => new Date(t.at).getFullYear())).toEqual([2021, 2022, 2023, 2024, 2025, 2026]);
    expect(new Date(nextBoundary(at(2026, 10, 6), "week")).getDay()).toBe(1);
  });
  it("steps by a tick (or a fiftieth of the span), never past the ends", () => {
    const s = at(2025, 0);
    const e = at(2026, 0);
    expect(timelineStep(s, e, s, -1)).toBe(s);
    expect(timelineStep(s, e, e, 1)).toBe(e);
    const one = timelineStep(s, e, s, 1) - s;
    expect(one / 86_400_000).toBeCloseTo(30.44, 1);
  });
  it("counts the notes made so far", () => {
    const nodes = [note("a", { createdAt: 1 }), note("b", { createdAt: 5 }), note("c", { createdAt: 9 }), { id: "e:x", kind: "person", label: "X", createdAt: 1 }];
    expect(notesSoFar(nodes, 5)).toEqual({ shown: 2, total: 3 });
  });
});
