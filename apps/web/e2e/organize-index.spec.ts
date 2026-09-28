import { expect, test } from "@playwright/test";
import { APP, newPersonWithWorkspace, seedDemo, showFolders, pick } from "./helpers";

test("the sidebar lists a few folders and tags; All folders / All tags pages search and sort the rest", async ({ browser }) => {
  const { page, email } = await newPersonWithWorkspace(browser, "Many Things");
  seedDemo(email, { notes: 6, folders: 12, tags: 14 });
  await page.goto(`${APP}/documents`);
  await showFolders(page).catch(() => undefined);
  const nav = page.getByRole("navigation", { name: "Workspace" });

  // Five folders (plus nested ones under them) and a "+N more" link to the full list.
  const moreFolders = nav.getByRole("link", { name: /^\+\d+ more folders$/ });
  await expect(moreFolders).toBeVisible({ timeout: 20_000 });
  // Tags start collapsed.
  await nav.getByRole("button", { name: "Expand Tags" }).click();
  await expect(nav.getByRole("link", { name: /^\+\d+ more tags$/ })).toBeVisible();

  // The section title opens every folder, with search and sort.
  await nav.getByRole("link", { name: "Folders", exact: true }).click();
  await expect(page).toHaveURL(/\/folders$/);
  const list = page.getByRole("list", { name: "Folders" });
  await expect(list.getByRole("listitem").nth(11)).toBeVisible();
  const total = await list.getByRole("listitem").count();
  expect(total).toBeGreaterThanOrEqual(12);
  await expect(page.getByRole("status").filter({ hasText: `${total} folders` })).toBeVisible();
  await page.getByLabel("Search folders").fill("garden");
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("status").filter({ hasText: `1 of ${total} folders` })).toBeVisible();
  await page.getByLabel("Search folders").fill("");
  await pick(page.getByLabel("Sort"), "Most pages");
  await list.getByRole("link").first().click({ position: { x: 24, y: 24 } }); // the folder, not its centred "…" menu
  await expect(page).toHaveURL(/\/folders\/[0-9A-Z]{26}$/);

  // Tags: the same, from "+N more".
  await nav.getByRole("link", { name: /^\+\d+ more tags$/ }).click();
  await expect(page).toHaveURL(/\/tags$/);
  const tags = page.getByRole("list", { name: "Tags" });
  // 14 seeded + the 2 every new workspace starts with.
  await expect(tags.getByRole("listitem")).toHaveCount(16);
  await page.getByLabel("Search tags").fill("#draft");
  await expect(tags.getByRole("listitem")).toHaveCount(1);
  await tags.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/tags\/[0-9A-Z]{26}$/);
});

test("new notes land in Drafts with no page icon; folders take a colour; Home has three sections", async ({ browser }) => {
  const { page } = await newPersonWithWorkspace(browser, "Home Person");
  await showFolders(page);
  const nav = page.getByRole("navigation", { name: "Workspace" });
  const drafts = nav.getByRole("link", { name: /^Drafts/ });
  const before = Number((await drafts.innerText()).replace(/\D/g, "") || 0);

  // A new note starts in Drafts (even when created from a folder page); notes have no emoji icon.
  await nav.getByRole("link", { name: "Projects" }).click();
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}/);
  await expect(page.getByRole("textbox", { name: "Title" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Page icon|Add page icon/ })).toHaveCount(0);
  await expect(drafts).toContainText(String(before + 1));

  // Folder colour from the folder menu (no emoji, no "Move into").
  await nav.getByRole("link", { name: "Projects" }).hover();
  await nav.getByRole("button", { name: "Folder options for Projects" }).click();
  await expect(page.getByRole("menuitem", { name: /^Move into/ })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Change color…" }).click();
  await page.getByRole("dialog", { name: /Color for/ }).getByRole("radio", { name: "Crackle green" }).click();
  await nav.getByRole("link", { name: "Projects" }).hover();
  await nav.getByRole("button", { name: "Folder options for Projects" }).click();
  await page.getByRole("menuitem", { name: "Change color…" }).click();
  await expect(page.getByRole("dialog", { name: /Color for/ }).getByRole("radio", { name: "Crackle green" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");

  // Home: Recent notes, Starred and Recent folders, each with See all.
  await nav.getByRole("link", { name: "Home" }).click();
  for (const [name, href] of [
    ["Recent notes", "/notes"],
    ["Starred", "/starred"],
    ["Recent folders", "/folders"],
  ] as const) {
    const section = page.getByRole("region", { name });
    await expect(section).toBeVisible();
    await expect(section.getByRole("link", { name: /^See all/ })).toHaveAttribute("href", href);
  }
  // Recent notes and Starred are single sideways rows of at most 10 notes, with arrows to scroll.
  const recentList = page.getByRole("list", { name: "Recent notes" });
  await expect(recentList.getByRole("listitem").first()).toBeVisible();
  expect(await recentList.getByRole("listitem").count()).toBeLessThanOrEqual(10);
  await page.setViewportSize({ width: 1100, height: 900 });
  const forward = page.getByRole("button", { name: "Scroll recent notes forward" });
  await forward.click();
  await expect(page.getByRole("button", { name: "Scroll recent notes back" })).toBeVisible();
  await expect.poll(() => recentList.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);

  // Folder cards have the same folder menu on hover.
  const folderCard = page.getByRole("region", { name: "Recent folders" }).getByRole("listitem").first();
  await folderCard.hover();
  await folderCard.getByRole("button", { name: /^Folder options for/ }).click();
  for (const item of ["New note in folder", "Rename…", "Change color…", "Copy link", "Delete folder…"]) {
    await expect(page.getByRole("menuitem", { name: item })).toBeVisible();
  }
  await page.keyboard.press("Escape");

  await page.getByRole("region", { name: "Recent notes" }).getByRole("link", { name: /^See all/ }).click();
  await expect(page.getByRole("heading", { name: "All notes", level: 1 })).toBeVisible();
});
