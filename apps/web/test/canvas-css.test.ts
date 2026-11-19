// Guards in the canvases' own styles for how touches reach them on the iPhone and iPad (the 2026-11-19 canvas
// audit: V6, V8 and V25). The real check is a finger on a device; these catch the rule going missing.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const css = (file: string) => readFileSync(join(__dirname, "../src/components/editor", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
/** The declarations of every rule one of whose selectors is exactly `selector`. */
function rules(source: string, selector: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]!.split(",").map((s) => s.trim().replace(/\s+/g, " "));
    if (selectors.includes(selector)) out.push(m[2]!.trim());
  }
  return out;
}
const declares = (source: string, selector: string, declaration: string) => rules(source, selector).some((body) => body.split(";").map((d) => d.trim().replace(/\s+/g, " ")).includes(declaration));

describe("touches on a canvas", () => {
  test("in full canvas every touch is the canvas's own, on all four (V8)", () => {
    expect(declares(css("mindmap/mindmap.css"), ".fb-canvas-card[data-full] .mm-canvas", "touch-action: none")).toBe(true);
    expect(declares(css("flowchart/flowchart.css"), ".fb-canvas-card[data-full] .fc-canvas", "touch-action: none")).toBe(true);
    expect(declares(css("stickies/stickies.css"), ".fb-vcard[data-full] .st-canvas", "touch-action: none")).toBe(true);
    expect(declares(css("wireframe/wireframe.css"), ".fb-wireframe .fb-vcard[data-full] .wf-stage", "touch-action: none")).toBe(true);
  });

  test("in the note a canvas lets a finger scroll the page until it is being worked in", () => {
    expect(declares(css("mindmap/mindmap.css"), ".mm-canvas", "touch-action: pan-y")).toBe(true);
    expect(declares(css("flowchart/flowchart.css"), ".fc-canvas", "touch-action: pan-y")).toBe(true);
    expect(declares(css("mindmap/mindmap.css"), ".mm-canvas[data-active]", "touch-action: none")).toBe(true);
    expect(declares(css("flowchart/flowchart.css"), ".fc-card[data-active] .fc-canvas", "touch-action: none")).toBe(true);
  });

  test("a whiteboard lets a finger scroll the note until the sheet is being worked on (V6)", () => {
    const source = css("insert-blocks.css");
    expect(declares(source, ".fb-whiteboard-canvas[data-tool]", "touch-action: pan-y")).toBe(true);
    expect(declares(source, ".fb-whiteboard-canvas[data-tool][data-active]", "touch-action: none")).toBe(true);
    // No rule takes every touch from a sheet that is not being worked on.
    for (const m of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/touch-action:\s*none/.test(m[2]!)) continue;
      for (const selector of m[1]!.split(",")) if (selector.includes(".fb-whiteboard-canvas")) expect(selector).toContain("[data-active]");
    }
    // After a pen has drawn, fingers scroll again (the pen itself is held by the sheet's touchstart listener).
    expect(declares(source, ".fb-whiteboard-canvas[data-tool][data-pen-only]", "touch-action: pan-x pan-y")).toBe(true);
  });

  test("the boxes that hold a canvas's text field clip, so the keyboard cannot scroll them (V25)", () => {
    expect(rules(css("flowchart/flowchart.css"), ".fc-canvas").join(";")).toMatch(/overflow:\s*hidden;\s*overflow:\s*clip/);
    expect(rules(css("canvas/canvas.css"), ".fb-vcard-body").join(";")).toMatch(/overflow:\s*hidden;\s*overflow:\s*clip/);
    expect(rules(css("stickies/stickies.css"), ".st-canvas").join(";")).toMatch(/overflow:\s*hidden;\s*overflow:\s*clip/);
    expect(rules(css("wireframe/wireframe.css"), ".wf-stage").join(";")).toMatch(/overflow:\s*hidden;\s*overflow:\s*clip/);
  });
});
