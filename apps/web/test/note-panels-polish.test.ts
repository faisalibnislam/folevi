import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { narrowWindowQuery } from "@/components/doc/panelLayout";

// Guards for the note's tool panels (Style, Format, Insert), from the owner's 2026-11-18 review of Folevi for
// Mac: words sat 4 px from the edge of their own hover, sections were unevenly spaced, the chosen tile had three
// looks, and the panel opened over the note's words at ordinary window sizes. The real check on a running app is
// apps/mac/scripts/hover-lint.js (mac.mjs eval @apps/mac/scripts/hover-lint.js); these catch the same slips in
// the source, so they fail in CI before a build.
const doc = (name: string) => readFileSync(join(__dirname, "../src/components/doc", name), "utf8");
/** Every class string (a quoted or template literal with Tailwind classes) of a source file. */
const classStrings = (source: string) => [...source.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)].map((m) => m[2]!).filter((s) => /\bhover:bg-/.test(s));

describe("the note's tool panels", () => {
  it("opens beside the note at ordinary Mac window sizes", () => {
    // The web's window holds its sidebar; the Mac's page is only the card beside the native one.
    expect(narrowWindowQuery(false)).toBe("(max-width: 1199px)");
    expect(narrowWindowQuery(true)).toBe("(max-width: 939px)");
    // A 1280 pt Mac window leaves the page 992 px: beside, not over.
    expect(992).toBeGreaterThan(939);
  });

  it("keeps a full-width row's words at least 8 px inside its hover", () => {
    for (const file of ["Inspector.tsx", "FormatPanel.tsx", "InsertPanel.tsx"]) {
      const rows = classStrings(doc(file)).filter((c) => /\bw-full\b|\bw-\[calc\(100%/.test(c) && /\bflex\b/.test(c));
      for (const c of rows) {
        // (A row that sets no horizontal padding of its own gets it from a shared class: not checked here.)
        const pad = c.match(/(?:^|\s)px-(\d+(?:\.\d+)?)(?=\s|$)/);
        if (!pad) continue;
        expect(Number(pad[1]), `${file}: "${c.slice(0, 90)}…"`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("draws the Style panel's rows from one shared row", () => {
    const source = doc("Inspector.tsx");
    const box = source.match(/const STYLE_ROW_BOX = "([^"]+)"/)?.[1] ?? "";
    expect(box).toContain("px-2");
    expect(box).toContain("-mx-1");
    expect(box).toContain("h-9");
    // The theme's row, both colour rows and Blur background: no row with a size of its own beside them.
    expect(source.match(/STYLE_ROW\b(?!_)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(source).toContain("className={STYLE_ROW_BOX}");
  });

  it("gives every chosen tile of the Format panel one look", () => {
    const source = doc("FormatPanel.tsx");
    // (The desktop panel's section: the iPhone's sheet draws its own above it.)
    const from = source.indexOf('<h3 className="ui-caps mb-2 px-1">Groups</h3>');
    expect(from).toBeGreaterThan(0);
    const groups = source.slice(from, source.indexOf("BLOCK_OFF_HINT", from));
    expect(groups.match(/CHOSEN_TILE/g)?.length).toBe(2);
    expect(groups).not.toContain("bg-heading");
    expect(groups).not.toContain("h-11");
    // The icon leads the words in both tiles.
    expect(groups).toMatch(/<FileText[^>]*\/> Page/);
    expect(groups).toMatch(/<PanelTop[^>]*\/> Card/);
  });
});
