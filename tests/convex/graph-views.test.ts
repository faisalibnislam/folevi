// Foli DNA's saved views (convex/graphViews.ts): private to the person who saved them, per place, named, capped,
// and removed with the account (convex/maintenance.ts).
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { PERSONAL, inWorkspace, person, setup } from "./helpers";

describe("Foli DNA saved views", () => {
  test("save, list, update and remove; only your own, only in their place", async () => {
    const t = setup();
    const a = await person(t, "dna-a@example.com");
    const b = await person(t, "dna-b@example.com");
    const settings = JSON.stringify({ filter: { folders: ["fld_1"] }, colorBy: "folder" });
    const { id } = await a.as.mutation(api.graphViews.save, { scope: PERSONAL, name: "  Trips only  ", settings });
    expect(id).toMatch(/^gv_/);
    expect(await a.as.query(api.graphViews.list, { scope: PERSONAL })).toMatchObject([{ id, name: "Trips only", settings }]);
    // Someone else sees none of it and can't change or remove it.
    expect(await b.as.query(api.graphViews.list, { scope: PERSONAL })).toEqual([]);
    await expect(b.as.mutation(api.graphViews.save, { scope: PERSONAL, id, name: "Mine now", settings })).rejects.toThrow(/gone/);
    expect(await b.as.mutation(api.graphViews.remove, { id })).toEqual({ removed: false });
    // Another place (a team workspace) has its own list.
    const { id: teamId } = await a.as.mutation(api.workspaces.createTeamWorkspace, { name: "Crew" });
    expect(await a.as.query(api.graphViews.list, { scope: inWorkspace(teamId) })).toEqual([]);
    // Saving again under the same id renames it.
    await a.as.mutation(api.graphViews.save, { scope: PERSONAL, id, name: "Trips", settings });
    expect((await a.as.query(api.graphViews.list, { scope: PERSONAL })).map((v) => v.name)).toEqual(["Trips"]);
    expect(await a.as.mutation(api.graphViews.remove, { id })).toEqual({ removed: true });
    expect(await a.as.query(api.graphViews.list, { scope: PERSONAL })).toEqual([]);
  });

  test("a view needs a name and settings that read back", async () => {
    const t = setup();
    const a = await person(t, "dna-c@example.com");
    await expect(a.as.mutation(api.graphViews.save, { scope: PERSONAL, name: "   ", settings: "{}" })).rejects.toThrow(/name/);
    await expect(a.as.mutation(api.graphViews.save, { scope: PERSONAL, name: "Broken", settings: "{not json" })).rejects.toThrow(/couldn't be saved/);
  });
});
