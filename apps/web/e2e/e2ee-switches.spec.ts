import { expect, test } from "@playwright/test";
import { APP, newPerson } from "./helpers";
import { e2eeScan, marker, migrationDone, newNote, paletteResults, turnOnEncryption } from "./e2ee-helpers";

// §11.4 e2ee-switches: each switch at "Encrypted, with the features you pick". Foli AI's consent needs a
// Gemini key on the deployment as well, like ai.spec.ts (E2E_AI=1).

test("Foli AI asks before sending notes, and Don't send sends nothing", async ({ browser }) => {
  test.skip(!process.env.E2E_AI, "calls Gemini; run with E2E_AI=1");
  test.setTimeout(420_000);
  const { page, context } = await newPerson(browser, "Consent Person");
  await turnOnEncryption(page);
  await migrationDone(page);
  const title = marker("TITLE");
  await newNote(page, title, "Notes about the lighthouse trip.");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+j" : "Control+j");
  await page.keyboard.type("What did I write about the lighthouse?");
  await page.keyboard.press("Enter");
  const ask = page.getByRole("dialog", { name: "Send to Foli AI?" });
  await expect(ask.getByText(title)).toBeVisible({ timeout: 30_000 });
  await ask.getByRole("button", { name: "Don't send" }).click();
  await expect(ask).toHaveCount(0);
  await context.close();
});

test("Search everywhere: server results while the replica downloads; turning it off deletes the copy", async ({ browser }) => {
  test.setTimeout(420_000);
  const { page, context } = await newPerson(browser, "Search Person");
  await turnOnEncryption(page);
  await migrationDone(page);
  const title = marker("TITLE");
  await newNote(page, title, "Findable from any device.");
  await page.goto(`${APP}/settings/privacy`);
  await page.getByRole("switch", { name: "Search everywhere" }).click();
  await expect(page.getByText("Search everywhere turned on")).toBeVisible();
  // The readable copy exists only in the search mirror.
  await expect.poll(() => e2eeScan([title]).hits.every((h) => h.table === "e2eeMirrors"), { timeout: 120_000 }).toBe(true);
  const viewer = await browser.newContext({ storageState: { cookies: (await context.storageState()).cookies, origins: [] } });
  const fresh = await viewer.newPage();
  await fresh.goto(`${APP}/documents`);
  await expect((await paletteResults(fresh, title)).filter({ hasText: title })).toBeVisible({ timeout: 45_000 });
  await page.getByRole("switch", { name: "Search everywhere" }).click();
  await expect(page.getByText("Turned off. Folevi deleted the readable copy.")).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => e2eeScan([title]).clean, { timeout: 120_000 }).toBe(true);
  await Promise.all([context.close(), viewer.close()]);
});

test("notification previews: generic text while off", async ({ browser }) => {
  test.setTimeout(420_000);
  const { page, context } = await newPerson(browser, "Preview Person");
  await turnOnEncryption(page);
  await page.goto(`${APP}/settings/privacy`);
  await expect(page.getByRole("switch", { name: "Notification previews" })).toHaveAttribute("aria-checked", "false");
  // The text of push and email notifications for sealed notes is checked server-side (tests/convex/e2ee-features.test.ts).
  await context.close();
});

test.fixme("apps: an MCP read sees nothing until Apps and integrations is on; a write is queued, then applied", async () => {
  // Needs an MCP client in the e2e harness (mcp-connect.spec.ts drives the consent screen only).
});
test.fixme("email to note: mail to the space's address arrives sealed and is filed by a device", async () => {
  // Needs the inbound mail webhook in the e2e harness.
});
