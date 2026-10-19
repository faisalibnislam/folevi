// The Foli AI mind map contract (convex/lib/mindmapAi.ts): whatever the model sends back, only a valid
// mind map block's data (or a short, clean list of ideas, tasks or a summary) leaves the server.
import { describe, expect, test } from "vitest";
import { mindmapDataIssue, mindmapToOutline, parseMindmap } from "@folevi/editor-schema";
import { AI_MAX_IDEAS, AI_MAX_TASKS, EXPAND_MAX, cleanSummary, ideaContext, mapForPrompt, parseIdeasReply, parseMapReply, parseTasksReply } from "../../../convex/lib/mindmapAi";

const MAP = JSON.stringify({
  v: 1,
  nodes: [
    { id: "r", parent: null, text: "Launch" },
    { id: "a", parent: "r", text: "Marketing", color: "pink", side: "left" },
    { id: "a1", parent: "a", text: "Blog post" },
    { id: "b", parent: "r", text: "Product", collapsed: true },
    { id: "b1", parent: "b", text: "Beta" },
  ],
});

describe("Foli AI mind maps", () => {
  test("a map reply (even fenced, even without its root wrapper) becomes valid block data", () => {
    const reply = '```json\n{"root":{"text":"Garden","children":[{"text":"Vegetables","children":[{"text":"Tomatoes"},{"text":""}]},{"text":"Flowers","color":"#123"},"junk"]}}\n```';
    const data = parseMapReply(reply)!;
    expect(mindmapDataIssue(data)).toBeNull();
    expect(mindmapToOutline(parseMindmap(data))).toEqual([
      { text: "Garden", depth: 0 },
      { text: "Vegetables", depth: 1 },
      { text: "Tomatoes", depth: 2 },
      { text: "Flowers", depth: 1 },
    ]);
    expect(parseMapReply('{"text":"Solo","children":[{"text":"One"}]}')).toBeTruthy();
    expect(parseMapReply("no json here")).toBeNull();
    expect(parseMapReply('{"root":{"text":"","children":[]}}')).toBeNull();
    // A layout asked for wins.
    expect(parseMindmap(parseMapReply('{"root":{"text":"R"}}', { layout: "down" })!).layout).toBe("down");
  });

  test("tidy keeps the ids, colours, sides and folding of the ideas it keeps", () => {
    const keep = parseMindmap(MAP);
    const reply = JSON.stringify({ root: { id: "r", text: "Launch plan", children: [{ text: "Go to market", children: [{ id: "a", text: "Marketing", children: [{ id: "a1", text: "Blog" }] }] }, { id: "b", text: "Product", children: [{ id: "b1", text: "Beta" }] }] } });
    const map = parseMindmap(parseMapReply(reply, { keep })!);
    const byId = new Map(map.nodes.map((n) => [n.id, n]));
    expect(byId.get("r")!.text).toBe("Launch plan");
    expect(byId.get("a")!.color).toBe("pink");
    // Moved under a new branch: its side no longer applies; Product keeps its folding.
    expect(byId.get("a")!.side).toBeUndefined();
    expect(byId.get("b")!.collapsed).toBe(true);
    expect(map.nodes.map((n) => n.id).slice(0, 2)).toEqual(["r", expect.any(String)]);
  });

  test("a huge reply is capped", () => {
    const tree = { text: "R", children: Array.from({ length: 400 }, (_, i) => ({ text: `Idea ${i}` })) };
    expect(parseMindmap(parseMapReply(JSON.stringify({ root: tree }))!).nodes.length).toBe(AI_MAX_IDEAS);
  });

  test("ideas: cleaned, without what's already there or repeats, at most six", () => {
    const reply = JSON.stringify({ ideas: ["- Blog post", { text: "1. Podcast" }, { text: "podcast" }, { text: "Events\nand talks" }, { text: "" }, "A", "B", "C", "D", "E"] });
    const ideas = parseIdeasReply(reply, ["Blog post"]);
    expect(ideas.map((i) => i.text)).toEqual(["Podcast", "Events and talks", "A", "B", "C", "D"]);
    expect(ideas).toHaveLength(EXPAND_MAX);
    expect(parseIdeasReply("{}")).toEqual([]);
  });

  test("tasks: single lines, no checkboxes, no repeats, capped", () => {
    const reply = JSON.stringify({ tasks: ["[ ] Write the blog post", "Write the blog post", { text: "Book a venue" }, 3, ...Array.from({ length: 60 }, (_, i) => `Task ${i}`)] });
    const tasks = parseTasksReply(reply);
    expect(tasks.slice(0, 2)).toEqual(["Write the blog post", "Book a venue"]);
    expect(tasks).toHaveLength(AI_MAX_TASKS);
  });

  test("summaries lose fences and a title heading", () => {
    expect(cleanSummary("```markdown\n# Launch\nThe plan has two parts.\n- Marketing\n```")).toBe("The plan has two parts.\n- Marketing");
  });

  test("prompts carry ids and text only, and the chosen idea's path", () => {
    const p = mapForPrompt(MAP)!;
    expect(JSON.parse(p)).toEqual({ id: "r", text: "Launch", children: [{ id: "a", text: "Marketing", color: "pink", children: [{ id: "a1", text: "Blog post" }] }, { id: "b", text: "Product", children: [{ id: "b1", text: "Beta" }] }] });
    expect(p).not.toContain("side");
    expect(JSON.parse(mapForPrompt(MAP, "a")!).text).toBe("Marketing");
    expect(mapForPrompt("")).toBeNull();
    expect(ideaContext(MAP, "a1")).toEqual({ path: ["Launch", "Marketing", "Blog post"], children: [] });
    expect(ideaContext(MAP, "a")!.children).toEqual(["Blog post"]);
    expect(ideaContext(MAP, "zz")).toBeNull();
  });
});
