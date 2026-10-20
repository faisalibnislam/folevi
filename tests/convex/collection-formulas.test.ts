// Formula properties of collections: the server keeps only the formula's text (checked: length, no loops),
// never values; renames follow into formulas; views keep their summaries; copies keep formulas.
import { describe, expect, test } from "vitest";
import { SCHEMA_VERSION } from "@folevi/editor-schema";
import { api } from "../../convex/_generated/api";
import { person, setup, ulid } from "./helpers";

type P = Awaited<ReturnType<typeof person>>;

async function newDoc(p: P, title = "Doc") {
  const id = ulid();
  const [r] = await p.as.mutation(api.sync.push, {
    scope: p.scope,
    deviceId: "device-formulas",
    ops: [{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null } }],
  });
  expect(r!.status).toBe("applied");
  return id;
}

async function collection(p: P) {
  const doc = await newDoc(p, "Orders");
  const { collectionId, viewId } = await p.as.mutation(api.collections.create, { documentId: doc, name: "Orders" });
  const { id: price } = await p.as.mutation(api.collections.addProperty, { collectionId, name: "Price", type: "number" });
  const { id: qty } = await p.as.mutation(api.collections.addProperty, { collectionId, name: "Qty", type: "number" });
  return { doc, collectionId, viewId, price, qty };
}

describe("collection formulas", () => {
  test("a formula property stores its formula and number format, never values", async () => {
    const t = setup();
    const a = await person(t, "formulas1@example.com");
    const { collectionId, price } = await collection(a);
    const { id: total } = await a.as.mutation(api.collections.addProperty, {
      collectionId,
      name: "Total",
      type: "formula",
      formula: 'prop("Price") * Qty',
      numberFormat: { format: "currency", currency: "XXX", decimals: 9 },
    });
    let c = await a.as.query(api.collections.get, { collectionId });
    const prop = c.properties.find((p) => p.id === total)!;
    expect(prop).toMatchObject({ type: "formula", formula: 'prop("Price") * Qty', numberFormat: { format: "currency", currency: "USD", decimals: 6 } });
    expect(c.properties.find((p) => p.id === price)).toMatchObject({ formula: null, numberFormat: null });

    const { id: row } = await a.as.mutation(api.collections.addRow, { collectionId, title: "One", values: { [price]: 3 } });
    await expect(a.as.mutation(api.collections.setValue, { collectionId, rowId: row, propertyId: total, value: 9 })).rejects.toThrow(/can't be set/);
    await expect(a.as.mutation(api.collections.addRow, { collectionId, title: "Two", values: { [total]: 1 } })).rejects.toThrow(/can't be set/);

    await a.as.mutation(api.collections.updateProperty, { collectionId, propertyId: total, formula: "  Price * Qty * 2  ", numberFormat: null });
    c = await a.as.query(api.collections.get, { collectionId });
    expect(c.properties.find((p) => p.id === total)).toMatchObject({ formula: "Price * Qty * 2", numberFormat: null });
    // Only formula properties have a formula; only number and formula ones a format.
    await expect(a.as.mutation(api.collections.updateProperty, { collectionId, propertyId: price, formula: "1" })).rejects.toThrow(/Only formula properties/);
    const status = c.properties.find((p) => p.type === "select")!;
    await expect(a.as.mutation(api.collections.updateProperty, { collectionId, propertyId: status.id, numberFormat: { format: "number" } })).rejects.toThrow(/number format/);
    await a.as.mutation(api.collections.updateProperty, { collectionId, propertyId: price, numberFormat: { format: "percent", decimals: 1 } });
    c = await a.as.query(api.collections.get, { collectionId });
    expect(c.properties.find((p) => p.id === price)!.numberFormat).toEqual({ format: "percent", decimals: 1 });
  });

  test("refuses formulas that are too long, use their own property, or loop through other formulas", async () => {
    const t = setup();
    const a = await person(t, "formulas2@example.com");
    const { collectionId } = await collection(a);
    await expect(a.as.mutation(api.collections.addProperty, { collectionId, name: "Long", type: "formula", formula: "1+".repeat(600) + "1" })).rejects.toThrow(/up to 1,000 characters/);
    await expect(a.as.mutation(api.collections.addProperty, { collectionId, name: "Self", type: "formula", formula: "Self + 1" })).rejects.toThrow(/its own property/);
    // Refused adds leave nothing behind.
    expect((await a.as.query(api.collections.get, { collectionId })).properties.map((p) => p.name)).not.toContain("Self");

    const { id: sub } = await a.as.mutation(api.collections.addProperty, { collectionId, name: "Subtotal", type: "formula", formula: "Price * Qty" });
    const { id: tax } = await a.as.mutation(api.collections.addProperty, { collectionId, name: "Tax", type: "formula", formula: "Subtotal * 0.2" });
    await expect(a.as.mutation(api.collections.updateProperty, { collectionId, propertyId: sub, formula: "Tax + 1" })).rejects.toThrow(/loop: “Subtotal” → “Tax” → “Subtotal”/);
    // A formula naming something that doesn't exist is kept (it shows #NAME? until the property does).
    await a.as.mutation(api.collections.updateProperty, { collectionId, propertyId: tax, formula: "Later * 2" });
    // ...and a rename that would close a loop is refused.
    await a.as.mutation(api.collections.updateProperty, { collectionId, propertyId: sub, formula: "Tax + 1" });
    await expect(a.as.mutation(api.collections.updateProperty, { collectionId, propertyId: sub, name: "Later" })).rejects.toThrow(/loop/);
  });

  test("renaming a property renames it in every formula that uses it", async () => {
    const t = setup();
    const a = await person(t, "formulas3@example.com");
    const { collectionId, price } = await collection(a);
    const { id: total } = await a.as.mutation(api.collections.addProperty, { collectionId, name: "Total", type: "formula", formula: 'Price * Qty + prop("Price") + LEN("Price")' });
    await a.as.mutation(api.collections.updateProperty, { collectionId, propertyId: price, name: "Unit cost" });
    const c = await a.as.query(api.collections.get, { collectionId });
    expect(c.properties.find((p) => p.id === total)!.formula).toBe('[Unit cost] * Qty + prop("Unit cost") + LEN("Price")');
  });

  test("views keep a summary per column; boards can group by a formula", async () => {
    const t = setup();
    const a = await person(t, "formulas4@example.com");
    const { collectionId, viewId, price } = await collection(a);
    const { id: total } = await a.as.mutation(api.collections.addProperty, { collectionId, name: "Total", type: "formula", formula: "Price * Qty" });
    let c = await a.as.query(api.collections.get, { collectionId });
    const view = c.views.find((v) => v.id === viewId)!;
    await a.as.mutation(api.collections.updateView, {
      collectionId,
      viewId,
      config: { ...view.config, summaries: [{ propertyId: price, fn: "sum" }, { propertyId: total, fn: "average" }, { propertyId: price, fn: "max" }, { propertyId: "title", fn: "count" }] },
    });
    c = await a.as.query(api.collections.get, { collectionId });
    // One summary per column: the last one given wins.
    expect(c.views.find((v) => v.id === viewId)!.config.summaries).toEqual([
      { propertyId: price, fn: "max" },
      { propertyId: total, fn: "average" },
      { propertyId: "title", fn: "count" },
    ]);

    const { id: board } = await a.as.mutation(api.collections.addViewToCollection, { collectionId, name: "Board", type: "board" });
    const boardView = (await a.as.query(api.collections.get, { collectionId })).views.find((v) => v.id === board)!;
    await a.as.mutation(api.collections.updateView, { collectionId, viewId: board, config: { ...boardView.config, groupBy: total } });
    expect((await a.as.query(api.collections.get, { collectionId })).views.find((v) => v.id === board)!.config.groupBy).toBe(total);
    await expect(a.as.mutation(api.collections.updateView, { collectionId, viewId: board, config: { ...boardView.config, groupBy: price } })).rejects.toThrow(/single-select or formula/);
  });

  test("a copied page's collection keeps its formulas and summaries; Copy to keeps their results", async () => {
    const t = setup();
    const a = await person(t, "formulas5@example.com");
    const { doc, collectionId, viewId, price, qty } = await collection(a);
    const { id: total } = await a.as.mutation(api.collections.addProperty, { collectionId, name: "Total", type: "formula", formula: "Price * Qty", numberFormat: { format: "number", decimals: 2 } });
    await a.as.mutation(api.collections.addRow, { collectionId, title: "One", values: { [price]: 2.5, [qty]: 4 } });
    const view = (await a.as.query(api.collections.get, { collectionId })).views.find((v) => v.id === viewId)!;
    await a.as.mutation(api.collections.updateView, { collectionId, viewId, config: { ...view.config, summaries: [{ propertyId: total, fn: "sum" }] } });
    // The page holds the collection block.
    const [r] = await a.as.mutation(api.sync.push, {
      scope: a.scope,
      deviceId: "device-formulas",
      ops: [
        {
          opId: ulid(),
          kind: "block.upsert",
          documentId: doc,
          baseRevision: null,
          fields: ["content", "position"],
          block: { id: ulid(), type: "collection", parentId: null, rank: "a", schemaVersion: SCHEMA_VERSION, text: [], props: { collectionId, viewId } },
        },
      ],
    });
    expect(r!.status).toBe("applied");
    const copy = await a.as.mutation(api.copies.copyTo, { documentId: doc, destination: a.scope });
    const table = (await a.as.query(api.blocks.list, { documentId: copy.id }))!.blocks.find((b) => b.type === "table")!;
    const rows = (table.props as { rows: { text: string }[][][] }).rows.map((row) => row.map((cell) => cell.map((n) => n.text).join("")));
    const header = rows[0]!;
    const line = rows[1]!;
    expect(line[header.indexOf("Total")]).toBe("10.00");
  });
});
