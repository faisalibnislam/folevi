import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { setup } from "./helpers";

// folevi.com's template gallery hides built-in templates an admin switched off; it asks without signing in.
describe("settings.disabledBuiltInTemplates", () => {
  test("lists only the keys of switched-off templates, to anyone", async () => {
    const t = setup();
    expect(await t.query(api.settings.disabledBuiltInTemplates, {})).toEqual([]);
    await t.run(async (ctx) => {
      await ctx.db.insert("builtInTemplates", { key: "okrs", name: "OKRs", description: "d", icon: "i", enabled: false, rank: "a0", updatedAt: Date.now() });
      await ctx.db.insert("builtInTemplates", { key: "budget", name: "Budget", description: "d", icon: "i", enabled: true, rank: "a1", updatedAt: Date.now() });
    });
    expect(await t.query(api.settings.disabledBuiltInTemplates, {})).toEqual(["okrs"]);
  });
});
