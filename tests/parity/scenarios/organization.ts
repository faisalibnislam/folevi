// Folders and tags: create, nest, rename and colour folders, file notes in them, tag notes.
import { api } from "../../../convex/_generated/api";
import { scenario } from "../types";

export const scenarios = [
  scenario({
    name: "folders: create, nest, rename, file a note",
    localPending: "WP7b: organization.*; WP7a: documents.move, list",
    async run(b, k) {
      const work = k.name((await b.mutation(api.organization.createFolder, { scope: b.scope, name: "Work" })).id, "work");
      const clients = k.name((await b.mutation(api.organization.createFolder, { scope: b.scope, name: "Clients", parentFolderId: work })).id, "clients");
      await b.mutation(api.organization.renameFolder, { folderId: clients, name: "Customers" });
      // A new folder gets a random colour; set both so the comparison holds.
      await b.mutation(api.organization.setFolderColor, { folderId: work, color: "olive" });
      await b.mutation(api.organization.setFolderColor, { folderId: clients, color: null });
      const note = await k.newNote("note", { title: "Quarterly review" });
      await b.mutation(api.documents.move, { documentId: note, folderId: clients });
      const sidebar = await b.query(api.organization.sidebar, { scope: b.scope });
      const inFolder = await b.query(api.documents.list, { scope: b.scope, view: "folder", folderId: clients, paginationOpts: { numItems: 50, cursor: null } });
      const got = await b.query(api.documents.get, { documentId: note });
      const mine = new Set([work, clients]);
      return {
        folders: sidebar.folders.filter((f: { id: string }) => mine.has(f.id)),
        inFolder: inFolder.page.map((d) => ({ id: d.id, title: d.title, folderId: d.folderId })),
        folder: got?.folder,
      };
    },
  }),
  scenario({
    name: "tags: create, rename, tag a note, list by tag",
    localPending: "WP7b: organization.*; WP7a: documents.list",
    async run(b, k) {
      const garden = k.name((await b.mutation(api.organization.createTag, { scope: b.scope, name: "garden" })).id, "garden");
      const kitchen = k.name((await b.mutation(api.organization.createTag, { scope: b.scope, name: "kitchen", color: "marigold" })).id, "kitchen");
      await b.mutation(api.organization.updateTag, { tagId: garden, name: "Garden plans", color: "moss" });
      const note = await k.newNote("note", { title: "Herbs" });
      await b.mutation(api.organization.setDocumentTags, { documentId: note, tagIds: [garden, kitchen] });
      const byTag = await b.query(api.documents.list, { scope: b.scope, view: "tag", tagId: garden, paginationOpts: { numItems: 50, cursor: null } });
      const sidebar = await b.query(api.organization.sidebar, { scope: b.scope });
      const mine = new Set([garden, kitchen]);
      await b.mutation(api.organization.deleteTag, { tagId: kitchen });
      const got = await b.query(api.documents.get, { documentId: note });
      return {
        tags: sidebar.tags.filter((t: { id: string }) => mine.has(t.id)),
        byTag: byTag.page.map((d) => ({ id: d.id, title: d.title, tags: d.tags })),
        afterDelete: got?.document.tags,
      };
    },
  }),
];
