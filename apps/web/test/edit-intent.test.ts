import { describe, expect, test } from "vitest";
import { asksToChange } from "@/components/ai/editIntent";

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
