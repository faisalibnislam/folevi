// Blocks: typing into a note goes through sync.push (block.upsert, block.delete), as the editor sends it.
import { api } from "../../../convex/_generated/api";
import { heading, para, todo } from "../kit";
import { scenario } from "../types";

const PENDING = "WP7a: sync.push, blocks.list";

export const scenarios = [
  scenario({
    name: "type blocks through sync.push",
    localPending: PENDING,
    async run(b, k) {
      const note = await k.newNote("note", { title: "Shopping" });
      const h = k.id("heading");
      const p1 = k.id("p1");
      const p2 = k.id("p2");
      const t = k.id("todo");
      const first = await k.upsert(note, [heading(h, "This week", "a1"), para(p1, "Apples", "a2"), para(p2, "Pears", "a3"), todo(t, "Call the grocer", "a4")]);
      const afterTyping = await b.query(api.blocks.list, { documentId: note });
      // Edit a paragraph on top of the revision it was read at, then delete another.
      const revOf = (list: typeof afterTyping, id: string) => list?.blocks.find((x) => x.id === id)?.revision ?? null;
      const edit = await k.upsert(note, [para(p1, "Apples and plums", "a2")], revOf(afterTyping, p1));
      const del = await k.deleteBlock(note, p2, revOf(afterTyping, p2));
      const afterEdits = await b.query(api.blocks.list, { documentId: note });
      // The same op sent again (its answer was lost) is a duplicate, not a second change.
      const replayOp = { opId: k.id("replay"), kind: "block.upsert" as const, documentId: note, block: todo(t, "Call the grocer", "a4", true), baseRevision: revOf(afterEdits, t), fields: ["content" as const] };
      const [once] = await k.push([replayOp]);
      const [twice] = await k.push([replayOp]);
      const finalBlocks = await b.query(api.blocks.list, { documentId: note });
      return { first, afterTyping, edit, del, afterEdits, replay: { once: once?.status, twice: twice?.status }, finalBlocks };
    },
  }),
  scenario({
    name: "nested blocks keep their parent and order",
    localPending: PENDING,
    async run(b, k) {
      const note = await k.newNote("note", { title: "Outline" });
      const top = k.id("top");
      const child1 = k.id("child1");
      const child2 = k.id("child2");
      await k.upsert(note, [para(top, "Top", "a1"), para(child2, "Second", "a3", top), para(child1, "First", "a2", top)]);
      const list = await b.query(api.blocks.list, { documentId: note });
      // Move the second child to the top level, before everything.
      await k.upsert(note, [para(child2, "Second", "Zz", null)]);
      const moved = await b.query(api.blocks.list, { documentId: note });
      return { list: list?.blocks, moved: moved?.blocks };
    },
  }),
  scenario({
    name: "an edit on top of an old revision is a conflict",
    accountOnly: "local mode applies it and keeps the overwritten text in version history (plan §2.3)",
    async run(b, k) {
      const note = await k.newNote("note", { title: "Draft" });
      const p = k.id("p");
      const [made] = await k.upsert(note, [para(p, "Apples", "a1")]);
      await k.upsert(note, [para(p, "Apples and plums", "a1")], made!.revision ?? null);
      const [stale] = await k.push([{ opId: k.id("stale"), kind: "block.upsert", documentId: note, block: para(p, "Just apples", "a1"), baseRevision: made!.revision ?? null, fields: ["content"] }]);
      return { stale, blocks: (await b.query(api.blocks.list, { documentId: note }))?.blocks };
    },
  }),
];
