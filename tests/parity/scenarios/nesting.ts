// Nested notes: pages inside pages, the tree, breadcrumbs, and moving a page out and back in.
import { api } from "../../../convex/_generated/api";
import { scenario } from "../types";

export const scenarios = [
  scenario({
    name: "nest and move notes",
    localPending: "WP7a: sync.push, documents.get, pageTree, move",
    async run(b, k) {
      const parent = await k.newNote("parent", { title: "Trip" });
      const child = await k.newNote("child", { title: "Packing list", parent });
      const grandchild = await k.newNote("grandchild", { title: "Toiletries", parent: child });
      const tree = await b.query(api.documents.pageTree, { documentId: parent });
      const deep = await b.query(api.documents.get, { documentId: grandchild });
      // Out to the top level, then back under the parent with the sidebar's move.
      await b.mutation(api.documents.move, { documentId: child, parentDocumentId: null });
      const out = await b.query(api.documents.get, { documentId: grandchild });
      const treeAfterOut = await b.query(api.documents.pageTree, { documentId: parent });
      await b.mutation(api.documents.move, { documentId: child, parentDocumentId: parent });
      const back = await b.query(api.documents.pageTree, { documentId: parent });
      return { tree, deepBreadcrumbs: deep?.breadcrumbs, outBreadcrumbs: out?.breadcrumbs, treeAfterOut, back };
    },
  }),
  scenario({
    name: "a page can't be moved inside itself",
    localPending: "WP7a: sync.push, documents.move",
    async run(b, k) {
      const parent = await k.newNote("parent", { title: "Outer" });
      const child = await k.newNote("child", { title: "Inner", parent });
      const viaSync = await k.push([{ opId: k.id("op"), kind: "document.update", documentId: parent, patch: { parentDocumentId: child }, baseRevision: null }]);
      const tree = await b.query(api.documents.pageTree, { documentId: parent });
      return { status: viaSync.map((r) => r.status), error: viaSync.map((r) => (r as { error?: { code: string } }).error?.code ?? null), tree };
    },
  }),
];
