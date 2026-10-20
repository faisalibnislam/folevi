// What the app reads about the platform: settings (the maintenance banner, built-in templates), note themes
// and the plan a note's theme picker offers, the person's team workspaces, and the clock.
import { api } from "../../../convex/_generated/api";
import { scenario } from "../types";

export const scenarios = [
  scenario({
    name: "settings: status and the built-in templates",
    // An account has the operators' minimum app version; a library is opened by the app that has it, so it
    // has none (local settings.ts).
    ignore: ["minShellVersion"],
    async run(b) {
      const status = await b.query(api.settings.status, {});
      const templates = await b.query(api.settings.builtInTemplates, {});
      const disabled = await b.query(api.settings.disabledBuiltInTemplates, {});
      return { status, templates, disabled };
    },
  }),
  scenario({
    name: "themes: the list, and the plan a note's picker offers",
    async run(b, k) {
      const note = await k.newNote("note", { title: "Themed" });
      const list = await b.query(api.themes.list, {});
      const plan = await b.query(api.themes.planForDocument, { documentId: note });
      const none = await b.query(api.themes.planForDocument, { documentId: "01JAAAAAAAAAAAAAAAAAAAAAAA" });
      return { list, plan, none };
    },
  }),
  scenario({
    name: "workspaces and the clock",
    async run(b) {
      const workspaces = await b.query(api.workspaces.mine, {});
      const before = Date.now();
      const now = await b.mutation(api.clock.now, {});
      return { workspaces, now, sane: typeof now === "number" && now >= before - 1000 && now <= Date.now() + 1000 };
    },
  }),
];
