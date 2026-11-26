// Imported attachments (Apple Notes): a link on its own line to an uploaded file becomes a file block; the
// original dates an import keeps are made safe.
import { describe, expect, it } from "vitest";
import { importedDates, markdownToBlocks } from "../src";

describe("attachments in imported Markdown", () => {
  it("turns a resolved link line into a file block and leaves other links alone", () => {
    const { blocks } = markdownToBlocks("# T\n\n[Report.pdf](att-1)\n\nSee [the site](https://example.com).\n\n[Other](att-2)", {
      resolveFile: (src) => (src === "att-1" ? { fileId: "F1", name: "Report.pdf", size: 10.6, mimeType: "" } : null),
    });
    expect(blocks.map((b) => b.type)).toEqual(["file", "paragraph", "paragraph"]);
    const file = blocks.find((b) => b.type === "file")!;
    expect(file.props).toEqual({ fileId: "F1", name: "Report.pdf", size: 11, mimeType: "application/octet-stream" });
    expect(blocks.filter((b) => b.type === "file")).toHaveLength(1);
  });
});

describe("importedDates", () => {
  const now = 1_800_000_000_000;
  it("keeps sensible dates", () => expect(importedDates(1_600_000_000_000, 1_700_000_000_000, now)).toEqual({ createdAt: 1_600_000_000_000, updatedAt: 1_700_000_000_000 }));
  it("never goes past now or before 1970", () => expect(importedDates(-5, now + 1, now)).toEqual({ createdAt: 0, updatedAt: now }));
  it("is changed no earlier than made", () => expect(importedDates(1_700_000_000_000, 1_600_000_000_000, now)).toEqual({ createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000 }));
  it("fills a missing one", () => {
    expect(importedDates(undefined, 1_600_000_000_000, now)).toEqual({ createdAt: 1_600_000_000_000, updatedAt: 1_600_000_000_000 });
    expect(importedDates(1_600_000_000_000, undefined, now)).toEqual({ createdAt: 1_600_000_000_000, updatedAt: 1_600_000_000_000 });
    expect(importedDates(Number.NaN, undefined, now)).toEqual({ createdAt: now, updatedAt: now });
  });
});
