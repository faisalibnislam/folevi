import { describe, expect, test } from "vitest";
import { blocksToHtml, imageDescription, looksLikeFileName, type WireBlock } from "../src";

describe("image descriptions", () => {
  test("file names and generated names are not descriptions", () => {
    for (const name of ["IMG_2041", "DSC01234", "PXL_20261012_091403123", "Screenshot 2026-10-12 at 09.14.03", "WhatsApp Image 2026-10-12 at 09.14.03", "image", "image (2)", "photo-3", "beach.jpg", "20261012_091403", "3f9a2c7e1b4d8f60a5c3e9d1", "beach_trip_2024_03"]) {
      expect(looksLikeFileName(name), name).toBe(true);
      expect(imageDescription(name)).toBe("");
    }
    expect(looksLikeFileName("holiday", "holiday.png")).toBe(true);
  });

  test("words someone wrote are kept", () => {
    for (const text of ["A dog on the beach", "Photo of the team in 2024", "Image showing Q3 revenue", "Sunset", "Revenue chart"]) {
      expect(looksLikeFileName(text), text).toBe(false);
      expect(imageDescription(` ${text} `)).toBe(text);
    }
    expect(imageDescription(undefined)).toBe("");
  });

  const b = (id: string, type: string, props: Record<string, unknown>, text = ""): WireBlock => ({ id, type, parentId: null, rank: id, schemaVersion: 1, text: text ? [{ type: "text", text }] : [], props });

  test("exported images use the description only, and to-dos are real checkboxes", () => {
    const html = blocksToHtml(
      [
        b("a", "image", { url: "https://example.com/a.png", alt: "IMG_2041", caption: "" }),
        b("b", "image", { url: "https://example.com/b.png", alt: "A dog", caption: "" }),
        b("c", "todo", { checked: true }, "done"),
        b("d", "todo", { checked: false }, "open"),
      ],
      { title: "T" },
    );
    expect(html).toContain('<figure aria-label="Image"><img src="https://example.com/a.png" alt="">');
    expect(html).toContain('<figure><img src="https://example.com/b.png" alt="A dog">');
    expect(html).toContain('<li class="done"><input type="checkbox" disabled checked> done');
    expect(html).toContain('<li><input type="checkbox" disabled> open');
  });
});
