// WP7-pre (docs/LOCAL_MODE_PLAN.md 2.5): convex/lib re-exports the pure logic shared with the local
// backend, unchanged. The server's functions are the shared ones, and a reply that can't be used is still
// the server's own error.
import { describe, expect, test } from "vitest";
import { ConvexError } from "convex/values";
import * as prompts from "@folevi/ai-prompts";
import * as schema from "@folevi/editor-schema";
import { finishWriting, writingRequest } from "../../../convex/lib/ai/writing";
import { finishTool } from "../../../convex/lib/ai/studyTools";
import { buildPreview, newDocumentRank, sanitizeTitle } from "../../../convex/lib/documents";
import { cloneBlocks, specsToWireBlocks } from "../../../convex/lib/create";
import { BUILT_IN_TEMPLATES } from "../../../convex/lib/templates";
import { nextSchedule, studyKindOf } from "../../../convex/lib/study";
import { parseIcs } from "../../../convex/lib/icsParse";
import { buildCalendar } from "../../../convex/lib/ical";
import { parseMapReply } from "../../../convex/lib/mindmapAi";
import { parseChartPatch } from "../../../convex/lib/chartAi";

describe("shared logic", () => {
  test("the server runs the shared functions", () => {
    expect(buildPreview).toBe(schema.buildPreview);
    expect(sanitizeTitle).toBe(schema.sanitizeTitle);
    expect(newDocumentRank).toBe(schema.newDocumentRank);
    expect(specsToWireBlocks).toBe(schema.specsToWireBlocks);
    expect(cloneBlocks).toBe(schema.cloneBlocks);
    expect(BUILT_IN_TEMPLATES).toBe(schema.BUILT_IN_TEMPLATES);
    expect(studyKindOf).toBe(schema.studyKindOf);
    expect(nextSchedule).toBe(schema.nextSchedule);
    expect(parseIcs).toBe(schema.parseIcs);
    expect(buildCalendar).toBe(schema.buildCalendar);
    expect(parseMapReply).toBe(prompts.mindmapAi.parseMapReply);
    expect(parseChartPatch).toBe(prompts.chartAi.parseChartPatch);
  });

  test("a reply that can't be used is the server's error, with the same code and message", () => {
    const caught = (run: () => unknown) => {
      try {
        run();
      } catch (e) {
        return e;
      }
      return null;
    };
    for (const e of [caught(() => finishWriting("mindMap", "No list at all")), caught(() => finishTool("quiz", "{}", ""))]) {
      expect(e).toBeInstanceOf(ConvexError);
      expect((e as ConvexError<{ code: string; message: string }>).data.code).toBe("invalid_argument");
    }
    expect((caught(() => finishWriting("flashcards", "[]")) as ConvexError<{ message: string }>).data.message).toBe("The AI couldn't make flashcards from that. Try again, or pick more text.");
    // Anything else goes through as it is.
    expect(finishWriting("title", "# Plan")).toEqual({ text: "Plan" });
  });

  test("a writing request is the shared one", () => {
    const input = { task: "summarize" as const, note: { title: "T", text: "Body" }, text: "", instruction: "" };
    expect(writingRequest(input, true)).toEqual(prompts.writing.writingRequest(input, true));
  });
});
