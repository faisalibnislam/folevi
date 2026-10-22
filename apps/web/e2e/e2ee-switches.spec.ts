import { expect, request, test, type Page } from "@playwright/test";
import { APP, newPerson } from "./helpers";
import { e2eeScan, marker, migrationDone, newNote, paletteResults, receiveMail, turnOnEncryption } from "./e2ee-helpers";

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

/** A personal access token that may add notes (Settings > Connected apps), as rest-api.spec.ts makes one. */
async function noteToken(page: Page): Promise<string> {
  await page.goto(`${APP}/settings/connected-apps`);
  const card = page.getByRole("region", { name: "Personal access tokens" });
  await card.getByRole("button", { name: "New token" }).click();
  const dialog = page.getByRole("dialog", { name: "New personal access token" });
  await dialog.getByLabel("Name").fill("E2EE script");
  await dialog.getByRole("checkbox", { name: "Create notes and add to them" }).click();
  await dialog.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByRole("dialog", { name: "Copy your new token" });
  const token = await shown.getByLabel("Your new token").inputValue();
  await shown.getByRole("button", { name: "Done" }).click();
  return token;
}

async function switchOn(page: Page, label: string) {
  await page.goto(`${APP}/settings/privacy`);
  const sw = page.getByRole("switch", { name: label });
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
}

test("apps: a write is refused until Apps and integrations is on, then queued, then made by this device; reads see its copy", async ({ browser }) => {
  test.setTimeout(480_000);
  const { page, context } = await newPerson(browser, "Apps Person");
  await turnOnEncryption(page);
  await migrationDone(page);
  const token = await noteToken(page);
  const api = await request.newContext();
  const auth = { authorization: `Bearer ${token}` };
  const title = marker("TITLE");
  const refused = await api.post(`${APP}/api/v1/notes`, { headers: { ...auth, "idempotency-key": `e2ee-${Date.now()}-a` }, data: { title, markdown: "Written by a script." } });
  expect(refused.status()).toBe(403);
  expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("e2ee_switch_off");

  await switchOn(page, "Apps and integrations");
  const queued = await api.post(`${APP}/api/v1/notes`, { headers: { ...auth, "idempotency-key": `e2ee-${Date.now()}-b` }, data: { title, markdown: "Written by a script." } });
  expect(queued.status(), await queued.text()).toBe(202);
  const body = (await queued.json()) as { status: string; noteId: string };
  expect(body.status).toBe("queued");

  // This (unlocked) browser applies it: the note is made, encrypted, with the id the app was given.
  await page.goto(`${APP}/d/${body.noteId}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveText(title, { timeout: 120_000 });
  await expect(page.getByText("Written by a script.")).toBeVisible();
  // Apps read it through the readable copy this device keeps for them.
  await expect.poll(async () => JSON.stringify(await (await api.get(`${APP}/api/v1/notes/${body.noteId}`, { headers: auth })).json()), { timeout: 180_000, intervals: [5_000] }).toContain("Written by a script.");
  await api.dispose();
  await context.close();
});

test("email to note: mail to the person's address arrives sealed and is filed in the Inbox by this device", async ({ browser }) => {
  // Scanning the whole dev deployment for the marker takes minutes.
  test.setTimeout(1_800_000);
  const { page, context, email } = await newPerson(browser, "Mail Person");
  await turnOnEncryption(page);
  await migrationDone(page);
  await switchOn(page, "Email to note");
  await page.goto(`${APP}/settings/data`);
  await page.getByRole("button", { name: "Create my address" }).click();
  const address = await page.getByLabel("Your address").inputValue({ timeout: 30_000 });
  const token = /^n-([^@]+)@/.exec(address)![1]!;
  const subject = marker("TITLE");
  // What the inbound mail webhook hands over once Resend has delivered and parsed the message.
  receiveMail({ token, emailId: `e2e-${Date.now()}`, fromAddress: email, fromName: "Mail Person", subject, text: "Sent from my phone.", truncated: false, rfcMessageId: null, receivedAt: Date.now(), attachments: [], authentication: { spf: "pass", dkim: "pass", dmarc: "pass" } });
  // This device files it under the Inbox; search on the device finds it.
  await page.goto(`${APP}/documents`);
  await expect.poll(async () => {
    const results = await paletteResults(page, subject);
    const n = await results.filter({ hasText: subject }).count();
    await page.keyboard.press("Escape");
    return n;
  }, { timeout: 180_000, intervals: [10_000] }).toBeGreaterThan(0);
  // Nothing readable was stored on the way: sealed to the space when it arrived, a sealed note once filed.
  expect(e2eeScan([subject]).clean).toBe(true);
  await context.close();
});
