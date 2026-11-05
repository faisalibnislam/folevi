// The sidebar's own folder order (convex/sidebarOrder.ts): one person's, per place, apart from the folders' rank.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { PERSONAL, join, person, setup, teamWorkspace } from "./helpers";

describe("the sidebar's own folder order", () => {
  test("saved per person and per place; the folders' rank stays as it was", async () => {
    const t = setup();
    const a = await person(t, "order-a@example.com");
    const b = await person(t, "order-b@example.com");
    const { workspaceId, scope: team } = await teamWorkspace(a);
    await join(t, a, b, "order-b@example.com", workspaceId, "viewer");
    const x = (await a.as.mutation(api.organization.createFolder, { scope: team, name: "X" })).id;
    const y = (await a.as.mutation(api.organization.createFolder, { scope: team, name: "Y" })).id;

    // Nothing saved: null (the sidebar shows rank order).
    expect(await a.as.query(api.sidebarOrder.get, { scope: team })).toBeNull();
    await a.as.mutation(api.sidebarOrder.set, { scope: team, folderIds: [y, x, y] });
    expect(await a.as.query(api.sidebarOrder.get, { scope: team })).toEqual([y, x]);
    // Sending it again changes nothing.
    await a.as.mutation(api.sidebarOrder.set, { scope: team, folderIds: [y, x] });
    expect(await a.as.query(api.sidebarOrder.get, { scope: team })).toEqual([y, x]);
    // The folders' rank (the Folders page) is untouched.
    expect((await a.as.query(api.organization.sidebar, { scope: team })).folders.map((f) => f.id)).toEqual([x, y]);
    // Another member (even a viewer, it's their own) has their own order; their Personal has another.
    expect(await b.as.query(api.sidebarOrder.get, { scope: team })).toBeNull();
    await b.as.mutation(api.sidebarOrder.set, { scope: team, folderIds: [x, y] });
    expect(await a.as.query(api.sidebarOrder.get, { scope: team })).toEqual([y, x]);
    expect(await a.as.query(api.sidebarOrder.get, { scope: PERSONAL })).toBeNull();
    // Null forgets it.
    await a.as.mutation(api.sidebarOrder.set, { scope: team, folderIds: null });
    expect(await a.as.query(api.sidebarOrder.get, { scope: team })).toBeNull();
  });

  test("refuses ids that aren't ids, and places the person isn't in", async () => {
    const t = setup();
    const a = await person(t, "order-c@example.com");
    const b = await person(t, "order-d@example.com");
    const { scope: team } = await teamWorkspace(a);
    await expect(a.as.mutation(api.sidebarOrder.set, { scope: PERSONAL, folderIds: ["not an id!"] })).rejects.toThrow(/Invalid folder id/);
    await expect(b.as.query(api.sidebarOrder.get, { scope: team })).rejects.toThrow();
    await expect(b.as.mutation(api.sidebarOrder.set, { scope: team, folderIds: [] })).rejects.toThrow();
  });
});
