import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { APP, completeOnboarding, createAccount, createWorkspace, openTool, pick, pickDate, showFolders, switchTo, waitForSaved } from "./helpers";

// Frames of the real web app for the marketing home page's showcase (components/marketing/home/DeviceShowcase.tsx):
// a demo workspace ("Studio", Maya Patel and Sam Okafor) built through the UI on the dev deployment, then one PNG
// per chapter step in public/marketing/showcase/web/. Run it on purpose only:
//   SHOWCASE_CAPTURE=1 E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 npx playwright test e2e/showcase-capture.spec.ts --project=account
// SHOWCASE_ACCOUNT_FILE (optional) is where the test accounts' sign-in details are written (never in the repo).
test.skip(!process.env.SHOWCASE_CAPTURE, "Set SHOWCASE_CAPTURE=1 to capture the showcase frames.");

const OUT = fileURLToPath(new URL("../public/marketing/showcase/web/", import.meta.url));
const DEBUG = process.env.SHOWCASE_DEBUG; // a folder for extra screenshots while working on this spec

/** The demo Vault's passcode (a test value on the dev deployment). */
const VAULT_PASSCODE = "246810";

const VIEW = { viewport: { width: 1280, height: 800 }, colorScheme: "light" as const, reducedMotion: "reduce" as const };

/** Dev-only overlays and nudges that aren't part of the app people see. */
const HIDE = `
nextjs-portal, [data-nextjs-toast], [data-nextjs-dev-tools-button], .ui-toasts { display: none !important; }
*, *::before, *::after { caret-color: transparent !important; }
`;

async function frame(page: Page, name: string) {
  // The pointer rests on the window's bottom-left corner, away from hover states and tooltips.
  await page.mouse.move(2, 798);
  await page.addStyleTag({ content: HIDE });
  await page.waitForTimeout(600);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}${name}.png` });
}

async function debug(page: Page, name: string) {
  if (!DEBUG) return;
  mkdirSync(DEBUG, { recursive: true });
  await page.screenshot({ path: `${DEBUG}/${name}.png` });
}

async function person(browser: Browser, key: string, name: string, scale: number): Promise<{ context: BrowserContext; page: Page; email: string; password: string; totpSecret: string }> {
  const context = await browser.newContext({ ...VIEW, deviceScaleFactor: scale });
  context.setDefaultTimeout(30_000);
  const { page, account } = await createAccount(context, { name, email: `${key}-${Date.now().toString(36)}@example.com` });
  await completeOnboarding(page);
  return { context, page, email: account.email, password: account.password, totpSecret: account.totpSecret };
}

const nav = (page: Page) => page.getByRole("navigation", { name: "Folio" });

async function newFolder(page: Page, name: string, color: string, parent?: string) {
  await showFolders(page);
  if (parent) {
    await nav(page).getByRole("button", { name: `Folder options for ${parent}` }).click();
    await page.getByRole("menuitem", { name: "New folder inside…" }).click();
  } else {
    await page.getByRole("button", { name: "New folder" }).click();
  }
  await page.getByLabel("Folder name").fill(name);
  await page.getByRole("button", { name: "Create folder" }).click();
  await expect(nav(page).getByRole("link", { name, exact: true })).toBeVisible();
  await nav(page).getByRole("button", { name: `Folder options for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Change color…" }).click();
  await page.getByRole("radiogroup", { name: "Folder color" }).getByRole("radio", { name: color, exact: true }).click();
}

/** A new note in a folder: open the folder, New note, title. Leaves the caret at the start of the body. */
async function newNoteIn(page: Page, folder: string, title: string) {
  await showFolders(page);
  await nav(page).getByRole("link", { name: folder, exact: true }).click();
  await page.getByRole("button", { name: "New note", exact: true }).first().click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}/);
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Document body" })).toBeFocused();
}

async function setTheme(page: Page, theme: string) {
  await openTool(page, "Style");
  await page.getByRole("group", { name: "Note Theme" }).getByRole("button").first().click();
  await page.getByRole("radiogroup", { name: "Note theme" }).getByRole("radio", { name: `Note theme: ${theme}` }).click();
  await page.getByRole("dialog", { name: "Note theme" }).getByRole("button", { name: "Done" }).click();
  // Close the Style panel again.
  await page.getByRole("toolbar", { name: "Page tools" }).getByRole("button", { name: "Style", exact: true }).click();
}

test("capture the showcase frames from the real app", async ({ browser }) => {
  test.setTimeout(1_500_000);
  const maya = await person(browser, "maya", "Maya Patel", 2);
  const sam = await person(browser, "sam", "Sam Okafor", 1);
  if (process.env.SHOWCASE_ACCOUNT_FILE) {
    writeFileSync(
      process.env.SHOWCASE_ACCOUNT_FILE,
      JSON.stringify({ app: APP, workspace: "Studio", maya: { email: maya.email, password: maya.password, totpSecret: maya.totpSecret }, sam: { email: sam.email, password: sam.password, totpSecret: sam.totpSecret } }, null, 2),
    );
  }
  const page = maya.page;

  // ---- Setup: everything except what the frames show being made. ----

  // The Studio workspace and its folders.
  await createWorkspace(page, "Studio");
  await newFolder(page, "Spring launch", "Coral");
  await newFolder(page, "Content plan", "Blue");
  await newFolder(page, "Team wiki", "Green");
  await newFolder(page, "Onboarding", "Emerald", "Team wiki");
  await newFolder(page, "Personal", "Pink");

  // Sam joins Studio (an invitation from Members, accepted from his notifications).
  await page.goto(`${APP}/settings/members`);
  await page.getByPlaceholder("name@example.com").fill(sam.email);
  await page.getByRole("button", { name: "Invite" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Invitation sent/ })).toBeVisible();
  await sam.page.goto(`${APP}/documents`);
  await sam.page.getByRole("button", { name: /Notifications/ }).click();
  await sam.page.getByRole("button", { name: "Accept invitation" }).first().click();
  await switchTo(sam.page, "Studio");
  await page.goto(`${APP}/documents`);

  // Team wiki pages and a few more notes, so Home looks lived in.
  const notes: [string, string, string, string[]][] = [
    ["Onboarding", "Onboarding", "Blossoms", ["Welcome to Studio! Your first week, step by step.", "Day one: laptop, accounts and a coffee with your buddy.", "Day two: read How we write and the Release checklist."]],
    ["Team wiki", "How we write", "Parchment", ["Short sentences. Plain words. One idea per paragraph.", "Write for the reader who is in a hurry: lead with what changed and why it matters."]],
    ["Team wiki", "Release checklist", "Harbor blue", ["Before every release:", "Changelog written and reviewed", "Screenshots updated", "Support team briefed"]],
    ["Personal", "Reading list", "Poppy print", ["Books for the autumn:", "The Creative Act by Rick Rubin", "Four Thousand Weeks by Oliver Burkeman", "Tomorrow, and Tomorrow, and Tomorrow"]],
    ["Personal", "Weekly review", "Summer sky", ["Wins: press kit is done and the pricing page draft is in.", "Next week: launch on Thursday, then a quiet Friday.", "Remember: thank-you notes to the beta testers."]],
  ];
  for (const [folder, title, theme, lines] of notes) {
    await newNoteIn(page, folder, title);
    for (const [i, line] of lines.entries()) {
      if (i) await page.keyboard.press("Enter");
      await page.keyboard.type(line);
    }
    await setTheme(page, theme);
    await waitForSaved(page);
  }

  // The Content plan collection (a table view; the board is added on camera).
  await newNoteIn(page, "Content plan", "Content plan");
  const contentUrl = page.url().replace(/\?.*$/, "");
  await page.keyboard.type("/collection");
  await expect(page.getByRole("option", { name: /Database/ })).toBeVisible();
  await page.keyboard.press("Enter");
  let coll = page.getByRole("region", { name: /^Collection / });
  await expect(coll).toBeVisible();
  await coll.getByRole("textbox", { name: "Collection name" }).fill("Content plan");
  await coll.getByRole("textbox", { name: "Collection name" }).press("Enter");
  coll = page.getByRole("region", { name: "Collection Content plan" });
  await expect(coll).toBeVisible();
  await coll.getByRole("button", { name: /View settings/ }).click();
  const settings = page.getByRole("dialog", { name: /settings/ });
  await settings.getByLabel("Options for Status (comma-separated)").fill("Ideas, Doing, Done");
  await settings.getByLabel("Options for Status (comma-separated)").press("Tab");
  await settings.getByRole("button", { name: "Delete property Date" }).click();
  await page.getByRole("button", { name: "Delete property", exact: true }).click();
  await expect(coll.getByRole("columnheader", { name: "Date" })).toHaveCount(0);
  await page.waitForTimeout(500);
  if (!(await settings.isVisible())) await coll.getByRole("button", { name: /View settings/ }).click();
  for (const [name, type] of [["Type", "Single select"], ["Owner", "Text"]] as const) {
    await settings.getByRole("textbox", { name: "New property" }).fill(name);
    await pick(settings.getByRole("combobox", { name: "Property type" }), type);
    await settings.getByRole("button", { name: "Add", exact: true }).click();
    await expect(settings.getByRole("textbox", { name: `Name of property ${name}` })).toBeVisible();
  }
  await settings.getByLabel("Options for Type (comma-separated)").fill("Blog, Email, Video");
  await settings.getByLabel("Options for Type (comma-separated)").press("Tab");
  await settings.getByRole("button", { name: "Close" }).click();
  const plan = [
    ["Launch post", "Blog", "Sam", "Doing"],
    ["Customer story", "Blog", "Ines", "Doing"],
    ["Spring newsletter", "Email", "Maya", "Done"],
    ["Feature video", "Video", "Sam", "Ideas"],
  ];
  // Enter in a row's name adds the next row, so each name is typed into the row Enter made.
  await coll.getByRole("button", { name: "New row" }).click();
  for (const [i, [name]] of plan.entries()) {
    const rowName = coll.getByRole("textbox", { name: "Row name" });
    await expect(rowName).toHaveCount(i + 1);
    await rowName.nth(i).fill(name!);
    if (i < plan.length - 1) await rowName.nth(i).press("Enter");
    else await rowName.nth(i).evaluate((el) => (el as HTMLInputElement).blur());
  }
  await expect(coll.getByRole("textbox", { name: "Row name" })).toHaveCount(plan.length);
  for (const [name, type, owner, status] of plan) {
    await pick(coll.getByRole("combobox", { name: `Type for ${name}` }), type!);
    await pick(coll.getByRole("combobox", { name: `Status for ${name}` }), status!);
    await coll.getByRole("textbox", { name: `Owner for ${name}` }).fill(owner!);
    await coll.getByRole("textbox", { name: `Owner for ${name}` }).press("Enter");
  }
  await waitForSaved(page);

  // The Spring launch page: titled and themed; its words are typed on camera.
  await newNoteIn(page, "Spring launch", "Spring launch");
  const springUrl = page.url().replace(/\?.*$/, "");
  await setTheme(page, "Irises");
  await waitForSaved(page);

  // Bookmarks: the launch page and the content plan (they show in the sidebar and on Home).
  for (const [url, title] of [[springUrl, "Spring launch"], [contentUrl, "Content plan"]] as const) {
    await page.goto(url);
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(title);
    await page.getByRole("group", { name: "Page" }).getByRole("button", { name: "Document actions" }).click();
    await page.getByRole("menuitem", { name: /^Bookmark/ }).click();
    await showFolders(page);
    await expect(nav(page).getByRole("group", { name: "Bookmarked pages" }).getByRole("link", { name: title })).toBeVisible();
  }

  // This week's tasks, with due dates.
  await nav(page).getByRole("link", { name: /^Tasks( \d+)?$/ }).click();
  const day = (offset: number) =>
    page.evaluate((o) => {
      const d = new Date();
      d.setDate(d.getDate() + o);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }, offset);
  for (const [task, offset] of [["Send the press kit", 0], ["Review the launch post", 1], ["Publish the pricing page", 2], ["Thank-you notes to beta testers", 4]] as const) {
    await page.getByRole("button", { name: "Add task" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Quick add task" });
    await dialog.getByLabel("Task").fill(task);
    await dialog.getByRole("button", { name: /^Due date/ }).click();
    await pickDate(page.getByRole("dialog", { name: "Choose due date" }), await day(offset));
    await dialog.getByRole("button", { name: "Add task" }).click();
    await expect(dialog).toBeHidden();
  }
  await page.getByRole("link", { name: /^All( \d+)?$/ }).click();

  // The team's Vault: set up with a test passcode, three items.
  await nav(page).getByRole("link", { name: "Vault" }).click();
  await expect(page.getByRole("heading", { name: /^Set up your/ })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Choose a passcode").fill(VAULT_PASSCODE);
  await page.getByLabel("Type it again").fill(VAULT_PASSCODE);
  await page.getByRole("button", { name: "Set up the Vault" }).click();
  await expect(page.getByRole("heading", { name: "Save your Vault recovery key" })).toBeVisible({ timeout: 60_000 });
  const groups = (await page.getByRole("list", { name: "Your recovery key" }).locator("li").allInnerTexts()).map((g) => g.replace(/^Group \d+:\s*/, "").trim());
  await page.getByRole("button", { name: "I've saved it" }).click();
  await page.getByLabel("Group 3").fill(groups[2]!);
  await page.getByLabel("Group 7").fill(groups[6]!);
  await page.getByRole("button", { name: "Check and continue" }).click();
  await page.getByRole("tab", { name: "Passwords & Credentials" }).click();
  const items: [string, string, Record<string, string>][] = [
    ["Login", "Bank login", { Username: "maya@studio.example", Password: "Harbor-Lantern-42-Quiet", Website: "https://bank.example", "2FA secret": "JBSWY3DPEHPK3PXP" }],
    ["API key", "Stripe API key", { Service: "Stripe", Key: "sk_test_demo_4eC39HqLyjWDarjtT1zdp7dc", Environment: "Test" }],
    ["Wi-Fi", "Studio Wi-Fi", { "Network name": "Studio 5G", Password: "Blue-Irises-Spring-12", Security: "WPA3" }],
  ];
  for (const [kind, title, fields] of items) {
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const add = page.getByRole("dialog", { name: "Add to the Vault" });
    await pick(add.getByRole("combobox", { name: "Kind" }), kind);
    await add.getByLabel("Title").fill(title);
    for (const [label, value] of Object.entries(fields)) await add.getByLabel(label, { exact: true }).fill(value);
    await add.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("region", { name: title })).toBeVisible({ timeout: 30_000 });
  }

  // The same tabs in every frame: Home, Spring launch, Content plan, Tasks, Vault.
  const strip = page.getByRole("navigation", { name: "Open pages" });
  await strip.getByRole("link").filter({ hasNotText: /^$/ }).last().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Close all tabs" }).click();
  // Opened from the sidebar, each in its own tab (a reload would replace the current tab instead).
  await showFolders(page);
  const bookmarks = nav(page).getByRole("group", { name: "Bookmarked pages" });
  await bookmarks.getByRole("link", { name: "Spring launch" }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Spring launch");
  await showFolders(page);
  await bookmarks.getByRole("link", { name: "Content plan" }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Content plan");
  await showFolders(page);
  await nav(page).getByRole("link", { name: /^Tasks( \d+)?$/ }).click();
  await expect(page.getByRole("button", { name: "Add task" }).first()).toBeVisible();
  await nav(page).getByRole("link", { name: "Vault" }).click();
  await expect(page.getByRole("button", { name: "Lock", exact: true }).or(page.getByRole("heading", { name: "The Vault is locked" })).first()).toBeVisible();
  // Folders stay in view under a collapsed Bookmarks.
  await nav(page).getByRole("button", { name: "Collapse Bookmarks" }).click();
  const tab = (name: RegExp) => strip.getByRole("link", { name });
  await debug(page, "09-tabs");

  // ---- Frames ----

  // Chapter 1, write: the Spring launch page.
  await tab(/^Spring launch$/).click();
  await page.getByRole("textbox", { name: "Document body" }).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("Launch day is Thursday the 12th. Here's who does what.");
  await waitForSaved(page);
  await frame(page, "write-1");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/table");
  await expect(page.getByRole("option", { name: /Simple table/ })).toBeVisible();
  await frame(page, "write-2");
  await page.keyboard.press("Enter");
  await expect(page.locator(".fb-editor table.fb-table")).toBeVisible();
  const cell = (r: number, c: number) => page.getByRole("textbox", { name: `Row ${r}, column ${c}` });
  await cell(1, 1).click();
  const rows = [
    ["Task", "Owner", "Status"],
    ["Press kit", "Maya", "Done"],
    ["Launch post", "Sam", "Doing"],
    ["Pricing page", "Ines", "Doing"],
  ];
  for (const [r, row] of rows.entries()) {
    for (const [c, text] of row.entries()) {
      if (r || c) await page.keyboard.press("Tab");
      await page.keyboard.type(text);
    }
  }
  await page.keyboard.press("Escape");
  // The closing line goes in the empty paragraph under the table.
  await page.locator(".fb-editor > p.fb-paragraph").last().click();
  await page.keyboard.type("Press kit, launch post, pricing page.");
  await waitForSaved(page);
  await frame(page, "write-3");

  // Chapter 2, together: Sam in the same page, a comment, his reply.
  await sam.page.goto(springUrl);
  const samBody = sam.page.getByRole("textbox", { name: "Document body" });
  await expect(samBody).toContainText("Here's who does what");
  await samBody.locator("p").first().click();
  await sam.page.keyboard.press("End");
  const mayaBody = page.getByRole("textbox", { name: "Document body" });
  await expect(mayaBody.locator('[data-remote-caret="Sam"]')).toBeVisible({ timeout: 30_000 });
  await frame(page, "together-1");

  // Maya comments on the launch-day line (⌘⌥M), mentioning Sam.
  await mayaBody.locator("p").first().click();
  await page.waitForTimeout(500);
  await page.keyboard.press("ControlOrMeta+Alt+KeyM");
  const card = page.getByRole("dialog", { name: "Comments" });
  const composer = card.getByRole("textbox").first();
  await expect(composer).toBeFocused();
  await page.keyboard.type("@Sam");
  await expect(page.getByRole("option", { name: /Sam Okafor/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(composer).toHaveValue(/@Sam Okafor $/);
  await page.keyboard.type("can the embargo lift at 9am on the 12th?");
  await page.keyboard.press("Enter");
  await expect(card.getByText("can the embargo lift")).toBeVisible();
  await frame(page, "together-2");

  // Sam answers from the note's Comments; Maya resolves the thread.
  await sam.page.getByRole("tab", { name: /^Comments/ }).click();
  await sam.page.getByRole("tabpanel").getByText("can the embargo lift").click();
  const reply = sam.page.getByRole("textbox", { name: "Reply" }).first();
  await reply.click();
  await sam.page.keyboard.type("Yes, 9am works. I'll schedule the launch post for then.");
  await sam.page.keyboard.press("Enter");
  await expect(card.getByText("9am works")).toBeVisible({ timeout: 30_000 });
  await frame(page, "together-3");
  await card.getByRole("button", { name: "Resolve thread" }).click();
  await expect(card.getByText(/^Resolved/)).toBeVisible();
  await frame(page, "together-4");
  await card.getByRole("button", { name: "Close comments" }).click();
  await sam.page.goto(`${APP}/documents`);

  // Chapter 3, tasks: this week's list, one ticked, then the calendar.
  await tab(/^Tasks/).click();
  await page.getByRole("link", { name: /^All( \d+)?$/ }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Thank-you notes to beta testers" })).toBeVisible();
  await page.mouse.move(5, 790);
  await frame(page, "tasks-1");
  await page.getByRole("listitem").filter({ hasText: "Send the press kit" }).getByRole("checkbox").click();
  await page.waitForTimeout(300);
  await page.mouse.move(5, 790);
  await frame(page, "tasks-2");
  await page.getByRole("link", { name: "Calendar" }).first().click();
  await expect(page.getByRole("gridcell").filter({ hasText: "Review the launch post" })).toBeVisible();
  await frame(page, "tasks-3");
  // Back to the four tabs (the calendar opened its own).
  await page.goBack();
  await strip.getByRole("button", { name: /^Close Calendar/ }).click().catch(() => undefined);

  // Chapter 4, board: the Content plan as a table, then as a board by Status.
  await tab(/^Content plan$/).click();
  coll = page.getByRole("region", { name: "Collection Content plan" });
  await expect(coll.getByRole("textbox", { name: "Row name" })).toHaveCount(plan.length);
  await page.mouse.click(5, 790);
  await frame(page, "board-1");
  await pick(coll.getByRole("combobox", { name: "Add view" }), "Board");
  await expect(coll.getByRole("group", { name: "Views" }).getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(5, 790);
  await frame(page, "board-2");

  // Chapter 6, the Vault: open with the three items (secrets hidden), then locked.
  await tab(/^Vault/).click();
  if (await page.getByRole("heading", { name: "The Vault is locked" }).isVisible()) {
    await page.getByLabel("Passcode").fill(VAULT_PASSCODE);
    await page.getByRole("button", { name: "Unlock" }).click();
  }
  await page.getByRole("tab", { name: "Passwords & Credentials" }).click();
  await page.getByRole("button", { name: /^Bank login/ }).click();
  await expect(page.getByRole("region", { name: "Bank login" })).toContainText("••••");
  await page.mouse.move(5, 790);
  await frame(page, "vault-2");
  await page.getByRole("button", { name: "Lock", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The Vault is locked" })).toBeVisible();
  await page.mouse.move(5, 790);
  await frame(page, "vault-1");

  // Home, then chapter 5, Foli AI, asked from Home.
  await strip.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Recent notes" })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.mouse.move(5, 790);
  await frame(page, "home-1");
  await page.getByRole("button", { name: "Ask Foli AI" }).click();
  const ai = page.getByRole("dialog", { name: "Foli AI" });
  await expect(ai).toBeVisible();
  await ai.getByRole("textbox").first().fill("What's left before the launch?");
  await frame(page, "ai-1");
  await page.keyboard.press("Enter");
  try {
    await expect(ai.locator(".fb-ai-answer")).toBeVisible({ timeout: 90_000 });
    // Until the answer has finished (its sources are listed at the end).
    await expect(ai.getByRole("button", { name: /Regenerate/ })).toBeVisible({ timeout: 90_000 });
    await page.waitForTimeout(2000);
    await frame(page, "ai-2");
  } catch {
    await debug(page, "50-ai-failed");
    console.log("Foli AI did not answer on this deployment: ai-2 not captured.");
  }

  // A WebP copy of each frame (quality 82), when cwebp is installed.
  for (const file of readdirSync(OUT).filter((f) => f.endsWith(".png"))) {
    try {
      execFileSync("cwebp", ["-quiet", "-q", "82", `${OUT}${file}`, "-o", `${OUT}${file.replace(/\.png$/, ".webp")}`]);
    } catch {
      console.log("cwebp isn't installed: PNG frames only.");
      break;
    }
  }
});
