// The pages Foli AI may open on its own (docs/SECURITY_PLAN.md P0.2): links the person wrote and pages a web
// search returned in the same run; never an address the model built from what it read.
import { describe, expect, test } from "vitest";
import { AllowedPages } from "../../convex/lib/ai/web";

describe("AllowedPages", () => {
  test("links the person wrote are allowed, ignoring a fragment, a trailing slash and the host's case", () => {
    const pages = new AllowedPages(["Summarise https://Example.com/guide/ and also see https://docs.example.org/a?x=1."]);
    expect(pages.allows("https://example.com/guide")).toBe(true);
    expect(pages.allows("https://example.com/guide/#intro")).toBe(true);
    expect(pages.allows("https://docs.example.org/a?x=1")).toBe(true);
  });

  test("an address built to carry data out is refused, even on an allowed site", () => {
    const pages = new AllowedPages(["Read https://example.com/guide"]);
    expect(pages.allows("https://attacker.example/?d=secret")).toBe(false);
    expect(pages.allows("https://example.com/guide?d=secret")).toBe(false);
    expect(pages.allows("https://example.com/other")).toBe(false);
    expect(pages.allows("not a url")).toBe(false);
  });

  test("search results of the run are added as they come", () => {
    const pages = new AllowedPages([]);
    expect(pages.allows("https://news.example/story")).toBe(false);
    pages.add("https://news.example/story");
    expect(pages.allows("https://news.example/story")).toBe(true);
  });
});
