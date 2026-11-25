import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Folevi for Mac (owner, 2026-11-25): Home's rows of note cards scroll sideways, and with the pointer over a row
// the page could not be scrolled up or down at all. The Mac's rule that keeps the window from bouncing held
// scrolling on both axes in every region, so a sideways row swallowed up-and-down scrolls. Each region now holds on
// only along the way it scrolls. Playwright's wheel skips the macOS scrolling path, so this guards the rule itself;
// the check against real wheel events in WKWebView is described in HANDOFF.md (2026-11-25 change log).
const css = readFileSync(join(__dirname, "../src/app/globals.css"), "utf8");
/** Every rule (selector and body) of the stylesheet, comments removed. */
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), body: m[2]! }));

describe("scroll regions in Folevi for Mac", () => {
  it("a sideways region never holds on to up-and-down scrolling", () => {
    const both = rules.filter((r) => /\.overflow-x-auto\b/.test(r.selector) && /overscroll-behavior\s*:/.test(r.body));
    expect(both.map((r) => r.selector)).toEqual([]);
    const yHeld = rules.filter((r) => /\.overflow-x-auto\b/.test(r.selector) && /overscroll-behavior-y\s*:\s*(contain|none)/.test(r.body));
    expect(yHeld.map((r) => r.selector)).toEqual([]);
  });

  it("each region still stops the window bouncing along the way it scrolls", () => {
    const has = (cls: string, prop: string) => rules.some((r) => r.selector.includes('[data-desktop="mac"]') && r.selector.includes(cls) && new RegExp(`${prop}\\s*:\\s*contain`).test(r.body));
    expect(has(".overflow-x-auto", "overscroll-behavior-x")).toBe(true);
    expect(has(".overflow-y-auto", "overscroll-behavior-y")).toBe(true);
    expect(has(".overflow-auto", "overscroll-behavior")).toBe(true);
  });
});
