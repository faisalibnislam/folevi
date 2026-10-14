import { describe, expect, it } from "vitest";
import { embedFor, embedProblem } from "../src/embeds";
import { blocksToMarkdown } from "../src/markdown";
import { validateWireBlock } from "../src/validate";
import type { WireBlock } from "../src/types";

const src = (url: string) => embedFor(url)?.src ?? null;

describe("embed addresses", () => {
  it("YouTube: watch, short, shorts and embed links, with a start time, through the no-cookie player", () => {
    expect(src("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(src("youtu.be/dQw4w9WgXcQ?t=1m30s")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90");
    expect(src("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(src("https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=42");
    expect(src("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(src("https://www.youtube.com/watch?v=dQw4w9WgXcQ\"><script>")).toBeNull();
  });

  it("Vimeo, with an unlisted video's hash; Loom; Figma keeps only the frame it points at", () => {
    expect(src("https://vimeo.com/76979871")).toBe("https://player.vimeo.com/video/76979871?dnt=1");
    expect(src("https://vimeo.com/76979871/8272103f6e")).toBe("https://player.vimeo.com/video/76979871?dnt=1&h=8272103f6e");
    expect(src("https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184?sid=x")).toBe("https://www.loom.com/embed/0281766fa2d04bb788eaf19e65135184");
    const figma = embedFor("https://www.figma.com/design/AbCdEfGhIjKlMnOp/Trip-plan?node-id=1-2&t=secret");
    expect(figma?.provider).toBe("figma");
    expect(decodeURIComponent(figma!.src.split("url=")[1]!)).toBe("https://www.figma.com/design/AbCdEfGhIjKlMnOp/Trip-plan?node-id=1-2");
  });

  it("Google Maps: a place, coordinates or a search; short links are explained", () => {
    expect(src("https://www.google.com/maps/place/Oban+Ferry+Terminal/@56.41,-5.47,15z")).toBe("https://maps.google.com/maps?q=Oban+Ferry+Terminal&output=embed&z=15");
    expect(src("https://www.google.com/maps/@56.41,-5.47,12z")).toBe("https://maps.google.com/maps?q=56.41%2C-5.47&output=embed&z=12");
    expect(src("https://maps.google.com/?q=Edinburgh")).toBe("https://maps.google.com/maps?q=Edinburgh&output=embed");
    expect(embedProblem("https://maps.app.goo.gl/abc")).toMatch(/Short map links/);
  });

  it("anything else isn't embedded", () => {
    for (const url of ["https://example.com/video", "javascript:alert(1)", "https://evil.com/youtube.com/watch?v=dQw4w9WgXcQ", "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ", ""]) expect(embedFor(url)).toBeNull();
    expect(embedProblem("https://example.com")).toMatch(/YouTube, Vimeo, Loom, Figma or Google Maps/);
  });
});

describe("embed block", () => {
  const block = (props: Record<string, unknown>): WireBlock => ({ id: "01JAEMBED0000000000000000A", type: "embed", parentId: null, rank: "V", schemaVersion: 1, text: [], props });

  it("must be an address its provider frames", () => {
    expect(validateWireBlock(block({ url: "https://youtu.be/dQw4w9WgXcQ", provider: "youtube" }))).toEqual([]);
    expect(validateWireBlock(block({ url: "https://youtu.be/dQw4w9WgXcQ", provider: "vimeo" })).map((i) => i.path)).toContain("props.url");
    expect(validateWireBlock(block({ url: "https://example.com", provider: "youtube" })).map((i) => i.path)).toContain("props.url");
    expect(validateWireBlock(block({ url: "https://youtu.be/dQw4w9WgXcQ", provider: "myspace" })).length).toBeGreaterThan(0);
  });

  it("exports as a link", () => {
    expect(blocksToMarkdown([block({ url: "https://youtu.be/dQw4w9WgXcQ", provider: "youtube" })]).trim()).toBe("[YouTube](https://youtu.be/dQw4w9WgXcQ)");
  });
});
