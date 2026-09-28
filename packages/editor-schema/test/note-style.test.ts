import { describe, expect, test } from "vitest";
import { NOTE_STYLE_COUNT, randomNoteCover } from "../src";

describe("randomNoteCover", () => {
  test("always picks one of the note styles (never Plain)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = randomNoteCover();
      expect(c.kind).toBe("art");
      expect(c.value).toMatch(/^art-\d{2}$/);
      const n = Number(c.value!.slice(4));
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(NOTE_STYLE_COUNT);
      seen.add(c.value!);
    }
    expect(seen.size).toBe(NOTE_STYLE_COUNT);
  });

  test("covers the edges of the range", () => {
    expect(randomNoteCover(() => 0).value).toBe("art-01");
    expect(randomNoteCover(() => 0.999999).value).toBe(`art-${String(NOTE_STYLE_COUNT).padStart(2, "0")}`);
  });
});
