// webUrl: what is fetched or opened as it is (a bookmark's picture and icon, a link opened from a menu) must be a
// web address. sanitizeHref also lets a path on Folevi's own site through, which is right for a link in a note
// and wrong for a picture: a reader's browser would ask Folevi itself for it.
import { describe, expect, it } from "vitest";
import { sanitizeHref, webUrl } from "../src";

describe("webUrl", () => {
  it("keeps http and https addresses", () => {
    expect(webUrl("https://example.com/og.png")).toBe("https://example.com/og.png");
    expect(webUrl("http://example.com/a?b=1#c")).toBe("http://example.com/a?b=1#c");
    expect(webUrl("  HTTPS://Example.com/x  ")).toBe("HTTPS://Example.com/x");
    // A bare host is a web address, as in a link.
    expect(webUrl("example.com/page")).toBe("https://example.com/page");
  });

  it("refuses everything else", () => {
    const refused = ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\tscript:alert(1)", "data:text/html,<script>1</script>", "data:image/svg+xml,<svg/>", "vbscript:x", "blob:https://app.folevi.com/1", "file:///etc/passwd", "folevi://note/1", "mailto:a@example.com", "/api/places/sign-out", "/documents", "#top", "//evil.example/x", "/\\evil.example", "https://", "http:///x", "", "   "];
    for (const value of refused) expect(webUrl(value), JSON.stringify(value)).toBeNull();
    for (const value of [null, undefined, 7, {}, ["https://example.com"], { toString: () => "https://example.com" }]) expect(webUrl(value), String(value)).toBeNull();
    expect(webUrl(`https://example.com/${"a".repeat(2100)}`)).toBeNull();
  });

  it("sanitizeHref answers null, not an error, for what isn't text", () => {
    for (const value of [null, undefined, 7, {}]) expect(sanitizeHref(value as never)).toBeNull();
  });
});
