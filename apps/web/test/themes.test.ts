import { describe, expect, test } from "vitest";
import { BUILT_IN_THEMES, familyFor, fontFamily, themeFontVars, themesFrom, type ThemeRow } from "@/lib/themes";

const row = (key: string, fields: Partial<ThemeRow> = {}): ThemeRow => ({
  key,
  name: null,
  status: "published",
  order: 1,
  plan: "free",
  image: null,
  palette: null,
  defaults: null,
  fonts: null,
  updatedAt: 0,
  ...fields,
});

describe("note themes in the app", () => {
  test("the shipped themes come with their setup, in order", () => {
    expect(BUILT_IN_THEMES).toHaveLength(57);
    expect(BUILT_IN_THEMES[26]).toMatchObject({ id: "art-27", name: "Ultramarine", builtIn: true, status: "published", plan: "free", defaults: { font: "sans", separator: "doodle" }, fonts: { modern: "plus-jakarta-sans" } });
  });

  test("an admin's changes apply on top of a built-in, and added themes join the list in their place", () => {
    const palette = { ...BUILT_IN_THEMES[0]!, paper: "#ffffff" };
    const list = themesFrom([
      row("art-02", { name: "Collage", status: "retired", plan: "pro", order: 1 }),
      row("th-01J000000000000000000000AA", { name: "Mine", order: 0.5, palette, image: { full: "f", half: "h", thumb: "t", width: 3200, height: 2000 } }),
      // An added theme without colours yet (a broken row) isn't drawn.
      row("th-01J000000000000000000000BB", { name: "Empty", order: 0 }),
    ]);
    expect(list.map((t) => t.id).slice(0, 3)).toEqual(["th-01J000000000000000000000AA", "art-01", "art-02"]);
    expect(list.find((t) => t.id === "art-02")).toMatchObject({ name: "Collage", status: "retired", plan: "pro", builtIn: true });
    expect(list.find((t) => t.id === "th-01J000000000000000000000AA")).toMatchObject({ name: "Mine", builtIn: false, paper: "#ffffff", image: { thumb: "t" } });
    expect(list.some((t) => t.id === "th-01J000000000000000000000BB")).toBe(false);
  });

  test("typefaces become CSS families with fallbacks; unknown ids fall back to the standard face", () => {
    expect(fontFamily("serif", "fraunces")).toMatch(/^var\(--font-fraunces\), var\(--font-spectral\)/);
    expect(fontFamily("serif", "comic-sans")).toMatch(/^var\(--font-spectral\)/);
    expect(fontFamily("soft", "system-rounded")).toMatch(/^ui-rounded, "SF Pro Rounded"/);
    expect(familyFor("sans")).toMatch(/^var\(--font-inter\)/);
    expect(themeFontVars({ modern: "figtree", serif: "lora", mono: "space-mono", soft: "nunito" })).toMatchObject({ "--note-modern": expect.stringMatching(/figtree/), "--note-soft": expect.stringMatching(/nunito/) });
    expect(themeFontVars(null)).toBeUndefined();
  });
});
