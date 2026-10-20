// Notes in lists: stars, the Archive, templates, sort orders, arranging by hand, bulk actions, duplicates,
// the Info inspector, backlinks and rank rebalancing.
import { LIMITS } from "@folevi/editor-schema";
import { api } from "../../../convex/_generated/api";
import { para } from "../kit";
import { scenario, type ParityBackend } from "../types";

/** Lets the clock move on, so "edited later" is later on both backends (both read the real clock). */
const tick = () => new Promise((r) => setTimeout(r, 3));

/** Waits for what a call leaves for afterwards (the server's deletion jobs), through the driver when it can. */
async function settle(b: object): Promise<void> {
  const own = (b as { settle?: () => Promise<void> }).settle;
  if (own) await own.call(b);
  else await new Promise((r) => setTimeout(r, 50));
}

const page = { numItems: 100, cursor: null };

/** A block's revision now (an edit is sent on top of it, as the editor does). */
async function revisionOf(b: ParityBackend, documentId: string, blockId: string): Promise<number | null> {
  return (await b.query(api.blocks.list, { documentId }))?.blocks.find((x) => x.id === blockId)?.revision ?? null;
}

async function listed(b: ParityBackend, mine: Set<string>, view: "all" | "starred" | "archive" | "templates" | "unsorted", sort?: "updated" | "created" | "title" | "manual") {
  const r = await b.query(api.documents.list, { scope: b.scope, view, ...(sort ? { sort } : {}), paginationOpts: page });
  return r.page.filter((d) => mine.has(d.id)).map((d) => ({ id: d.id, title: d.title, starred: d.starred, archivedAt: d.archivedAt, kind: d.kind }));
}

export const scenarios = [
  scenario({
    name: "star and archive notes; the Starred and Archive views",
    async run(b, k) {
      const a = await k.newNote("a", { title: "Apples" });
      await tick();
      const c = await k.newNote("c", { title: "Cherries" });
      await tick();
      const p = await k.newNote("p", { title: "Pears" });
      const mine = new Set([a, c, p]);
      await b.mutation(api.documents.setStarred, { documentId: a, starred: true });
      await b.mutation(api.documents.setStarred, { documentId: p, starred: true });
      // Starring twice changes nothing; a star isn't an edit.
      await b.mutation(api.documents.setStarred, { documentId: p, starred: true });
      const starred = await listed(b, mine, "starred");
      await tick();
      await b.mutation(api.documents.setArchived, { documentId: c, archived: true });
      const archive = await listed(b, mine, "archive");
      const all = await listed(b, mine, "all");
      await b.mutation(api.documents.setStarred, { documentId: a, starred: false });
      await b.mutation(api.documents.setArchived, { documentId: c, archived: false });
      const after = { starred: await listed(b, mine, "starred"), archive: await listed(b, mine, "archive"), all: await listed(b, mine, "all") };
      const missing = await b.mutation(api.documents.setStarred, { documentId: k.id("missing"), starred: true }).then(
        () => "ok",
        (e: { data?: { code?: string } }) => e.data?.code,
      );
      return { starred, archive, all, after, missing };
    },
  }),
  scenario({
    name: "list sorts: by title, by creation and by hand (reorder)",
    async run(b, k) {
      const one = await k.newNote("one", { title: "banana" });
      await tick();
      const two = await k.newNote("two", { title: "Apple" });
      await tick();
      const three = await k.newNote("three", { title: "cherry" });
      const mine = new Set([one, two, three]);
      const byTitle = await listed(b, mine, "all", "title");
      const byCreated = await listed(b, mine, "all", "created");
      const manualBefore = await listed(b, mine, "all", "manual");
      // Put the third between nothing and the first: it goes first by hand.
      const moved = await b.mutation(api.documents.reorder, { documentId: three, afterDocumentId: null, beforeDocumentId: one });
      const manualAfter = await listed(b, mine, "all", "manual");
      const got = await b.query(api.documents.get, { documentId: three });
      return { byTitle, byCreated, manualBefore, manualAfter, rankIsString: typeof moved.rank === "string", rankMatches: got?.document.rank === moved.rank };
    },
  }),
  scenario({
    name: "lists page through in order with cursors",
    async run(b, k) {
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        ids.push(await k.newNote(`n${i}`, { title: `Note ${i}` }));
        await tick();
      }
      const mine = new Set(ids);
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 20; i++) {
        const r: { page: { id: string }[]; isDone: boolean; continueCursor: string } = await b.query(api.documents.list, { scope: b.scope, view: "all", paginationOpts: { numItems: 2, cursor } });
        seen.push(...r.page.map((d) => d.id).filter((id) => mine.has(id)));
        if (r.isDone) break;
        cursor = r.continueCursor;
      }
      return { seen };
    },
  }),
  scenario({
    name: "bulk actions: move, star, archive, trash, restore, delete",
    async run(b, k) {
      const folder = k.name((await b.mutation(api.organization.createFolder, { scope: b.scope, name: "Bulk" })).id, "folder");
      await b.mutation(api.organization.setFolderColor, { folderId: folder, color: null });
      const a = await k.newNote("a", { title: "One" });
      const c = await k.newNote("c", { title: "Two" });
      const nested = await k.newNote("nested", { title: "Inside two", parent: c });
      const missing = k.id("missing");
      const mine = new Set([a, c, nested]);
      const moved = await b.mutation(api.documents.bulkUpdate, { documentIds: [a, c, missing], action: { kind: "move", folderId: folder } });
      const inFolder = await b.query(api.documents.list, { scope: b.scope, view: "folder", folderId: folder, paginationOpts: page });
      const starred = await b.mutation(api.documents.bulkUpdate, { documentIds: [a, c], action: { kind: "star", starred: true } });
      const archived = await b.mutation(api.documents.bulkUpdate, { documentIds: [a], action: { kind: "archive", archived: true } });
      const archive = await listed(b, mine, "archive");
      const trashed = await b.mutation(api.documents.bulkUpdate, { documentIds: [c, nested], action: { kind: "trash" } });
      // In Trash: a move or an archive skips it.
      const moveTrashed = await b.mutation(api.documents.bulkUpdate, { documentIds: [c], action: { kind: "move", folderId: null } });
      const archiveTrashed = await b.mutation(api.documents.bulkUpdate, { documentIds: [c], action: { kind: "archive", archived: true } });
      const summary = await b.query(api.documents.trashSummary, { scope: b.scope });
      // The nested page first: restoring sorts parents first, so it lands back under its parent.
      const restored = await b.mutation(api.documents.bulkUpdate, { documentIds: [nested, c], action: { kind: "restore" } });
      const tree = await b.query(api.documents.pageTree, { documentId: c });
      // Deleting needs Trash: the first one isn't there.
      await b.mutation(api.documents.bulkUpdate, { documentIds: [a], action: { kind: "trash" } });
      const deleted = await b.mutation(api.documents.bulkUpdate, { documentIds: [a, c], action: { kind: "delete" } });
      await settle(b);
      const gone = await b.query(api.documents.get, { documentId: a });
      const tooMany = await b.mutation(api.documents.bulkUpdate, { documentIds: Array.from({ length: 51 }, (_, i) => `x${i}`), action: { kind: "trash" } }).then(
        () => "ok",
        (e: { data?: { code?: string } }) => e.data?.code,
      );
      const empty = await b.mutation(api.documents.bulkUpdate, { documentIds: [], action: { kind: "trash" } });
      return {
        moved,
        // Both moved in one call (the same moment, or a millisecond apart): which is first isn't compared.
        inFolder: [a, c].map((id) => inFolder.page.some((d) => d.id === id && d.folderId === folder)),
        starred,
        archived,
        archive,
        trashed,
        moveTrashed,
        archiveTrashed,
        summary,
        restored,
        tree,
        deleted,
        gone,
        tooMany,
        empty,
      };
    },
  }),
  scenario({
    name: "duplicate a note, and make a template from it",
    async run(b, k) {
      const note = await k.newNote("note", { title: "Packing list" });
      const p1 = k.id("p1");
      const p2 = k.id("p2");
      await k.upsert(note, [para(p1, "Socks", "a1"), para(p2, "Charger", "a2")]);
      const copy = await b.mutation(api.documents.duplicate, { documentId: note });
      k.name(copy.id, "copy");
      const template = await b.mutation(api.documents.duplicate, { documentId: note, asTemplate: true });
      k.name(template.id, "template");
      const copyBlocks = await b.query(api.blocks.list, { documentId: copy.id });
      const templates = await b.query(api.documents.list, { scope: b.scope, view: "templates", paginationOpts: page });
      // A copy of an untitled note says so.
      const untitled = await k.newNote("untitled", { title: "" });
      const untitledCopy = await b.mutation(api.documents.duplicate, { documentId: untitled });
      return {
        copy: { ...copy, icon: copy.icon !== null },
        template: { ...template, icon: template.icon !== null },
        copyText: copyBlocks?.blocks.map((x) => ({ type: x.type, text: x.text, rank: x.rank, newId: x.id !== p1 && x.id !== p2 })),
        inTemplates: templates.page.filter((d) => d.id === template.id).map((d) => d.title),
        untitledCopy: untitledCopy.title,
      };
    },
  }),
  scenario({
    name: "the Info inspector: counts, times and versions",
    async run(b, k) {
      const note = await k.newNote("note", { title: "Counted" });
      await k.upsert(note, [para(k.id("p1"), "Three little words", "a1"), para(k.id("p2"), "and two more", "a2")]);
      const before = await b.query(api.documents.info, { documentId: note });
      await b.mutation(api.documents.createSnapshot, { documentId: note, reason: "manual" });
      const after = await b.query(api.documents.info, { documentId: note });
      const missing = await b.query(api.documents.info, { documentId: k.id("missing") }).then(
        () => "ok",
        (e: { data?: { code?: string } }) => e.data?.code,
      );
      return { before, after: after.activity.map((a) => ({ kind: a.kind, reason: a.reason })), counts: [after.wordCount, after.charCount, after.blockCount], missing };
    },
  }),
  scenario({
    name: "backlinks: notes linking here, in the order they linked",
    async run(b, k) {
      const target = await k.newNote("target", { title: "Glossary" });
      const first = await k.newNote("first", { title: "Chapter one" });
      const second = await k.newNote("second", { title: "Chapter two" });
      const card = k.id("card");
      const link = k.id("link");
      await k.upsert(second, [{ id: card, type: "page", parentId: null, rank: "a1", schemaVersion: 1, text: [], props: { documentId: target, display: "card", titleCache: "Old name" } }]);
      await k.upsert(first, [{ ...para(link, "", "a1"), text: [{ type: "text", text: "See " }, { type: "pageLink", documentId: target, label: "Old name" }] }]);
      const linked = await b.query(api.documents.backlinks, { documentId: target });
      // The label shows the linked note's current title, whatever the block stored.
      const cardBlocks = await b.query(api.blocks.list, { documentId: second });
      const linkBlocks = await b.query(api.blocks.list, { documentId: first });
      // A linking note in Trash isn't listed; removing the link takes it off the list.
      await b.mutation(api.documents.moveToTrash, { documentId: second });
      await k.upsert(first, [para(link, "No link now", "a1")], await revisionOf(b, first, link));
      const after = await b.query(api.documents.backlinks, { documentId: target });
      const none = await b.query(api.documents.backlinks, { documentId: k.id("missing") });
      return {
        linked,
        cardProps: cardBlocks?.blocks[0]?.props,
        linkText: linkBlocks?.blocks[0]?.text,
        after,
        none,
      };
    },
  }),
  scenario({
    name: "rebalance a list of blocks whose ranks grew long",
    async run(b, k) {
      const note = await k.newNote("note", { title: "Long ranks" });
      const long = "V".repeat(Math.floor(LIMITS.maxRankLength / 2) + 2);
      const ids = [k.id("x1"), k.id("x2"), k.id("x3")];
      await k.upsert(note, [para(ids[0]!, "one", `${long}1`), para(ids[1]!, "two", `${long}2`), para(ids[2]!, "three", "W")]);
      const done = await b.mutation(api.blocks.rebalance, { documentId: note, parentId: null });
      const blocks = (await b.query(api.blocks.list, { documentId: note }))?.blocks ?? [];
      const order = [...blocks].sort((x, y) => (x.rank < y.rank ? -1 : 1)).map((x) => x.id);
      const again = await b.mutation(api.blocks.rebalance, { documentId: note, parentId: null });
      return { done, order, ranks: blocks.map((x) => x.rank.length <= 4), again };
    },
  }),
];
