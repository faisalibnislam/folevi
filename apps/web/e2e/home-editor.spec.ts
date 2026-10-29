import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { APP, convexUrl } from "./helpers";

// The home page's note is the app's real editor, running with no account and no server: it can be edited,
// its to-dos ticked, blocks inserted with "/", formatted and restyled from the page tools dock; what needs an
// account asks the visitor to sign up; and a reload brings the original note back (nothing is saved).
const SITE = (process.env.E2E_SITE_URL ?? APP.replace("://app.", "://")).replace(/\/$/, "");

test("the home page note is editable, and a reload resets it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const external: string[] = [];
  page.on("request", (r) => {
    // Our own backend is allowed (the Style gallery loads the app's theme list from it), and the app's
    // signed-in check (the site opens your notes when you are); nothing else.
    const own = [SITE, "data:", new URL(convexUrl()).origin, `${APP}/api/signed-in`];
    if (!own.some((o) => r.url().startsWith(o))) external.push(r.url());
  });
  await page.goto(`${SITE}/`);
  const editor = page.getByRole("textbox", { name: "Try the editor" });
  await expect(editor).toBeVisible({ timeout: 20_000 });
  // The title is being co-edited (the ending changes); assistive tech reads the whole sentence once.
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName("Folevi is a digital workspace for notes, documentation, collaboration and publishing.");

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
  // Style: every theme the app has, right in the panel; Browse all opens the app's gallery (no upload here).
  await dock.getByRole("button", { name: "Style" }).click();
  await panel.getByRole("radio", { name: "Note theme: Poppy print" }).click();
  await expect(page.locator(".mk-hero-stage")).toHaveAttribute("data-tone", "light");
  await expect(panel.getByRole("radio", { name: "Note theme: Poppy print" })).toHaveAttribute("aria-checked", "true");
  await panel.getByRole("button", { name: "Browse all" }).click();
  const gallery = page.getByRole("dialog", { name: "Note theme" });
  await expect(gallery.getByRole("radio")).not.toHaveCount(0);
  await expect(gallery.getByRole("button", { name: /Use your own image/ })).toHaveCount(0);
  await gallery.getByRole("button", { name: "Done" }).click();

  // AI needs an account.
  await dock.getByRole("button", { name: "Foli AI" }).click();
  await expect(panel.getByRole("heading", { name: "Foli AI" })).toBeVisible();
  await expect(panel.getByRole("link", { name: "Sign up free" })).toBeVisible();

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
    for (const tool of ["Insert", "Format", "Style", "Foli AI"]) {
      await dock.getByRole("button", { name: tool }).click();
      await expect(page.locator("#document-inspector")).toBeVisible();
      await scan(tool);
      await page.keyboard.press("Escape");
    }
  });
}
