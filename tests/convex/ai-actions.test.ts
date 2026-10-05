import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { checkPlan } from "../../convex/lib/aiActions";
import { person, setup } from "./helpers";

describe("Ask AI changes", () => {
  test("a plan keeps only real folders, notes the model was shown, and folders made in the same plan", () => {
    const folders = [{ id: "f1", name: "Products" }];
    const notes = [{ id: "n1", title: "Involets" }];
    const plan = checkPlan(
      {
        actions: [
          { type: "createNote", title: "Formkit", markdown: "Forms", folderId: "f1" },
          { type: "createNote", title: "Idea", markdown: "x", folderName: "Ideas" },
          { type: "createFolder", name: "Ideas" },
          { type: "createFolder", name: "products" },
          { type: "moveNote", noteId: "n1", folderName: "products" },
          { type: "moveNote", noteId: "someone-elses", folderId: "f1" },
          { type: "createNote", title: "Lost", markdown: "x", folderId: "made-up" },
          { type: "deleteEverything" },
        ],
      },
      folders,
      notes,
    );
    expect(plan).toEqual([
      { type: "createFolder", name: "Ideas" },
      { type: "createNote", title: "Formkit", markdown: "Forms", folderId: "f1", folderName: "Products" },
      { type: "createNote", title: "Idea", markdown: "x", folderName: "Ideas" },
      { type: "moveNote", noteId: "n1", noteTitle: "Involets", folderId: "f1", folderName: "Products" },
    ]);
  });

  test("asked to write notes into a folder, Ask AI proposes it; applying makes the notes there", async () => {
    const t = setup();
    const a = await person(t, "ai-act@example.com");
    const { id: products } = await a.as.mutation(api.organization.createFolder, { scope: a.scope, name: "Products" });
    const trip = (await a.as.query(internal.ai.gather, { scope: a.scope, queries: ["coastal weekend"], limit: 5 })).find((n) => n.title === "Trip Sketch: Coastal Weekend")!;
    process.env.GEMINI_API_KEY = "test-key";
    const replies = [
      { queries: ["coastal weekend"], act: true },
      {
        reply: "I'll add Formkit to Products and move your trip note there.",
        actions: [
          { type: "createNote", title: "Formkit", markdown: "Free AI form builder.\n\n- Logic\n- Payments", folderId: products },
          { type: "moveNote", noteId: trip.id, folderId: products },
        ],
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(replies.shift()) }] }, finishReason: "STOP" }] }), { status: 200 })),
    );
    try {
      const result = await a.as.action(api.ai.ask, { scope: a.scope, question: "Create a note for Formkit in this folder and put my trip note here", folderId: products });
      expect(result.answer).toMatch(/Formkit/);
      expect(result.actions?.map((x) => x.type)).toEqual(["createNote", "moveNote"]);
      // Nothing has changed yet.
      expect((await a.as.query(api.documents.titles, { documentIds: [trip.id] }))[trip.id]).toBeTruthy();
      const applied = await a.as.mutation(api.aiActions.apply, { scope: a.scope, actions: result.actions! });
      expect(applied.notes.map((n) => n.title)).toEqual(["Formkit"]);
      expect(applied.moved).toBe(1);
      const blocks = (await a.as.query(api.blocks.list, { documentId: applied.notes[0]!.id }))!.blocks;
      expect(blocks.map((b) => b.type)).toEqual(["paragraph", "bulleted", "bulleted"]);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.GEMINI_API_KEY;
    }
  });

  test("applying checks everything again: someone else's note can't be moved, a missing folder is refused", async () => {
    const t = setup();
    const a = await person(t, "ai-act-a@example.com");
    const b = await person(t, "ai-act-b@example.com");
    const { id: folder } = await a.as.mutation(api.organization.createFolder, { scope: a.scope, name: "Mine" });
    const theirs = (await b.as.query(internal.ai.gather, { scope: b.scope, queries: ["coastal weekend"], limit: 5 }))[0]!;
    await expect(a.as.mutation(api.aiActions.apply, { scope: a.scope, actions: [{ type: "moveNote", noteId: theirs.id, noteTitle: "x", folderId: folder }] })).rejects.toThrow(/not found|can't|different/i);
    await expect(a.as.mutation(api.aiActions.apply, { scope: a.scope, actions: [{ type: "createNote", title: "x", markdown: "y", folderId: "nope" }] })).rejects.toThrow(/no longer there/);
  });
});
