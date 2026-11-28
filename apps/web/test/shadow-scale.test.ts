// One shadow hierarchy (packages/design-tokens shadow; docs/SHADOWS.md). Edges outline a surface (a ring, an inset
// line, the glass edge) and carry no elevation; elevation comes only from the levels, drop shadows that sit under
// an edge: raised, resting, lifted, floating and overlay (flat is an edge with no drop). This test fails on any
// drop shadow that bypasses the levels: a blurred or offset layer written out in a Tailwind class (shadow-[0_4px_..]),
// a CSS box-shadow or inline style, Tailwind's own sizes (shadow-lg) and the retired names (--shadow-pop and the
// rest). Lines (a 1px offset with no blur) and rings are edges, so they pass.
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

// The share images are drawn without CSS (Satori takes no variables).
const OUTSIDE = [/opengraph-image\.tsx$/, /\/og\.tsx$/, /cardImage\.tsx$/];
// Drawing inside the note and folder art, not elevation: the folder's front lip over the notes in its pocket, a
// note's paper peeking out of a folder (sized in cqw with the art) and the bookmark ribbon's drop.
const ART = [
  /^app\/globals\.css:\d+ (?::root\[data-theme="dark"\] )?\[data-fc="front"\]/,
  /^components\/views\/FolderCardArt\.tsx:\d+ 0 0 0 0\.5px rgb\(40 40 60\/0\.16\),0 1cqw/,
];

/** Splits a shadow list at its top-level commas. */
function layers(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** A layer that lifts the box: not inset, and blurred (a ring or a 1px line has no blur). */
function isDrop(layer: string): boolean {
  if (/^var\(/.test(layer) || /\binset\b/.test(layer) || layer === "none") return false;
  const lengths = layer
    .replace(/(?:rgba?|hsla?|color-mix|oklab|oklch)\((?:[^()]|\([^()]*\))*\)/g, "")
    .replace(/var\([^)]*\)/g, "")
    .match(/-?\d*\.?\d+(?:px|cqw|em|rem)?/g) ?? [];
  const blur = Number.parseFloat(lengths[2] ?? "0");
  return blur !== 0;
}

const RETIRED = /--(?:shadow-(?:card|card-drop|pop|sheet|lift|dock)|glass-shadow|liquid-shadow)(?![\w-])/;

function violations(path: string, text: string): string[] {
  const found: string[] = [];
  const rel = relative(SRC, path);
  const at = (i: number) => `${rel}:${text.slice(0, i).split("\n").length}`;
  const check = (i: number, value: string, label = value) => {
    if (layers(value).some(isDrop)) found.push(`${at(i)} ${label}`);
  };
  for (const m of text.matchAll(new RegExp(RETIRED, "g"))) found.push(`${at(m.index!)} ${m[0]} (retired: use a level)`);
  if (path.endsWith(".css")) {
    for (const m of text.matchAll(/(box-shadow|--[\w-]*shadow[\w-]*)\s*:\s*([^;}]+)/g)) {
      // The edge recipes are defined here (--shadow-control's neutral copy and the like); the levels come from tokens.
      if (/^--shadow-(?:hairline|edge|control|primary)$/.test(m[1]!)) continue;
      const line = text.slice(text.lastIndexOf("}", m.index!) + 1, m.index!).trim().split("{")[0]!.trim();
      const label = `${line} ${m[2]!.trim().replace(/\s+/g, " ")}`;
      if (layers(m[2]!).some(isDrop)) found.push(`${at(m.index!)} ${label}`);
    }
  } else {
    for (const m of text.matchAll(/(?<![\w-])(?:[\w-]+:)*shadow-\[([^\]\s"'`]+)\]/g)) check(m.index!, m[1]!.replace(/_/g, " "));
    for (const m of text.matchAll(/boxShadow:\s*["'`]([^"'`]+)["'`]/g)) check(m.index!, m[1]!);
    for (const m of text.matchAll(/(?<![\w-])shadow-(?:xs|sm|md|lg|xl|2xl)(?![\w-])/g)) found.push(`${at(m.index!)} ${m[0]} (Tailwind's own size: use a level)`);
  }
  return found.filter((v) => !ART.some((re) => re.test(v)));
}

describe("shadows", () => {
  test("every drop shadow in the app is a level of the hierarchy", () => {
    const all = files(SRC)
      .filter((path) => !OUTSIDE.some((re) => re.test(relative(SRC, path))))
      .flatMap((path) => violations(path, readFileSync(path, "utf8")));
    expect(all).toEqual([]);
  });

  test("the levels are drops only and each one is deeper than the one below, in light and in dark", async () => {
    const { tokens } = await import("@folevi/design-tokens");
    const shadow = tokens.shadow as unknown as Record<"light" | "dark", Record<string, [number, number, number, number, string, string?][]>>;
    const levels = ["raised", "resting", "lifted", "floating", "overlay"];
    for (const theme of ["light", "dark"] as const) {
      expect(Object.keys(shadow[theme])).toEqual(["hairline", "edge", "control", "primary", ...levels]);
      let last = { y: -1, blur: -1, alpha: -1 };
      for (const name of levels) {
        const ls = shadow[theme][name]!;
        expect(ls.every((l) => !l[5] && l[2] > 0), `${theme} ${name} is drops only`).toBe(true);
        const deepest = ls[ls.length - 1]!;
        const now = { y: deepest[1], blur: deepest[2], alpha: Number(/[\d.]+\)$/.exec(deepest[4])![0].slice(0, -1)) };
        expect(now.y, `${theme} ${name} offset`).toBeGreaterThan(last.y);
        expect(now.blur, `${theme} ${name} blur`).toBeGreaterThan(last.blur);
        expect(now.alpha, `${theme} ${name} strength`).toBeGreaterThanOrEqual(last.alpha);
        last = now;
      }
    }
  });

  test("the checks catch what they should", () => {
    expect(isDrop("0 1px 0 var(--color-line)")).toBe(false);
    expect(isDrop("0 0 0 1px rgb(0 0 0 / 0.1)")).toBe(false);
    expect(isDrop("inset 0 1px 2px rgb(0 0 0 / 0.1)")).toBe(false);
    expect(isDrop("var(--shadow-floating)")).toBe(false);
    expect(isDrop("0 4px 12px rgb(0 0 0 / 0.18)")).toBe(true);
    expect(violations(join(SRC, "x.tsx"), 'className="shadow-[0_4px_12px_rgb(0_0_0/0.18)]"')).toHaveLength(1);
    expect(violations(join(SRC, "x.tsx"), 'className="shadow-[var(--glass-edge),var(--shadow-floating)]"')).toEqual([]);
    expect(violations(join(SRC, "x.tsx"), 'className="hover:shadow-lg"')).toHaveLength(1);
    expect(violations(join(SRC, "x.css"), ".a { box-shadow: var(--shadow-pop); }")).toHaveLength(1);
  });
});
