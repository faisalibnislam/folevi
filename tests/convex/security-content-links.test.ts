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
    // Readers who know the password never use the budget up, however many they are.
    for (let i = 0; i < 40; i++) expect((await open("tulip", `reader-${i}`)).status).toBe("ok");
    // Thirty wrong guesses, each from another address (the per-client limit never sees two)...
    for (let i = 0; i < 30; i++) expect((await open(`guess-${i}`, `address-${i}`)).status).toBe("password_incorrect");
    // ...and the link takes no more passwords for now, from anyone, right or wrong (as when one client runs out).
    await expect(open("guess-30", "address-30")).rejects.toThrow(/rate_limited|Too many/);
    await expect(open("tulip", "address-31")).rejects.toThrow(/rate_limited|Too many/);
    // Another link of the same note has its own budget.
    const other = await a.as.mutation(api.sharing.createPublicLink, { documentId, password: "daisy" });
    expect((await t.mutation(api.sharing.openPublicLink, { token: other.token, password: "daisy", serverSecret: secret, clientKey: "address-0" })).status).toBe("ok");
  });
});
