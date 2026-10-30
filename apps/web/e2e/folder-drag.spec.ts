// Drag and drop in the sidebar's folders (2026-10-23): notes dragged onto a folder (from a folder page, a list,
// Home, search results and the sidebar) move there, several at once; a folder dragged onto another nests in it, a
// line between rows reorders (at any level, or out of a parent), a folder can't go inside itself or past five
// levels (the row says why), a closed folder opens while a drag rests on it, "+N more" shows every folder and
// "Show less" goes back. Every move has one Undo and survives a reload. Mouse on the web, a finger on the iPad.
//   E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 npx playwright test e2e/folder-drag.spec.ts --workers=1
import { expect, test } from "@playwright/test";
import { APP, newPerson, waitForSaved } from "./helpers";
import { centre, drafts, drag, finger, folderLink, line, more, nav, newFolder, roots, row, toast } from "./folderDragHelpers";

test("mouse: reorder, nest, un-nest, refuse, open while resting, and +N more", async ({ browser }) => {
  test.setTimeout(240_000);
  const { page } = await newPerson(browser, "Folder Dragger");
  await page.goto(`${APP}/documents`);
  for (const name of ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"]) await newFolder(page, name, false);

  // "+N more" shows every folder, and the list scrolls once it's long; "Show less" goes back.
  await expect(folderLink(page, "Foxtrot")).toHaveCount(0);
  await more(page).click();
  await expect(folderLink(page, "Foxtrot")).toBeVisible();
  const all = nav(page).getByRole("group", { name: "All folders" });
  expect(await all.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
  await nav(page).getByRole("button", { name: "Show less folders" }).click();
  await expect(folderLink(page, "Foxtrot")).toHaveCount(0);
  await more(page).click();
  expect(await roots(page)).toEqual(["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"]);

  // A line above a row: Charlie goes before Alpha; the line shows while it's over the row's top edge.
  let d = await drag(page, folderLink(page, "Charlie"), row(page, "Alpha"), 0.1);
  await expect(row(page, "Alpha")).toHaveAttribute("data-drop-state", "before");
  await d.drop();
  await expect(toast(page, "Moved “Charlie”")).toBeVisible();
  await expect.poll(() => roots(page)).toEqual(["Charlie", "Alpha", "Bravo", "Delta", "Echo", "Foxtrot"]);
  // Its Undo is one step back.
  await toast(page, "Moved “Charlie”").getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => roots(page)).toEqual(["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"]);

  // A line below a row: Alpha after Delta.
  d = await drag(page, folderLink(page, "Alpha"), row(page, "Delta"), 0.9);
  await expect(row(page, "Delta")).toHaveAttribute("data-drop-state", "after");
  await d.drop();
  await expect.poll(() => roots(page)).toEqual(["Bravo", "Charlie", "Delta", "Alpha", "Echo", "Foxtrot"]);

  // Onto the middle of a row: inside it (it opens to show it).
  d = await drag(page, folderLink(page, "Bravo"), row(page, "Echo"), 0.5);
  await expect(row(page, "Echo")).toHaveAttribute("data-drop-state", "inside");
  await d.drop();
  await expect(toast(page, "Moved “Bravo” to Echo")).toBeVisible();
  const inEcho = nav(page).getByRole("group", { name: "In Echo" });
  await expect(inEcho.getByRole("link", { name: "Bravo" })).toBeVisible();
  // ...and a folder inside that one.
  await drag(page, folderLink(page, "Foxtrot"), row(page, "Bravo"), 0.5).then((x) => x.drop());
  await expect(nav(page).getByRole("group", { name: "In Bravo" }).getByRole("link", { name: "Foxtrot" })).toBeVisible();

  // Never into itself or its own subfolder: the row says why and nothing moves.
  d = await drag(page, folderLink(page, "Echo"), row(page, "Foxtrot"), 0.5);
  await expect(row(page, "Foxtrot")).toHaveAttribute("data-drop-state", "refused");
  await expect(page.getByRole("status").filter({ hasText: "Can’t go inside its own subfolder" })).toBeVisible();
  await d.drop();
  await expect(nav(page).getByRole("group", { name: "In Bravo" }).getByRole("link", { name: "Foxtrot" })).toBeVisible();
  await expect(toast(page, /Moved “Echo”/)).toHaveCount(0);

  // Out of its parent: a line between top-level rows un-nests it, so does "Move to the top level".
  d = await drag(page, folderLink(page, "Bravo"), row(page, "Charlie"), 0.1);
  await expect(row(page, "Charlie")).toHaveAttribute("data-drop-state", "before");
  await d.drop();
  await expect(toast(page, "Moved “Bravo” to the top level")).toBeVisible();
  await expect.poll(() => roots(page)).toEqual(["Bravo", "Charlie", "Delta", "Alpha", "Echo"]);
  await expect(nav(page).getByRole("group", { name: "In Bravo" }).getByRole("link", { name: "Foxtrot" })).toBeVisible();
  d = await drag(page, folderLink(page, "Foxtrot"), nav(page).getByText("Move to the top level"), 0.5);
  await d.drop();
  await expect(toast(page, "Moved “Foxtrot” to the top level")).toBeVisible();
  await expect.poll(() => roots(page)).toEqual(["Bravo", "Charlie", "Delta", "Alpha", "Echo", "Foxtrot"]);

  // Reordering inside a folder: two subfolders of Echo swap.
  await drag(page, folderLink(page, "Delta"), row(page, "Echo"), 0.5).then((x) => x.drop());
  await drag(page, folderLink(page, "Alpha"), row(page, "Echo"), 0.5).then((x) => x.drop());
  const echoKids = () => inEcho.evaluate((g) => [...g.querySelectorAll(":scope > div > [data-drop-tree] a")].map((a) => a.textContent!.trim()));
  await expect.poll(echoKids).toEqual(["Delta", "Alpha"]);
  await drag(page, folderLink(page, "Alpha"), row(page, "Delta"), 0.1).then((x) => x.drop());
  await expect.poll(echoKids).toEqual(["Alpha", "Delta"]);

  // A closed folder opens while a drag rests on it, so a folder can go deeper in one go.
  await nav(page).getByRole("button", { name: "Collapse Echo" }).click();
  await expect(folderLink(page, "Alpha")).toHaveCount(0);
  d = await drag(page, folderLink(page, "Charlie"), row(page, "Echo"), 0.5, 1100);
  await expect(folderLink(page, "Alpha")).toBeVisible();
  const toAlpha = await row(page, "Alpha").boundingBox();
  await page.mouse.move(toAlpha!.x + 60, toAlpha!.y + toAlpha!.height / 2, { steps: 8 });
  await page.waitForTimeout(150);
  await page.mouse.move(toAlpha!.x + 61, toAlpha!.y + toAlpha!.height / 2, { steps: 2 });
  await d.drop();
  await expect(toast(page, "Moved “Charlie” to Alpha")).toBeVisible();

  // All of it is still so after a reload.
  await page.reload();
  await expect(nav(page).getByRole("group", { name: "In Alpha" }).getByRole("link", { name: "Charlie" })).toBeVisible();
  expect(await roots(page)).toEqual(["Bravo", "Echo", "Foxtrot"]);
  await expect.poll(echoKids).toEqual(["Alpha", "Delta"]);
});

test("mouse: notes onto folders from a list, a folder page's chips, Home, search and the sidebar", async ({ browser }) => {
  test.setTimeout(240_000);
  const { page } = await newPerson(browser, "Note Dragger");
  await page.goto(`${APP}/documents`);
  await newFolder(page, "Shelf");
  await newFolder(page, "Inner");
  await drag(page, folderLink(page, "Inner"), row(page, "Shelf"), 0.5).then((x) => x.drop());
  await expect(toast(page, "Moved “Inner” to Shelf")).toBeVisible();

  // From the All notes list onto a sidebar folder; Undo puts it back.
  await folderLink(page, "All notes").click();
  await page.getByRole("radio", { name: "List" }).click();
  const listRow = (title: string) => page.getByRole("main").getByRole("listitem").filter({ hasText: title });
  const title = (await listRow("").first().getByRole("link").first().innerText()).split("\n")[0]!.trim();
  let d = await drag(page, listRow(title), row(page, "Shelf"), 0.5);
  await expect(row(page, "Shelf")).toHaveAttribute("data-drop-state", "inside");
  await d.drop();
  await expect(toast(page, "Moved to Shelf")).toBeVisible();
  await folderLink(page, "Shelf").click();
  await expect(page.getByRole("main").getByText(title).first()).toBeVisible();

  // On the folder's page: the note onto its subfolder's card.
  const inner = page.getByRole("list", { name: "Folders inside" }).getByRole("link", { name: /^Inner,/ });
  const card = page.getByRole("main").locator("[data-card-id]").filter({ hasText: title }).first();
  d = await drag(page, card, inner, 0.5);
  await expect(page.getByRole("list", { name: "Folders inside" }).locator('[data-drop-key^="card:"]')).toHaveAttribute("data-drop-state", "inside");
  await d.drop();
  await expect(toast(page, "Moved to Inner")).toBeVisible();
  await expect(page.getByRole("main").locator("[data-card-id]").filter({ hasText: title })).toHaveCount(0);

  // Several selected notes go together (from the list).
  await folderLink(page, "All notes").click();
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  // Two notes picked by name, not place: the list is by last edited, and the moves above may still be reordering it.
  const rows = page.getByRole("main").getByRole("listitem");
  await expect(rows.nth(1)).toBeVisible();
  // Each row's own link, its title (a row also links its folder and tags).
  const title0 = (i: number) => rows.nth(i).getByRole("link").first().innerText();
  const [first, second] = [(await title0(0)).trim(), (await title0(1)).trim()];
  const note = (name: string) => rows.filter({ hasText: name }).first();
  await note(first).getByRole("link").first().click({ modifiers: [mod] });
  await note(second).getByRole("link").first().click({ modifiers: [mod] });
  await expect(page.getByRole("toolbar", { name: "Selected notes" }).getByRole("status")).toHaveText("2 selected");
  await drag(page, note(first), row(page, "Shelf"), 0.5).then((x) => x.drop());
  await expect(toast(page, "Moved 2 notes to Shelf")).toBeVisible();

  // From search results (the palette steps aside while the note is dragged).
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  const palette = page.getByRole("dialog", { name: "Search and commands" });
  await expect(palette).toBeVisible();
  await palette.getByRole("combobox", { name: "Search documents or type a command" }).fill(title.slice(0, 6));
  const result = palette.getByRole("option").filter({ hasText: title }).first();
  await expect(result).toBeVisible();
  // Once the search has answered (the list redraws as the device's and the server's results come in).
  await expect(palette.getByText("Searching…")).toHaveCount(0);
  await page.waitForTimeout(500);
  await drag(page, result, drafts(page), 0.5).then((x) => x.drop());
  await expect(toast(page, "Moved to Drafts")).toBeVisible();
  await expect(palette).toBeHidden();

  // A starred note in the sidebar onto a folder.
  await drafts(page).click();
  const draft = page.getByRole("main").locator("[data-card-id]").filter({ hasText: title }).first();
  await draft.click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Star/ }).click();
  const starred = nav(page).getByRole("group", { name: "Starred pages" }).getByRole("link", { name: title });
  await expect(starred).toBeVisible();
  await drag(page, starred, row(page, "Shelf"), 0.5).then((x) => x.drop());
  await expect(toast(page, "Moved to Shelf")).toBeVisible();

  // Home's cards onto a folder.
  await folderLink(page, "Home").click();
  const homeCard = page.getByRole("main").locator('[draggable="true"]:has(a[href^="/d/"])').first();
  await expect(homeCard).toBeVisible();
  const homeTitle = (await homeCard.innerText()).split("\n")[0]!.trim();
  await drag(page, homeCard, row(page, "Inner"), 0.5).then((x) => x.drop());
  await expect(toast(page, "Moved to Inner")).toBeVisible();

  // And it's there after a reload.
  await page.reload();
  await folderLink(page, "Inner").click();
  await expect(page.getByRole("main").getByText(homeTitle).first()).toBeVisible();
});

test("iPad: a still hold opens the menu; hold then move drags folders and notes", async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "Touch input is driven through Chromium's DevTools protocol.");
  test.setTimeout(240_000);
  const { context: signedIn, page: first } = await newPerson(browser, "iPad Dragger");
  await first.goto(`${APP}/documents`);
  for (const name of ["Garden", "Kitchen", "Shed"]) await newFolder(first, name);
  // (The folders are sent before this window goes.)
  await waitForSaved(first);
  const state = await signedIn.storageState();
  await signedIn.close();

  const IPAD_UA = "Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1";
  const context = await browser.newContext({ storageState: state, viewport: { width: 1366, height: 1024 }, userAgent: IPAD_UA, hasTouch: true, isMobile: true });
  // Like Safari on iOS: no right-click of the browser's own for a long press (Chromium sends one).
  await context.addInitScript(() => window.addEventListener("contextmenu", (e) => (e.isTrusted ? (e.stopImmediatePropagation(), e.preventDefault()) : undefined), true));
  const page = await context.newPage();
  await page.goto(`${APP}/documents`);
  await expect(folderLink(page, "Shed")).toBeVisible({ timeout: 30_000 });

  // A still hold: the folder's menu, nothing moves.
  await finger(page, await centre(folderLink(page, "Kitchen")), [], 700);
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  expect(await roots(page)).toEqual(["Garden", "Kitchen", "Shed"]);

  // Hold, then move: the menu gives way and the folder follows the finger; let go on a line above Garden.
  const shed = await centre(folderLink(page, "Shed"));
  await finger(page, shed, line(shed, await centre(row(page, "Garden"), 0.1)));
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(toast(page, "Moved “Shed”")).toBeVisible();
  await expect.poll(() => roots(page)).toEqual(["Shed", "Garden", "Kitchen"]);
  await expect(page.locator("[data-drag-ghost]")).toHaveCount(0);

  // Into another folder.
  const kitchen = await centre(folderLink(page, "Kitchen"));
  await finger(page, kitchen, line(kitchen, await centre(row(page, "Garden"), 0.5)));
  await expect(toast(page, "Moved “Kitchen” to Garden")).toBeVisible();
  await expect(nav(page).getByRole("group", { name: "In Garden" }).getByRole("link", { name: "Kitchen" })).toBeVisible();

  // Refused into its own subfolder.
  const garden = await centre(folderLink(page, "Garden"));
  await finger(page, garden, line(garden, await centre(row(page, "Kitchen"), 0.5)));
  await expect(nav(page).getByRole("group", { name: "In Garden" }).getByRole("link", { name: "Kitchen" })).toBeVisible();
  await expect(toast(page, /Moved “Garden”/)).toHaveCount(0);

  // A note card onto a folder in the sidebar. (A tap just after a hold belongs to the hold: wait a moment.)
  await page.waitForTimeout(600);
  await folderLink(page, "All notes").click();
  const top = page.getByRole("main").locator("[data-card-id]").first();
  await expect(top).toBeVisible();
  const titleText = (await top.innerText()).split("\n")[0]!.trim();
  // That card, by its title: the list is by last edited and can still be reordering.
  const card = page.getByRole("main").locator("[data-card-id]").filter({ hasText: titleText }).first();
  const from = await centre(card);
  await finger(page, from, line(from, await centre(row(page, "Shed"), 0.5), 20));
  await expect(toast(page, "Moved to Shed")).toBeVisible();
  // Saved before the reload (a slow machine was still sending it).
  await waitForSaved(page);
  await page.reload();
  await folderLink(page, "Shed").click();
  await expect(page.getByRole("main").getByText(titleText).first()).toBeVisible();
  await context.close();
});
