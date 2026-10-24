// The UI type scale is the only source of font sizes (packages/design-tokens font.role; docs/DESIGN_SYSTEM.md
// "Type"): Apple's text styles as roles, text-large-title … text-caption-2, compact on the web and the Mac and
// Apple's default Dynamic Type sizes in the iPhone and iPad apps. This test fails on any size that bypasses it:
// arbitrary Tailwind sizes (text-[13px]), Tailwind's own sizes (text-sm), raw px in CSS font-size / font, and
// inline fontSize numbers. The exceptions are listed below, each with its reason: the note's own typography
// and drawings (they follow the note's style, not the UI), images drawn without CSS, and the marketing site's
// display typography (its own scale, nothing under 11 px).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

const SRC = join(__dirname, "../src");

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else if (/\.(tsx?|css)$/.test(name)) out.push(path);
  }
  return out;
}

const ROLES = ["large-title", "title-1", "title-2", "title-3", "headline", "body", "callout", "subheadline", "footnote", "caption-1", "caption-2"];

/** The marketing site keeps its own display typography: whole px, 11 and up. */
const MARKETING = (path: string) => path.startsWith("components/marketing/") || path.startsWith("app/(marketing)/");
/** Its pictures of the app (miniatures drawn at a fraction of the app's size) go down to 8. */
const MARKETING_PICTURES = new Set(["components/marketing/home/Included.tsx", "components/marketing/home/HeroEditor.tsx", "components/marketing/product/Replica.tsx", "components/marketing/foli/pictures.tsx", "components/marketing/features/FeatureVisual.tsx", "components/marketing/features/MorePictures.tsx", "components/marketing/demos/AskDemo.tsx"]);

/** Arbitrary Tailwind sizes allowed in the app, by file: the note's own typography. */
const NOTE_TYPOGRAPHY: Record<string, string[]> = {
  // The note's title (the note's style decides it, like the editor's body).
  "components/doc/DocumentView.tsx": ["text-[40px]"],
  "app/s/[token]/page.tsx": ["text-[40px]"],
  "app/s/[token]/EncryptedShare.tsx": ["text-[40px]"],
  // The note's title in a version's preview.
  "components/doc/VersionHistory.tsx": ["text-[2.1rem]"],
  // The six-digit code another device shows, set to be read across a room.
  "components/e2ee/ApproveDeviceDialog.tsx": ["text-[40px]"],
  // The onboarding's hero line on a wide screen (a display size, like the marketing site's).
  "components/app/Onboarding.tsx": ["sm:text-[44px]"],
};

/** Inline fontSize numbers: images drawn without CSS, sizes that scale with a drawing, and font previews. */
const INLINE_SIZES = new Set([
  "app/opengraph-image.tsx", // Open Graph image (rendered by next/og, no CSS)
  "components/marketing/og.tsx",
  "components/marketing/home/Included.tsx", // an SVG picture
  "components/ui/Avatar.tsx", // initials proportional to the avatar
  "components/app/WorkspaceMenu.tsx",
  "components/admin/ThemeEditor.tsx", // a theme font's preview
  "components/editor/richRender.ts", // Mermaid's diagram theme (note content)
  "components/editor/flowchart/interactions/containers.tsx", // scales with the flowchart's zoom
]);

/** CSS rules that keep px sizes, by file and selector: the note's own typography and drawings. */
const CSS_CONTENT: Record<string, RegExp> = {
  "app/globals.css": /^body$/, // the document's base size (the marketing site and the editor inherit it)
  "components/editor/editor.css": /pre\.fb-code/,
  "components/editor/insert-blocks.css": /\.fb-formula-(source|input)|pre\.fb-code/,
  "components/editor/stickies/stickies.css": /\.st-(group-label|label-input)/,
  "components/editor/chart/chart.css": /\.fb-chart-(static-)?title/,
  "components/editor/mindmap/mindmap.css": /\.mm-outline/,
  "components/present/present.css": /\.fb-slide/,
  "components/app/onboarding/onboarding.css": /\.ob-(win|tab)/,
};

const at = (text: string, i: number) => text.slice(0, i).split("\n").length;

function violations(path: string, text: string): string[] {
  const rel = relative(SRC, path);
  const found: string[] = [];
  if (path.endsWith(".css")) {
    let selector = "";
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (line.includes("{") && !line.trim().startsWith("@")) selector = line.split("{")[0]!.trim() || selector;
      for (const m of line.matchAll(/(?:font-size:\s*|\bfont:\s*(?:\d{3}\s+)?)(\d+(?:\.\d+)?)px/g)) {
        if (/editor-zoom|clamp\(/.test(line)) continue;
        const px = Number(m[1]);
        if (rel.endsWith("marketing.css") && Number.isInteger(px) && px >= 11) continue;
        if (CSS_CONTENT[rel]?.test(selector)) continue;
        found.push(`${rel}:${i + 1} ${selector.slice(0, 60)} ${m[0]}`);
      }
    });
    return found;
  }
  for (const m of text.matchAll(/(?<![\w-])((?:[\w[\]&_.:>()=*~+#@,/-]+?:)?!?)text-(\[\d+(?:\.\d+)?(?:px|rem|pt)\]|(?:xs|sm|base|lg|xl|[2-9]xl)(?![\w-]))/g)) {
    const cls = m[0].replace(/^[^\w[!]*/, "");
    const size = m[2]!;
    if (MARKETING(rel)) {
      const px = /^\[(\d+(?:\.\d+)?)px\]$/.exec(size);
      if (px && Number.isInteger(Number(px[1])) && Number(px[1]) >= (MARKETING_PICTURES.has(rel) ? 8 : 11)) continue;
    }
    if (NOTE_TYPOGRAPHY[rel]?.some((c) => cls.endsWith(c))) continue;
    found.push(`${rel}:${at(text, m.index!)} ${cls}`);
  }
  if (!INLINE_SIZES.has(rel)) for (const m of text.matchAll(/fontSize:\s*(["'`]?\d|Math\.)/g)) found.push(`${rel}:${at(text, m.index!)} ${m[0]}`);
  return found;
}

describe("type scale", () => {
  test("every font size in the app comes from the scale's roles", () => {
    const all = files(SRC).flatMap((path) => violations(path, readFileSync(path, "utf8")));
    expect(all).toEqual([]);
  });

  test("the roles: compact on the desktop, Apple's default Dynamic Type sizes on iPhone and iPad", async () => {
    const { tokens } = await import("@folevi/design-tokens");
    const sizes = (scale: Record<string, { size: number; leading: number }>) => Object.fromEntries(Object.entries(scale).map(([k, v]) => [k, v.size]));
    expect(sizes(tokens.font.role.desktop)).toEqual({ largeTitle: 32, title1: 24, title2: 20, title3: 17, headline: 15, body: 14, callout: 13, subheadline: 13, footnote: 12, caption1: 12, caption2: 11 });
    expect(sizes(tokens.font.role.ios)).toEqual({ largeTitle: 34, title1: 28, title2: 22, title3: 20, headline: 17, body: 17, callout: 16, subheadline: 15, footnote: 13, caption1: 12, caption2: 11 });
    // Every role reads at least as large as the one below it, and nothing readable is under 11.
    for (const scale of [tokens.font.role.desktop, tokens.font.role.ios]) {
      const list = Object.values(scale).map((v) => v.size);
      expect([...list].sort((a, b) => b - a)).toEqual(list);
      expect(Math.min(...list)).toBeGreaterThanOrEqual(11);
      for (const v of Object.values(scale)) expect(v.leading).toBeGreaterThanOrEqual(v.size);
    }
  });

  test("each role is a Tailwind class, and the iPhone and iPad apps switch every role to Apple's sizes", () => {
    const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
    for (const r of ROLES) {
      expect(css).toContain(`--text-${r}: var(--type-${r});`);
      expect(css).toContain(`--text-${r}--line-height: var(--type-${r}-leading);`);
    }
    const generated = readFileSync(join(__dirname, "../../../packages/design-tokens/generated/tokens.css"), "utf8");
    const ios = generated.slice(generated.indexOf(":root:is([data-iphone], [data-native]) {"));
    for (const r of ROLES) expect(ios).toContain(`--type-${r}:`);
  });
});
