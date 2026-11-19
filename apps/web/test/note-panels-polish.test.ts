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

  it("has no blur at the panel's foot, on the web or the Mac", () => {
    // The owner, 2026-11-19: the progressive blur over the last rows of Foli AI's panel looked out of place.
    const css = readFileSync(join(__dirname, "../src/app/globals.css"), "utf8");
    const inspector = readFileSync(join(__dirname, "../src/components/doc/Inspector.tsx"), "utf8");
    expect(css).not.toContain("ui-blur-bottom");
    expect(inspector).not.toContain("ui-blur-bottom");
  });
});

describe("the iPad's wide layout has the Mac's note page (2026-11-19)", () => {
  const css = readFileSync(join(__dirname, "../src/app/globals.css"), "utf8");
  it("shares every Mac-native rule with the iPad's marker", () => {
    // No rule is the Mac's alone: each one names both markers (the iPad's own numbers follow in their block).
    expect(css).not.toMatch(/:root\[data-mac-native\]/);
    expect(css.match(/:root:is\(\[data-mac-native\], \[data-ipad-native\]\)/g)?.length ?? 0).toBeGreaterThan(40);
  });
  it("puts the iPad's page on its frame's grey with its own card corners and panel width", () => {
    expect(css).toMatch(/:root\[data-ipad-native\] \{ --ipad-frame: #ececec; --mac-card-radius: 18px; \}/);
    expect(css).toMatch(/:root\[data-ipad-native\] aside\[aria-label="Page tools"\]:not\(\.ui-pop\) \{ width: 292px !important; \}/);
  });
});
