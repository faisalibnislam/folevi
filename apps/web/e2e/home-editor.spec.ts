import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { APP } from "./helpers";

// The home page's note is the app's real editor, running with no account and no server: it can be edited,
// its to-dos ticked, blocks inserted with "/", formatted and restyled from the page tools dock; what needs an
// account asks the visitor to sign up; and a reload brings the original note back (nothing is saved).
const SITE = (process.env.E2E_SITE_URL ?? APP.replace("://app.", "://")).replace(/\/$/, "");

test("the home page note is editable, and a reload resets it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const external: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith(SITE) && !r.url().startsWith("data:")) external.push(r.url());
  });
  await page.goto(`${SITE}/`);
  const editor = page.getByRole("textbox", { name: "Try the editor" });
  await expect(editor).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("A quiet notes app for ideas that keep growing.");

  // Type at the end of the heading (clicking past its text puts the caret at its end).
  const heading = editor.getByRole("heading", { level: 2 });
  const atEnd = async () => {
    const box = (await heading.boundingBox())!;
    await heading.click({ position: { x: box.width - 4, y: box.height / 2 } });
  };
  await atEnd();
  await page.keyboard.type(" in the demo");
  await expect(editor.getByRole("heading", { level: 2 })).toHaveText("First things to try in the demo");

  // Tick an open to-do.
  const todo = editor.locator(".fb-todo", { hasText: "Give a to-do a due date" });
  await expect(todo).toHaveAttribute("data-checked", "false");
  await todo.getByRole("checkbox").click();
  await expect(todo).toHaveAttribute("data-checked", "true");

  // Insert a block with "/".
  await atEnd();
  await page.keyboard.press("Enter");
  await page.keyboard.type("/quote");
  await expect(page.getByRole("option", { name: /Quote/ }).first()).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.type("A quote from the demo");
  await expect(editor.locator("blockquote.fb-quote")).toHaveText("A quote from the demo");

  // The dock: Format opens the Format panel; Style recolours the note.
  const dock = page.getByRole("toolbar", { name: "Page tools" });
  await dock.getByRole("button", { name: "Format" }).click();
  const panel = page.locator("#document-inspector");
  await expect(panel.getByRole("heading", { name: "Format" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await dock.getByRole("button", { name: "Style" }).click();
  await panel.getByRole("radio", { name: "Note style: Poppy print" }).click();
  await expect(page.locator(".mk-hero-stage")).toHaveAttribute("data-tone", "light");
  await expect(page.getByText("Note style: Poppy print", { exact: false }).first()).toBeVisible();

  // AI and Share need an account.
  await dock.getByRole("button", { name: "AI" }).click();
  await expect(panel.getByRole("heading", { name: "AI Assistant" })).toBeVisible();
  await expect(panel.getByRole("link", { name: "Sign up free" })).toBeVisible();
  await dock.getByRole("button", { name: "Share" }).click();
  await expect(panel.getByRole("heading", { name: "Share" })).toBeVisible();

  expect(external).toEqual([]);

  // Nothing is saved.
  await page.reload();
  const fresh = page.getByRole("textbox", { name: "Try the editor" });
  await expect(fresh).toBeVisible({ timeout: 20_000 });
  await expect(fresh).not.toContainText("in the demo");
  await expect(fresh.locator("blockquote")).toHaveCount(0);
  await expect(fresh.locator(".fb-todo", { hasText: "Give a to-do a due date" })).toHaveAttribute("data-checked", "false");
});

for (const scheme of ["light", "dark"] as const) {
  test(`the editable note has no serious accessibility issues (${scheme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto(`${SITE}/`);
    await expect(page.getByRole("textbox", { name: "Try the editor" })).toBeVisible({ timeout: 20_000 });
    const scan = async (where: string) => {
      const results = await new AxeBuilder({ page }).include(".mk-hero").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${where}: ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
    };
    await scan("note");
    const dock = page.getByRole("toolbar", { name: "Page tools" });
    for (const tool of ["Insert", "Format", "Style", "AI"]) {
      await dock.getByRole("button", { name: tool }).click();
      await expect(page.locator("#document-inspector")).toBeVisible();
      await scan(tool);
      await page.keyboard.press("Escape");
    }
  });
}
