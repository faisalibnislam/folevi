// Trash: a note (and the pages inside it) go to Trash and come back.
import { api } from "../../../convex/_generated/api";
import { scenario } from "../types";

export const scenarios = [
  scenario({
    name: "trash and restore",
    localPending: "WP7a: documents.moveToTrash, restoreFromTrash, trashSummary, list",
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
];
