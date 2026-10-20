// Version history: saving versions, the list, a version's content, who changed what, naming, copying and
// restoring. Account mode names people, local mode names devices (one person owns a library): the person or
// device keys are shown here as <editor>, and only how many there are is compared.
import { api } from "../../../convex/_generated/api";
import { heading, para } from "../kit";
import { scenario, type ParityBackend } from "../types";

/** A block's revision now (an edit is sent on top of it, as the editor does). */
async function revisionOf(b: ParityBackend, documentId: string, blockId: string): Promise<number | null> {
  return (await b.query(api.blocks.list, { documentId }))?.blocks.find((x) => x.id === blockId)?.revision ?? null;
}

const tick = () => new Promise((r) => setTimeout(r, 3));

/** One editor in these scenarios: every person (or device) key reads <editor>. */
const editors = (list: [string, string, number][] | null) => list?.map(([id, , at]) => [id, "<editor>", at]) ?? null;

export const scenarios = [
  scenario({
    name: "versions: save, list, name and read one",
    async run(b, k) {
      const note = await k.newNote("note", { title: "Recipe" });
      const h = k.id("h");
      const p = k.id("p");
      await k.upsert(note, [heading(h, "Soup", "a1"), para(p, "Boil water", "a2")]);
      const first = await b.mutation(api.documents.createSnapshot, { documentId: note, reason: "manual" });
      // Nothing changed since: no new version, and a name names the one there is.
      const same = await b.mutation(api.documents.createSnapshot, { documentId: note, reason: "idle", name: "  First   draft " });
      await tick();
      await k.upsert(note, [para(p, "Boil salted water", "a2")], await revisionOf(b, note, p));
      await k.deleteBlock(note, h);
      const second = await b.mutation(api.documents.createSnapshot, { documentId: note, reason: "close" });
      const list = await b.query(api.documents.versions, { documentId: note });
      const named = await b.query(api.documents.versions, { documentId: note, namedOnly: true });
      await b.mutation(api.documents.nameVersion, { snapshotId: second.id!, name: "Second" });
      await b.mutation(api.documents.nameVersion, { snapshotId: first.id!, name: "" });
      const renamed = await b.query(api.documents.versions, { documentId: note });
      const content = await b.query(api.documents.snapshotContent, { snapshotId: first.id! });
      const later = await b.query(api.documents.snapshotContent, { snapshotId: second.id! });
      const missing = await b.query(api.documents.snapshotContent, { snapshotId: k.id("nope") });
      const nameMissing = await b.mutation(api.documents.nameVersion, { snapshotId: k.id("nope2"), name: "x" }).then(
        () => "ok",
        (e: { data?: { code?: string } }) => e.data?.code,
      );
      return {
        first: first.created,
        same: { created: same.created, sameId: same.id === first.id },
        second: second.created,
        // contentSeq counts saves differently by mode (the server's settle window); whether the latest version
        // holds the note as it is now is what the history panel reads.
        list: { upToDate: list.current.contentSeq === list.current.latestContentSeq, people: Object.keys(list.people).length, versions: list.versions.map((v) => ({ ...v, editors: v.editors.map(() => "<editor>") })) },
        named: named.versions.map((v) => ({ id: v.id, name: v.name, previousId: v.previousId })),
        renamed: renamed.versions.map((v) => v.name),
        content: content && { ...content, content: content.content && JSON.parse(content.content), authors: editors(content.authors), removed: editors(content.removed), people: Object.keys(content.people).length },
        later: later && { content: later.content && JSON.parse(later.content), authors: editors(later.authors), removed: editors(later.removed) },
        missing,
        nameMissing,
      };
    },
  }),
  scenario({
    name: "who changed what: block authors since a version",
    async run(b, k) {
      const note = await k.newNote("note", { title: "Shared list" });
      const p1 = k.id("p1");
      const p2 = k.id("p2");
      await k.upsert(note, [para(p1, "Milk", "a1"), para(p2, "Eggs", "a2")]);
      const v = await b.mutation(api.documents.createSnapshot, { documentId: note, reason: "manual" });
      await tick();
      await k.deleteBlock(note, p2);
      const now = await b.query(api.documents.blockAuthors, { documentId: note });
      const since = await b.query(api.documents.blockAuthors, { documentId: note, since: v.id! });
      return {
        now: { authors: editors(now.authors), removed: editors(now.removed), people: Object.keys(now.people).length },
        since: { authors: editors(since.authors), removed: editors(since.removed), people: Object.keys(since.people).length },
      };
    },
  }),
  scenario({
    name: "restore a version, undo the restore, and make a copy of a version",
    async run(b, k) {
      const note = await k.newNote("note", { title: "Essay" });
      const p1 = k.id("p1");
      const p2 = k.id("p2");
      await k.upsert(note, [para(p1, "Opening", "a1"), para(p2, "Middle", "a2")]);
      const v1 = await b.mutation(api.documents.createSnapshot, { documentId: note, reason: "manual", name: "Draft one" });
      await tick();
      const p3 = k.id("p3");
      await k.update(note, { title: "Essay, revised" });
      await k.upsert(note, [para(p1, "A better opening", "a1")], await revisionOf(b, note, p1));
      await k.upsert(note, [para(p3, "Ending", "a3")]);
      await k.deleteBlock(note, p2);
      await tick();
      const restored = await b.mutation(api.documents.restoreSnapshot, { snapshotId: v1.id! });
      const afterRestore = await b.query(api.blocks.list, { documentId: note });
      const doc = await b.query(api.documents.get, { documentId: note });
      const versions = await b.query(api.documents.versions, { documentId: note });
      await tick();
      // The version saved before the restore puts it back.
      const undone = await b.mutation(api.documents.restoreSnapshot, { snapshotId: restored.undoVersionId! });
      const afterUndo = await b.query(api.blocks.list, { documentId: note });
      const copy = await b.mutation(api.documents.copyVersion, { snapshotId: v1.id! });
      k.name(copy.id, "copy");
      const copyBlocks = await b.query(api.blocks.list, { documentId: copy.id });
      const blocks = (list: typeof afterRestore) => list?.blocks.map((x) => ({ id: x.id, text: x.text, rank: x.rank }));
      return {
        restored: { hasUndo: restored.undoVersionId !== null },
        afterRestore: blocks(afterRestore),
        title: doc?.document.title,
        reasons: versions.versions.map((v) => ({ reason: v.reason, name: v.name, title: v.title })),
        undone: { hasUndo: undone.undoVersionId !== null },
        afterUndo: blocks(afterUndo),
        copy: { ...copy, icon: copy.icon !== null },
        copyText: copyBlocks?.blocks.map((x) => ({ text: x.text, rank: x.rank, newId: x.id !== p1 && x.id !== p2 })),
      };
    },
  }),
];
