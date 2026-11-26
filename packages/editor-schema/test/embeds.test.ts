import { describe, expect, it } from "vitest";
import { embedFor, embedPlayer, embedProblem } from "../src/embeds";
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

  it("Google Maps: a place with a broken percent escape is no map, not a thrown error", () => {
    const broken = "https://www.google.com/maps/place/100%/";
    expect(() => embedFor(broken)).not.toThrow();
    expect(embedFor(broken)).toBeNull();
    expect(embedProblem(broken)).toMatch(/can't be embedded/);
    // The coordinates after it still say where.
    expect(src("https://www.google.com/maps/place/100%/@56.41,-5.47,15z")).toBe("https://maps.google.com/maps?q=56.41%2C-5.47&output=embed&z=15");
    const block: WireBlock = { id: "01JAEMBED0000000000000000B", type: "embed", parentId: null, rank: "V", schemaVersion: 1, text: [], props: { url: broken, provider: "googleMaps" } };
    expect(validateWireBlock(block).map((i) => i.path)).toContain("props.url");
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

// The website's /api/embed page is handed a player address and frames it: it only ever frames what embedFor itself
// would have written (embedPlayer), never just any page of the players' sites.
describe("a player address made again from its own parts", () => {
  const pages = [
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s",
    "https://vimeo.com/76979871",
    "https://vimeo.com/76979871/abcdef0123",
    "https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184",
    "https://www.figma.com/design/AbCdEfGhIjKlMnOp/Trip-plan?node-id=1-2&t=secret",
    "https://www.figma.com/proto/AbCdEfGhIjKlMnOp/x?starting-point-node-id=1-2",
    "https://www.google.com/maps/place/Eiffel+Tower/@48.8584,2.2945,17z",
    "https://www.google.com/maps?q=Kyoto",
  ];

  it("every player embedFor builds comes back the same", () => {
    for (const page of pages) {
      const player = embedFor(page)!.src;
      expect(embedPlayer(player), page).toBe(player);
    }
  });

  it("any other page of a player's site is refused", () => {
    for (const src of [
      "https://www.figma.com/embed?embed_host=folevi&url=https%3A%2F%2Fevil.example%2Fproto",
      "https://www.figma.com/embed?embed_host=folevi&url=https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ",
      "https://www.figma.com/community/file/123",
      "https://www.figma.com/@someone",
      "https://www.loom.com/looms/videos",
      "https://www.loom.com/login",
      "https://maps.google.com/url?q=https://evil.example",
      "https://maps.google.com/maps/dir/a/b",
      "https://www.youtube-nocookie.com/redirect?q=https://evil.example",
      "https://player.vimeo.com/external/1.hd.mp4",
    ]) expect(embedPlayer(src), src).toBeNull();
  });

  it("an address anywhere else is refused, and so is a page address that isn't a player", () => {
    for (const src of ["https://evil.example/embed/dQw4w9WgXcQ", "http://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "https://www.youtube-nocookie.com.evil.example/embed/dQw4w9WgXcQ", "https://www.youtube-nocookie.com@evil.example/embed/dQw4w9WgXcQ", "javascript:alert(1)", "", "https://youtu.be/dQw4w9WgXcQ"]) {
      expect(embedPlayer(src), src).toBeNull();
    }
  });

  it("only the parts embedFor writes are kept", () => {
    expect(embedPlayer("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90&autoplay=1&list=PLx")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90");
    expect(embedPlayer("https://maps.google.com/maps?q=Kyoto&output=embed&z=99&pb=x")).toBe("https://maps.google.com/maps?q=Kyoto&output=embed");
    expect(embedPlayer("https://maps.google.com/maps?q=Kyoto&output=embed&z=12")).toBe("https://maps.google.com/maps?q=Kyoto&output=embed&z=12");
  });
});

