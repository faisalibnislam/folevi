import { expect, test } from "@playwright/test";
import { newPerson, openShare } from "./helpers";
import { HAS_BACKEND, NEEDS_BACKEND, marker, migrationDone, newNote, turnOnEncryption } from "./e2ee-stub";

// §11.4 e2ee-link: an encrypted link opens signed out (the key is after #); without the fragment it says the
// key is missing; revoking it stops it.
test.skip(!HAS_BACKEND, NEEDS_BACKEND);

test("an encrypted link opens signed out, needs its fragment, and can be revoked", async ({ browser }) => {
  test.setTimeout(300_000);
  const { page, context } = await newPerson(browser, "Link Person");
  await turnOnEncryption(page);
  await migrationDone(page);
  const title = marker("TITLE");
  const url = await newNote(page, title, "Shared through an encrypted link.");
  await page.goto(url);
  await openShare(page);
  const share = page.getByRole("dialog", { name: /^Share/ });
  await expect(share.getByText("Encrypted link: the key is in the link itself.", { exact: false })).toBeVisible();
  await share.getByRole("button", { name: "Create link" }).click();
  const link = await share.getByLabel("Public link").inputValue();
  expect(link).toMatch(/\/s\/[A-Za-z0-9_-]+#k=[A-Za-z0-9_-]+$/);

  const anon = await browser.newContext();
  const viewer = await anon.newPage();
  await viewer.goto(link);
  await expect(viewer.getByRole("heading", { name: title })).toBeVisible({ timeout: 30_000 });
  // The HTML the server sent has none of the note.
  expect(await (await viewer.request.get(link.split("#")[0]!)).text()).not.toContain(title);
  await viewer.goto(link.split("#")[0]!);
  await expect(viewer.getByText("This link is missing its key. Ask the person who shared it to send the whole link.")).toBeVisible({ timeout: 30_000 });

  await share.getByRole("button", { name: "Revoke" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Link revoked" })).toBeVisible();
  await viewer.goto(link);
  await expect(viewer.getByRole("heading", { name: "Page unavailable" })).toBeVisible({ timeout: 30_000 });
  await Promise.all([context.close(), anon.close()]);
});
