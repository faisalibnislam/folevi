// A cover's colour, a page's accent and a select option's colour are written into CSS as var(--color-<name>). On a
// public share page that CSS is rendered on the server into a style attribute, where a value such as
// "x);position:fixed;inset:0;background:url(https://...)" would add declarations of its own. Only the names
// Folevi has are ever used (lib/cover.ts, components/views/collectionView.ts).
import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_DOCUMENT_STYLE, type DocumentCover, type DocumentStyle } from "@folevi/editor-schema";
import { accentVar, coverBackground, pageBackdrop, softVar } from "@/lib/cover";
import { optionChipStyle } from "@/components/views/collectionView";
import { ReadOnlyCollection } from "@/components/views/ReadOnlyCollection";

const HOSTILE = "x);position:fixed;inset:0;z-index:2147483647;background:#fff url(https://attacker.example/o.png) center/contain no-repeat;--x:(";
const style = DEFAULT_DOCUMENT_STYLE;

describe("a cover's colour", () => {
  test("an accent Folevi has draws as before", () => {
    expect(coverBackground({ kind: "color", value: "plum" }, style)).toBe("var(--color-plum-soft)");
    expect(coverBackground({ kind: "color" }, style)).toBe("var(--color-ember-soft)");
    expect(coverBackground({ kind: "gradient", value: "moss" }, style)).toContain("var(--color-moss)");
  });

  test("any other value draws nothing, as a cover or as the page's backdrop", () => {
    for (const kind of ["color", "gradient"] as const) {
      const cover = { kind, value: HOSTILE } as DocumentCover;
      expect(coverBackground(cover, style)).toBeUndefined();
      expect(pageBackdrop(style, cover)).toBeUndefined();
    }
  });

  test("a page accent that isn't one of them draws the default, never its own text", () => {
    expect(accentVar(HOSTILE as DocumentStyle["accent"])).toBe("var(--color-ember)");
    expect(softVar(HOSTILE as DocumentStyle["accent"])).toBe("var(--color-ember-soft)");
    expect(coverBackground({ kind: "gradient" }, { ...style, accent: HOSTILE as DocumentStyle["accent"] })).not.toContain("attacker.example");
  });
});

describe("a select option's colour", () => {
  test("the colours an option can have", () => {
    expect(optionChipStyle("moss")).toEqual({ background: "var(--color-moss-soft)", color: "var(--color-moss-ink)" });
    expect(optionChipStyle("accent")).toEqual({ background: "var(--color-accent-soft)", color: "var(--color-accent-soft-ink)" });
    expect(optionChipStyle("muted")).toEqual({ background: "var(--color-surface-sunken)", color: "var(--color-ink)" });
  });

  test("anything else gets no style at all", () => {
    for (const color of [HOSTILE, "", "ink-muted", "constructor", 7, null, undefined, { toString: () => "moss" }]) expect(optionChipStyle(color)).toBeUndefined();
  });

  test("a shared page's collection renders the option without it", () => {
    const data = {
      name: "Board",
      viewType: "table" as const,
      config: { filters: [], sorts: [], visibleProperties: ["p1"] },
      properties: [{ id: "p1", name: "Status", type: "select", options: [{ id: "a", name: "Open", color: HOSTILE }] }],
      rows: [{ id: "r1", title: "Row", icon: null, values: { p1: "a" } }],
    };
    const html = renderToStaticMarkup(createElement(ReadOnlyCollection, { data: data as never }));
    expect(html).toContain("Open");
    expect(html).not.toContain("attacker.example");
    expect(html).not.toContain("position:fixed");
  });
});
