// Selectors that make a long note slow to edit, kept out of the app's CSS. Both were found by measuring a
// 2,000-line note (e2e/editor-long-note.spec.ts): the time went to the browser working out styles again for
// lines that had not changed.
//
// 1. A rule that ends in a bare position test (`tr > :nth-child(2)`, with no tag, class or attribute beside
//    it). WebKit tries such a rule on every element of the page, and once it has tried :nth-child on a note's
//    lines, each line added or removed restyles every line after it (about 40 ms a key on a fast Mac).
// 2. `:has()` on something that holds the note (the page, the sheet, the editor). Chromium then restyles the
//    whole note whenever a line is added or removed (about 100 ms a key on a slow device). Say it with an
//    attribute set where the thing is drawn instead (data-sheet-host, data-sheet-pages).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..", "..");
const roots = [join(root, "apps/web/src"), join(root, "packages/design-tokens/generated")];

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...cssFiles(path));
    else if (name.endsWith(".css")) out.push(path);
  }
  return out;
}

/** Splits at `separator` (a test on one character) wherever it is outside brackets and parentheses. */
function splitOutside(text: string, separator: (c: string) => boolean): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const c of text) {
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (depth === 0 && separator(c)) {
      parts.push(current);
      current = "";
    } else current += c;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Every selector of every style rule in a stylesheet (comments, at-rule lines and declarations left out). */
export function selectorsOf(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  for (const match of text.matchAll(/([^{}]+)\{/g)) {
    const prelude = match[1]!.trim();
    if (!prelude || prelude.startsWith("@") || /^(from|to|\d+(\.\d+)?%)(\s*,\s*(from|to|\d+(\.\d+)?%))*$/.test(prelude)) continue;
    out.push(...splitOutside(prelude, (c) => c === ","));
  }
  return out;
}

/** The last compound of a selector: what the rule styles. */
export function subjectOf(selector: string): string {
  const compounds = splitOutside(selector.replace(/\s*([>+~])\s*/g, " $1 "), (c) => c === " ").filter((p) => !/^[>+~]$/.test(p));
  return compounds[compounds.length - 1] ?? "";
}

const POSITION = /:nth-(last-)?(child|of-type)\(/;
/** A subject with a position test and nothing that names the element (a tag, class, id or attribute). */
export const barePosition = (subject: string) => POSITION.test(subject) && /^\*?(::?[\w-]+(\([^)]*\))?)+$/.test(subject) && !/^[a-zA-Z]/.test(subject);

const HOLDS_NOTE = /(\.fb-page|\.fb-sheet|\.fb-editor|\[data-iphone-plain\]|\[data-iphone-scroll\]|#doc-scroll)(?![\w-])[^\s>+~]*:has\(/;
/** `:has()` written on a compound that names something the note sits inside. */
export const hasOnNoteHolder = (selector: string) => splitOutside(selector.replace(/\s*([>+~])\s*/g, " $1 "), (c) => c === " ").some((compound) => HOLDS_NOTE.test(compound) && !/\.fb-(todo|table|code)/.test(compound));

describe("selectors that cost a long note time", () => {
  const files = roots.flatMap(cssFiles);
  const all = files.flatMap((file) => selectorsOf(readFileSync(file, "utf8")).map((selector) => ({ file: relative(root, file), selector })));

  it("reads the stylesheets", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(all.length).toBeGreaterThan(2000);
    expect(selectorsOf("a, b > c { x: y } @media (min-width: 1px) { .d:is(.e, .f) g { x: y } }")).toEqual(["a", "b > c", ".d:is(.e, .f) g"]);
    expect(subjectOf(".fb-chart-grid tr > :nth-child(2)")).toBe(":nth-child(2)");
    expect(subjectOf(".a:has(> .b) > :not(.c)")).toBe(":not(.c)");
  });

  it("no rule ends in a bare :nth-child", () => {
    expect(barePosition(":nth-child(2)")).toBe(true);
    expect(barePosition("*:nth-last-child(1)")).toBe(true);
    expect(barePosition("td:nth-child(2)")).toBe(false);
    expect(barePosition(".border-line:nth-last-child(1 of .border-line)")).toBe(false);
    expect(barePosition(":first-child")).toBe(false);
    expect(all.filter(({ selector }) => barePosition(subjectOf(selector)))).toEqual([]);
  });

  it("nothing that holds the note is styled with :has()", () => {
    expect(hasOnNoteHolder(".fb-page:not([data-backdrop]):has(> .fb-sheet:not([data-pages])) > :not(.fb-sheet)")).toBe(true);
    expect(hasOnNoteHolder(":root[data-iphone] [data-iphone-plain]:has(> .fb-sheet[data-pages])")).toBe(true);
    expect(hasOnNoteHolder(".fb-page[data-sheet-host]:not([data-sheet-pages]) > :not(.fb-sheet)")).toBe(false);
    // A line of the note may look at its own children (a task's date chip, a code block's Copy button).
    expect(hasOnNoteHolder(".fb-editor .fb-todo:has(> .fb-task-meta:not(:empty)) > .fb-content")).toBe(false);
    expect(all.filter(({ selector }) => hasOnNoteHolder(selector))).toEqual([]);
  });
});
