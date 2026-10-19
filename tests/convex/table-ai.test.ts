// Foli AI for tables (convex/tableAi.ts, lib/tableAi.ts): every reply is checked before it's returned (a table
// within the block's limits, a formula that works in the table), the usual gates and credits apply, and the
// table goes to Gemini as data.
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { cleanRows, parseExplainReply, parseFormulaReply, parseTableReply, tableForPrompt } from "../../convex/lib/tableAi";
import { person, setup } from "./helpers";

const TABLE = { rows: [["Item", "Price", "Qty", "Total"], ["Apples", "1.5", "4", "=Price * Qty"], ["Pears", "2", "3", ""]], headerRow: true };

function gemini(reply: unknown, prompts: string[] = []) {
  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    prompts.push(init.body);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: typeof reply === "string" ? reply : JSON.stringify(reply) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 } }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GEMINI_API_KEY;
});

describe("the reply checks", () => {
  test("tables are text cells within the limits, every row as long as the longest", () => {
    expect(cleanRows([["a", 1, true], ["b"]])).toEqual([["a", "1", "TRUE"], ["b", "", ""]]);
    expect(cleanRows("nope")).toBeNull();
    expect(cleanRows([])).toBeNull();
    const big = cleanRows(Array.from({ length: 300 }, () => Array.from({ length: 30 }, () => "x".repeat(2000))))!;
    expect(big.length).toBe(200);
    expect(big[0]!.length).toBe(20);
    expect(big[0]![0]!.length).toBe(1000);
    expect(parseTableReply('```json\n{"rows":[["a","b"]],"summary":"Added b"}\n```')).toEqual({ rows: [["a", "b"]], summary: "Added b" });
    expect(parseTableReply("I can't")).toBeNull();
  });
  test("a formula must read and work in the table", () => {
    const t = { rows: TABLE.rows, headerRow: true, totalsRow: false };
    expect(parseFormulaReply('{"formula":"=Price*Qty","explanation":"Price times quantity"}', t, 2, 3)).toEqual({ formula: "=Price*Qty", explanation: "Price times quantity" });
    expect(parseFormulaReply('{"formula":"SUM(B:B)"}', t, 2, 3)?.formula).toBe("=SUM(B:B)");
    expect(parseFormulaReply('{"formula":"=NOPE(B2)"}', t, 2, 3)).toBeNull();
    expect(parseFormulaReply('{"formula":"=SUM(D:D)"}', t, 2, 3)).toBeNull();
    expect(parseFormulaReply('{"formula":"=SUM((B2"}', t, 2, 3)).toBeNull();
  });
  test("explanations are short and capped", () => {
    expect(parseExplainReply(JSON.stringify({ summary: "Two fruits.", points: ["- Apples cost less", "2. Pears", "", ...Array.from({ length: 9 }, (_, i) => `p${i}`)] }))).toEqual({ summary: "Two fruits.", points: ["Apples cost less", "Pears", "p0", "p1", "p2"] });
    expect(parseExplainReply("{}")).toBeNull();
  });
  test("the prompt carries formulas' results", () => {
    const prompt = tableForPrompt({ rows: TABLE.rows, headerRow: true, totalsRow: false });
    expect(JSON.parse(prompt).results[1][3]).toBe("6");
  });
});

describe("tableAi actions", () => {
  test("edit, clean, formula and explain return checked replies; the gates apply", async () => {
    const t = setup();
    const a = await person(t, "table-ai@example.com");
    process.env.GEMINI_API_KEY = "test-key";
    const prompts: string[] = [];
    gemini({ rows: [["Item", "Price"], ["Apples", "1.5"]], summary: "Removed two columns." }, prompts);
    const edited = await a.as.action(api.tableAi.edit, { scope: a.scope, table: TABLE, instruction: "Keep only item and price" });
    expect(edited).toEqual({ rows: [["Item", "Price"], ["Apples", "1.5"]], summary: "Removed two columns." });
    // The table goes as data, wrapped, with what formulas show.
    expect(prompts[0]).toContain("untrusted_note");
    expect(prompts[0]).toContain("Price * Qty");

    gemini({ rows: [["Item", "Price"], ["Apples", "1.50"]], summary: "Fixed a format." });
    expect((await a.as.action(api.tableAi.clean, { scope: a.scope, table: TABLE })).summary).toBe("Fixed a format.");

    gemini({ formula: "=Price * Qty", explanation: "Price times quantity." });
    expect(await a.as.action(api.tableAi.formula, { scope: a.scope, table: TABLE, instruction: "total", row: 2, column: 3 })).toEqual({ formula: "=Price * Qty", explanation: "Price times quantity." });
    gemini({ formula: "=MYSTERY()" });
    await expect(a.as.action(api.tableAi.formula, { scope: a.scope, table: TABLE, instruction: "total", row: 2, column: 3 })).rejects.toThrow(/working formula/);
    await expect(a.as.action(api.tableAi.formula, { scope: a.scope, table: TABLE, instruction: "total", row: 9, column: 3 })).rejects.toThrow(/cell/);

    gemini({ summary: "Two fruits.", points: ["Apples sell more."] });
    expect(await a.as.action(api.tableAi.explain, { scope: a.scope, table: TABLE })).toEqual({ summary: "Two fruits.", points: ["Apples sell more."] });

    gemini("not json");
    await expect(a.as.action(api.tableAi.edit, { scope: a.scope, table: TABLE, instruction: "x" })).rejects.toThrow(/couldn't change/);
    await expect(a.as.action(api.tableAi.edit, { scope: a.scope, table: TABLE, instruction: "  " })).rejects.toThrow(/Say how/);
    await expect(a.as.action(api.tableAi.explain, { scope: a.scope, table: { rows: [["", ""]], headerRow: true } })).rejects.toThrow(/empty/);

    // Turned off in settings: refused before anything is sent.
    await a.as.mutation(api.users.updateProfile, { aiEnabled: false });
    const fetchMock = gemini({ summary: "x" });
    await expect(a.as.action(api.tableAi.explain, { scope: a.scope, table: TABLE })).rejects.toThrow(/turned off/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
