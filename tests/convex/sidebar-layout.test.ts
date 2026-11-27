// The sidebar's layout (convex/sidebarLayout.ts): one person's, the same everywhere they sign in.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { person, setup } from "./helpers";

describe("the sidebar's layout", () => {
  test("saved per person; null forgets it", async () => {
    const t = setup();
    const a = await person(t, "layout-a@example.com");
    const b = await person(t, "layout-b@example.com");
    expect(await a.as.query(api.sidebarLayout.get, {})).toBeNull();
    await a.as.mutation(api.sidebarLayout.set, { layout: { order: ["home", "tasks", "home", "drafts"], more: ["tasks", "tasks"] } });
    expect(await a.as.query(api.sidebarLayout.get, {})).toEqual({ order: ["home", "tasks", "drafts"], more: ["tasks"] });
    // Sending it again changes nothing.
    await a.as.mutation(api.sidebarLayout.set, { layout: { order: ["home", "tasks", "drafts"], more: ["tasks"] } });
    expect(await a.as.query(api.sidebarLayout.get, {})).toEqual({ order: ["home", "tasks", "drafts"], more: ["tasks"] });
    // Someone else has their own.
    expect(await b.as.query(api.sidebarLayout.get, {})).toBeNull();
    await a.as.mutation(api.sidebarLayout.set, { layout: null });
    expect(await a.as.query(api.sidebarLayout.get, {})).toBeNull();
  });

  test("refuses ids that aren't item ids, and too many", async () => {
    const t = setup();
    const a = await person(t, "layout-c@example.com");
    await expect(a.as.mutation(api.sidebarLayout.set, { layout: { order: ["Not an id!"], more: [] } })).rejects.toThrow(/Invalid sidebar item/);
    await expect(a.as.mutation(api.sidebarLayout.set, { layout: { order: [], more: ["x".repeat(41)] } })).rejects.toThrow(/Invalid sidebar item/);
    await expect(a.as.mutation(api.sidebarLayout.set, { layout: { order: Array.from({ length: 101 }, (_, i) => `item-${i}`), more: [] } })).rejects.toThrow(/Too many/);
  });
});
