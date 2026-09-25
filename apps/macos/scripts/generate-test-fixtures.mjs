#!/usr/bin/env node
// Regenerates apps/macos/FoleviTests/Fixtures/reference-outputs.json from the TypeScript reference
// implementation in packages/editor-schema (Markdown/HTML export, Markdown import, inline parsing,
// tree helpers, number formatting). The Swift ports are tested against this file.
//   node apps/macos/scripts/generate-test-fixtures.mjs
// Requires the repo's node_modules (esbuild comes with vitest); nothing is written outside the fixture.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../../..");
const pnpmDir = join(root, "node_modules/.pnpm");
const esbuildPkg = readdirSync(pnpmDir).find((d) => d.startsWith("@esbuild+darwin-"));
if (!esbuildPkg) throw new Error("esbuild binary not found in node_modules/.pnpm");
const arch = esbuildPkg.replace(/^@esbuild\+/, "").replace(/@.*$/, "");
const esbuild = join(pnpmDir, esbuildPkg, "node_modules/@esbuild", arch, "bin/esbuild");
const out = join(mkdtempSync(join(tmpdir(), "folevi-fixtures-")), "schema.mjs");
execFileSync(esbuild, [join(root, "packages/editor-schema/src/index.ts"), "--bundle", "--format=esm", "--platform=node", `--outfile=${out}`], { stdio: "inherit" });
const s = await import(pathToFileURL(out).href);
const R = root;
const golden = JSON.parse(readFileSync(`${R}/packages/editor-schema/fixtures/document-golden.json`, "utf8")).blocks;
const resolveFile = (id) => `assets/${id}.bin`;
const resolveDocument = (id) => (id.endsWith("2") ? `Project Atlas Brief.md` : null);
const md1 = s.blocksToMarkdown(golden, { resolveFile, resolveDocument });
const md2 = s.blocksToMarkdown(golden, { title: "Field Notes & [Tides]", frontMatter: { created: "2026-09-25", tags: "travel \"sea\"" } });
const html = s.blocksToHtml(golden, { title: "Field <Notes>", resolveFile });
const importSrc = `---
title: "Imported Title"
author: Ada
---
# Heading One Ignored As Title

Intro with **bold**, _italic_, \`code\`, ~~gone~~ and a [link](https://example.com/a b) plus https://folevi.com/x.
Second line joins the paragraph.

## Section *two*

- first bullet
  - nested bullet
- [ ] open task (due 2026-10-02 09:30)
- [x] done task
1. one
2. two

> A quote
> continues

> [!WARNING] Mind the gap
> really

\`\`\`ts
const a = 1;
\`\`\`

\`\`\`weird
x
\`\`\`

| Day | Plan |
| --- | --- |
| Sat | Walk \\| run |

---

![Harbor](https://example.com/h.png "Dawn")
![Local](local/pic.png)
<div>raw</div>
<details><summary>Toggle me</summary></details>
[^1]: footnote
[ref]: https://x.y

snake_case_word and *unclosed
`;
let n = 0;
const imp = s.markdownToBlocks(importSrc, { newId: () => `id${String(++n).padStart(2, "0")}`, resolveImage: (src) => (src === "local/pic.png" ? null : null) });
const inlineCases = ["plain", "**b** and *i*", "a_b_c", "***both***", "``co`de``", "[x](javascript:alert(1))", "<https://a.b/c>", "esc \\*not\\*", "~~s~~ **_bi_**"];
const inline = inlineCases.map((c) => ({ input: c, output: s.parseInlineMarkdown(c) }));
const flat = [
  { id: "a", depth: 0, rank: "V", parentId: null },
  { id: "b", depth: 1, rank: "V", parentId: "a" },
  { id: "c", depth: 1 },
  { id: "d", depth: 0, rank: "G", parentId: null },
  { id: "e", depth: 5, rank: "x", parentId: null },
  { id: "f", depth: 0, rank: "l", parentId: null },
];
const assigned = Object.fromEntries([...s.assignTreePositions(flat)].map(([k, v]) => [k, v]));
const tree = [
  { id: "r1", parentId: null, rank: "G" }, { id: "r2", parentId: null, rank: "V" }, { id: "r3", parentId: null, rank: "V" },
  { id: "c1", parentId: "r1", rank: "V" }, { id: "o1", parentId: "missing", rank: "A" },
];
const rankCases = [[null, null, undefined], [null, "r1", undefined], [null, "r2", undefined], [null, "r3", undefined], [null, "nope", undefined], ["r1", "c1", undefined], ["r1", null, undefined], [null, "o1", undefined], [null, "r1", "r2"], [null, null, "r1"]].map(([parentId, afterId, movingId]) => ({ parentId, afterId, movingId }));
const ranks = rankCases.map((c) => ({ ...c, result: s.rankForPosition(tree, c.parentId, c.afterId, c.movingId) }));
const flatOrder = s.flattenTree(tree).map((e) => `${e.block.id}:${e.depth}`);
const plain = s.plainTextToBlocks("One\npara\n\n\nTwo  \n\nThree", (() => { let k = 0; return () => `p${++k}`; })());
const words = ["", "Hello world", "It’s a well-known fact_ok", "naïve café 123 — dash", "  multiple   spaces\nnew line "].map((w) => ({ input: w, count: s.wordCount(w) }));
const hrefs = ["https://x.com", "javascript:alert(1)", "java\tscript:alert(1)", "/relative", "//evil.com", "#frag", "example.com/path", "MAILTO:a@b.c", "data:text/html,x", "folevi://doc/1", " "].map((h) => ({ input: h, output: s.sanitizeHref(h) }));
const numbers = [0, 1, -1, 0.75, 1790000000000, 1e21, 1e-7, 123456789.125, 0.1 + 0.2, 2 ** 60, 5e-324, 1.5e300].map((x) => ({ value: x, text: JSON.stringify(x) }));
writeFileSync(`${R}/apps/macos/FoleviTests/Fixtures/reference-outputs.json`, JSON.stringify({ $description: "Generated from packages/editor-schema (TypeScript reference) by the macOS test-fixture script; expected outputs for Swift ports.", markdown: { withResolvers: md1, withTitle: md2 }, html, importSource: importSrc, importResult: imp, inline, assigned, flatInput: flat, tree, ranks, flatOrder, plain, words, hrefs, numbers }, null, 2) + "\n");
