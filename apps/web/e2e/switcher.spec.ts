import { expect, test, type Page } from "@playwright/test";
import { APP, createWorkspace, newPerson, switcher, switchTo, waitForSaved } from "./helpers";

// Personal is not a workspace (docs/ACCOUNT_MODEL_PLAN.md): the switcher at the bottom of the sidebar lists
// Personal first, then your team workspaces, and everything in the app follows the current context.
// Spec scenarios 24 (Personal → workspace → Personal, no leakage) and 26 (no workspaces: Personal works).

const SWITCHER = /: Personal, workspaces and account$/;

async function searchFor(page: Page, query: string) {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  const input = page.getByRole("combobox", { name: /Search documents/ });
  await expect(input).toBeFocused();
  await input.fill(query);
  return page.getByRole("dialog", { name: "Search and commands" });
}

test("a new account starts in Personal with no workspaces, and each context shows only its own notes", async ({ browser }) => {
  test.setTimeout(180_000);
  const { page } = await newPerson(browser, "Switch Person");
  await page.goto(`${APP}/documents`);
  const recent = page.getByRole("list", { name: "Recent notes" });

  // Personal: the default. The trigger shows you and "Personal".
  await expect(switcher(page)).toHaveAccessibleName("Personal: Personal, workspaces and account");
  await expect(switcher(page)).toContainText("Switch Person");
  await expect(switcher(page)).toContainText("Personal");
  await expect(recent.getByRole("link", { name: /Welcome to Folevi/ })).toBeVisible();

  // The menu: Personal first (checked, with your plan), then Workspaces (none yet) and "New workspace…".
  await switcher(page).click();
  const menu = page.getByRole("menu", { name: SWITCHER });
  const personal = menu.getByRole("menuitemradio", { name: "Personal", exact: true });
  await expect(personal).toHaveAttribute("aria-checked", "true");
  await expect(personal).toContainText("Switch Person");
  await expect(personal).toContainText("Pro AI trial"); // new accounts start with the 7-day Pro AI trial
  await expect(menu.getByText("Workspaces", { exact: true })).toBeVisible();
  // Only Personal and the three appearance choices are choices: no workspaces.
  await expect(menu.getByRole("menuitemradio")).toHaveCount(4);
  await expect(menu.getByRole("menuitem", { name: "New workspace…" })).toBeVisible();
  // Personal has no members or workspace settings, and is never called a workspace.
  await expect(menu.getByRole("menuitem", { name: "Members" })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "Workspace settings" })).toHaveCount(0);
  await expect(menu.getByText(/personal workspace/i)).toHaveCount(0);
  await page.keyboard.press("Escape");

  // A new workspace opens empty: none of Personal's notes leak into it.
  await createWorkspace(page, "Switch Studio");
  await page.waitForURL(/\/documents$/);
  await expect(page.getByText("No notes yet. Press New to write your first one.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Welcome to Folevi/ })).toHaveCount(0);

  // A note written in the workspace lives there.
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill("Studio plans");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Only for the studio.");
  await waitForSaved(page);
  await page.goto(`${APP}/documents`);
  await expect(recent.getByRole("link", { name: /Studio plans/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Welcome to Folevi/ })).toHaveCount(0);

  // The menu lists it with your role, checked.
  await switcher(page).click();
  const studio = menu.getByRole("menuitemradio", { name: "Switch Studio", exact: true });
  await expect(studio).toHaveAttribute("aria-checked", "true");
  await expect(studio).toContainText("Owner · Free");
  await expect(menu.getByRole("menuitemradio", { name: "Personal", exact: true })).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");

  // Back to Personal: its notes and not the workspace's, on Home and in search.
  await switchTo(page, "Personal");
  await expect(recent.getByRole("link", { name: /Welcome to Folevi/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Studio plans/ })).toHaveCount(0);
  let palette = await searchFor(page, "Studio plans");
  await expect(palette.getByText("No documents match “Studio plans”.")).toBeVisible();
  await page.keyboard.press("Escape");

  // And to the workspace again; a reload keeps the choice.
  await switchTo(page, "Switch Studio");
  await expect(recent.getByRole("link", { name: /Studio plans/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Welcome to Folevi/ })).toHaveCount(0);
  palette = await searchFor(page, "Welcome to Folevi");
  await expect(palette.getByText("No documents match “Welcome to Folevi”.")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(switcher(page)).toHaveAccessibleName("Switch Studio: Personal, workspaces and account");
  await expect(recent.getByRole("link", { name: /Studio plans/ })).toBeVisible();

  // Settings: the workspace's group appears only while it's open; Personal offers to create one instead.
  await page.goto(`${APP}/settings/account`);
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  await expect(sections.getByText("Switch Studio")).toBeVisible();
  await expect(sections.getByRole("link", { name: "Members" })).toBeVisible();
  await switchTo(page, "Personal");
  await expect(sections.getByRole("link", { name: "Members" })).toHaveCount(0);
  await expect(sections.getByRole("button", { name: "Create a workspace" })).toBeVisible();
  // Import & export under "You" exports Personal.
  await sections.getByRole("link", { name: "Import & export" }).click();
  await expect(page.getByRole("button", { name: "Export Personal (.zip)" })).toBeVisible();
});

test("a page from Personal still opens by link while a workspace is selected, without folder actions", async ({ browser }) => {
  const { page } = await newPerson(browser, "Deep Linker");
  await page.goto(`${APP}/documents`);
  await page.getByRole("list", { name: "Recent notes" }).getByRole("link", { name: /Welcome to Folevi/ }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}/);
  const personalUrl = page.url();
  await page.goto(`${APP}/documents`);
  await createWorkspace(page, "Link Studio");

  // Opened by id while the workspace is selected: it works, and edits save.
  await page.goto(personalUrl);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Welcome to Folevi");
  const body = page.getByRole("textbox", { name: "Document body" });
  await expect(body).toHaveAttribute("contenteditable", "true");
  await body.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Edited while in a workspace");
  await waitForSaved(page);
  // It belongs to Personal, not the open workspace: no "Move to folder" here.
  await page.getByRole("button", { name: "Document actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Move to folder…" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Back in Personal, the edit is there and the page can be filed again.
  await switchTo(page, "Personal");
  await page.goto(personalUrl);
  await expect(page.getByRole("textbox", { name: "Document body" })).toContainText("Edited while in a workspace");
  await page.getByRole("button", { name: "Document actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Move to folder…" })).toBeVisible();
});
