// One person's Home (convex/homePrefs.ts): block layout and pinned note, the same everywhere they sign in.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { person, setup } from "./helpers";

describe("Home's layout and pinned note", () => {
  test("saved per person; null forgets the layout and keeps the pinned note", async () => {
    const t = setup();
    const a = await person(t, "home-a@example.com");
    const b = await person(t, "home-b@example.com");
    expect(await a.as.query(api.homePrefs.get, {})).toEqual({ layout: null, pinnedNote: null });
    await a.as.mutation(api.homePrefs.setLayout, { layout: { order: ["tasks", "scratch", "tasks", "recent"], hidden: ["bookmarks", "bookmarks"] } });
    await a.as.mutation(api.homePrefs.setPinnedNote, { documentId: "note_abc-123" });
    expect(await a.as.query(api.homePrefs.get, {})).toEqual({ layout: { order: ["tasks", "scratch", "recent"], hidden: ["bookmarks"] }, pinnedNote: "note_abc-123" });
    // Someone else has their own.
    expect(await b.as.query(api.homePrefs.get, {})).toEqual({ layout: null, pinnedNote: null });
    await a.as.mutation(api.homePrefs.setLayout, { layout: null });
    expect(await a.as.query(api.homePrefs.get, {})).toEqual({ layout: null, pinnedNote: "note_abc-123" });
    await a.as.mutation(api.homePrefs.setPinnedNote, { documentId: null });
    expect(await a.as.query(api.homePrefs.get, {})).toEqual({ layout: null, pinnedNote: null });
  });

  test("refuses ids that aren't block ids, too many, and a pinned note id that isn't one", async () => {
    const t = setup();
    const a = await person(t, "home-c@example.com");
    await expect(a.as.mutation(api.homePrefs.setLayout, { layout: { order: ["Not an id!"], hidden: [] } })).rejects.toThrow(/Invalid Home block/);
    await expect(a.as.mutation(api.homePrefs.setLayout, { layout: { order: Array.from({ length: 51 }, (_, i) => `b-${i}`), hidden: [] } })).rejects.toThrow(/Too many/);
    await expect(a.as.mutation(api.homePrefs.setPinnedNote, { documentId: "../../x" })).rejects.toThrow(/Invalid note/);
  });
});
