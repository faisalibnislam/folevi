import { describe, expect, test } from "vitest";
import { NOTE_STYLE_COUNT, randomNoteCover } from "../src";

describe("randomNoteCover", () => {
  test("always picks one of the 40 note styles (never Plain)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = randomNoteCover();
      expect(c.kind).toBe("art");
      expect(c.value).toMatch(/^art-(0[1-9]|[1-3]\d|40)$/);
      seen.add(c.value!);
    }
    expect(seen.size).toBe(NOTE_STYLE_COUNT);
  });

  test("covers the edges of the range", () => {
    expect(randomNoteCover(() => 0).value).toBe("art-01");
    expect(randomNoteCover(() => 0.999999).value).toBe("art-40");
  });
});
