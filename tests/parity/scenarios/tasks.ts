// Tasks: to-dos as the task views, the calendar and Quick Add see them, repeating ones coming back when
// they're checked off, and tasks moving between notes (convex/tasks.ts, lib/local/functions/tasks.ts).
//
// Every note starts with the welcome content's to-dos, so the views are read for the scenario's own notes
// (`mine`), and the counts (which include the welcome to-dos, the same in both modes) are compared whole.
// Dates are fixed, far from today, except where the server reads the clock (a repeat's next date).
import { SCHEMA_VERSION, addDays, localDate, type WireBlock } from "@folevi/editor-schema";
import { api } from "../../../convex/_generated/api";
import { todo } from "../kit";
import { scenario, type ParityBackend } from "../types";

const TODAY = "2031-03-12";
const T0 = 1_900_000_000_000;

/** A to-do with props of its own. */
function task(id: string, text: string, rank: string, props: Record<string, unknown>): WireBlock {
  return { ...todo(id, text, rank), props: { checked: false, ...props } };
}

/** What a call refused with: its code and words. */
async function refusal(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { data?: unknown }).data ?? String(e);
  }
}

type Task = { documentId: string; title: string; dueDate: string | null };
const only = (ids: string[]) => (list: readonly Task[]) => list.filter((t) => ids.includes(t.documentId));

async function views(b: ParityBackend, mine: (list: readonly Task[]) => Task[], today = TODAY) {
  const out: Record<string, unknown> = {};
  for (const view of ["inbox", "today", "upcoming", "all", "completed", "mine"] as const) out[view] = mine(await b.query(api.tasks.list, { scope: b.scope, view, today }));
  return out;
}

export const scenarios = [
  scenario({
    name: "tasks: each view, the counts and the calendar range",
    async run(b, k) {
      const note = await k.newNote("note", { title: "Garden" });
      await k.upsert(note, [
        task(k.id("inbox"), "Buy seeds", "a1", {}),
        task(k.id("overdue"), "Prune the roses", "a2", { dueDate: addDays(TODAY, -3), priority: "low" }),
        task(k.id("today"), "Water the beds", "a3", { dueDate: TODAY, dueTime: "08:30", priority: "high", reminderAt: T0 }),
        task(k.id("soon"), "Order compost", "a4", { dueDate: addDays(TODAY, 2), priority: "medium" }),
        task(k.id("later"), "Plant bulbs", "a5", { dueDate: addDays(TODAY, 40) }),
        task(k.id("done"), "Mend the fence", "a6", { checked: true, completedAt: T0 + 2000, dueDate: addDays(TODAY, -1) }),
        task(k.id("canceled"), "Paint the shed", "a7", { canceled: true, completedAt: T0 + 1000 }),
      ]);
      const mine = only([note]);
      const counts = await b.query(api.tasks.counts, { scope: b.scope, today: TODAY });
      const range = mine(await b.query(api.tasks.range, { scope: b.scope, from: addDays(TODAY, -5), to: addDays(TODAY, 5) }));
      const withDone = mine(await b.query(api.tasks.range, { scope: b.scope, from: addDays(TODAY, -5), to: addDays(TODAY, 5), includeCompleted: true }));
      // A note in Trash takes its tasks out of every view.
      await b.mutation(api.documents.moveToTrash, { documentId: note });
      const trashed = { counts: await b.query(api.tasks.counts, { scope: b.scope, today: TODAY }), all: mine(await b.query(api.tasks.list, { scope: b.scope, view: "all", today: TODAY })) };
      await b.mutation(api.documents.restoreFromTrash, { documentId: note });
      return { views: await views(b, mine), counts, range, withDone, trashed, badDate: await refusal(b.query(api.tasks.list, { scope: b.scope, view: "all", today: "March 12" })) };
    },
  }),
  scenario({
    name: "tasks: changing one from a task list (done, canceled, dates, priority, reminder)",
    async run(b, k) {
      const note = await k.newNote("note", { title: "Errands" });
      const id = k.id("task");
      await k.upsert(note, [task(id, "Post the parcel", "a1", { dueDate: TODAY })]);
      const mine = only([note]);
      const steps: Record<string, unknown> = {};
      const step = async (name: string, args: Omit<Parameters<typeof b.mutation<typeof api.tasks.update>>[1], "blockId">) => {
        const result = await b.mutation(api.tasks.update, { blockId: id, ...args });
        steps[name] = { result, all: mine(await b.query(api.tasks.list, { scope: b.scope, view: "all", today: TODAY })), completed: mine(await b.query(api.tasks.list, { scope: b.scope, view: "completed", today: TODAY })) };
      };
      await step("time", { dueTime: "17:45", priority: "high", reminderAt: T0 });
      await step("moved", { dueDate: addDays(TODAY, 1) });
      await step("done", { checked: true });
      await step("reopened", { checked: false });
      await step("canceled", { canceled: true });
      await step("uncanceled", { canceled: false, priority: "none", reminderAt: null });
      await step("undated", { dueDate: null });
      const blocks = (await b.query(api.blocks.list, { documentId: note }))?.blocks;
      return {
        steps,
        blocks,
        badTime: await refusal(b.mutation(api.tasks.update, { blockId: id, dueTime: "5pm" })),
        badDate: await refusal(b.mutation(api.tasks.update, { blockId: id, dueDate: "tomorrow" })),
        missing: await refusal(b.mutation(api.tasks.update, { blockId: k.id("nothing"), checked: true })),
      };
    },
  }),
  scenario({
    name: "tasks: Quick Add with dates, a priority and a repeat, into the Inbox or a note",
    async run(b, k) {
      const note = await k.newNote("note", { title: "Work" });
      const first = await b.mutation(api.tasks.quickAdd, { scope: b.scope, title: "  Call the dentist  ", today: TODAY, dueDate: addDays(TODAY, 1), dueTime: "09:15", priority: "high" });
      const inbox = k.name(first.documentId, "inbox");
      const second = await b.mutation(api.tasks.quickAdd, { scope: b.scope, title: "Renew the passport", today: TODAY, dueTime: "10:00" });
      const third = await b.mutation(api.tasks.quickAdd, {
        scope: b.scope,
        title: "Send the weekly report",
        today: TODAY,
        dueDate: addDays(TODAY, 3),
        priority: "none",
        documentId: note,
        repeat: { repeat: "weekly", repeatEvery: 2, repeatDays: "1,5" },
      });
      // The Inbox page is the same one each time, and Save to Folevi files after its last line.
      const again = await b.mutation(api.tasks.inbox, { scope: b.scope });
      const mine = only([note, inbox]);
      const inboxNote = await b.query(api.documents.get, { documentId: inbox });
      return {
        first,
        second,
        third,
        again,
        inboxNote: inboxNote && { title: inboxNote.title, icon: inboxNote.icon },
        inboxBlocks: (await b.query(api.blocks.list, { documentId: inbox }))?.blocks,
        noteBlocks: (await b.query(api.blocks.list, { documentId: note }))?.blocks,
        views: await views(b, mine),
        counts: await b.query(api.tasks.counts, { scope: b.scope, today: TODAY }),
        empty: await refusal(b.mutation(api.tasks.quickAdd, { scope: b.scope, title: "   ", today: TODAY })),
        nowhere: await refusal(b.mutation(api.tasks.quickAdd, { scope: b.scope, title: "Lost", today: TODAY, documentId: k.id("gone") })),
      };
    },
  }),
  scenario({
    name: "tasks: the Inbox comes back from Trash",
    async run(b, k) {
      const made = await b.mutation(api.tasks.inbox, { scope: b.scope });
      const inbox = k.name(made.documentId, "inbox");
      await b.mutation(api.tasks.quickAdd, { scope: b.scope, title: "Book a table", today: TODAY });
      await b.mutation(api.documents.moveToTrash, { documentId: inbox });
      const back = await b.mutation(api.tasks.quickAdd, { scope: b.scope, title: "Buy flowers", today: TODAY });
      const doc = await b.query(api.documents.get, { documentId: inbox });
      // Undated tasks list newest edit first, to the millisecond: compared by title.
      const listed = only([inbox])(await b.query(api.tasks.list, { scope: b.scope, view: "inbox", today: TODAY })).sort((x, y) => (x.title < y.title ? -1 : 1));
      return { made, back, inTrash: doc ? doc.deletedAt !== null : null, inbox: listed };
    },
  }),
  scenario({
    name: "tasks: a repeating to-do checked off comes back at its next date, its reminder moved with it",
    async run(b, k) {
      const today = localDate(Date.now(), "UTC");
      const note = await k.newNote("note", { title: "Home" });
      const weekly = k.id("weekly");
      const daily = k.id("daily");
      const once = k.id("once");
      const reminderAt = Date.parse(`${today}T08:00:00Z`);
      await k.upsert(note, [
        task(weekly, "Water the plants", "a1", { dueDate: today, repeat: "weekly", reminderAt }),
        task(daily, "Stretch", "a2", { repeat: "daily" }),
        task(once, "Fix the tap", "a3", { dueDate: addDays(today, 1) }),
      ]);
      const mine = only([note]);
      const before = mine(await b.query(api.tasks.list, { scope: b.scope, view: "all", today }));
      // Checked off from a task list, from the editor (sync.push), and one that doesn't repeat.
      const fromList = await b.mutation(api.tasks.update, { blockId: weekly, checked: true });
      const list = await b.query(api.blocks.list, { documentId: note });
      const row = list!.blocks.find((x) => x.id === daily)!;
      await k.upsert(note, [{ ...row, props: { ...row.props, checked: true, completedAt: Date.now() } }], row.revision ?? null);
      await b.mutation(api.tasks.update, { blockId: once, checked: true });
      await b.settle();
      const blocks = (await b.query(api.blocks.list, { documentId: note }))?.blocks;
      const props = (id: string) => blocks?.find((x) => x.id === id)?.props;
      const nextWeek = addDays(today, 7);
      return {
        before,
        fromList: { before: fromList.before },
        weekly: props(weekly),
        weeklyMoved: { dueDate: props(weekly)?.dueDate === nextWeek, reminder: props(weekly)?.reminderAt === reminderAt + 7 * 86_400_000 },
        daily: props(daily),
        dailyNext: props(daily)?.dueDate === addDays(today, 1),
        once: props(once),
        all: mine(await b.query(api.tasks.list, { scope: b.scope, view: "all", today })),
        completed: mine(await b.query(api.tasks.list, { scope: b.scope, view: "completed", today })),
        upcoming: mine(await b.query(api.tasks.list, { scope: b.scope, view: "upcoming", today })),
      };
    },
  }),
  scenario({
    name: "tasks: a task moves to another note or to the Inbox, alone",
    async run(b, k) {
      const from = await k.newNote("from", { title: "Meeting notes" });
      const to = await k.newNote("to", { title: "Follow-ups" });
      const t = k.id("task");
      const child = k.id("child");
      const keep = k.id("keep");
      const nested = k.id("nested");
      await k.upsert(from, [
        task(t, "Email the minutes", "a1", { dueDate: TODAY, priority: "medium" }),
        task(keep, "Book the next room", "a2", {}),
        task(nested, "Plan the offsite", "a3", {}),
        { id: child, type: "paragraph", parentId: nested, rank: "a1", schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text: "Ask about the dates first" }], props: {} },
      ]);
      await k.upsert(to, [task(k.id("existing"), "Chase the budget", "a1", {})]);
      const moved = await b.mutation(api.tasks.moveToDocument, { blockId: t, documentId: to });
      const movedId = k.name(moved.blockId, "moved");
      const same = await b.mutation(api.tasks.moveToDocument, { blockId: movedId, documentId: to });
      const toInbox = await b.mutation(api.tasks.moveToDocument, { blockId: keep });
      k.name(toInbox.blockId, "inInbox");
      const made = await b.mutation(api.tasks.inbox, { scope: b.scope });
      const inbox = k.name(made.documentId, "inbox");
      const blocks = async (id: string) => (await b.query(api.blocks.list, { documentId: id }))?.blocks;
      return {
        same,
        from: await blocks(from),
        to: await blocks(to),
        inbox: await blocks(inbox),
        // Undated tasks list newest edit first, to the millisecond: they're compared by title.
        all: only([from, to, inbox])(await b.query(api.tasks.list, { scope: b.scope, view: "all", today: TODAY })).sort((x, y) => (x.dueDate ?? "").localeCompare(y.dueDate ?? "") || x.title.localeCompare(y.title)),
        gone: await refusal(b.mutation(api.tasks.moveToDocument, { blockId: t, documentId: to })),
        // A task with lines inside it stays where it is (the move would leave them behind).
        withLines: await refusal(b.mutation(api.tasks.moveToDocument, { blockId: nested, documentId: to })),
        notATask: await refusal(b.mutation(api.tasks.moveToDocument, { blockId: child, documentId: to })),
        nowhere: await refusal(b.mutation(api.tasks.moveToDocument, { blockId: movedId, documentId: k.id("missing") })),
      };
    },
  }),
];
