// Search (convex/search.ts; local: lib/local/functions/search.ts over lib/local/search): which notes are found
// and in what order (title matches, then text matches best first, then notes with a matching tag), prefixes,
// several words, snippets, the filters, ⌘K's All places, and search by meaning being off in local mode.
//
// The words are made up ("quokka", "wombat") so nothing in the seeded notes is found. Within the text matches
// the note made first is also the better match: the account test backend (convex-test) returns search hits
// in the order rows were made, the real one and local mode by relevance, and this keeps both true.
import { ulid } from "@folevi/editor-schema";
import { api } from "../../../convex/_generated/api";
import { para, type Kit } from "../kit";
import { scenario, type ParityBackend } from "../types";

/** The parts of a result that matter, in order. */
function shown(results: { id: string; title: string; snippet: string; match: unknown; kind: string; archived: boolean; homeFolder: unknown; icon: string | null }[]) {
  return results.map((r) => ({ id: r.id, title: r.title, snippet: r.snippet, match: r.match, kind: r.kind, archived: r.archived, homeFolder: r.homeFolder, icon: r.icon }));
}

/** A moment, so edits made one after another have times of their own (lists order by them). */
export const tick = () => new Promise((resolve) => setTimeout(resolve, 3));

/** Four notes: one with the word in its title (made last), two with it in their text, one only tagged with it. */
async function quokkaNotes(b: ParityBackend, k: Kit) {
  const weekend = await k.newNote("weekend", { title: "Weekend plans" });
  await k.upsert(weekend, [para(ulid(), "The quokka visit is on Saturday morning. Bring the quokka guide and a hat.", "V"), para(ulid(), "Lunch after.", "W")]);
  await tick();
  const groceries = await k.newNote("groceries", { title: "Groceries" });
  await k.upsert(groceries, [para(ulid(), "Apples, bread, and snacks for the long drive to see the quokka colony on the island.", "V")]);
  await tick();
  const zoo = await k.newNote("zoo", { title: "Zoo trip" });
  await k.upsert(zoo, [para(ulid(), "Tickets are booked.", "V")]);
  const tag = k.name((await b.mutation(api.organization.createTag, { scope: b.scope, name: "quokkaland", color: "moss" })).id, "tag");
  await b.mutation(api.organization.setDocumentTags, { documentId: zoo, tagIds: [tag] });
  await tick();
  const facts = await k.newNote("facts", { title: "Quokka facts" });
  await k.upsert(facts, [para(ulid(), "Small marsupials that seem to smile.", "V")]);
  return { weekend, groceries, zoo, facts, tag };
}

export const scenarios = [
  scenario({
    name: "search: titles first, then text best first, then tags, with snippets",
    async run(b, k) {
      await quokkaNotes(b, k);
      const all = await b.query(api.search.documents, { scope: b.scope, query: "quokka" });
      const prefix = await b.query(api.search.documents, { scope: b.scope, query: "quok" });
      const twoWords = await b.query(api.search.documents, { scope: b.scope, query: "quokka saturday" });
      const upper = await b.query(api.search.documents, { scope: b.scope, query: "QUOKKA" });
      const none = await b.query(api.search.documents, { scope: b.scope, query: "wombatish" });
      const blank = await b.query(api.search.documents, { scope: b.scope, query: "   " });
      return { all: shown(all), prefix: shown(prefix).map((r) => r.id), twoWords: shown(twoWords).map((r) => r.id), upper: shown(upper).map((r) => r.id), none, blank };
    },
  }),
  scenario({
    name: "search: filters (folder, tag, archived, limit) and edits found at once",
    async run(b, k) {
      const { weekend, groceries, tag } = await quokkaNotes(b, k);
      const folder = k.name((await b.mutation(api.organization.createFolder, { scope: b.scope, name: "Trips" })).id, "folder");
      // A new folder gets a random colour.
      await b.mutation(api.organization.setFolderColor, { folderId: folder, color: "olive" });
      await k.update(groceries, { folderId: folder });
      const inFolder = await b.query(api.search.documents, { scope: b.scope, query: "quokka", folderId: folder });
      const byTag = await b.query(api.search.documents, { scope: b.scope, query: "quokka", tagId: tag });
      const limited = await b.query(api.search.documents, { scope: b.scope, query: "quokka", limit: 2 });
      await b.mutation(api.documents.setArchived, { documentId: weekend, archived: true });
      const withoutArchived = await b.query(api.search.documents, { scope: b.scope, query: "quokka" });
      const withArchived = await b.query(api.search.documents, { scope: b.scope, query: "quokka", includeArchived: true });
      // An edit is found by the next search, and the old words aren't.
      await k.update(groceries, { title: "Wombat errands" });
      const renamed = await b.query(api.search.documents, { scope: b.scope, query: "wombat" });
      await b.mutation(api.documents.moveToTrash, { documentId: groceries });
      const trashed = await b.query(api.search.documents, { scope: b.scope, query: "wombat" });
      const ids = (rs: { id: string }[]) => rs.map((r) => r.id);
      return {
        inFolder: shown(inFolder),
        byTag: ids(byTag),
        limited: ids(limited),
        withoutArchived: ids(withoutArchived),
        withArchived: shown(withArchived).map((r) => ({ id: r.id, archived: r.archived })),
        renamed: shown(renamed),
        trashed,
      };
    },
  }),
  scenario({
    name: "search: All places (one place here) and search by meaning",
    // Account mode decides by the plan whether a place has search by meaning (a free Personal doesn't);
    // local mode never has it.
    async run(b, k) {
      await quokkaNotes(b, k);
      const everywhere = await b.query(api.search.everywhere, { query: "quokka", limit: 3 });
      const empty = await b.query(api.search.everywhere, { query: " " });
      const meaning = await b.query(api.search.meaningAvailable, { scope: b.scope });
      return { everywhere: everywhere.map((r) => ({ id: r.id, title: r.title, place: r.place, snippet: r.snippet })), empty, meaning };
    },
  }),
];
