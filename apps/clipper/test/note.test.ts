// The note a clip becomes: title, source line, byline, content, and the cut for very long pages.
import { describe, expect, test } from "vitest";
import { buildNote, capMarkdown, cleanTitle, clipDate, sourceLine } from "../src/lib/note";

const when = new Date(2026, 9, 14, 9, 30);

describe("source line", () => {
  test("names the page as a link, with the date", () => {
    expect(clipDate(when)).toBe("14 October 2026");
    expect(sourceLine("article", "How [we] ship", "https://example.com/blog/ship?x=1", when)).toBe("Clipped from [How \\[we\\] ship](https://example.com/blog/ship?x=1) on 14 October 2026");
    expect(sourceLine("link", "Reading list", "https://example.com/list", when)).toBe("Link saved from [Reading list](https://example.com/list) on 14 October 2026");
  });

  test("an address that isn't http(s) isn't linked", () => {
    expect(sourceLine("selection", "Local file", "file:///Users/me/notes.html", when)).toBe("Clipped from Local file on 14 October 2026");
  });
});

describe("buildNote", () => {
  test("an article: source line, byline and site, a rule, then the content", () => {
    const note = buildNote({ kind: "article", title: "  The   long read ", pageUrl: "https://example.com/read", markdown: "## Part one\n\nText.", byline: "Sam Lee", siteName: "Example Weekly" }, when);
    expect(note.title).toBe("The long read");
    expect(note.markdown).toBe("Clipped from [The long read](https://example.com/read) on 14 October 2026\n\nSam Lee · Example Weekly\n\n---\n\n## Part one\n\nText.");
  });

  test("a selection keeps the page's title for the source and the person's title for the note", () => {
    const note = buildNote({ kind: "selection", title: "Quote to keep", pageTitle: "Interview", pageUrl: "https://example.com/i", markdown: "> Words." }, when);
    expect(note.title).toBe("Quote to keep");
    expect(note.markdown.startsWith("Clipped from [Interview](https://example.com/i) on 14 October 2026\n\n---\n\n> Words.")).toBe(true);
  });

  test("a link becomes the link, with where it was found", () => {
    const note = buildNote({ kind: "link", title: "Design notes", pageTitle: "Blog", pageUrl: "https://example.com/blog", markdown: "", linkUrl: "https://other.example/design notes" }, when);
    expect(note.title).toBe("Design notes");
    expect(note.markdown).toBe("Link saved from [Blog](https://example.com/blog) on 14 October 2026\n\n---\n\n[Design notes](https://other.example/design%20notes)");
  });

  test("an empty title falls back to the site's name", () => {
    expect(cleanTitle("   ", "https://www.example.com/x")).toBe("example.com");
    expect(cleanTitle("", "not a url")).toBe("Untitled clip");
    expect(cleanTitle("a".repeat(300)).length).toBe(200);
  });

  test("a page longer than a note takes is cut at a paragraph, and says so", () => {
    const paragraph = `${"word ".repeat(199)}word`;
    const markdown = Array.from({ length: 200 }, () => paragraph).join("\n\n");
    const note = buildNote({ kind: "article", title: "Huge", pageUrl: "https://example.com/huge", markdown }, when);
    expect(note.markdown.length).toBeLessThanOrEqual(100_000);
    expect(note.markdown.endsWith("\n\n_The rest of the page was too long to clip._")).toBe(true);
    expect(note.markdown).toContain(`${paragraph}\n\n_The rest`);
  });
});

describe("capMarkdown", () => {
  test("leaves short text alone and closes a code fence it cut through", () => {
    expect(capMarkdown("short", 100)).toEqual({ markdown: "short", cut: false });
    const cut = capMarkdown(`Intro\n\n\`\`\`js\n${"let a = 1;\n".repeat(50)}\`\`\``, 120);
    expect(cut.cut).toBe(true);
    expect(cut.markdown.endsWith("\n```")).toBe(true);
    expect((cut.markdown.match(/^```/gm) ?? []).length % 2).toBe(0);
  });
});
