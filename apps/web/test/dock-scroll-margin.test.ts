import { afterEach, describe, expect, test } from "vitest";
import { DOCK_SCROLL_MARGIN, DOCK_SCROLL_THRESHOLD, setDockClearance } from "@/components/editor/scrollEdges";

describe("caret scroll room above the floating page tools", () => {
  afterEach(() => setDockClearance(0));

  test("without the bar, ProseMirror's own margin and no threshold", () => {
    expect(DOCK_SCROLL_MARGIN).toMatchObject({ top: 5, left: 5, right: 5, bottom: 5 });
    expect(DOCK_SCROLL_THRESHOLD.bottom).toBe(0);
  });

  test("with the bar, a caret under it counts as out of view and scrolls to just above it", () => {
    setDockClearance(84);
    expect(DOCK_SCROLL_THRESHOLD.bottom).toBe(84);
    expect(DOCK_SCROLL_MARGIN.bottom).toBe(89);
    expect(DOCK_SCROLL_MARGIN.top).toBe(5);
  });

  test("never negative", () => {
    setDockClearance(-20);
    expect(DOCK_SCROLL_THRESHOLD.bottom).toBe(0);
    expect(DOCK_SCROLL_MARGIN.bottom).toBe(5);
  });
});
