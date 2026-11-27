// The marketing site's paper cards (.mk-box.mk-tint: every page's header card, and some sections on Home) take the
// theme's dark pair in dark mode. Without it the card stayed light while headings turned near-white, so headlines such
// as /mac's and /linux's vanished (owner, 2026-11-27). The labels on them (.mk-eyebrow) get light text in dark mode too.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const css = readFileSync(join(__dirname, "../src/components/marketing/marketing.css"), "utf8");

/** The declarations of the first rule whose selector list matches exactly. */
function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `rule ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at));
}

describe("paper cards in dark mode", () => {
  test("the card uses the theme's dark paper", () => {
    expect(rule(':root[data-theme="dark"] .mk-box.mk-tint')).toContain("var(--art-paper-dark");
  });

  test("its secondary text mixes the dark ink and paper", () => {
    const text = rule(':root[data-theme="dark"] .mk-tint .mk-lede, :root[data-theme="dark"] .mk-tint .text-muted');
    expect(text).toContain("--art-ink-dark");
    expect(text).toContain("--art-paper-dark");
  });

  test("labels get light text in dark mode", () => {
    expect(rule(':root[data-theme="dark"] .mk-eyebrow, .mk-dark .mk-eyebrow')).toMatch(/color: color-mix\([^;]*#fff\)/);
  });
});
