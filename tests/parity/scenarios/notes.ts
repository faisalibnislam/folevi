// Notes: create one, rename it, change its icon; what the note, its title and the notes list then say.
import { NOTE_EMOJI } from "@folevi/editor-schema";
import { api } from "../../../convex/_generated/api";
import { scenario } from "../types";


export const scenarios = [
  scenario({
    name: "create and rename a note",
    async run(b, k) {
      const note = await k.newNote("note", { title: "First draft" });
      const created = await b.query(api.documents.get, { documentId: note });
      await k.update(note, { title: "Garden plans" });
      await k.update(note, { icon: NOTE_EMOJI[1]! });
      const renamed = await b.query(api.documents.get, { documentId: note });
      const titles = await b.query(api.documents.titles, { documentIds: [note] });
      const list = await b.query(api.documents.list, { scope: b.scope, view: "all", paginationOpts: { numItems: 100, cursor: null } });
      return { created, renamed, titles, inList: list.page.filter((d) => d.id === note) };
    },
  }),
  scenario({
    name: "a note made without an icon gets one of the note icons",
    async run(b, k) {
      const note = await k.newNote("note", { title: "No icon", icon: null });
      const got = await b.query(api.documents.get, { documentId: note });
      const icon = got?.document.icon ?? null;
      return { hasNoteIcon: icon !== null && (NOTE_EMOJI as readonly string[]).includes(icon) };
    },
  }),
  scenario({
    name: "a title is cleaned up the same way",
    async run(b, k) {
      const note = await k.newNote("note", { title: "  Spaces   and\ttabs  " });
      const a = await b.query(api.documents.get, { documentId: note });
      await k.update(note, { title: "Line\nbreak" });
      const c = await b.query(api.documents.get, { documentId: note });
      return { first: a?.document.title, second: c?.document.title };
    },
  }),
];
