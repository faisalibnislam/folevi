// ⌘K "All places": Personal and every workspace the person is in, labelled; never anyone else's.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { para, person, PERSONAL, setup, teamWorkspace, ulid } from "./helpers";

type Person = Awaited<ReturnType<typeof person>>;

async function note(p: Person, scope: Person["scope"], title: string, text: string) {
  const id = ulid();
  await p.as.mutation(api.sync.push, {
    scope,
    deviceId: "device-search",
    ops: [
      { opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } },
      { opId: ulid(), kind: "block.upsert", documentId: id, block: para(ulid(), text), baseRevision: null, fields: ["content", "position"] },
    ] as never,
  });
  return id;
}

describe("search everywhere", () => {
  test("finds notes in Personal and each workspace, with the place", async () => {
    const t = setup();
    const a = await person(t, "everywhere@example.com");
    const other = await person(t, "elsewhere@example.com");
    const { scope } = await teamWorkspace(a, "Studio");
    const mine = await note(a, PERSONAL, "Zephyrquill trip", "pack the zephyrquill map");
    const team = await note(a, scope, "Studio zephyrquill", "zephyrquill mural");
    await note(other, PERSONAL, "Their zephyrquill", "not yours");
    const found = await a.as.query(api.search.everywhere, { query: "zephyrquill" });
    expect(found.map((r) => [r.id, r.place.name]).sort()).toEqual([
      [mine, "Personal"],
      [team, "Studio"],
    ].sort());
    expect(await a.as.query(api.search.everywhere, { query: "  " })).toEqual([]);
    // Free plans have no notes index: no search by meaning.
    expect(await a.as.query(api.search.meaningAvailable, { scope: PERSONAL })).toBe(false);
  });
});
