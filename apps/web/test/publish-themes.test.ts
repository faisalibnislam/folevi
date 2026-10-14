// Publishing themes (lib/publishThemes.ts): what each look does to a public page, and the Docs contents.
import { describe, expect, test } from "vitest";
import { SCHEMA_VERSION, type WireBlock } from "@folevi/editor-schema";
import { PUBLISH_THEMES, publishLook, publishTheme, tableOfContents } from "@/lib/publishThemes";

const style = { font: "rounded", width: "default" } as const;

describe("publishing themes", () => {
  test("four looks, Note first; anything unknown is the note's own style", () => {
    expect(PUBLISH_THEMES.map((t) => t.id)).toEqual(["note", "article", "docs", "minimal"]);
    expect(publishTheme("docs")).toBe("docs");
    expect(publishTheme("neon")).toBe("note");
    expect(publishTheme(undefined)).toBe("note");
  });

  test("each look's type, width and what it keeps of the note", () => {
    // Note: the note's own style, cover, backdrop and colours, as in the app.
    expect(publishLook("note", style)).toEqual({ font: "rounded", width: "default", cover: true, backdrop: true, colors: true, toc: false });
    // Article: serif and narrow, still in the note's colours.
    expect(publishLook("article", style)).toEqual({ font: "serif", width: "narrow", cover: true, backdrop: true, colors: true, toc: false });
    // Docs: sans and wide with contents, on the plain page background.
    expect(publishLook("docs", style)).toEqual({ font: "sans", width: "wide", cover: true, backdrop: false, colors: true, toc: true });
    // Minimal: the note's type and width on plain paper, no cover.
    expect(publishLook("minimal", style)).toEqual({ font: "rounded", width: "default", cover: false, backdrop: false, colors: false, toc: false });
  });

  test("the contents list the headings in page order, nested ones too, skipping empty ones", () => {
    const block = (id: string, type: string, text: string, rank: string, props: Record<string, unknown> = {}, parentId: string | null = null): WireBlock => ({ id, type, parentId, rank, schemaVersion: SCHEMA_VERSION, text: text ? [{ type: "text", text }] : [], props });
    const blocks = [
      block("b", "paragraph", "Intro", "b"),
      block("c", "heading", "Setup", "c", { level: 1 }),
      block("d", "toggle", "More", "d"),
      block("e", "heading", "Inside the toggle", "a", { level: 2 }, "d"),
      block("f", "heading", "", "f", { level: 2 }),
      block("g", "heading", "Deep", "g", { level: 9 }),
    ];
    expect(tableOfContents(blocks)).toEqual([
      { id: "c", text: "Setup", level: 1 },
      { id: "e", text: "Inside the toggle", level: 2 },
      { id: "g", text: "Deep", level: 3 },
    ]);
  });
});
