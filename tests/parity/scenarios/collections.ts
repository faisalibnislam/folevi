// Collections (Folevi's databases): a collection hosted by a note, its properties of every type (formulas
// too), its views with filters, sorts, groups and summaries, its rows (each a note under the host), and what
// the client works out from them (a board's groups, a view's summaries, its CSV and Markdown export).
import { SCHEMA_VERSION, ulid, type WireBlock } from "@folevi/editor-schema";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import { applyView, exportTable, formulaGroups, summarize, toCsv, toMarkdownTable, withFormulaValues, type ViewProperty, type ViewRow } from "@/components/views/collectionView";
import type { Kit } from "../kit";
import { scenario, type ParityBackend } from "../types";

type Collection = NonNullable<FunctionReturnType<typeof api.collections.get>>;

/** What a call refused with (its error code and message), or what it returned. */
async function attempt<T>(run: () => Promise<T>): Promise<T | { error: string; message: string }> {
  try {
    return await run();
  } catch (e) {
    const raw = (e as { data?: unknown }).data;
    const data = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
    if (data && typeof data === "object" && "code" in data) return { error: String((data as { code: unknown }).code), message: String((data as { message?: unknown }).message ?? "") };
    throw e;
  }
}

/** A collection block, as the editor inserts one after collections.create. */
function collectionBlock(id: string, collectionId: string, viewId: string, rank = "V"): WireBlock {
  return { id, type: "collection", parentId: null, rank, schemaVersion: SCHEMA_VERSION, text: [], props: { collectionId, viewId } };
}

/** The collection as the person sees it; the profile's name differs by mode (an account's, the library's), so people are ids. */
async function shown(b: ParityBackend, collectionId: string) {
  const got = await b.query(api.collections.get, { collectionId });
  return { ...got, people: got.people.map((p) => p.id) };
}

/** A new collection in a new note, with its two starting properties named. */
async function newCollection(b: ParityBackend, k: Kit, name: string, view?: "table" | "board" | "gallery" | "calendar") {
  const host = await k.newNote(`${name}-host`, { title: `${name} note` });
  const made = await b.mutation(api.collections.create, { documentId: host, name, ...(view ? { view } : {}) });
  const collectionId = k.name(made.collectionId, name);
  const viewId = k.name(made.viewId, `${name}-view`);
  await k.upsert(host, [collectionBlock(k.id(`${name}-block`), collectionId, viewId)]);
  const got = await b.query(api.collections.get, { collectionId });
  const status = k.name(got.properties[0]!.id, `${name}-status`);
  const date = k.name(got.properties[1]!.id, `${name}-date`);
  return { host, collectionId, viewId, status, date };
}

const asView = (c: Pick<Collection, "properties">) => c.properties as ViewProperty[];

export const scenarios = [
  scenario({
    name: "collections: create in a note, rename, list for charts, the seeded shelf",
    async run(b, k) {
      const first = await newCollection(b, k, "tasks");
      const board = await newCollection(b, k, "board", "board");
      const calendar = await newCollection(b, k, "calendar", "calendar");
      await b.mutation(api.collections.rename, { collectionId: first.collectionId, name: "  Roadmap  " });
      await b.mutation(api.collections.rename, { collectionId: board.collectionId, name: "   " });
      const missing = await attempt(() => b.mutation(api.collections.create, { documentId: ulid(), name: "Nowhere" }));
      const gone = await attempt(() => b.query(api.collections.get, { collectionId: ulid() }));
      const charts = await b.query(api.charts.collections, { scope: b.scope });
      // The seeded Reading Shelf: its collection (properties, views, the five books with their values) and its block.
      const books = charts.find((c) => c.name === "Books")!;
      k.name(books.id, "books");
      k.name(books.noteId, "shelf");
      const shelf = await shown(b, books.id);
      for (const p of shelf.properties) k.name(p.id, `books-${p.name}`);
      for (const v of shelf.views) k.name(v.id, `books-view-${v.name}`);
      for (const r of shelf.rows) k.name(r.documentId, `book-${r.title}`);
      const shelfBlocks = await b.query(api.blocks.list, { documentId: books.noteId });
      const book = await b.query(api.collections.rowForDocument, { documentId: shelf.rows[0]!.documentId });
      return {
        tasks: await shown(b, first.collectionId),
        board: await shown(b, board.collectionId),
        calendar: await shown(b, calendar.collectionId),
        hostBlocks: (await b.query(api.blocks.list, { documentId: first.host }))?.blocks,
        // Most recently changed first; collections changed in the same millisecond tie, so the set is compared.
        charts: [...charts].sort((x, y) => x.name.localeCompare(y.name)),
        missing,
        gone,
        shelf: { ...shelf, rows: shelf.rows.map(({ id: _id, ...r }) => r) },
        shelfBlocks: shelfBlocks?.blocks.map((x) => ({ type: x.type, props: x.props })).sort((x, y) => x.type.localeCompare(y.type)),
        book: book && { ...book, row: { ...book.row, id: "<row>" } },
      };
    },
  }),
  scenario({
    name: "collections: properties of every type, values set, cleared and refused",
    async run(b, k) {
      const { collectionId, date } = await newCollection(b, k, "kit");
      const add = async (name: string, type: Collection["properties"][number]["type"], extra: Record<string, unknown> = {}) => k.name((await b.mutation(api.collections.addProperty, { collectionId, name, type, ...extra })).id, name);
      const owner = await add("Owner", "text");
      const cost = await add("Cost", "number", { numberFormat: { format: "currency", currency: "XYZ", decimals: 9.4 } });
      const share = await add("Share", "number", { numberFormat: { format: "percent", decimals: -2 } });
      const done = await add("Done", "checkbox");
      const priority = await add("Priority", "select");
      const labels = await add("Labels", "multiSelect");
      const link = await add("Link", "url");
      const who = await add("Who", "person");
      const related = await add("Related", "relation");
      // A blank name is "Property".
      await add("blank", "text", { name: "   " });
      // A property id chosen offline: sent twice, it's made once.
      const chosen = k.id("chosen");
      const firstSend = await b.mutation(api.collections.addProperty, { collectionId, name: "Chosen", type: "text", id: chosen });
      const resend = await b.mutation(api.collections.addProperty, { collectionId, name: "Chosen again", type: "number", id: chosen });
      const badId = await attempt(() => b.mutation(api.collections.addProperty, { collectionId, name: "Bad", type: "text", id: "not an id" }));
      const textFormat = await b.mutation(api.collections.addProperty, { collectionId, name: "Plain", type: "text", numberFormat: { format: "number" } });
      k.name(textFormat.id, "plain");
      await b.mutation(api.collections.updateProperty, { collectionId, propertyId: priority, options: [{ name: "  High  " }, { name: "Low", color: "plum" }, { name: "", color: "bogus" }] });
      const opts = (await b.query(api.collections.get, { collectionId })).properties.find((p) => p.id === priority)!.options;
      opts.forEach((o, i) => k.name(o.id, `priority-${i}`));
      await b.mutation(api.collections.updateProperty, { collectionId, propertyId: labels, options: [{ id: "red", name: "Red" }, { id: "blue", name: "Blue", color: "moss" }] });
      // Resending the same list changes nothing; a rename and options on a text property are refused.
      await b.mutation(api.collections.updateProperty, { collectionId, propertyId: priority, options: opts });
      const optionsOnText = await attempt(() => b.mutation(api.collections.updateProperty, { collectionId, propertyId: owner, options: [{ name: "x" }] }));
      const formulaOnText = await attempt(() => b.mutation(api.collections.updateProperty, { collectionId, propertyId: owner, formula: "1" }));
      const formatOnText = await attempt(() => b.mutation(api.collections.updateProperty, { collectionId, propertyId: owner, numberFormat: { format: "number" } }));
      await b.mutation(api.collections.updateProperty, { collectionId, propertyId: share, numberFormat: null });
      await b.mutation(api.collections.updateProperty, { collectionId, propertyId: owner, name: "  Lead  " });
      await b.mutation(api.collections.updateProperty, { collectionId, propertyId: done, name: "   " });
      const other = await k.newNote("other", { title: "Linked" });

      const row = await b.mutation(api.collections.addRow, { collectionId, title: "First", values: { [owner]: "Ada", [cost]: "12.5", [done]: true, [labels]: ["red", "red", "blue"] } });
      k.name(row.id, "row");
      k.name(row.documentId, "row-note");
      const set = (propertyId: string, value: unknown) => attempt(() => b.mutation(api.collections.setValue, { collectionId, rowId: row.id, propertyId, value }));
      const results = {
        text: await set(owner, "x".repeat(2100)),
        textBad: await set(owner, 5),
        number: await set(cost, 3),
        numberBad: await set(cost, "abc"),
        checkboxBad: await set(done, "yes"),
        date: await set(date, "2026-10-20"),
        dateBad: await set(date, "2026/10/20"),
        select: await set(priority, opts[1]!.id),
        selectBad: await set(priority, "nope"),
        multiBad: await set(labels, ["red", "green"]),
        multiNotList: await set(labels, "red"),
        url: await set(link, "https://example.com/a"),
        urlBad: await set(link, "ftp://example.com"),
        person: await set(who, (await b.query(api.collections.get, { collectionId })).people[0]!.id),
        relation: await set(related, [other, other, 7]),
        relationBad: await set(related, other),
        cleared: await set(done, null),
        clearedEmpty: await set(owner, ""),
        unknownProperty: await set(ulid(), 1),
        unknownRow: await attempt(() => b.mutation(api.collections.setValue, { collectionId, rowId: ulid(), propertyId: owner, value: "x" })),
      };
      const before = await shown(b, collectionId);
      await b.mutation(api.collections.deleteProperty, { collectionId, propertyId: link });
      const deletedAgain = await attempt(() => b.mutation(api.collections.deleteProperty, { collectionId, propertyId: link }));
      const setDeleted = await set(link, "https://example.com/b");
      // A deleted property's id stays taken by its collection: sending its add again answers with it.
      const resendDeleted = await b.mutation(api.collections.addProperty, { collectionId, name: "Link", type: "url", id: link });
      const rowPage = await b.query(api.collections.rowForDocument, { documentId: row.documentId });
      return { firstSend, resend, badId, optionsOnText, formulaOnText, formatOnText, results, before, after: await shown(b, collectionId), deletedAgain, setDeleted, resendDeleted, rowPage };
    },
  }),
  scenario({
    name: "collections: formula properties, their checks, and renames that rewrite them",
    async run(b, k) {
      const { collectionId } = await newCollection(b, k, "sums");
      const add = async (name: string, type: Collection["properties"][number]["type"], extra: Record<string, unknown> = {}) =>
        attempt(async () => k.name((await b.mutation(api.collections.addProperty, { collectionId, name, type, ...extra })).id, name));
      const price = (await add("Price", "number")) as string;
      const qty = (await add("Qty", "number")) as string;
      const total = (await add("Total", "formula", { formula: "  Price * Qty\u0001 ", numberFormat: { format: "currency", currency: "EUR", decimals: 2 } })) as string;
      await add("Label", "formula", { formula: 'prop("Total") & " each"' });
      const refused = {
        self: await add("Self", "formula", { formula: "Self + 1" }),
        long: await add("Long", "formula", { formula: "1+".repeat(600) + "1" }),
        loop: await attempt(() => b.mutation(api.collections.updateProperty, { collectionId, propertyId: total, formula: "Label" })),
        valueOfFormula: null as unknown,
      };
      const empty = (await add("Empty", "formula")) as string;
      // A name that makes formulas depend on each other is refused: Ghost names "Y", which doesn't exist yet.
      const ghost = (await add("Ghost", "formula", { formula: "Y + 1" })) as string;
      const echo = (await add("Echo", "formula", { formula: "Ghost" })) as string;
      const loopByName = await attempt(() => b.mutation(api.collections.updateProperty, { collectionId, propertyId: echo, name: "Y" }));
      // Renames: every formula that names the property follows it, its own formula included.
      await b.mutation(api.collections.updateProperty, { collectionId, propertyId: price, name: "Unit price" });
      await b.mutation(api.collections.updateProperty, { collectionId, propertyId: total, name: "Line total", formula: "Price * Qty * 2" });
      await b.mutation(api.collections.updateProperty, { collectionId, propertyId: qty, name: "Count" });
      const r1 = await b.mutation(api.collections.addRow, { collectionId, title: "Pens", values: { [price]: 2, [qty]: 3 } });
      const r2 = await b.mutation(api.collections.addRow, { collectionId, title: "Ink", values: { [price]: 4.5 } });
      k.name(r1.id, "pens");
      k.name(r2.id, "ink");
      refused.valueOfFormula = await attempt(() => b.mutation(api.collections.setValue, { collectionId, rowId: r1.id, propertyId: total, value: 3 }));
      const got = await shown(b, collectionId);
      const worked = withFormulaValues(got.rows as ViewRow[], asView(got), { today: "2026-10-20" });
      return { refused, loopByName, empty, ghost, collection: got, results: worked.map((r) => ({ title: r.title, values: r.values })) };
    },
  }),
  scenario({
    name: "collections: views with filters, sorts, groups and summaries",
    async run(b, k) {
      const { collectionId, viewId, status, date } = await newCollection(b, k, "plan");
      const points = k.name((await b.mutation(api.collections.addProperty, { collectionId, name: "Points", type: "number" })).id, "points");
      const kind = k.name((await b.mutation(api.collections.addProperty, { collectionId, name: "Kind", type: "text" })).id, "kind");
      const big = k.name((await b.mutation(api.collections.addProperty, { collectionId, name: "Big", type: "formula", formula: 'IF(Points > 3, "big", "small")' })).id, "big");
      const add = async (name: string, type: "table" | "board" | "gallery" | "calendar", id?: string) => attempt(async () => k.name((await b.mutation(api.collections.addViewToCollection, { collectionId, name, type, ...(id ? { id } : {}) })).id, `view-${name}`));
      const boardId = (await add("Board", "board")) as string;
      await add("Calendar", "calendar");
      await add("Gallery", "gallery");
      const chosen = k.id("view-chosen");
      const once = await b.mutation(api.collections.addViewToCollection, { collectionId, name: "  ", type: "table", id: chosen });
      const twice = await b.mutation(api.collections.addViewToCollection, { collectionId, name: "Again", type: "board", id: chosen });
      // A property added after the views shows in all of them.
      const late = k.name((await b.mutation(api.collections.addProperty, { collectionId, name: "Late", type: "checkbox" })).id, "late");

      const rows: [string, Record<string, unknown>][] = [
        ["Alpha", { [status]: "todo", [points]: 5, [kind]: "bug", [date]: "2026-10-01" }],
        ["Beta", { [status]: "doing", [points]: 2, [kind]: "feature", [late]: true }],
        ["Gamma", { [status]: "done", [points]: 8, [kind]: "bug", [date]: "2026-10-03" }],
        ["Delta", { [points]: 1 }],
        ["Epsilon", { [status]: "todo", [kind]: "chore", [late]: true }],
      ];
      for (const [title, values] of rows) k.name((await b.mutation(api.collections.addRow, { collectionId, title, values })).id, `row-${title}`);

      const filters = Array.from({ length: 25 }, () => ({ propertyId: kind, op: "isNotEmpty" as const }));
      const config = {
        filters: [{ propertyId: points, op: "gt" as const, value: 1 }, ...filters],
        sorts: [{ propertyId: points, direction: "desc" as const }, ...Array.from({ length: 6 }, () => ({ propertyId: "title", direction: "asc" as const }))],
        visibleProperties: [status, points, kind, big],
        cardPreview: "none" as const,
        cardSize: "small" as const,
        summaries: [
          { propertyId: points, fn: "count" as const },
          { propertyId: points, fn: "sum" as const },
          { propertyId: "title", fn: "countNotEmpty" as const },
          { propertyId: late, fn: "percentChecked" as const },
          { propertyId: kind, fn: "countEmpty" as const },
        ],
      };
      await b.mutation(api.collections.updateView, { collectionId, viewId, name: "  Main  ", config });
      await b.mutation(api.collections.updateView, { collectionId, viewId, name: "   " });
      const boardConfig = { filters: [], sorts: [], groupBy: big, visibleProperties: [points], cardPreview: "content" as const, cardSize: "large" as const };
      await b.mutation(api.collections.updateView, { collectionId, viewId: boardId, config: boardConfig });
      const refused = {
        groupByText: await attempt(() => b.mutation(api.collections.updateView, { collectionId, viewId: boardId, config: { ...boardConfig, groupBy: kind } })),
        dateByText: await attempt(async () => {
          const cal = (await b.query(api.collections.get, { collectionId })).views.find((v) => v.type === "calendar")!;
          return await b.mutation(api.collections.updateView, { collectionId, viewId: cal.id, config: { ...cal.config, dateBy: kind } });
        }),
        unknownView: await attempt(() => b.mutation(api.collections.updateView, { collectionId, viewId: ulid(), name: "x" })),
      };
      const galleryId = (await b.query(api.collections.get, { collectionId })).views.find((v) => v.type === "gallery")!.id;
      await b.mutation(api.collections.deleteView, { collectionId, viewId: galleryId });
      const deletedAgain = await attempt(() => b.mutation(api.collections.deleteView, { collectionId, viewId: galleryId }));

      const got = await shown(b, collectionId);
      const props = asView(got);
      const withFormulas = withFormulaValues(got.rows as (ViewRow & { id: string })[], props);
      const main = got.views.find((v) => v.id === viewId)!;
      const shownRows = applyView(withFormulas, main.config, props);
      const targets = [{ id: "title", type: "title" as const }, ...props];
      const summaries = (main.config.summaries ?? []).map((s) => {
        const t = targets.find((x) => x.id === s.propertyId)!;
        return { ...s, value: summarize(shownRows, t, s.fn) };
      });
      const board = got.views.find((v) => v.id === boardId)!;
      const groups = formulaGroups(withFormulas, board.config.groupBy!).map((g) => ({ key: g.key, rows: withFormulas.filter((r) => (r.values[big] as { display?: string } | undefined)?.display === g.result.display).map((r) => r.title) }));

      // A board needs a single-select property and a calendar a date: without them, they're refused.
      await b.mutation(api.collections.deleteProperty, { collectionId, propertyId: status });
      await b.mutation(api.collections.deleteProperty, { collectionId, propertyId: date });
      const noSelect = await add("No select", "board");
      const noDate = await add("No date", "calendar");
      const views = (await b.query(api.collections.get, { collectionId })).views;
      for (const v of views.slice(1)) await b.mutation(api.collections.deleteView, { collectionId, viewId: v.id });
      const lastView = await attempt(() => b.mutation(api.collections.deleteView, { collectionId, viewId: views[0]!.id }));
      return { once, twice, refused, deletedAgain, views: got.views, shown: shownRows.map((r) => r.title), summaries, groups, noSelect, noDate, lastView, after: (await b.query(api.collections.get, { collectionId })).views };
    },
  }),
  scenario({
    name: "collections: rows and row pages, order, board moves, rename, delete",
    async run(b, k) {
      const { collectionId, host, status } = await newCollection(b, k, "work", "board");
      const add = async (name: string, args: Record<string, unknown> = {}) => {
        const r = await b.mutation(api.collections.addRow, { collectionId, title: name, ...args });
        k.name(r.id, `row-${name}`);
        k.name(r.documentId, `note-${name}`);
        return r;
      };
      const a = await add("A", { values: { [status]: "todo" } });
      const c = await add("C");
      const bee = await add("B", { afterRowId: a.id });
      // A row and its note chosen offline: sent twice, made once, and its note starts empty.
      const rowId = k.id("row-offline");
      const docId = k.id("note-offline");
      const offline = await b.mutation(api.collections.addRow, { collectionId, title: "Offline", id: rowId, documentId: docId });
      const offlineAgain = await b.mutation(api.collections.addRow, { collectionId, title: "Offline again", id: rowId, documentId: docId });
      const other = await newCollection(b, k, "other");
      const taken = await attempt(() => b.mutation(api.collections.addRow, { collectionId: other.collectionId, id: rowId }));
      const badId = await attempt(() => b.mutation(api.collections.addRow, { collectionId, id: "not an id" }));
      const unknownValue = await attempt(() => b.mutation(api.collections.addRow, { collectionId, title: "X", values: { [ulid()]: 1 } }));
      const badValue = await attempt(() => b.mutation(api.collections.addRow, { collectionId, title: "Y", values: { [status]: "nope" } }));
      const long = await add("L".repeat(320));

      // Board moves: C to the top, into In progress; B out of its group.
      await b.mutation(api.collections.moveRow, { collectionId, rowId: c.id, afterRowId: null, groupPropertyId: status, groupValue: "doing" });
      await b.mutation(api.collections.moveRow, { collectionId, rowId: bee.id, afterRowId: offline.id, groupPropertyId: status, groupValue: null });
      await b.mutation(api.collections.moveRow, { collectionId, rowId: a.id, afterRowId: c.id });
      const moveBad = await attempt(() => b.mutation(api.collections.moveRow, { collectionId, rowId: a.id, afterRowId: null, groupPropertyId: status, groupValue: "nope" }));

      await b.mutation(api.collections.renameRow, { collectionId, rowId: bee.id, title: "Bee" });
      const renamed = await b.query(api.documents.get, { documentId: bee.documentId });
      await b.mutation(api.collections.deleteRow, { collectionId, rowId: a.id });
      const deletedAgain = await attempt(() => b.mutation(api.collections.deleteRow, { collectionId, rowId: a.id }));
      const renameDeleted = await attempt(() => b.mutation(api.collections.renameRow, { collectionId, rowId: a.id, title: "Back" }));
      const deletedNote = await b.query(api.documents.get, { documentId: a.documentId });

      const got = await shown(b, collectionId);
      const statusProp = got.properties.find((p) => p.id === status)!;
      const groups = [...statusProp.options.map((o) => o.id), null].map((g) => ({ group: g, rows: got.rows.filter((r) => (r.values[status] ?? null) === g).map((r) => r.title) }));
      const blocksOf = async (documentId: string) => (await b.query(api.blocks.list, { documentId }))?.blocks.map((x) => ({ type: x.type, text: x.text }));
      return {
        offline,
        offlineAgain,
        taken,
        badId,
        unknownValue,
        badValue,
        moveBad,
        deletedAgain,
        renameDeleted,
        renamed: renamed && { title: renamed.document.title, kind: renamed.document.kind, parent: renamed.document.parentDocumentId, icon: renamed.document.icon, breadcrumbs: renamed.breadcrumbs },
        deletedNote: deletedNote && { inTrash: deletedNote.inTrash },
        collection: got,
        groups,
        long: long.documentId,
        rowPage: await b.query(api.collections.rowForDocument, { documentId: bee.documentId }),
        hostPage: await b.query(api.collections.rowForDocument, { documentId: host }),
        deletedPage: await b.query(api.collections.rowForDocument, { documentId: a.documentId }),
        rowBlocks: await blocksOf(c.documentId),
        offlineBlocks: await blocksOf(docId),
        tree: await b.query(api.documents.pageTree, { documentId: host }),
      };
    },
  }),
  scenario({
    name: "collections: a view exported as CSV and Markdown",
    async run(b, k) {
      const { collectionId, viewId, status, date } = await newCollection(b, k, "export");
      const add = async (name: string, type: Collection["properties"][number]["type"], extra: Record<string, unknown> = {}) => k.name((await b.mutation(api.collections.addProperty, { collectionId, name, type, ...extra })).id, name);
      const cost = await add("Cost", "number", { numberFormat: { format: "currency", currency: "GBP", decimals: 2 } });
      const done = await add("Done", "checkbox");
      const tags = await add("Tags", "multiSelect");
      await b.mutation(api.collections.updateProperty, { collectionId, propertyId: tags, options: [{ id: "home", name: "Home" }, { id: "work", name: "Work, mostly" }] });
      const who = await add("Who", "person");
      const link = await add("Link", "url");
      const related = await add("Related", "relation");
      const note = await add("Note", "text");
      const vat = await add("With VAT", "formula", { formula: "Cost * 1.2", numberFormat: { format: "currency", currency: "GBP", decimals: 2 } });
      const linked = await k.newNote("linked", { title: "Supplier list" });
      const me = (await b.query(api.collections.get, { collectionId })).people[0]!.id;
      const rows: [string, Record<string, unknown>][] = [
        ["Paint", { [status]: "doing", [date]: "2026-10-12", [cost]: 40, [done]: false, [tags]: ["home"], [who]: me, [related]: [linked], [note]: 'Say "matte"' }],
        ["Desk, oak", { [status]: "done", [cost]: 310.5, [done]: true, [tags]: ["work", "home"], [link]: "https://example.com/desk", [note]: "=SUM(A1)" }],
        ["Lamp", { [status]: "todo", [cost]: 25 }],
      ];
      for (const [title, values] of rows) k.name((await b.mutation(api.collections.addRow, { collectionId, title, values })).id, `row-${title}`);
      await b.mutation(api.collections.updateView, {
        collectionId,
        viewId,
        config: { filters: [{ propertyId: cost, op: "gt", value: 30 }], sorts: [{ propertyId: cost, direction: "desc" }], visibleProperties: [status, date, cost, done, tags, who, link, related, note, vat], cardPreview: "none", cardSize: "medium" },
      });
      const got = await b.query(api.collections.get, { collectionId });
      const props = asView(got);
      const view = got.views.find((v) => v.id === viewId)!;
      const visible = view.config.visibleProperties.map((id) => props.find((p) => p.id === id)!).filter(Boolean);
      const shownRows = applyView(withFormulaValues(got.rows as ViewRow[], props), view.config, props);
      // The person's name is the account's or the library's: the same stand-in for both.
      const people = got.people.map((p) => ({ id: p.id, name: "Sam" }));
      const ids = [...new Set(visible.filter((p) => p.type === "relation").flatMap((p) => shownRows.flatMap((r) => (Array.isArray(r.values[p.id]) ? (r.values[p.id] as string[]) : []))))];
      const titles = Object.fromEntries(Object.entries(await b.query(api.documents.titles, { documentIds: ids })).map(([id, t]) => [id, t.title || "Untitled"]));
      return {
        csv: toCsv(exportTable(shownRows, visible, { as: "csv", people, titles })),
        markdown: toMarkdownTable(exportTable(shownRows, visible, { as: "markdown", people, titles })),
      };
    },
  }),
  scenario({
    name: "collections: a note made from a template gets its own copies, without rows",
    async run(b, k) {
      const template = k.id("template");
      await k.apply([{ opId: ulid(), kind: "document.create", document: { id: template, parentDocumentId: null, folderId: null, kind: "template", title: "Project", icon: "📁" } }]);
      const made = await b.mutation(api.collections.create, { documentId: template, name: "Milestones", view: "board" });
      const collectionId = k.name(made.collectionId, "source");
      k.name(made.viewId, "source-board");
      const extra = k.name((await b.mutation(api.collections.addViewToCollection, { collectionId, name: "List", type: "table" })).id, "source-list");
      const owner = k.name((await b.mutation(api.collections.addProperty, { collectionId, name: "Owner", type: "text" })).id, "source-owner");
      const gone = k.name((await b.mutation(api.collections.addProperty, { collectionId, name: "Old", type: "text" })).id, "source-old");
      await b.mutation(api.collections.deleteProperty, { collectionId, propertyId: gone });
      const src = await b.query(api.collections.get, { collectionId });
      k.name(src.properties[0]!.id, "source-status");
      k.name(src.properties[1]!.id, "source-date");
      await b.mutation(api.collections.updateView, { collectionId, viewId: extra, config: { filters: [{ propertyId: owner, op: "isNotEmpty" }, { propertyId: gone, op: "isEmpty" }], sorts: [{ propertyId: owner, direction: "asc" }], visibleProperties: [owner, gone], cardPreview: "none", cardSize: "medium", summaries: [{ propertyId: "title", fn: "count" }, { propertyId: owner, fn: "countEmpty" }] } });
      k.name((await b.mutation(api.collections.addRow, { collectionId, title: "Kickoff" })).id, "source-row");
      await k.upsert(template, [collectionBlock(k.id("template-block"), collectionId, extra)]);
      const page = k.id("from-template");
      await k.apply([{ opId: ulid(), kind: "document.create", document: { id: page, parentDocumentId: null, folderId: null, kind: "document", title: "Launch", icon: "🚀", templateId: template } }]);
      const blocks = (await b.query(api.blocks.list, { documentId: page }))!.blocks.filter((x) => x.type === "collection");
      const props = blocks[0]!.props as { collectionId: string; viewId: string };
      k.name(props.collectionId, "copy");
      const copy = await shown(b, props.collectionId);
      for (const p of copy.properties) k.name(p.id, `copy-${p.name}`);
      for (const v of copy.views) k.name(v.id, `copy-view-${v.name}`);
      return { blocks: blocks.map((x) => x.props), copy, source: await shown(b, collectionId) };
    },
  }),
];
