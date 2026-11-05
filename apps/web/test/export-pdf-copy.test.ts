// QA F23: the PDF choice says what the next screen is on each platform (the Mac app opens the Mac print dialog,
// not a browser's print window).
import { afterEach, describe, expect, test } from "vitest";
import { pdfCopy, printPlatform } from "@/components/doc/ExportDialog";

afterEach(() => {
  document.documentElement.removeAttribute("data-desktop");
  delete document.documentElement.dataset.native;
});

describe("PDF export copy", () => {
  test("the Mac app names the Mac print dialog", () => {
    document.documentElement.setAttribute("data-desktop", "mac");
    expect(printPlatform()).toBe("mac");
    expect(pdfCopy("mac").desc).toBe("For printing or sending. Opens the Mac print dialog, where you can save a PDF.");
    expect(pdfCopy("mac").desc).not.toMatch(/browser/i);
    expect(pdfCopy("mac").ready).not.toMatch(/browser|window/i);
  });

  test("the iPhone and iPad app names the print options", () => {
    document.documentElement.dataset.native = "ios";
    expect(printPlatform()).toBe("ios");
    expect(pdfCopy("ios").desc).not.toMatch(/browser/i);
  });

  test("a browser keeps its print window", () => {
    expect(printPlatform()).toBe("browser");
    expect(pdfCopy("browser").desc).toBe("For printing or sending. Uses your browser's print window.");
  });

  test("no em dashes", () => {
    for (const p of ["mac", "ios", "browser"] as const) expect(Object.values(pdfCopy(p)).join(" ")).not.toContain("—");
  });
});
