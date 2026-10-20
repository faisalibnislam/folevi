import { describe, expect, test } from "vitest";
import { MAX_SAVE_BYTES, saveBytes, saveFileName, saveFilters, saveFromPage } from "./saveFile";

describe("saving a file the page made", () => {
  test("the name is only a suggestion: no folders, control characters or hidden names", () => {
    expect(saveFileName("Personal-folevi-export-2026-10-20.zip")).toBe("Personal-folevi-export-2026-10-20.zip");
    expect(saveFileName("../../etc/passwd")).toBe("-..-etc-passwd");
    expect(saveFileName(".hidden")).toBe("hidden");
    expect(saveFileName("a\u0000b:c")).toBe("a-b-c");
    expect(saveFileName(42)).toBe("Folevi file");
    expect(saveFileName("x".repeat(400))).toHaveLength(180);
  });

  test("only bytes of a sensible size are accepted", () => {
    expect(saveBytes(new Uint8Array([1, 2]))).toEqual(new Uint8Array([1, 2]));
    expect(saveBytes(new Uint8Array(0))).toBeNull();
    expect(saveBytes("text")).toBeNull();
    expect(saveBytes({ length: 3 })).toBeNull();
    expect(saveBytes({ byteLength: MAX_SAVE_BYTES + 1 } as unknown)).toBeNull();
  });

  test("the dialog offers the file's type", () => {
    expect(saveFilters("a.zip")).toEqual([{ name: "ZIP archive", extensions: ["zip"] }]);
    expect(saveFilters("noext")).toEqual([]);
  });

  test("written where the dialog says; nothing when cancelled or refused", async () => {
    const written: [string, Uint8Array][] = [];
    const write = async (p: string, b: Uint8Array) => void written.push([p, b]);
    const asked: string[] = [];
    const ok = await saveFromPage("Export.zip", new Uint8Array([9]), { folder: "/Users/me/Downloads", choose: async (o) => (asked.push(o.defaultPath), "/Users/me/Desktop/Export.zip"), write });
    expect(ok).toBe(true);
    expect(asked).toEqual(["/Users/me/Downloads/Export.zip"]);
    expect(written).toEqual([["/Users/me/Desktop/Export.zip", new Uint8Array([9])]]);
    expect(await saveFromPage("Export.zip", new Uint8Array([9]), { folder: "/d", choose: async () => null, write })).toBe(false);
    let shown = false;
    expect(await saveFromPage("Export.zip", "not bytes", { folder: "/d", choose: async () => ((shown = true), "/x"), write })).toBe(false);
    expect(shown).toBe(false);
    expect(written).toHaveLength(1);
  });
});
