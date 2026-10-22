import { describe, expect, it } from "vitest";
import { pageForQuery, readQuickAddTokens } from "@/lib/desktop/quickAddTokens";
import { splitTooltip } from "@/lib/desktop/tooltip";

describe("Quick Add tokens (Folevi for Mac)", () => {
  it("reads a priority and takes it out of the words", () => {
    expect(readQuickAddTokens("call Sam !high tomorrow")).toEqual({ rest: "call Sam tomorrow", priority: { level: "high", text: "!high" }, page: null });
    expect(readQuickAddTokens("pay rent !!").priority?.level).toBe("medium");
    expect(readQuickAddTokens("water plants !").priority?.level).toBe("low");
    expect(readQuickAddTokens("ship it !!!").priority?.level).toBe("high");
    expect(readQuickAddTokens("plan !med").priority?.level).toBe("medium");
  });
  it("leaves exclamations that aren't tokens", () => {
    expect(readQuickAddTokens("Hooray!").priority).toBeNull();
    expect(readQuickAddTokens("wow !nice").priority).toBeNull();
  });
  it("reads a page, one word or quoted", () => {
    expect(readQuickAddTokens("draft brief #Atlas")).toEqual({ rest: "draft brief", priority: null, page: { query: "Atlas", text: "#Atlas" } });
    expect(readQuickAddTokens('book ferry #"Trip Sketch" !h')).toMatchObject({ rest: "book ferry", priority: { level: "high" }, page: { query: "Trip Sketch" } });
  });
  it("keeps tokens the person kept as text", () => {
    expect(readQuickAddTokens("tag #1 issue", new Set(["#1"]))).toEqual({ rest: "tag #1 issue", priority: null, page: null });
    expect(readQuickAddTokens("yes !h", new Set(["!h"])).priority).toBeNull();
  });
  it("finds the page a query names", () => {
    const docs = [{ title: "Reading Shelf" }, { title: "Project Atlas" }, { title: "Atlas notes" }];
    expect(pageForQuery("atlas", docs)?.title).toBe("Atlas notes");
    expect(pageForQuery("proj", docs)?.title).toBe("Project Atlas");
    expect(pageForQuery("shelf", docs)?.title).toBe("Reading Shelf");
    expect(pageForQuery("zzz", docs)).toBeNull();
  });
});

describe("Mac tooltips", () => {
  it("splits a shortcut off a title", () => {
    expect(splitTooltip("New note (⌘⌥N)")).toEqual({ text: "New note", shortcut: "⌘⌥N" });
    expect(splitTooltip("Back (⌘[)")).toEqual({ text: "Back", shortcut: "⌘[" });
    expect(splitTooltip("Go to Home")).toEqual({ text: "Go to Home", shortcut: null });
    expect(splitTooltip("Show sidebar (⌘\\)")).toEqual({ text: "Show sidebar", shortcut: "⌘\\" });
  });
});

describe("Mac text menu", () => {
  it("finds the word at a caret", async () => {
    const { wordAround } = await import("@/lib/desktop/textMenu");
    expect(wordAround("the quick brwn fox", 12)).toEqual({ start: 10, end: 14, word: "brwn" });
    expect(wordAround("don’t stop", 2)?.word).toBe("don’t");
    expect(wordAround("'quoted' word", 3)?.word).toBe("quoted");
    expect(wordAround("a  b", 2)).toBeNull();
    expect(wordAround("2026", 2)).toBeNull();
  });
});
