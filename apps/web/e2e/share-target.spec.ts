import { expect, test } from "@playwright/test";
import { APP, newPerson, waitForSaved } from "./helpers";

// Save to Folevi: the bookmarklet (and the share target's fallback) open /share with the page's title,
// address and selected text; saving files a note under the Inbox.
test("a page sent to /share is saved as a note under the Inbox", async ({ browser }) => {
  const { page, context } = await newPerson(browser, "Share Person");
  const query = new URLSearchParams({ title: "Field notes", url: "https://example.com/field", text: "Look here https://example.com/field" });
  await page.goto(`${APP}/share?${query}`);
  await expect(page.getByRole("heading", { name: "Save to Folevi" })).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveValue("Field notes");
  const preview = page.getByLabel("What will be saved");
  await expect(preview).toContainText("https://example.com/field");
  // The link was in the text too: it's shown once.
  await expect(preview).toContainText("Look here");
  await expect(page.getByRole("combobox", { name: "Save to" })).toContainText("Inbox in Personal");
  await page.getByLabel("Title").fill("Field notes, saved");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Saved to your Inbox" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("It’s in the Inbox in Personal.");

  await page.getByRole("button", { name: "Open note" }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}$/);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveText("Field notes, saved");
  await expect(page.getByRole("textbox", { name: "Document body" })).toContainText("Look here");
  await waitForSaved(page);

  // It's a page under the Inbox, with a card for it there.
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await breadcrumb.getByRole("link", { name: /Inbox/ }).click();
  await page.waitForURL(/\/d\/inbox-/);
  await expect(page.getByRole("textbox", { name: "Document body" })).toContainText("Field notes, saved");
  await context.close();
});

test("the share target's server fallback passes the share on to /share, and Settings has the bookmarklet", async ({ browser }) => {
  const { page, context } = await newPerson(browser, "Share Fallback");
  const res = await page.request.post(`${APP}/share-target`, {
    multipart: { title: "From my phone", text: "https://example.org/read", url: "" },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(303);
  const location = res.headers()["location"]!;
  expect(location.startsWith("/share?")).toBe(true);
  await page.goto(`${APP}${location}`);
  await expect(page.getByLabel("Title")).toHaveValue("From my phone");
  await expect(page.getByLabel("What will be saved")).toContainText("https://example.org/read");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForURL(/\/documents/);

  await page.goto(`${APP}/settings/data`);
  const bookmarklet = page.getByTestId("bookmarklet");
  await expect(bookmarklet).toHaveText("Save to Folevi");
  await expect(bookmarklet).toHaveAttribute("href", /^javascript:/);
  await context.close();
});
