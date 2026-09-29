import { expect, test } from "@playwright/test";
import { newPerson } from "./helpers";

test("turning the AI Assistant off hides every AI entry point; turning it on brings them back", async ({ browser }) => {
  const { page } = await newPerson(browser, "AI Switcher");
  const nav = page.getByRole("navigation", { name: "Folio" });
  const dock = page.getByRole("toolbar", { name: "Page tools" });
  // On by default: the note's dock and the floating chat button offer AI (not the sidebar).
  const launcher = page.getByRole("button", { name: "AI Assistant", exact: true });
  await expect(dock.getByRole("button", { name: "AI" })).toBeVisible();
  await page.goto("/documents");
  await expect(launcher).toBeVisible();
  await expect(nav.getByRole("button", { name: /Ask AI/ })).toHaveCount(0);
  // It pops out a chat; Escape closes it and returns focus to the button.
  await launcher.click();
  const chat = page.getByRole("dialog", { name: "Ask AI" });
  await expect(chat).toBeVisible();
  await expect(chat.getByRole("textbox", { name: /Ask a question/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(chat).toHaveCount(0);
  await expect(launcher).toBeFocused();

  await page.goto("/settings/account");
  const toggle = page.getByRole("switch", { name: "AI Assistant" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(launcher).toHaveCount(0);
  await page.goto("/documents");
  await expect(page.getByRole("button", { name: "Catch me up" })).toHaveCount(0);

  // A note: no AI in the dock, the selection toolbar or the slash menu; ⌘J does nothing.
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Some words to select");
  await expect(dock.getByRole("button", { name: "AI" })).toHaveCount(0);
  await page.keyboard.press("Shift+Home");
  await expect(page.getByRole("toolbar", { name: "Text formatting" })).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Text formatting" }).getByRole("button", { name: "Ask AI" })).toHaveCount(0);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/ask ai");
  await expect(page.getByRole("option", { name: /Ask AI|AI ·/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+j");
  await expect(page.getByRole("dialog", { name: "Ask AI" })).toHaveCount(0);
  await page.keyboard.press("Meta+k");
  await expect(page.getByRole("option", { name: /Ask AI/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Back on.
  await page.goto("/settings/account");
  await page.getByRole("switch", { name: "AI Assistant" }).click();
  await expect(launcher).toBeVisible();
  await page.goto("/documents");
  await expect(page.getByRole("button", { name: "Catch me up" })).toBeVisible();
});
