// The corner scale is the only source of rounded corners (packages/design-tokens radius: tiny 4, chip 6,
// small 8, control 10, panel 14, container 18; docs/DESIGN_SYSTEM.md "Corners"). This test fails on any
// corner that bypasses it: arbitrary Tailwind values, Tailwind's own sizes, full rounding, raw CSS values
// and inline numbers. Nested corners follow inner = outer - inset; they're checked in the browser.
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

const TOKENS = "none|tiny|chip|small|control|panel|container";
const SIDES = "(?:-(?:t|b|l|r|tl|tr|bl|br|s|e|ss|se|es|ee))?";

/** Every way a corner could be set outside the scale, with what it found. */
function violations(path: string, text: string): string[] {
  const found: string[] = [];
  const at = (i: number) => `${relative(SRC, path)}:${text.slice(0, i).split("\n").length}`;
  if (path.endsWith(".css")) {
    for (const m of text.matchAll(/border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius:\s*([^;}]+)/g)) {
      const value = m[1]!.trim();
      // A token, or a component variable that falls back to one (var(--x, var(--radius-chip))).
      const token = new RegExp(`var\\(--radius-(?:${TOKENS})\\)`);
      const ok = value === "0" || value === "inherit" || value.split(/\s+/).every((v) => v === "0" || token.test(v)) || /^var\(--[\w-]+, var\(--radius-[a-z]+\)\)$/.test(value);
      if (!ok) found.push(`${at(m.index!)} border-radius: ${value}`);
    }
    return found;
  }
  // Tailwind classes: only the scale's names (and rounded-none / rounded-[inherit]).
  for (const m of text.matchAll(new RegExp(`(?<![\\w-])rounded${SIDES}(-[\\w\\[\\]().,%-]+)?(?![\\w-])`, "g"))) {
    const suffix = m[1] ?? "";
    if (new RegExp(`^-(?:${TOKENS}|\\[inherit\\])$`).test(suffix)) continue;
    // Words that merely contain "rounded" in prose or identifiers aren't classes.
    const before = text[m.index! - 1] ?? "";
    if (!suffix && !/["'`\s{]/.test(before)) continue;
    if (!suffix && !/["'`\s}]/.test(text[m.index! + m[0].length] ?? "")) continue;
    if (!suffix && !/className|class=|cx\(|clsx|tw`|"\s*\+/.test(text.slice(Math.max(0, m.index! - 400), m.index!))) continue;
    // A value compared or assigned ("rounded" is also a note font) and prose in comments aren't classes.
    if (!suffix && /(===|!==|:)\s*["'`]$/.test(text.slice(Math.max(0, m.index! - 8), m.index!))) continue;
    const line = text.slice(text.lastIndexOf("\n", m.index!) + 1, m.index!);
    if (/^\s*(\/\/|\/?\*)/.test(line)) continue;
    found.push(`${at(m.index!)} ${m[0]}`);
  }
  // Inline styles: tokens only (CSS variables, or tokens.radius in images rendered without CSS).
  for (const m of text.matchAll(/borderRadius:\s*([^,}\n]+)/g)) {
    const value = m[1]!.trim();
    if (/^"var\(--radius-(?:[a-z]+)\)"$/.test(value) || /\bR\.(?:none|tiny|chip|small|control|panel|container)\b/.test(value) || value === "inherit" || value === '"inherit"') continue;
    found.push(`${at(m.index!)} borderRadius: ${value}`);
  }
  return found;
}

describe("corners", () => {
  test("every rounded corner in the app and on the website comes from the scale", () => {
    const all = files(SRC).flatMap((path) => violations(path, readFileSync(path, "utf8")));
    expect(all).toEqual([]);
  });

  test("the scale is 18 at most, and every step is on it", async () => {
    const { tokens } = await import("@folevi/design-tokens");
    expect(tokens.radius).toEqual({ none: 0, tiny: 4, chip: 6, small: 8, control: 10, panel: 14, container: 18 });
  });
});
