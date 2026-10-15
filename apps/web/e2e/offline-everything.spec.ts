import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { convexUrl, newPerson, pick, showFolders, waitForSaved } from "./helpers";

// Folders, comments and collections work offline the way notes do: changes made with no connection are
// shown at once, kept on the device (the outbox), counted in the sync status, and reach the server once,
// in order, when the connection is back. What was seen before reads the same after an offline reload.

async function newNote(page: Page, title: string, line?: string) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await expect(page.getByRole("textbox", { name: "Title" })).toBeFocused();
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  if (line !== undefined) {
    await page.keyboard.press("Enter");
    await page.keyboard.type(line);
  }
  await waitForSaved(page);
  return page.url().split("?")[0]!;
}

async function goOffline(page: Page, context: BrowserContext) {
  await context.setOffline(true);
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-status", "offline", { timeout: 15_000 });
}

/** The note's own sidebar (contents, comments), from the Sidebar menu. */
async function showDocument(page: Page) {
  await page.getByRole("button", { name: "Sidebar", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Show document" }).click();
}

/** The same person in a fresh browser (only the session cookies): what's on the server, not this device. */
async function elsewhere(browser: Browser, context: BrowserContext, url: string) {
  const other = await browser.newContext();
  await other.addCookies(await context.cookies());
  const page = await other.newPage();
  await page.goto(url);
  return { other, page };
}

test("a folder made offline, with a note moved into it, reaches the server once", async ({ browser }) => {
  const { page, context } = await newPerson(browser, "Offline Filer");
  const url = await newNote(page, "Packing list", "Socks and a map.");
  await showFolders(page);
  const nav = page.getByRole("navigation", { name: "Folio" });
  // The folder list has loaded (a new account starts with a couple of folders) before the connection goes.
  await expect(nav.getByRole("link", { name: "Projects" })).toBeVisible();
  await goOffline(page, context);

  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("Trips");
  await page.getByRole("button", { name: "Create folder" }).click();
  await expect(nav.getByRole("link", { name: "Trips" })).toBeVisible();

  // Filed in the folder that only exists on this device so far.
  await page.getByRole("button", { name: "Document actions" }).click();
  await page.getByRole("menuitem", { name: "Move…" }).click();
  await page.getByRole("dialog", { name: /^Move “/ }).getByRole("option", { name: /^Trips/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Moved to Trips" })).toBeVisible();

  const status = page.getByTestId("sync-status");
  await expect(status).toHaveAccessibleName(/Sync status: Offline, [2-9] changes waiting/);
  await status.click();
  const details = page.getByRole("dialog", { name: "Sync details" });
  const outbox = details.getByTestId("sync-outbox-list");
  await expect(outbox.getByText("New folder “Trips”")).toBeVisible();
  await expect(outbox.getByText("Move a note")).toBeVisible();
  await expect(outbox.getByText("Waiting to send").first()).toBeVisible();
  await page.keyboard.press("Escape");

  await context.setOffline(false);
  await waitForSaved(page);

  // On the server: one Trips folder, with the note in it.
  const { other, page: page2 } = await elsewhere(browser, context, url.replace(/\/d\/.*$/, "/documents"));
  const nav2 = page2.getByRole("navigation", { name: "Folio" });
  await expect(nav2.getByRole("link", { name: "Trips" })).toHaveCount(1);
  await nav2.getByRole("link", { name: "Trips" }).click();
  await expect(page2.getByRole("main").getByText("Packing list")).toBeVisible();
  await other.close();
  await context.close();
});

test("a comment and a reply written offline, on a line typed offline, reach the server once", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, context } = await newPerson(browser, "Offline Commenter");
  const url = await newNote(page, "Itinerary", "Day one: arrive.");
  await goOffline(page, context);

  // A new line, and a comment on it: both only on this device.
  await page.getByRole("textbox", { name: "Document body" }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Day two: the museum.");
  await page.keyboard.press("ControlOrMeta+Alt+m");
  const thread = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Comments" }) });
  await thread.getByRole("textbox", { name: "Comment on this block" }).fill("Book tickets ahead?");
  await page.keyboard.press("Enter");
  await expect(thread.getByText("Book tickets ahead?")).toBeVisible();
  await expect(thread.getByText(/Waiting to send/).first()).toBeVisible();
  await thread.getByRole("textbox", { name: "Reply" }).fill("Yes, for ten.");
  await page.keyboard.press("Enter");
  await expect(thread.getByText("Yes, for ten.")).toBeVisible();
  await expect(page.getByTestId("sync-status")).toHaveAccessibleName(/Sync status: Offline, \d+ changes waiting/);

  await context.setOffline(false);
  await waitForSaved(page);
  await expect(thread.getByText(/Waiting to send/)).toHaveCount(0);

  const { other, page: page2 } = await elsewhere(browser, context, url);
  await expect(page2.getByRole("textbox", { name: "Document body" })).toContainText("Day two: the museum.");
  await page2.getByRole("tab", { name: /^Comments/ }).click();
  const list = page2.getByRole("tabpanel");
  await expect(list.getByText("Book tickets ahead?")).toHaveCount(1);
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await list.getByText("Book tickets ahead?").click();
  await expect(page2.getByText("Yes, for ten.")).toHaveCount(1);
  await other.close();
  await context.close();
});

test("a cell edited and a row added offline reach the server once", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, context } = await newPerson(browser, "Offline Collector");
  await newNote(page, "Library");
  const url = page.url().split("?")[0]!;
  await page.keyboard.press("Enter");
  await page.keyboard.type("/collection");
  await expect(page.getByRole("option", { name: /Collection/ })).toBeVisible();
  await page.keyboard.press("Enter");
  const coll = page.getByRole("region", { name: /^Collection / });
  await expect(coll).toBeVisible();
  await coll.getByRole("button", { name: "New row" }).click();
  await coll.getByRole("textbox", { name: "Row name" }).fill("Dune");
  await coll.getByRole("textbox", { name: "Row name" }).press("Enter");
  await expect(coll.getByRole("combobox", { name: "Status for Dune" })).toBeVisible();
  await waitForSaved(page);

  await goOffline(page, context);
  await pick(coll.getByRole("combobox", { name: "Status for Dune" }), "In progress");
  await coll.getByRole("button", { name: "New row" }).click();
  await expect(coll.getByRole("textbox", { name: "Row name" })).toHaveCount(2);
  await expect(coll.getByText("Waiting to send")).toBeVisible();
  await coll.getByRole("textbox", { name: "Row name" }).nth(1).fill("Middlemarch");
  await coll.getByRole("textbox", { name: "Row name" }).nth(1).press("Enter");
  await expect(coll.getByRole("combobox", { name: "Status for Middlemarch" })).toBeVisible();
  await pick(coll.getByRole("combobox", { name: "Status for Middlemarch" }), "Done");
  await expect(page.getByTestId("sync-status")).toHaveAccessibleName(/Sync status: Offline, [3-9] changes waiting/);

  await context.setOffline(false);
  await waitForSaved(page);
  await expect(coll.getByText("Waiting to send")).toHaveCount(0);

  const { other, page: page2 } = await elsewhere(browser, context, url);
  const coll2 = page2.getByRole("region", { name: /^Collection / });
  await expect(coll2.getByRole("textbox", { name: "Row name" })).toHaveCount(2);
  await expect(coll2.getByRole("combobox", { name: "Status for Dune" })).toContainText("In progress");
  await expect(coll2.getByRole("combobox", { name: "Status for Middlemarch" })).toContainText("Done");
  await other.close();
  await context.close();
});

test("reopened with no connection, the sidebar, comments and a collection read as last seen", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, context } = await newPerson(browser, "Offline Reader");
  await showFolders(page);
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("Archive box");
  await page.getByRole("button", { name: "Create folder" }).click();
  const nav = page.getByRole("navigation", { name: "Folio" });
  await expect(nav.getByRole("link", { name: "Archive box" })).toBeVisible();

  await newNote(page, "Field notes", "A line to discuss.");
  await page.keyboard.press("ControlOrMeta+Alt+m");
  await page.getByRole("textbox", { name: "Comment on this block" }).fill("Seen before the tunnel");
  await page.keyboard.press("Enter");
  await expect(page.locator(".fb-comment-chip")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Document body" }).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/collection");
  await expect(page.getByRole("option", { name: /Collection/ })).toBeVisible();
  await page.keyboard.press("Enter");
  const coll = page.getByRole("region", { name: /^Collection / });
  await coll.getByRole("button", { name: "New row" }).click();
  await coll.getByRole("textbox", { name: "Row name" }).fill("Kept row");
  await coll.getByRole("textbox", { name: "Row name" }).press("Enter");
  await waitForSaved(page);
  await showDocument(page);
  await page.getByRole("tab", { name: /^Comments/ }).click();
  await expect(page.getByRole("tabpanel").getByText("Seen before the tunnel")).toBeVisible();
  await showFolders(page);
  // The kept copies are written a moment after the answers settle.
  await page.waitForTimeout(2_500);

  // No server: the auth endpoints and the backend's socket are cut, and the app starts again.
  await page.route("**/api/auth/**", (route) => route.abort("internetdisconnected"));
  const backendHost = new URL(convexUrl()).host;
  await page.routeWebSocket((u) => u.host === backendHost || u.hostname.endsWith(".convex.cloud"), (ws) => ws.close());
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Folio" }).getByRole("link", { name: "Archive box" })).toBeVisible({ timeout: 20_000 });
  const coll2 = page.getByRole("region", { name: /^Collection / });
  await expect(coll2.getByRole("textbox", { name: "Row name" })).toHaveValue("Kept row", { timeout: 20_000 });
  await expect(page.locator(".fb-comment-chip")).toBeVisible();
  await showDocument(page);
  await page.getByRole("tab", { name: /^Comments/ }).click();
  await expect(page.getByRole("tabpanel").getByText("Seen before the tunnel")).toBeVisible();
  await context.close();
});

test("a property with an option, a view and a read mark made offline reach the server once", async ({ browser }) => {
  test.setTimeout(150_000);
  const { page, context } = await newPerson(browser, "Offline Shelver");
  const url = await newNote(page, "Book club", "Chapter one.");
  await page.keyboard.press("ControlOrMeta+Alt+m");
  await page.getByRole("textbox", { name: "Comment on this block" }).fill("Read by Friday?");
  await page.keyboard.press("Enter");
  await expect(page.locator(".fb-comment-chip")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Document body" }).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/collection");
  await expect(page.getByRole("option", { name: /Collection/ })).toBeVisible();
  await page.keyboard.press("Enter");
  const coll = page.getByRole("region", { name: /^Collection / });
  await coll.getByRole("button", { name: "New row" }).click();
  await coll.getByRole("textbox", { name: "Row name" }).fill("Dune");
  await coll.getByRole("textbox", { name: "Row name" }).press("Enter");
  await expect(coll.getByRole("combobox", { name: "Status for Dune" })).toBeVisible();
  // The thread is marked unread while online, to be read again offline.
  await showDocument(page);
  await page.getByRole("tab", { name: /^Comments/ }).click();
  const panel = page.getByRole("tabpanel");
  await panel.getByRole("listitem").hover();
  await panel.getByRole("button", { name: "Thread actions" }).click();
  await page.getByRole("menuitem", { name: "Mark as unread" }).click();
  await expect(panel.getByRole("img", { name: "Unread" })).toBeVisible();
  await waitForSaved(page);

  await goOffline(page, context);
  await panel.getByRole("listitem").hover();
  await panel.getByRole("button", { name: "Thread actions" }).click();
  await page.getByRole("menuitem", { name: "Mark as read" }).click();
  await expect(panel.getByRole("img", { name: "Unread" })).toHaveCount(0);

  // A single-select property with one option, set on the row.
  await coll.getByRole("button", { name: /^View settings/ }).click();
  const settings = page.getByRole("dialog", { name: "Table settings" });
  await settings.getByLabel("New property").fill("Genre");
  await pick(settings.getByRole("combobox", { name: "Property type" }), "Single select");
  await settings.getByRole("button", { name: "Add", exact: true }).click();
  await expect(settings.getByRole("textbox", { name: "Name of property Genre" })).toBeVisible();
  await settings.getByLabel("Options for Genre (comma-separated)").fill("Sci-fi");
  await settings.getByLabel("Options for Genre (comma-separated)").press("Tab");
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  await pick(coll.getByRole("combobox", { name: "Genre for Dune" }), "Sci-fi");

  // A board, renamed.
  await pick(coll.getByRole("combobox", { name: "Add view" }), "Board");
  await expect(coll.getByRole("button", { name: "Board", exact: true })).toHaveAttribute("aria-pressed", "true");
  await coll.getByRole("button", { name: /^View settings/ }).click();
  const boardSettings = page.getByRole("dialog", { name: "Board settings" });
  await boardSettings.getByRole("textbox", { name: "View name" }).fill("Shelves");
  await boardSettings.getByRole("textbox", { name: "View name" }).press("Enter");
  await page.keyboard.press("Escape");
  await expect(coll.getByRole("button", { name: "Shelves", exact: true })).toBeVisible();
  await expect(page.getByTestId("sync-status")).toHaveAccessibleName(/Sync status: Offline, [5-9] changes waiting/);

  await context.setOffline(false);
  await waitForSaved(page);

  // On the server: one Genre property with its option, the value on the row, one renamed board, the thread read.
  const { other, page: page2 } = await elsewhere(browser, context, url);
  const coll2 = page2.getByRole("region", { name: /^Collection / });
  await expect(coll2.getByRole("group", { name: "Views" }).getByRole("button")).toHaveCount(2);
  await expect(coll2.getByRole("button", { name: "Shelves", exact: true })).toHaveCount(1);
  await coll2.getByRole("button", { name: "Table", exact: true }).click();
  await expect(coll2.getByRole("combobox", { name: "Genre for Dune" })).toContainText("Sci-fi");
  await coll2.getByRole("button", { name: /^View settings/ }).click();
  const settings2 = page2.getByRole("dialog", { name: "Table settings" });
  await expect(settings2.getByRole("textbox", { name: "Name of property Genre" })).toHaveCount(1);
  await expect(settings2.getByLabel("Options for Genre (comma-separated)")).toHaveValue("Sci-fi");
  await page2.keyboard.press("Escape");
  await showDocument(page2);
  await page2.getByRole("tab", { name: /^Comments/ }).click();
  await expect(page2.getByRole("tabpanel").getByText("Read by Friday?")).toBeVisible();
  await expect(page2.getByRole("tabpanel").getByRole("img", { name: "Unread" })).toHaveCount(0);
  await other.close();
  await context.close();
});

test("a row added offline opens as a page, and what's typed there is saved after the row", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, context } = await newPerson(browser, "Offline Row Writer");
  await newNote(page, "Recipes");
  const url = page.url().split("?")[0]!;
  await page.keyboard.press("Enter");
  await page.keyboard.type("/collection");
  await expect(page.getByRole("option", { name: /Collection/ })).toBeVisible();
  await page.keyboard.press("Enter");
  const coll = page.getByRole("region", { name: /^Collection / });
  await expect(coll).toBeVisible();
  await waitForSaved(page);

  await goOffline(page, context);
  await coll.getByRole("button", { name: "New row" }).click();
  await coll.getByRole("textbox", { name: "Row name" }).fill("Soup");
  await coll.getByRole("textbox", { name: "Row name" }).press("Enter");
  await expect(coll.getByText("Waiting to send")).toBeVisible();
  await coll.getByRole("link", { name: "Open Soup" }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}$/);
  const rowUrl = page.url();
  await expect(page.getByRole("region", { name: "Properties in Collection" })).toBeVisible();
  await page.getByRole("textbox", { name: "Document body" }).click();
  await page.keyboard.type("Leeks, then stock.");
  await expect(page.getByTestId("sync-status")).toHaveAccessibleName(/Sync status: Offline, [2-9] changes waiting/);

  await context.setOffline(false);
  await waitForSaved(page);

  const { other, page: page2 } = await elsewhere(browser, context, rowUrl);
  await expect(page2.getByRole("textbox", { name: "Document body" })).toContainText("Leeks, then stock.");
  // One line: the page didn't get a second, empty one from the server.
  await expect(page2.getByRole("textbox", { name: "Document body" }).locator("p")).toHaveCount(1);
  await page2.goto(url);
  await expect(page2.getByRole("region", { name: /^Collection / }).getByRole("textbox", { name: "Row name" })).toHaveCount(1);
  await other.close();
  await context.close();
});
