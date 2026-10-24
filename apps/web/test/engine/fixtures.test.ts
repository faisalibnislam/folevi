// The bridge contract's fixtures (docs/NATIVE_APP_PLAN.md section 3.8): the JSON files the Swift tests decode are
// exactly what src/lib/engine/fixtures/source.ts produces (typed against protocol.ts), every view, command,
// editor command and event has at least one, and every list story applies cleanly.
//   UPDATE_ENGINE_FIXTURES=1 pnpm --filter @folevi/web exec vitest run test/engine/fixtures.test.ts
import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES, type ListFixture } from "@/lib/engine/fixtures/source";
import { applyDiff, emptyNativeList, nativeRows, rowHash } from "@/lib/engine/diff";
import { COMMAND_NAMES, EDITOR_COMMAND_NAMES, EVENT_NAMES, LIST_VIEW_NAMES, VIEW_NAMES } from "@/lib/engine/protocol";

// (vitest runs from apps/web)
const DIR = join(process.cwd(), "src/lib/engine/fixtures");
// The 5,000-row story is written on one line (it would be half a megabyte indented).
const json = (value: unknown, name = "") => `${name.endsWith(".5000") ? JSON.stringify(value) : JSON.stringify(value, null, 2)}\n`;

describe("engine contract fixtures", () => {
  if (process.env.UPDATE_ENGINE_FIXTURES) {
    it("writes the JSON files", () => {
      mkdirSync(DIR, { recursive: true });
      for (const f of readdirSync(DIR)) if (f.endsWith(".json")) unlinkSync(join(DIR, f));
      for (const [name, fixture] of Object.entries(FIXTURES)) writeFileSync(join(DIR, `${name}.json`), json(fixture, name));
    });
    return;
  }

  it("the JSON files match the typed source", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
    expect(files).toEqual(Object.keys(FIXTURES).map((n) => `${n}.json`).sort());
    for (const [name, fixture] of Object.entries(FIXTURES)) {
      expect(readFileSync(join(DIR, `${name}.json`), "utf8"), `${name}.json is stale: regenerate it`).toBe(json(fixture, name));
    }
  });

  it("covers every view, list view, command, editor command and event", () => {
    const all = Object.values(FIXTURES);
    const has = (kind: string, name: string) => all.some((f) => f.kind === kind && "name" in f && f.name === name);
    for (const n of VIEW_NAMES) expect(has("view", n), `view ${n}`).toBe(true);
    for (const n of LIST_VIEW_NAMES) expect(has("list", n), `list ${n}`).toBe(true);
    for (const n of COMMAND_NAMES) expect(has("command", n), `command ${n}`).toBe(true);
    for (const n of EDITOR_COMMAND_NAMES) expect(has("editor", n), `editor ${n}`).toBe(true);
    for (const n of EVENT_NAMES) expect(has("event", n), `event ${n}`).toBe(true);
  });

  it("list stories: revs count up from 1 and the updates rebuild the expected rows", () => {
    for (const [name, f] of Object.entries(FIXTURES)) {
      if (f.kind !== "list") continue;
      const story = f as ListFixture;
      let list = emptyNativeList();
      let rev = 0;
      for (const u of story.updates) {
        if (u.diff?.reset && u.rev === 1) rev = 0;
        expect(u.rev, name).toBe(rev + 1);
        rev = u.rev;
        if (u.diff) list = applyDiff(list, u.diff);
      }
      expect(nativeRows(list), name).toEqual(story.expected.rows);
      expect(list.total, name).toBe(story.expected.total);
      expect(story.expected.rows.length, name).toBeLessThanOrEqual(story.window.count);
    }
  });

  it("every row carries the hash of its content", () => {
    const rows = Object.values(FIXTURES).flatMap((f) => (f.kind === "list" ? f.expected.rows : f.kind === "view" && f.name === "home" ? (f.value as unknown as { recents: never[] }).recents : []));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect((r as { h: string }).h).toBe(rowHash(r));
  });

  it("the edit story sends only the edited row", () => {
    const f = FIXTURES["list.notes.edit-one"] as ListFixture;
    const second = f.updates[1]!;
    expect(Object.keys(second.diff!.upsert!)).toEqual(["doc_00003"]);
    expect(second.diff!.order).toBeUndefined();
    expect(second.diff!.remove).toBeUndefined();
  });

  it("the 5,000-row story sends one window with the whole total", () => {
    const f = FIXTURES["list.notes.5000"] as ListFixture;
    expect(f.updates).toHaveLength(1);
    expect(f.updates[0]!.diff!.total).toBe(5000);
    expect(f.updates[0]!.diff!.order).toHaveLength(200);
  });

  it("has no em dashes", () => {
    for (const fixture of Object.values(FIXTURES)) expect(JSON.stringify(fixture)).not.toContain(String.fromCharCode(0x2014));
  });
});
