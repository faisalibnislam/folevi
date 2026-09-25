import { describe, expect, it } from "vitest";
import { blocksToHtml, blocksToMarkdown, flattenTree, markdownToBlocks, plainText, plainTextToBlocks, validateWireBlock } from "../src";
import golden from "../fixtures/document-golden.json";
import type { WireBlock } from "../src";

let n = 0;
const newId = () => `id${String(++n).padStart(4, "0")}`;

describe("markdown import", () => {
  it("imports headings, lists, checklists, code, quotes, tables, front matter", () => {
    const md = `---
title: "Trip Sketch"
tags: travel
---

Intro with **bold**, _italic_, \`code\`, ~~gone~~ and a [link](https://example.com).

## Plan

- Pack
  - Wool socks
  - [x] Thermos
1. Ferry
2. Lighthouse

- [ ] Book cabin (due 2026-10-02 09:30)

> [!WARNING]
> Last ferry at 21:00

> Slow is smooth.

\`\`\`ts
const x = 1;
\`\`\`

| Day | Plan |
| --- | --- |
| Sat | Walk \\| swim |

---

![Harbor](https://example.com/harbor.jpg)
![Local](./img/local.png)

<div>raw</div>

[^1]: footnote
`;
    const r = markdownToBlocks(md, { newId });
    expect(r.title).toBe("Trip Sketch");
    expect(r.frontMatter.tags).toBe("travel");
    for (const b of r.blocks) expect(validateWireBlock(b), JSON.stringify(b)).toEqual([]);
    const flat = flattenTree(r.blocks).map((e) => `${"  ".repeat(e.depth)}${e.block.type}:${plainText(e.block.text)}`);
    expect(flat).toEqual([
      "paragraph:Intro with bold, italic, code, gone and a link.",
      "heading:Plan",
      "bulleted:Pack",
      "  bulleted:Wool socks",
      "  todo:Thermos",
      "numbered:Ferry",
      "numbered:Lighthouse",
      "todo:Book cabin",
      "callout:Last ferry at 21:00",
      "quote:Slow is smooth.",
      "code:",
      "table:",
      "divider:",
      "image:",
      "paragraph:Local",
      "paragraph:<div>raw</div>",
      "paragraph:[^1]: footnote",
    ]);
    const todo = r.blocks.find((b) => b.type === "todo" && plainText(b.text) === "Book cabin")!;
    expect(todo.props).toEqual({ checked: false, dueDate: "2026-10-02", dueTime: "09:30" });
    const intro = r.blocks[0]!;
    expect(intro.text).toContainEqual({ type: "text", text: "bold", marks: [{ type: "bold" }] });
    expect(intro.text).toContainEqual({ type: "text", text: "link", marks: [{ type: "link", href: "https://example.com" }] });
    const table = r.blocks.find((b) => b.type === "table")!;
    expect(plainText((table.props.rows as never[][])[1]![1] as never)).toBe("Walk | swim");
    expect(r.warnings.map((w) => w.code).sort()).toEqual(["footnote", "html_block", "unresolved_image"]);
  });

  it("uses the first H1 as the title only when it leads the document", () => {
    expect(markdownToBlocks("# Hello\n\nBody", { newId }).title).toBe("Hello");
    const r = markdownToBlocks("Body\n\n# Later", { newId });
    expect(r.title).toBeNull();
    expect(r.blocks[1]!.type).toBe("heading");
  });

  it("never allows javascript: links through", () => {
    const r = markdownToBlocks("[x](javascript:alert(1))", { newId });
    expect(JSON.stringify(r.blocks)).not.toContain("javascript");
  });

  it("imports plain text as paragraphs", () => {
    const b = plainTextToBlocks("one\ntwo\n\nthree", newId);
    expect(b.map((x) => plainText(x.text))).toEqual(["one two", "three"]);
  });
});

describe("markdown export", () => {
  it("round-trips the structural content of the golden document", () => {
    const blocks = (golden.blocks as unknown as WireBlock[]).filter((b) => b.schemaVersion === 1);
    const md = blocksToMarkdown(blocks, { title: "Field Notes", resolveFile: (id) => `assets/${id}.bin`, resolveDocument: (id) => `${id}.md` });
    expect(md).toContain("# Field Notes");
    expect(md).toContain("- [ ] Book the ferry (due 2026-10-02 09:30)");
    expect(md).toContain("```swift\nlet tide = Tide(height: 1.2)");
    expect(md).toContain("| Day | Plan |");
    expect(md).toContain("![Harbor at dawn](assets/file_harbor.bin)");
    const back = markdownToBlocks(md, { newId });
    const types = back.blocks.map((b) => b.type);
    for (const t of ["heading", "paragraph", "bulleted", "numbered", "todo", "quote", "callout", "divider", "code", "table"]) {
      expect(types).toContain(t);
    }
  });

  it("escapes HTML in the HTML export", () => {
    const html = blocksToHtml(
      [{ id: "a", type: "paragraph", parentId: null, rank: "V", schemaVersion: 1, text: [{ type: "text", text: "<script>alert(1)</script>" }], props: {} }],
      { title: "<b>T</b>" },
    );
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<title>&lt;b&gt;T&lt;/b&gt;</title>");
  });
});
