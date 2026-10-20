// Trash: a note (and the pages inside it) go to Trash and come back.
import { api } from "../../../convex/_generated/api";
import { scenario } from "../types";

const tick = () => new Promise((r) => setTimeout(r, 3));

/** Waits for what a call leaves for afterwards (the server's deletion jobs), through the driver when it can. */
async function settle(b: object): Promise<void> {
  const own = (b as { settle?: () => Promise<void> }).settle;
  if (own) await own.call(b);
  else await new Promise((r) => setTimeout(r, 50));
}

export const scenarios = [
  scenario({
    name: "trash and restore",
    async run(b, k) {
      const parent = await k.newNote("parent", { title: "Old project" });
      const child = await k.newNote("child", { title: "Notes from the kickoff", parent });
      const before = await b.query(api.documents.trashSummary, { scope: b.scope });
      await b.mutation(api.documents.moveToTrash, { documentId: parent });
      const summary = await b.query(api.documents.trashSummary, { scope: b.scope });
      const trash = await b.query(api.documents.list, { scope: b.scope, view: "trash", paginationOpts: { numItems: 50, cursor: null } });
      const all = await b.query(api.documents.list, { scope: b.scope, view: "all", paginationOpts: { numItems: 100, cursor: null } });
      const trashedChild = await b.query(api.documents.get, { documentId: child });
      await b.mutation(api.documents.restoreFromTrash, { documentId: parent });
      const restored = await b.query(api.documents.get, { documentId: parent });
      const restoredChild = await b.query(api.documents.get, { documentId: child });
      const after = await b.query(api.documents.trashSummary, { scope: b.scope });
      const mine = new Set([parent, child]);
      return {
        before,
        summary,
        trash: trash.page.filter((d) => mine.has(d.id)).map((d) => ({ id: d.id, title: d.title })),
        stillListed: all.page.filter((d) => mine.has(d.id)).map((d) => d.id),
        trashedChild: { inTrash: trashedChild?.inTrash },
        restored: { inTrash: restored?.inTrash },
        restoredChild: { inTrash: restoredChild?.inTrash },
        after,
      };
    },
  }),
  scenario({
    name: "a child trashed on its own stays in Trash when its parent comes back",
    async run(b, k) {
      const parent = await k.newNote("parent", { title: "Book" });
      const one = await k.newNote("one", { title: "Chapter one", parent });
      const two = await k.newNote("two", { title: "Chapter two", parent });
      await b.mutation(api.documents.moveToTrash, { documentId: one });
      await tick();
      await b.mutation(api.documents.moveToTrash, { documentId: parent });
      await b.mutation(api.documents.restoreFromTrash, { documentId: parent });
      const tree = await b.query(api.documents.pageTree, { documentId: parent });
      const oneNow = await b.query(api.documents.get, { documentId: one });
      // Restoring a page whose parent is gone or still in Trash puts it at the top level.
      await b.mutation(api.documents.moveToTrash, { documentId: parent });
      await b.mutation(api.documents.restoreFromTrash, { documentId: two });
      const twoNow = await b.query(api.documents.get, { documentId: two });
      const missing = await b.mutation(api.documents.restoreFromTrash, { documentId: k.id("missing") }).then(
        () => "ok",
        (e: { data?: { code?: string } }) => e.data?.code,
      );
      return { tree, one: { inTrash: oneNow?.inTrash, parent: oneNow?.document.parentDocumentId }, two: { inTrash: twoNow?.inTrash, parent: twoNow?.document.parentDocumentId, breadcrumbs: twoNow?.breadcrumbs }, missing };
    },
  }),
  scenario({
    name: "delete for good: Trash first, the title typed back",
    async run(b, k) {
      const note = await k.newNote("note", { title: "Old receipts" });
      const code = (p: Promise<unknown>) => p.then(
        () => "ok",
        (e: { data?: { code?: string; message?: string } }) => `${e.data?.code}: ${e.data?.message}`,
      );
      const notInTrash = await code(b.mutation(api.documents.deletePermanently, { documentId: note, confirmTitle: "Old receipts" }));
      await b.mutation(api.documents.moveToTrash, { documentId: note });
      const wrongTitle = await code(b.mutation(api.documents.deletePermanently, { documentId: note, confirmTitle: "Old" }));
      const deleted = await code(b.mutation(api.documents.deletePermanently, { documentId: note, confirmTitle: "  Old receipts " }));
      await settle(b);
      const gone = await b.query(api.documents.get, { documentId: note });
      const trash = await b.query(api.documents.list, { scope: b.scope, view: "trash", paginationOpts: { numItems: 50, cursor: null } });
      const untitled = await k.newNote("untitled", { title: "" });
      await b.mutation(api.documents.moveToTrash, { documentId: untitled });
      const untitledDeleted = await code(b.mutation(api.documents.deletePermanently, { documentId: untitled, confirmTitle: "Untitled" }));
      const missing = await code(b.mutation(api.documents.deletePermanently, { documentId: k.id("missing"), confirmTitle: "x" }));
      return { notInTrash, wrongTitle, deleted, gone, inTrash: trash.page.map((d) => d.id), untitledDeleted, missing };
    },
  }),
  scenario({
    name: "empty Trash",
    async run(b, k) {
      const a = await k.newNote("a", { title: "First" });
      const c = await k.newNote("c", { title: "Second" });
      const keep = await k.newNote("keep", { title: "Kept" });
      await b.mutation(api.documents.moveToTrash, { documentId: a });
      await b.mutation(api.documents.moveToTrash, { documentId: c });
      const summary = await b.query(api.documents.trashSummary, { scope: b.scope });
      const emptied = await b.mutation(api.documents.emptyTrash, { scope: b.scope });
      await settle(b);
      const after = await b.query(api.documents.trashSummary, { scope: b.scope });
      const trash = await b.query(api.documents.list, { scope: b.scope, view: "trash", paginationOpts: { numItems: 50, cursor: null } });
      const gone = await b.query(api.documents.get, { documentId: a });
      const kept = await b.query(api.documents.get, { documentId: keep });
      return { summary, emptied, after, trash: trash.page.length, gone, kept: kept?.document.title };
    },
  }),
];
