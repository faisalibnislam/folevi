// Security audit 2026-11-26, public links (convex/sharing.ts): wrong passwords for one link share a budget,
// whichever address they come from.
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { person, PERSONAL, setup } from "./helpers";

const secret = "a".repeat(64);

describe("guessing a public link's password", () => {
  test("is limited per link, not only per client address", async () => {
    const t = setup();
    const a = await person(t, "link-owner@example.com");
    const { id: documentId } = await a.as.mutation(api.documents.create, { scope: PERSONAL, title: "Protected" });
    const { token } = await a.as.mutation(api.sharing.createPublicLink, { documentId, password: "tulip" });
    const open = (password: string, clientKey: string) => t.mutation(api.sharing.openPublicLink, { token, password, serverSecret: secret, clientKey });
    // A small budget for the test (each password check is 210,000 rounds of PBKDF2, slow on a busy machine).
    await t.run(async (ctx) => {
      await ctx.db.insert("systemSettings", { key: "rate_limits", value: { publicLinkPasswordLink: { limit: 3, windowMs: 15 * 60_000 } }, updatedAt: Date.now() });
    });
    // Readers who know the password never use the budget up, however many they are.
    for (let i = 0; i < 5; i++) expect((await open("tulip", `reader-${i}`)).status).toBe("ok");
    // Three wrong guesses, each from another address (the per-client limit never sees two)...
    for (let i = 0; i < 3; i++) expect((await open(`guess-${i}`, `address-${i}`)).status).toBe("password_incorrect");
    // ...and the link takes no more passwords for now, from anyone, right or wrong (as when one client runs out).
    await expect(open("guess-3", "address-3")).rejects.toThrow(/rate_limited|Too many/);
    await expect(open("tulip", "address-4")).rejects.toThrow(/rate_limited|Too many/);
    // Another link of the same note has its own budget.
    const other = await a.as.mutation(api.sharing.createPublicLink, { documentId, password: "daisy" });
    expect((await t.mutation(api.sharing.openPublicLink, { token: other.token, password: "daisy", serverSecret: secret, clientKey: "address-0" })).status).toBe("ok");
  }, 20_000);
});
