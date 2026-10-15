import { afterEach, describe, expect, test } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { WireBlock } from "@folevi/editor-schema";
import { ReadOnlyBlocks } from "@/components/doc/ReadOnlyBlocks";
import { fileIcon } from "@/components/doc/ReadOnlyCards";
import { FileArchive, FileImage, FileText, File as FileGlyph } from "lucide-react";

const block = (id: string, type: string, props: Record<string, unknown>, rank: string): WireBlock => ({ id, type, parentId: null, rank, schemaVersion: 1, text: [], props });

function render(blocks: WireBlock[], fileUrls: Record<string, string> = {}) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  act(() => createRoot(host).render(<ReadOnlyBlocks blocks={blocks} fileUrls={fileUrls} />));
  return host;
}

describe("read-only bookmark and file cards", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("a bookmark is one link card with its title, description, site, image and icon", () => {
    const host = render([
      block("b1", "bookmark", { url: "https://example.com/post", title: "A good post", description: "What it says.", siteName: "Example", image: "https://example.com/og.png", icon: "https://example.com/icon.png" }, "a"),
    ]);
    const card = host.querySelector<HTMLAnchorElement>("a[data-bookmark]")!;
    expect(card).not.toBeNull();
    expect(host.querySelectorAll("a")).toHaveLength(1);
    expect(card.href).toBe("https://example.com/post");
    expect(card.target).toBe("_blank");
    expect(card.rel).toContain("noopener");
    expect(card.className).toContain("ui-card");
    expect(card.textContent).toContain("A good post");
    expect(card.textContent).toContain("What it says.");
    expect(card.textContent).toContain("Example · example.com");
    const images = [...card.querySelectorAll("img")];
    expect(images.map((i) => i.getAttribute("src"))).toEqual(["https://example.com/icon.png", "https://example.com/og.png"]);
    for (const img of images) {
      expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
      expect(img.alt).toBe("");
    }
    // An image that doesn't load falls back: the icon to the link glyph, the preview to nothing.
    act(() => images.forEach((img) => img.dispatchEvent(new Event("error"))));
    expect(card.querySelectorAll("img")).toHaveLength(0);
    expect(card.querySelector("svg")).not.toBeNull();
  });

  test("a bookmark without a title shows its host, and an unsafe address is not a link", () => {
    const host = render([block("b1", "bookmark", { url: "https://example.org/x" }, "a"), block("b2", "bookmark", { url: "javascript:alert(1)", title: "Bad" }, "b")]);
    const cards = host.querySelectorAll("[data-bookmark]");
    expect(cards).toHaveLength(2);
    expect(cards[0]!.tagName).toBe("A");
    expect(cards[0]!.textContent).toContain("example.org");
    expect(cards[1]!.tagName).toBe("DIV");
    expect(host.querySelectorAll("a")).toHaveLength(1);
  });

  test("a file is one download link with its name and size, using the page's signed address", () => {
    const host = render([block("f1", "file", { fileId: "file_1", name: "Report.pdf", size: 2_400_000, mimeType: "application/pdf" }, "a")], { file_1: "https://files.example/file_1?sig=x" });
    const card = host.querySelector<HTMLAnchorElement>("a[data-file]")!;
    expect(card.href).toBe("https://files.example/file_1?sig=x");
    expect(card.getAttribute("download")).toBe("Report.pdf");
    expect(card.getAttribute("aria-label")).toBe("Download Report.pdf, 2.3 MB");
    expect(card.textContent).toContain("Report.pdf");
    expect(card.textContent).toContain("2.3 MB");
    expect(card.textContent).toContain("Download");
    expect(host.querySelectorAll("a")).toHaveLength(1);
  });

  test("a file the page can't serve is a plain card that says so", () => {
    const host = render([block("f1", "file", { fileId: "gone", name: "Old.zip", size: 900 }, "a")]);
    const card = host.querySelector("[data-file]")!;
    expect(card.tagName).toBe("DIV");
    expect(card.textContent).toContain("Old.zip");
    expect(card.textContent).toContain("Not available on this page");
    expect(host.querySelectorAll("a")).toHaveLength(0);
  });

  test("a file's icon follows its type", () => {
    expect(fileIcon("image/png", "a.png")).toBe(FileImage);
    expect(fileIcon(null, "notes.zip")).toBe(FileArchive);
    expect(fileIcon("application/pdf", "a.pdf")).toBe(FileText);
    expect(fileIcon("application/octet-stream", "data.bin")).toBe(FileGlyph);
  });
});
