// The handoff is a folder (handoff/README.md, scripts/handoff.mjs): HANDOFF.md stays a pointer, every change adds
// a file of its own, and each area has one short state file. Until 2026-11-26 every session appended to HANDOFF.md
// and each merged pull request made every other open one conflict there.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
// @ts-expect-error: a plain .mjs script without types
import * as h from "../../../scripts/handoff.mjs";

const repo = resolve(__dirname, "../../..");

describe("the handoff folder", () => {
  let root = "";
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "folevi-handoff-"));
    mkdirSync(join(root, "handoff/state"), { recursive: true });
    mkdirSync(join(root, "handoff/log"), { recursive: true });
    writeFileSync(join(root, "HANDOFF.md"), h.POINTER);
    writeFileSync(join(root, "handoff/state/mac.md"), "# Mac\n\n## Current state\n\n- Fine.\n");
    writeFileSync(join(root, "handoff/state/release.md"), "# Release\n\n## Current state\n\n- 1.0.00.\n");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test("this repository's handoff is well formed, and HANDOFF.md is only the pointer", () => {
    expect(h.problems(repo)).toEqual([]);
    expect(h.areas(repo)).toContain("release");
  });

  test("anything added to HANDOFF.md is refused, with what to do instead", () => {
    writeFileSync(join(root, "HANDOFF.md"), `${h.POINTER}\n- 2026-11-27: something changed\n`);
    const found: string[] = h.problems(root);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("node scripts/handoff.mjs log");
  });

  test("a new entry is a file of its own, named by time, branch and title, so two never collide", () => {
    const now = new Date("2026-11-26T01:53:00Z");
    const a = h.newEntry({ title: "Home scrolls smoothly", area: "mac", now, branchName: "claude/mac-feedback-8652d2" });
    const b = h.newEntry({ title: "Home scrolls smoothly", area: "mac", now, branchName: "claude/ios-feedback-b1307a" });
    expect(a.name).toBe("2026-11-26-0153Z-mac-feedback-8652d2-home-scrolls-smoothly.md");
    expect(b.name).not.toBe(a.name);
    expect(a.text).toContain("# Home scrolls smoothly\n");
    expect(a.text).toContain("- Area: mac\n");
    writeFileSync(join(root, "handoff/log", a.name), a.text);
    writeFileSync(join(root, "handoff/log", b.name), b.text);
    expect(h.problems(root)).toEqual([]);
  });

  test("entries name a known area, keep the naming, and carry no conflict markers or em dashes", () => {
    const now = new Date("2026-11-26T02:00:00Z");
    const e = h.newEntry({ title: "A change", area: "garden", now, branchName: "claude/x" });
    writeFileSync(join(root, "handoff/log", e.name), e.text);
    writeFileSync(join(root, "handoff/log/notes.md"), "# Notes\n\n- Area: mac\n");
    writeFileSync(join(root, "handoff/state/mac.md"), "# Mac\n\n<<<<<<< HEAD\n- One — two.\n");
    const found: string[] = h.problems(root);
    expect(found.some((p) => p.includes('unknown area "garden"'))).toBe(true);
    expect(found.some((p) => p.includes("notes.md: the name isn't"))).toBe(true);
    expect(found.some((p) => p.includes("mac.md has merge conflict markers"))).toBe(true);
    expect(found.some((p) => p.includes("mac.md has an em dash"))).toBe(true);
  });

  test("show prints an area's state, the release's, and that area's entries, newest first", () => {
    const first = h.newEntry({ title: "Older Mac change", area: "mac", now: new Date("2026-11-26T01:00:00Z"), branchName: "claude/a" });
    const second = h.newEntry({ title: "Newer Mac change", area: "mac, release", now: new Date("2026-11-26T03:00:00Z"), branchName: "claude/b" });
    const other = h.newEntry({ title: "A release note", area: "release", now: new Date("2026-11-26T02:00:00Z"), branchName: "claude/c" });
    for (const e of [first, second, other]) writeFileSync(join(root, "handoff/log", e.name), e.text);
    const out: string = h.show({ root, area: "mac", last: 5 });
    expect(out).toContain("# Mac\n");
    expect(out).toContain("# Release\n");
    expect(out.indexOf("Newer Mac change")).toBeLessThan(out.indexOf("Older Mac change"));
    expect(out).not.toContain("A release note");
    expect(h.show({ root, last: 1 })).toContain("Newer Mac change");
  });
});
