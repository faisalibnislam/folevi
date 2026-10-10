import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { APP, createAccount, completeOnboarding, endTrial, grantPlatformRole, newPerson, openTool, pick, waitForSaved } from "./helpers";

const IMAGE = fileURLToPath(new URL("../../../packages/design-tokens/covers/source/27-ultramarine.jpg", import.meta.url));

/** Opens the theme gallery (a modal) from the Style panel; returns its grid of themes. */
async function openThemes(page: Page) {
  await openTool(page, "Style");
  await page.getByRole("group", { name: "Note Theme" }).getByRole("button").first().click();
  await expect(page.getByRole("dialog", { name: "Note theme" })).toBeVisible();
  return page.getByRole("radiogroup", { name: "Note theme" });
}
const closeThemes = (page: Page) => page.getByRole("dialog", { name: "Note theme" }).getByRole("button", { name: "Done" }).click();

test("picking a theme sets its colours, separator and font type, drawn in its own typefaces", async ({ browser }) => {
  const { page } = await newPerson(browser, "Theme Picker");
  const themes = await openThemes(page);
  const sheet = page.locator("article.fb-sheet");
  const editor = page.locator(".fb-editor").first();

  // Ultramarine starts Modern with doodle separators, in Plus Jakarta Sans.
  await themes.getByRole("radio", { name: "Note theme: Ultramarine" }).click();
  await expect(sheet).toHaveAttribute("data-separator", "doodle");
  await expect(page.getByRole("button", { name: "Font: Modern" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => editor.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Plus Jakarta Sans");
  // Black satin starts on a night page, in its serif (Spectral).
  await themes.getByRole("radio", { name: "Note theme: Black satin" }).click();
  await expect(sheet).toHaveAttribute("data-sheet", "night");
  await expect(sheet).toHaveAttribute("data-separator", "line");
  await expect(page.getByRole("button", { name: "Font: Serif" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => editor.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Spectral");
  // People can still change what the theme set; Mono draws in the theme's mono (JetBrains Mono).
  await closeThemes(page);
  await page.getByRole("button", { name: "Font: Mono" }).click();
  await expect.poll(() => editor.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("JetBrains Mono");
  await waitForSaved(page);
  await page.reload();
  await expect(page.locator("article.fb-sheet")).toHaveAttribute("data-sheet", "night");
  await expect(page.locator("#doc-scroll")).toHaveAttribute("data-font", "mono");
  // Picking a theme again resets to its defaults.
  await (await openThemes(page)).getByRole("radio", { name: "Note theme: Irises" }).click();
  await expect(page.locator("article.fb-sheet")).toHaveAttribute("data-sheet", "art");
  await expect(page.locator("#doc-scroll")).toHaveAttribute("data-font", "serif");
});

test("the Theme manager adds a theme, gates it by plan, reorders, retires and deletes it", async ({ browser }) => {
  test.setTimeout(240_000);
  const adminContext = await browser.newContext();
  const { page: admin, account } = await createAccount(adminContext, { name: "Theme Admin" });
  await completeOnboarding(admin);
  grantPlatformRole(account.email, "super_admin");
  const name = `Test theme ${Date.now().toString(36)}`;

  // A new theme: an image (its colours are picked from it), a name, saved as a draft.
  await admin.goto(`${APP}/admin/themes/new`);
  await expect(admin.getByRole("navigation", { name: "Admin" })).toBeVisible({ timeout: 30_000 });
  await admin.locator('input[type="file"]').setInputFiles(IMAGE);
  await expect(admin.getByRole("heading", { name: "Colours" })).toBeVisible({ timeout: 60_000 });
  await admin.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await pick(admin.getByRole("combobox", { name: "Serif typeface" }), "Fraunces");
  await admin.getByRole("group", { name: "Font" }).getByRole("button", { name: "Serif" }).click();
  await admin.getByRole("button", { name: "Save as draft" }).click();
  await admin.waitForURL(/\/admin\/themes\/th-[0-9A-Z]{26}$/, { timeout: 30_000 });
  const key = admin.url().split("/").pop()!;
  await expect(admin.getByText("Draft", { exact: true }).first()).toBeVisible();

  // A draft isn't in anyone's picker.
  const { page: person } = await newPerson(browser, "Theme Person");
  let picker = await openThemes(person);
  await expect(picker.getByRole("radio", { name: `Note theme: ${name}` })).toHaveCount(0);

  // Published, for Pro and up.
  await pick(admin.getByRole("combobox", { name: "Who can pick it" }), "Pro and up");
  await admin.getByRole("button", { name: "Save changes" }).click();
  await expect(admin.getByRole("button", { name: "Save changes" })).toBeDisabled({ timeout: 20_000 });
  await admin.getByRole("button", { name: "Publish" }).click();
  await expect(admin.getByText("Published", { exact: true }).first()).toBeVisible();

  // The person is on the Pro trial: they can pick it, and it brings its typefaces.
  await expect(picker.getByRole("radio", { name: `Note theme: ${name}` })).toBeVisible({ timeout: 20_000 });
  await picker.getByRole("radio", { name: `Note theme: ${name}` }).click();
  await expect(person.locator("#doc-scroll")).toHaveAttribute("data-font", "serif");
  await expect.poll(() => person.locator(".fb-editor").first().evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Fraunces");
  await waitForSaved(person);

  // On Free it's locked in the picker (the note that has it keeps it).
  const free = await newPerson(browser, "Free Person");
  endTrial(free.email);
  await free.page.reload();
  picker = await openThemes(free.page);
  const locked = picker.getByRole("radio", { name: `Note theme: ${name} (Pro and up)` });
  await expect(locked).toBeVisible({ timeout: 20_000 });
  await locked.click();
  await expect(free.page.getByRole("dialog", { name: "Note theme" }).getByRole("status")).toContainText(/is for Pro plans and up/);
  await expect(locked).toHaveAttribute("aria-checked", "false");

  // Reorder from the list with the keyboard: one step to the left.
  await admin.goto(`${APP}/admin/themes`);
  const handle = admin.getByRole("button", { name: new RegExp(`^Move ${name} \\(position (\\d+) of`) });
  const before = Number(/position (\d+)/.exec((await handle.getAttribute("aria-label"))!)![1]);
  await handle.focus();
  await admin.keyboard.press("ArrowLeft");
  await expect(handle).toHaveAttribute("aria-label", new RegExp(`position ${before - 1} of`), { timeout: 20_000 });

  // Retired: out of the picker; the note that uses it keeps it.
  await admin.goto(`${APP}/admin/themes/${key}`);
  await admin.getByRole("button", { name: "Retire" }).click();
  await expect(admin.getByText("Retired", { exact: true }).first()).toBeVisible();
  await expect(free.page.getByRole("radiogroup", { name: "Note theme" }).getByRole("radio", { name: new RegExp(name) })).toHaveCount(0, { timeout: 20_000 });
  await expect(person.getByRole("radio", { name: `Note theme: ${name}` })).toHaveAttribute("aria-checked", "true");

  // Deleted for good: its notes move to the theme picked for them.
  await admin.getByRole("button", { name: "Delete theme…" }).click();
  const dialog = admin.getByRole("dialog");
  await pick(dialog.getByRole("combobox", { name: "Move its notes to" }), "Irises");
  await dialog.getByLabel(/Reason/).fill("Test theme, cleaning up after the run.");
  await dialog.getByRole("button", { name: "Delete theme" }).click();
  await admin.waitForURL(/\/admin\/themes$/, { timeout: 20_000 });
  await expect(person.getByRole("radio", { name: "Note theme: Irises" })).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
  await expect(person.locator("#doc-scroll")).toHaveAttribute("style", /\/covers\/art-03/);
});
