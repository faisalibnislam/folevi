// Home's Recent (notes opened) and Recent notes (notes edited, minus the ones removed from the list).
import { api } from "../../../convex/_generated/api";
import { para } from "../kit";
import { scenario } from "../types";

const tick = () => new Promise((r) => setTimeout(r, 3));

export const scenarios = [
  scenario({
    name: "recent: opening notes puts them in Recent, newest first",
    async run(b, k) {
      const a = await k.newNote("a", { title: "Opened first" });
      const c = await k.newNote("c", { title: "Opened second" });
      const t = await k.newNote("t", { title: "Opened, then trashed" });
      const before = await b.query(api.documents.recent, { scope: b.scope });
      await b.mutation(api.documents.recordView, { documentId: a });
      await tick();
      await b.mutation(api.documents.recordView, { documentId: c });
      await tick();
      await b.mutation(api.documents.recordView, { documentId: t });
      // Opening one again straight away doesn't move it.
      await b.mutation(api.documents.recordView, { documentId: a });
      const missing = await b.mutation(api.documents.recordView, { documentId: k.id("missing") });
      await b.mutation(api.documents.moveToTrash, { documentId: t });
      const recent = await b.query(api.documents.recent, { scope: b.scope });
      const two = await b.query(api.documents.recent, { scope: b.scope, limit: 1 });
      return { before, recent: recent.map((d) => ({ id: d.id, title: d.title, homeFolder: d.homeFolder })), two: two.map((d) => d.id), missing };
    },
  }),
  scenario({
    name: "recent notes: edited first, removed until edited or opened again",
    async run(b, k) {
      const a = await k.newNote("a", { title: "Alpha" });
      await tick();
      const c = await k.newNote("c", { title: "Gamma" });
      await tick();
      const nested = await k.newNote("nested", { title: "Nested", parent: a });
      const mine = new Set([a, c, nested]);
      const pick = (list: { id: string; title: string }[]) => list.filter((d) => mine.has(d.id)).map((d) => d.title);
      const first = pick(await b.query(api.documents.recentNotes, { scope: b.scope }));
      const hidden = await b.mutation(api.documents.hideFromRecent, { documentIds: [a, a, k.id("missing")] });
      const afterHide = pick(await b.query(api.documents.recentNotes, { scope: b.scope }));
      await tick();
      // An edit after it was removed brings it back.
      await k.upsert(a, [para(k.id("p"), "edited", "a1")]);
      const afterEdit = pick(await b.query(api.documents.recentNotes, { scope: b.scope }));
      await b.mutation(api.documents.hideFromRecent, { documentIds: [c] });
      const hiddenAgain = pick(await b.query(api.documents.recentNotes, { scope: b.scope }));
      await b.mutation(api.documents.showInRecent, { documentIds: [c] });
      const shown = pick(await b.query(api.documents.recentNotes, { scope: b.scope }));
      // Opening a removed note brings it back too.
      await b.mutation(api.documents.hideFromRecent, { documentIds: [c] });
      await b.mutation(api.documents.recordView, { documentId: c });
      const opened = pick(await b.query(api.documents.recentNotes, { scope: b.scope }));
      const limited = (await b.query(api.documents.recentNotes, { scope: b.scope, limit: 2 })).length;
      const tooMany = await b.mutation(api.documents.hideFromRecent, { documentIds: Array.from({ length: 51 }, (_, i) => `x${i}`) }).then(
        () => "ok",
        (e: { data?: { code?: string } }) => e.data?.code,
      );
      return { first, hidden, afterHide, afterEdit, hiddenAgain, shown, opened, limited, tooMany };
    },
  }),
];
