import { describe, expect, test } from "vitest";
import { cleanFileText, fileTextLabel, joinPdfPages, MAX_PDF_PAGES, pageAt, textFingerprint, validPageStarts } from "../src";

describe("text found in files", () => {
  test("cleaning drops control characters, collapses spaces and blank lines, and trims lines", () => {
    expect(cleanFileText("  Hello\u0000   world \r\n\r\n\r\n  second\tline  \n\n")).toBe("Hello world\n\nsecond line");
    expect(cleanFileText("\n\n  \n")).toBe("");
  });

  test("cleaning caps the length, at a word when one is near", () => {
    const long = "word ".repeat(100);
    const out = cleanFileText(long, 52);
    expect(out.length).toBeLessThanOrEqual(52);
    expect(out.endsWith("word")).toBe(true);
    expect(cleanFileText("x".repeat(80), 50)).toHaveLength(50);
  });

  test("PDF pages join with where each starts, and offsets map back to pages", () => {
    const { text, pageStarts } = joinPdfPages(["First page", "", "Third  page\nwith quokka"]);
    expect(text).toBe("First page\n\nThird page\nwith quokka");
    expect(pageStarts).toEqual([0, 12, 12]);
    expect(pageAt(pageStarts, text.indexOf("quokka"))).toBe(3);
    expect(pageAt(pageStarts, 0)).toBe(1);
    expect(pageAt([], 5)).toBeNull();
    expect(validPageStarts(pageStarts, text.length)).toBe(true);
  });

  test("a PDF's text stops at the cap and at the page limit", () => {
    const { text, pageStarts } = joinPdfPages(["a".repeat(30), "b".repeat(30), "c".repeat(30)], 50);
    expect(text.length).toBeLessThanOrEqual(50);
    expect(pageStarts).toHaveLength(2);
    expect(joinPdfPages(Array.from({ length: MAX_PDF_PAGES + 20 }, (_, i) => `p${i}`)).pageStarts).toHaveLength(MAX_PDF_PAGES);
  });

  test("page starts must increase and stay inside the text", () => {
    expect(validPageStarts([0, 5, 3], 10)).toBe(false);
    expect(validPageStarts([0, 11], 10)).toBe(false);
    expect(validPageStarts([0, 1.5], 10)).toBe(false);
    expect(validPageStarts(Array.from({ length: MAX_PDF_PAGES + 1 }, () => 0), 10)).toBe(false);
  });

  test("labels say where the words were", () => {
    expect(fileTextLabel("pdf", 3)).toBe("In PDF, page 3");
    expect(fileTextLabel("pdf")).toBe("In PDF");
    expect(fileTextLabel("image")).toBe("In image");
    expect(fileTextLabel("handwriting")).toBe("In handwriting");
  });

  test("fingerprints are stable and change with the input", () => {
    expect(textFingerprint("abc")).toBe(textFingerprint("abc"));
    expect(textFingerprint("abc")).not.toBe(textFingerprint("abd"));
    expect(textFingerprint("")).toHaveLength(16);
  });
});
