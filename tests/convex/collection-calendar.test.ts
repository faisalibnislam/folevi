// Calendar views of a collection: rows placed by a date property, which a drag (setValue) or "New" on a
// day (addRow) writes.
import { describe, expect, test } from "vitest";
import { SCHEMA_VERSION } from "@folevi/editor-schema";
import { api } from "../../convex/_generated/api";
import { person, setup, ulid } from "./helpers";

type P = Awaited<ReturnType<typeof person>>;

async function newDoc(p: P, title = "Doc") {
  const id = ulid();
  const [r] = await p.as.mutation(api.sync.push, {
    scope: p.scope,
    deviceId: "device-calendar",
    ops: [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } }],
  });
  expect(r!.status).toBe("applied");
  return id;
}

describe("collection calendar views", () => {
  test("a collection can start as a calendar, placed by its Date property", async () => {
    const t = setup();
    const a = await person(t, "calview@example.com");
    const doc = await newDoc(a);
    const cal = await a.as.mutation(api.collections.create, { documentId: doc, name: "Calendar", view: "calendar" });
    const c = await a.as.query(api.collections.get, { collectionId: cal.collectionId });
    expect(c.views.map((v) => [v.id === cal.viewId, v.type, v.name])).toEqual([[true, "calendar", "Calendar"]]);
    expect(c.views[0]!.config.dateBy).toBe(c.properties.find((p) => p.type === "date")!.id);
  });

  test("adding a calendar view needs a date property; it can be pointed at another date property, never a non-date one", async () => {
    const t = setup();
    const a = await person(t, "calview2@example.com");
    const doc = await newDoc(a);
    const { collectionId } = await a.as.mutation(api.collections.create, { documentId: doc });
    let c = await a.as.query(api.collections.get, { collectionId });
    const date = c.properties.find((p) => p.type === "date")!;
    const status = c.properties.find((p) => p.type === "select")!;

    const { id: viewId } = await a.as.mutation(api.collections.addViewToCollection, { collectionId, name: "Calendar", type: "calendar" });
    c = await a.as.query(api.collections.get, { collectionId });
    const view = c.views.find((v) => v.id === viewId)!;
    expect(view.type).toBe("calendar");
    expect(view.config.dateBy).toBe(date.id);

    const { id: due } = await a.as.mutation(api.collections.addProperty, { collectionId, name: "Due", type: "date" });
    await a.as.mutation(api.collections.updateView, { collectionId, viewId, config: { ...view.config, dateBy: due } });
    c = await a.as.query(api.collections.get, { collectionId });
    expect(c.views.find((v) => v.id === viewId)!.config.dateBy).toBe(due);
    await expect(a.as.mutation(api.collections.updateView, { collectionId, viewId, config: { ...view.config, dateBy: status.id } })).rejects.toThrow(/date property/);

    // Without any date property there's nothing to place rows by.
    await a.as.mutation(api.collections.deleteProperty, { collectionId, propertyId: date.id });
    await a.as.mutation(api.collections.deleteProperty, { collectionId, propertyId: due });
    await expect(a.as.mutation(api.collections.addViewToCollection, { collectionId, name: "Calendar", type: "calendar" })).rejects.toThrow(/date property/);
  });

  test("New on a day adds a row with that date; a drag moves it to another day or clears it", async () => {
    const t = setup();
    const a = await person(t, "calview3@example.com");
    const doc = await newDoc(a);
    const { collectionId } = await a.as.mutation(api.collections.create, { documentId: doc, view: "calendar" });
    const date = (await a.as.query(api.collections.get, { collectionId })).properties.find((p) => p.type === "date")!;
    const row = await a.as.mutation(api.collections.addRow, { collectionId, title: "", values: { [date.id]: "2026-10-14" } });
    const valueOf = async () => (await a.as.query(api.collections.get, { collectionId })).rows.find((r) => r.id === row.id)!.values[date.id];
    expect(await valueOf()).toBe("2026-10-14");

    expect(await a.as.mutation(api.collections.setValue, { collectionId, rowId: row.id, propertyId: date.id, value: "2026-10-20" })).toEqual({ before: "2026-10-14" });
    expect(await valueOf()).toBe("2026-10-20");
    await a.as.mutation(api.collections.setValue, { collectionId, rowId: row.id, propertyId: date.id, value: null });
    expect(await valueOf()).toBeUndefined();
    await expect(a.as.mutation(api.collections.setValue, { collectionId, rowId: row.id, propertyId: date.id, value: "next week" })).rejects.toThrow(/date/);
  });

  test("a duplicated page's calendar view points at the copy's own date property", async () => {
    const t = setup();
    const a = await person(t, "calview4@example.com");
    const doc = await newDoc(a, "Host");
    const cal = await a.as.mutation(api.collections.create, { documentId: doc, name: "Schedule", view: "calendar" });
    const [r] = await a.as.mutation(api.sync.push, {
      scope: a.scope,
      deviceId: "device-calendar",
      ops: [
        {
          opId: ulid(),
          kind: "block.upsert",
          documentId: doc,
          block: { id: ulid(), type: "collection", parentId: null, rank: "V", schemaVersion: SCHEMA_VERSION, text: [], props: { collectionId: cal.collectionId, viewId: cal.viewId } },
          baseRevision: null,
          fields: ["content", "position"],
        },
      ] as never,
    });
    expect(r!.status).toBe("applied");
    const copy = await a.as.mutation(api.documents.duplicate, { documentId: doc });
    const blocks = (await a.as.query(api.blocks.list, { documentId: copy.id }))!.blocks;
    const props = blocks.find((b) => b.type === "collection")!.props as { collectionId: string; viewId: string };
    const mine = await a.as.query(api.collections.get, { collectionId: props.collectionId });
    expect(mine.views[0]!.type).toBe("calendar");
    expect(mine.views[0]!.config.dateBy).toBe(mine.properties.find((p) => p.type === "date")!.id);
  });
});
