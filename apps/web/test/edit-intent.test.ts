import { describe, expect, test } from "vitest";
import { asksToChange, wantsAgent } from "@/components/ai/editIntent";

describe("requests to change the note", () => {
  test("fixes, reorganising and rewriting are changes to the note", () => {
    for (const t of [
      "Font hierarchy and section numbers are all messed up. Please fix.",
      "Fix the headings",
      "Renumber the sections",
      "clean up this note",
      "Can you reorganise this into clear sections?",
      "Make the headings consistent",
      "Shorten the intro",
      "rewrite this more clearly",
      "Remove the duplicate sections",
      "Turn this into a checklist",
      "The numbering is wrong, could you sort it out please",
    ]) expect(asksToChange(t), t).toBe(true);
  });

  test("questions, summaries and new writing are not", () => {
    for (const t of [
      "What did we decide about pricing?",
      "How do I fix the build?",
      "Summarize this note",
      "Write a friendly intro paragraph",
      "Who is mentioned, and why?",
      "Brainstorm names for the product",
      "Is the numbering wrong?",
      "",
    ]) expect(asksToChange(t), t).toBe(false);
  });
});

describe("which messages go to the agent", () => {
  test("changes and organising go to the agent; questions get the quick answer", () => {
    for (const t of ["Put my travel notes in a Travel folder", "Tag these notes as research", "Make a checklist from this note", "Create a note with the launch plan", "Merge these two notes", "Fix the headings"]) expect(wantsAgent(t), t).toBe(true);
    for (const t of ["What did we decide about pricing?", "Which notes mention the launch?", "Summarize my week", "Brainstorm names for the product"]) expect(wantsAgent(t), t).toBe(false);
  });
});
