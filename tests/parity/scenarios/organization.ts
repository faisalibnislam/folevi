// Folders and tags: create, nest, move, rename, colour and delete folders, file notes in them, tag notes; the
// All folders and All tags views, Home's recent folders, the Drafts count, and the errors each refuses with.
import { rankBetween } from "@folevi/editor-schema";
import { api } from "../../../convex/_generated/api";
import { para } from "../kit";
import { scenario } from "../types";

/** What a call refused with ({ code, message }), or what it returned. */
async function attempt<T>(p: Promise<T>): Promise<{ ok: T } | { error: unknown }> {
  try {
    return { ok: await p };
  } catch (e) {
    const data = (e as { data?: unknown }).data;
    return { error: typeof data === "string" ? JSON.parse(data) : (data ?? String(e)) };
  }
}

export const scenarios = [
  scenario({
    name: "folders: create, nest, rename, file a note",
    localPending: "WP7a: documents.move",
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
  scenario({
    name: "folders: move and reorder, and the moves a folder refuses",
    async run(b, k) {
      const make = async (name: string, parentFolderId?: string) => k.name((await b.mutation(api.organization.createFolder, { scope: b.scope, name, parentFolderId })).id, name.toLowerCase());
      const a = await make("A");
      const bb = await make("B");
      const c = await make("C");
      const inner = await make("Inner", a);
      // C into A, after Inner; then B to the front of the top level.
      await b.mutation(api.organization.moveFolder, { folderId: c, parentFolderId: a, afterFolderId: inner });
      await b.mutation(api.organization.moveFolder, { folderId: bb, parentFolderId: null, afterFolderId: null });
      const self = await attempt(b.mutation(api.organization.moveFolder, { folderId: a, parentFolderId: a }));
      const descendant = await attempt(b.mutation(api.organization.moveFolder, { folderId: a, parentFolderId: inner }));
      // Five levels is the deepest: a sixth can't be made, and a branch can't be moved to go past it.
      let parent = inner;
      for (const level of ["L3", "L4", "L5"]) parent = await make(level, parent);
      const tooDeep = await attempt(b.mutation(api.organization.createFolder, { scope: b.scope, name: "L6", parentFolderId: parent }));
      const deepMove = await attempt(b.mutation(api.organization.moveFolder, { folderId: bb, parentFolderId: parent }));
      const missing = await attempt(b.mutation(api.organization.moveFolder, { folderId: a, parentFolderId: "01JAAAAAAAAAAAAAAAAAAAAAAA" }));
      const sidebar = await b.query(api.organization.sidebar, { scope: b.scope });
      const mine = new Set([a, bb, c, inner]);
      const rows = sidebar.folders.filter((f) => mine.has(f.id));
      // The order the sidebar shows them in, by parent: ranks are compared, not shown.
      const order = (p: string | null) => rows.filter((f) => f.parentFolderId === p).map((f) => f.id);
      const top = sidebar.folders.filter((f) => f.parentFolderId === null).map((f) => f.id);
      return {
        topFirst: top[0],
        topMine: top.filter((id) => mine.has(id)),
        inA: order(a),
        parents: Object.fromEntries([a, bb, c, inner].map((id) => [id, rows.find((f) => f.id === id)?.parentFolderId ?? null])),
        self,
        descendant,
        tooDeep,
        deepMove,
        missing,
      };
    },
  }),
  scenario({
    name: "folders: deleting one keeps its notes (in Drafts) and lifts its subfolders",
    async run(b, k) {
      const outer = k.name((await b.mutation(api.organization.createFolder, { scope: b.scope, name: "Outer" })).id, "outer");
      const doomed = k.name((await b.mutation(api.organization.createFolder, { scope: b.scope, name: "Doomed", parentFolderId: outer })).id, "doomed");
      const kept = k.name((await b.mutation(api.organization.createFolder, { scope: b.scope, name: "Kept", parentFolderId: doomed })).id, "kept");
      const draftsBefore = await b.query(api.organization.draftCount, { scope: b.scope });
      const note = await k.newNote("note", { title: "Filed", folder: doomed });
      const deep = await k.newNote("deep", { title: "In the kept one", folder: kept });
      await b.mutation(api.organization.deleteFolder, { folderId: doomed });
      const again = await attempt(b.mutation(api.organization.deleteFolder, { folderId: doomed }));
      const rename = await attempt(b.mutation(api.organization.renameFolder, { folderId: doomed, name: "Back" }));
      const sidebar = await b.query(api.organization.sidebar, { scope: b.scope });
      const got = await b.query(api.documents.get, { documentId: note });
      const gotDeep = await b.query(api.documents.get, { documentId: deep });
      const drafts = await b.query(api.documents.list, { scope: b.scope, view: "unsorted", paginationOpts: { numItems: 100, cursor: null } });
      const draftsAfter = await b.query(api.organization.draftCount, { scope: b.scope });
      const mine = new Set([outer, doomed, kept]);
      return {
        folders: sidebar.folders.filter((f) => mine.has(f.id)).map((f) => ({ id: f.id, name: f.name, parentFolderId: f.parentFolderId })),
        note: { folderId: got?.document.folderId ?? null, folder: got?.folder ?? null },
        deep: { folderId: gotDeep?.document.folderId ?? null, folder: gotDeep?.folder ?? null },
        inDrafts: drafts.page.some((d) => d.id === note),
        draftsAdded: draftsAfter - draftsBefore,
        again,
        rename,
      };
    },
  }),
  scenario({
    name: "folders: names, colours and ids the server refuses or keeps",
    async run(b, k) {
      const id = k.id("chosen");
      const first = await b.mutation(api.organization.createFolder, { scope: b.scope, name: "  Offline\tfolder  ", id });
      // The same create sent again (its answer was lost) returns the folder it made.
      const replay = await b.mutation(api.organization.createFolder, { scope: b.scope, name: "Another name", id });
      const badId = await attempt(b.mutation(api.organization.createFolder, { scope: b.scope, name: "Bad", id: "no spaces allowed" }));
      const empty = await attempt(b.mutation(api.organization.createFolder, { scope: b.scope, name: " \n " }));
      const emptyRename = await attempt(b.mutation(api.organization.renameFolder, { folderId: id, name: "" }));
      const long = await b.mutation(api.organization.renameFolder, { folderId: id, name: "x".repeat(120) });
      const colour = await attempt(b.mutation(api.organization.setFolderColor, { folderId: id, color: "not-a-colour" }));
      await b.mutation(api.organization.setFolderColor, { folderId: id, color: "olive" });
      const unknown = await attempt(b.mutation(api.organization.setFolderColor, { folderId: "01JAAAAAAAAAAAAAAAAAAAAAAA", color: null }));
      const noParent = await attempt(b.mutation(api.organization.createFolder, { scope: b.scope, name: "Orphan", parentFolderId: "01JAAAAAAAAAAAAAAAAAAAAAAA" }));
      const sidebar = await b.query(api.organization.sidebar, { scope: b.scope });
      return { first, replay, badId, empty, emptyRename, long, colour, unknown, noParent, row: sidebar.folders.find((f) => f.id === id) };
    },
  }),
  scenario({
    name: "folders: All folders, Home's recent folders and the Drafts count",
    async run(b, k) {
      const older = k.name((await b.mutation(api.organization.createFolder, { scope: b.scope, name: "Older" })).id, "older");
      const newer = k.name((await b.mutation(api.organization.createFolder, { scope: b.scope, name: "Newer", parentFolderId: older })).id, "newer");
      await b.mutation(api.organization.setFolderColor, { folderId: older, color: "olive" });
      await b.mutation(api.organization.setFolderColor, { folderId: newer, color: "olive" });
      const one = await k.newNote("one", { title: "First", folder: newer });
      await k.newNote("two", { title: "Second", folder: newer });
      await k.newNote("nested", { title: "Inside First", parent: one });
      // Edited last, so it's the newest whatever the clock does.
      await k.upsert(one, [para(k.id("p"), "Opening line", rankBetween(null, null))]);
      const index = await b.query(api.organization.index, { scope: b.scope });
      const foldersOnly = await b.query(api.organization.index, { scope: b.scope, only: "folders" });
      const tagsOnly = await b.query(api.organization.index, { scope: b.scope, only: "tags" });
      // Renaming the older one makes it the most recently changed.
      await b.mutation(api.organization.renameFolder, { folderId: older, name: "Older, renamed" });
      const recent = await b.query(api.organization.recentFolders, { scope: b.scope, limit: 100 });
      const first = await b.query(api.organization.recentFolders, { scope: b.scope, limit: 1.7 });
      const none = await b.query(api.organization.recentFolders, { scope: b.scope, limit: -3 });
      const drafts = await b.query(api.organization.draftCount, { scope: b.scope });
      const mine = new Set([older, newer]);
      const strip = <F extends { id: string; updatedAt: number; createdAt: number }>(f: F) => ({ ...f, updatedAt: 0, createdAt: 0 });
      return {
        folders: index.folders.filter((f) => mine.has(f.id)).map(strip),
        // The welcome folders' previews are left out: notes made in the same instant order by creation.
        seededFolders: index.folders.filter((f) => !mine.has(f.id)).map((f) => ({ name: f.name, documentCount: f.documentCount })),
        tags: index.tags.map((t) => ({ name: t.name, color: t.color, documentCount: t.documentCount })),
        foldersOnlyHasTags: foldersOnly.tags.length,
        tagsOnlyHasFolders: tagsOnly.folders.length,
        // Only these two are compared in order: the welcome folders may share their instant.
        recent: { total: recent.total, folders: recent.folders.filter((f) => mine.has(f.id)).map((f) => ({ id: f.id, name: f.name, parentName: f.parentName, documentCount: f.documentCount })) },
        firstCount: first.folders.length,
        none,
        drafts,
      };
    },
  }),
  scenario({
    name: "tags: one per name, renames that clash, colours, and setting a note's tags",
    async run(b, k) {
      const plants = k.name((await b.mutation(api.organization.createTag, { scope: b.scope, name: "#Plants", color: "plum" })).id, "plants");
      // Same name (any case, with or without #): the same tag.
      const again = await b.mutation(api.organization.createTag, { scope: b.scope, name: "plants" });
      const herbs = k.name((await b.mutation(api.organization.createTag, { scope: b.scope, name: "herbs", color: "moss" })).id, "herbs");
      const trees = k.name((await b.mutation(api.organization.createTag, { scope: b.scope, name: "trees", color: "coral" })).id, "trees");
      const clash = await attempt(b.mutation(api.organization.updateTag, { tagId: herbs, name: "#PLANTS" }));
      const badColour = await attempt(b.mutation(api.organization.updateTag, { tagId: herbs, color: "rainbow" }));
      const sameName = await b.mutation(api.organization.updateTag, { tagId: herbs, name: "Herbs" });
      const empty = await attempt(b.mutation(api.organization.createTag, { scope: b.scope, name: "#" }));
      const unknown = await attempt(b.mutation(api.organization.updateTag, { tagId: "01JAAAAAAAAAAAAAAAAAAAAAAA", name: "x" }));
      const note = await k.newNote("note", { title: "Window box" });
      await b.mutation(api.organization.setDocumentTags, { documentId: note, tagIds: [trees, plants, trees] });
      // Keeps the ones it has where they were; new ones follow in the order given.
      await b.mutation(api.organization.setDocumentTags, { documentId: note, tagIds: [herbs, plants] });
      const got = await b.query(api.documents.get, { documentId: note });
      const unknownTag = await attempt(b.mutation(api.organization.setDocumentTags, { documentId: note, tagIds: [plants, "01JAAAAAAAAAAAAAAAAAAAAAAA"] }));
      const unknownNote = await attempt(b.mutation(api.organization.setDocumentTags, { documentId: "01JAAAAAAAAAAAAAAAAAAAAAAB", tagIds: [] }));
      const index = await b.query(api.organization.index, { scope: b.scope, only: "tags" });
      await b.mutation(api.organization.deleteTag, { tagId: plants });
      const deletedTwice = await attempt(b.mutation(api.organization.deleteTag, { tagId: plants }));
      const after = await b.query(api.documents.get, { documentId: note });
      const mine = new Set([plants, herbs, trees]);
      return {
        again: again.id === plants,
        clash,
        badColour,
        sameName,
        empty,
        unknown,
        tags: got?.document.tags,
        unknownTag,
        stillTagged: (await b.query(api.documents.get, { documentId: note }))?.document.tags.map((t) => t.id),
        unknownNote,
        index: index.tags.filter((t) => mine.has(t.id)).map((t) => ({ id: t.id, name: t.name, color: t.color, documentCount: t.documentCount })),
        deletedTwice,
        after: after?.document.tags,
      };
    },
  }),
];
