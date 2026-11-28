// One person's Home (convex/homePrefs.ts): block layout and scratch pad, the same everywhere they sign in.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { person, setup } from "./helpers";

describe("Home's layout and scratch pad", () => {
  test("saved per person; null forgets the layout and keeps the scratch pad", async () => {
    const t = setup();
    const a = await person(t, "home-a@example.com");
    const b = await person(t, "home-b@example.com");
    expect(await a.as.query(api.homePrefs.get, {})).toEqual({ layout: null, scratch: "" });
    await a.as.mutation(api.homePrefs.setLayout, { layout: { order: ["tasks", "scratch", "tasks", "recent"], hidden: ["bookmarks", "bookmarks"] } });
    await a.as.mutation(api.homePrefs.setScratch, { text: "Ask Mira about the plot map" });
    expect(await a.as.query(api.homePrefs.get, {})).toEqual({ layout: { order: ["tasks", "scratch", "recent"], hidden: ["bookmarks"] }, scratch: "Ask Mira about the plot map" });
    // Someone else has their own.
    expect(await b.as.query(api.homePrefs.get, {})).toEqual({ layout: null, scratch: "" });
    await a.as.mutation(api.homePrefs.setLayout, { layout: null });
    expect(await a.as.query(api.homePrefs.get, {})).toEqual({ layout: null, scratch: "Ask Mira about the plot map" });
  });

  test("refuses ids that aren't block ids, too many, and an overfull scratch pad", async () => {
    const t = setup();
    const a = await person(t, "home-c@example.com");
    await expect(a.as.mutation(api.homePrefs.setLayout, { layout: { order: ["Not an id!"], hidden: [] } })).rejects.toThrow(/Invalid Home block/);
    await expect(a.as.mutation(api.homePrefs.setLayout, { layout: { order: Array.from({ length: 51 }, (_, i) => `b-${i}`), hidden: [] } })).rejects.toThrow(/Too many/);
    await expect(a.as.mutation(api.homePrefs.setScratch, { text: "x".repeat(4001) })).rejects.toThrow(/full/);
  });
});
