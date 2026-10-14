// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://example.com/blog/2026/clean-notes"}
// The page side: HTML to Markdown for the web, and the injected extractor (Readability on a copy of the page,
// the selection from the live one) on a real-looking article.
import { beforeAll, describe, expect, test } from "vitest";
import { htmlToMarkdown, nodeToMarkdown, safeUrl } from "../src/lib/htmlToMarkdown";
import type { Extracted, ExtractMode } from "../src/lib/messages";
import { withoutSiteName } from "../src/extractor";

const BASE = "https://example.com/blog/2026/clean-notes";

describe("htmlToMarkdown", () => {
  test("headings, emphasis, lists, quotes, code and tables", () => {
    const md = htmlToMarkdown(
      `<h1>Title</h1><h4>Small</h4><p>Some <strong>bold</strong> and <em>soft</em> text with <code>x = 1</code>.</p>
       <ul><li>One<ul><li>Nested</li></ul></li><li><input type="checkbox" checked> Done</li></ul><ol start="3"><li>Three</li></ol>
       <blockquote><p>Quoted.</p></blockquote><pre><code class="language-ts">const a = 1;\n</code></pre>
       <table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2 | 3</td></tr></table>`,
      BASE,
    );
    expect(md).toBe(
      [
        "# Title",
        "### Small",
        "Some **bold** and _soft_ text with `x = 1`.",
        "- One\n  - Nested\n- [x] Done",
        "3. Three",
        "> Quoted.",
        "```ts\nconst a = 1;\n```",
        "| A | B |\n| --- | --- |\n| 1 | 2 \\| 3 |",
      ].join("\n\n"),
    );
  });

  test("links and images become absolute; images stay remote; unsafe ones keep only text", () => {
    const md = htmlToMarkdown(
      `<p><a href="../other">Other post</a>, <a href="#notes">jump</a>, <a href="javascript:alert(1)">bad</a>, <a href="mailto:sam@example.com">mail</a>.</p>
       <figure><img src="/img/cover.jpg" alt="A [cover]"><figcaption>The cover</figcaption></figure>
       <p><img src="data:image/png;base64,AAAA" alt="inline"><img data-src="lazy.png" alt="lazy"></p>`,
      BASE,
    );
    expect(md).toContain("[Other post](https://example.com/blog/other)");
    expect(md).toContain(", jump, bad, [mail](mailto:sam@example.com).");
    expect(md).toContain("![A cover](https://example.com/img/cover.jpg)");
    expect(md).toContain("_The cover_");
    expect(md).not.toContain("data:image");
    expect(md).toContain("![lazy](https://example.com/blog/2026/lazy.png)");
  });

  test("scripts, styles, forms and navigation never come through; Markdown in text is escaped", () => {
    const md = htmlToMarkdown(`<nav>Menu</nav><script>evil()</script><style>p{}</style><form><input value="x"></form><p>2 * 3 = [six]_ok</p>`, BASE);
    expect(md).toBe("2 \\* 3 = \\[six\\]\\_ok");
  });

  test("safeUrl", () => {
    expect(safeUrl("/a b", BASE)).toBe("https://example.com/a%20b");
    expect(safeUrl("ftp://x", BASE)).toBeNull();
    expect(safeUrl("mailto:a@b.c", BASE)).toBeNull();
    expect(safeUrl("mailto:a@b.c", BASE, true)).toBe("mailto:a@b.c");
  });
});

describe("the injected extractor", () => {
  let extract: (mode: ExtractMode, link?: string) => Extracted;

  beforeAll(() => {
    const paragraphs = Array.from({ length: 8 }, (_, i) => `<p>Paragraph ${i + 1} of the article explains how clipping keeps the reading clean, with enough words in it that Readability treats it as the main content of the page. <a href="/related/${i}">Related</a></p>`).join("");
    document.head.innerHTML = `<meta property="og:site_name" content="Example Weekly"><meta name="author" content="Sam Lee">`;
    document.title = "Clean notes | Example Weekly";
    document.body.innerHTML = `<nav><a href="/">Home</a> <a href="/about">About</a></nav><header><h1>Example Weekly</h1></header>
      <article><h1>Clean notes</h1><h2>Why it matters</h2>${paragraphs}<img src="/img/chart.png" alt="Chart"></article>
      <aside>Subscribe now</aside><footer>Copyright</footer>`;
    extract = (globalThis as unknown as { __foleviExtract: typeof extract }).__foleviExtract;
  });

  test("an article: the clean content as Markdown, with title, byline and site", () => {
    const page = extract("article");
    expect(page).toMatchObject({ url: BASE, title: "Clean notes", byline: "Sam Lee", siteName: "Example Weekly", readable: true, hasSelection: false });
    expect(page.markdown).toContain("## Why it matters");
    expect(page.markdown).toContain("Paragraph 8 of the article");
    expect(page.markdown).toContain("[Related](https://example.com/related/0)");
    expect(page.markdown).toContain("![Chart](https://example.com/img/chart.png)");
    expect(page.markdown).not.toMatch(/Subscribe now|Copyright|About/);
    // The page itself is left as it was.
    expect(document.querySelector("nav")).not.toBeNull();
  });

  test("a selection: just what's selected", () => {
    const range = document.createRange();
    const second = document.querySelectorAll("article p")[1]!;
    range.selectNodeContents(second);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    const page = extract("selection");
    expect(page.hasSelection).toBe(true);
    expect(page.markdown).toMatch(/^Paragraph 2 of the article/);
    expect(page.markdown).not.toContain("Paragraph 3");
    window.getSelection()!.removeAllRanges();
  });

  test("a title loses the site's name at its end", () => {
    expect(withoutSiteName("Clean notes | Example Weekly", "Example Weekly")).toBe("Clean notes");
    expect(withoutSiteName("Clean notes \u2014 example weekly", "Example Weekly")).toBe("Clean notes");
    expect(withoutSiteName("Example Weekly", "Example Weekly")).toBe("Example Weekly");
    expect(withoutSiteName("Clean notes | Example Weekly", null)).toBe("Clean notes | Example Weekly");
  });

  test("a link: its text on the page", () => {
    expect(extract("link", "https://example.com/about").title).toBe("About");
  });

  test("nodeToMarkdown on a fragment", () => {
    const box = document.createElement("div");
    box.innerHTML = "<p>One</p><p>Two</p>";
    expect(nodeToMarkdown(box, BASE)).toBe("One\n\nTwo");
  });
});
