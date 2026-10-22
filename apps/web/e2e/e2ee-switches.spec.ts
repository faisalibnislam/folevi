import { expect, test } from "@playwright/test";
import { APP, newPerson } from "./helpers";
import { e2eeScan, marker, migrationDone, newNote, turnOnEncryption } from "./e2ee-helpers";

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

test("Search everywhere keeps a readable copy only in the search mirror; turning it off deletes it", async ({ browser }) => {
  // Scanning the whole dev deployment for the marker takes minutes.
  test.setTimeout(1_800_000);
  const { page, context } = await newPerson(browser, "Search Person");
  await turnOnEncryption(page);
  await migrationDone(page);
  const title = marker("TITLE");
  await newNote(page, title, "Findable from any device.");
  await page.goto(`${APP}/settings/privacy`);
  await page.getByRole("switch", { name: "Search everywhere" }).click();
  await expect(page.getByText("Search everywhere turned on")).toBeVisible({ timeout: 30_000 });
  // The device keeps the mirror up to date in the background: the marker shows up there, and only there.
  await expect.poll(() => { const r = e2eeScan([title]); return r.hits.length > 0 && r.hits.every((h) => h.table === "e2eeMirrors"); }, { timeout: 900_000, intervals: [30_000] }).toBe(true);
  await page.getByRole("switch", { name: "Search everywhere" }).click();
  await expect(page.getByText("Turned off. Folevi deleted the readable copy.")).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => e2eeScan([title]).clean, { timeout: 900_000, intervals: [30_000] }).toBe(true);
  await context.close();
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
