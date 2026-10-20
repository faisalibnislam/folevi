// Synced blocks (docs/SYNCED_BLOCKS.md; convex/synced.ts, local: lib/local/functions/synced.ts): one piece of
// content shown in two notes, what its frame says ("Synced, in 2 notes"), where a link to it opens, search
// finding the notes by it (also after it's edited), unsyncing it in one note, and the content going to Trash
// when no note shows it, then coming back.
import { SCHEMA_VERSION, ulid, type WireBlock } from "@folevi/editor-schema";
import { api } from "../../../convex/_generated/api";
import { para, type Kit } from "../kit";
import { scenario, type ParityBackend } from "../types";

const syncedBlock = (id: string, sourceId: string, rank = "W"): WireBlock => ({ id, type: "synced", parentId: null, rank, schemaVersion: SCHEMA_VERSION, text: [], props: { sourceId } });

/** Synced content (document.create of kind "synced", as Turn into synced block does) with one line. */
async function newSource(k: Kit, name: string, text: string) {
  const id = k.id(name);
  await k.apply([{ opId: ulid(), kind: "document.create", document: { id, parentDocumentId: null, folderId: null, kind: "synced", title: "", icon: null } }]);
  const line = k.id(`${name}Line`);
  await k.upsert(id, [para(line, text, "V")]);
  return { id, line };
}

const search = async (b: ParityBackend, query: string) => (await b.query(api.search.documents, { scope: b.scope, query })).map((r) => ({ id: r.id, snippet: r.snippet }));

export const scenarios = [
  scenario({
    name: "synced blocks: one content in two notes, found by search, edited in place",
    async run(b, k) {
      const source = await newSource(k, "source", "Packing list: tent, stove and the yakwool blanket.");
      const a = await k.newNote("a", { title: "Trip to the lakes" });
      const blockA = k.id("blockA");
      await k.upsert(a, [para(ulid(), "Leaving Friday.", "V"), syncedBlock(blockA, source.id)]);
      const c = await k.newNote("c", { title: "Camping gear" });
      const blockC = k.id("blockC");
      // (Longer than the first note, so the note made first is also the better match: see search.ts.)
      await k.upsert(c, [syncedBlock(blockC, source.id, "V"), para(ulid(), "Check everything twice before the long drive north with the whole family.", "W")]);

      const info = await b.query(api.synced.info, { sourceId: source.id });
      const home = await b.query(api.synced.home, { sourceId: source.id });
      const found = await search(b, "yakwool");
      // Edited (in either note, it's the content's own block): both notes are found by the new words.
      await k.upsert(source.id, [para(source.line, "Packing list: tent, stove and the marmotfur hat.", "V")], 1);
      // The server writes a note's search text a moment after a burst of edits (lib/editSettle.ts); saving a
      // version writes it now. Local mode writes it straight away.
      await b.mutation(api.documents.createSnapshot, { documentId: source.id, reason: "idle" });
      const afterEdit = { old: await search(b, "yakwool"), now: await search(b, "marmotfur") };
      const content = await b.query(api.blocks.list, { documentId: source.id });
      const missing = await b.query(api.synced.info, { sourceId: ulid() });
      const notSynced = await b.query(api.synced.info, { sourceId: a });
      return { info, home, found, afterEdit, content: content?.blocks, missing, notSynced, homeOfNote: await b.query(api.synced.home, { sourceId: a }) };
    },
  }),
  scenario({
    name: "synced blocks: unsync in one note, then the last one goes and the content waits in Trash",
    async run(b, k) {
      const source = await newSource(k, "source", "Shared agenda for the zebrafinch meeting.");
      const a = await k.newNote("a", { title: "Monday" });
      const blockA = k.id("blockA");
      await k.upsert(a, [syncedBlock(blockA, source.id, "V")]);
      const c = await k.newNote("c", { title: "Tuesday" });
      const blockC = k.id("blockC");
      await k.upsert(c, [syncedBlock(blockC, source.id, "V")]);

      // Unsync in Monday: its synced block becomes ordinary lines with what it showed (one flush).
      const copied = k.id("copied");
      await k.push([
        { opId: ulid(), kind: "block.delete", documentId: a, blockId: blockA, baseRevision: null },
        { opId: ulid(), kind: "block.upsert", documentId: a, block: para(copied, "Shared agenda for the zebrafinch meeting.", "V"), baseRevision: null, fields: ["content", "position"] },
      ]);
      const afterUnsync = await b.query(api.synced.info, { sourceId: source.id });
      const homeAfterUnsync = await b.query(api.synced.home, { sourceId: source.id });
      const foundAfterUnsync = await search(b, "zebrafinch");

      // The last note showing it lets go: the content goes to Trash (not listed there: it isn't a page).
      await k.deleteBlock(c, blockC);
      const inTrash = await b.query(api.synced.info, { sourceId: source.id });
      const home = await b.query(api.synced.home, { sourceId: source.id });
      const trashList = await b.query(api.documents.list, { scope: b.scope, view: "trash", paginationOpts: { numItems: 50, cursor: null } });

      // Undo brings the synced block back, and the content with it.
      await k.push([{ opId: ulid(), kind: "block.restore", documentId: c, blockId: blockC }]);
      const back = await b.query(api.synced.info, { sourceId: source.id });

      // A note moved to Trash stops counting; restored, it counts again.
      await b.mutation(api.documents.moveToTrash, { documentId: c });
      const noteTrashed = await b.query(api.synced.info, { sourceId: source.id });
      await b.mutation(api.documents.restoreFromTrash, { documentId: c });
      const noteRestored = await b.query(api.synced.info, { sourceId: source.id });
      return { afterUnsync, homeAfterUnsync, foundAfterUnsync, inTrash, home, trashListed: trashList.page.some((d) => d.id === source.id), back, noteTrashed, noteRestored };
    },
  }),
  scenario({
    name: "synced blocks: a synced block can't go inside synced content",
    async run(b, k) {
      const source = await newSource(k, "source", "Inner");
      const other = await newSource(k, "other", "Other");
      const results = await k.push([{ opId: ulid(), kind: "block.upsert", documentId: source.id, block: syncedBlock(ulid(), other.id), baseRevision: null, fields: ["content", "position"] }]);
      return results.map((r) => ({ status: r.status, error: (r as { error?: unknown }).error }));
    },
  }),
];
