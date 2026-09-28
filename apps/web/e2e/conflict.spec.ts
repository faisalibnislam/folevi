import { expect, test } from "@playwright/test";
import { newPersonWithWorkspace, waitForSaved } from "./helpers";

test("same-block edits on two devices produce a visible conflict; Keep both loses nothing", async ({ browser }) => {
  const { page: web, context } = await newPersonWithWorkspace(browser, "Two Devices");
  await web.getByRole("button", { name: "New note", exact: true }).click();
  await web.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await expect(web.getByRole("textbox", { name: "Title" })).toHaveValue("");
  await expect(web.getByRole("textbox", { name: "Title" })).toBeFocused();
  await web.getByRole("textbox", { name: "Title" }).fill("Shared line");
  await web.keyboard.press("Enter");
  await web.keyboard.type("Hello");
  await waitForSaved(web);
  const url = web.url().split("?")[0]!;

  // Second device, same person.
  const other = await browser.newContext();
  await other.addCookies(await context.cookies());
  const mac = await other.newPage();
  await mac.goto(url);
  const macBody = mac.getByRole("textbox", { name: "Document body" });
  await expect(macBody).toContainText("Hello");

  // Device 2 goes offline and edits the same block.
  await other.setOffline(true);
  await macBody.click();
  await mac.keyboard.press("End");
  await mac.keyboard.type(" from the second device");
  await expect(mac.getByTestId("sync-status")).toHaveAttribute("data-status", "offline", { timeout: 15_000 });

  // Device 1 edits the same block online.
  await web.getByRole("textbox", { name: "Document body" }).click();
  await web.keyboard.press("End");
  await web.keyboard.type(" from the web");
  await waitForSaved(web);

  // Device 2 reconnects → typed conflict, both versions shown.
  await other.setOffline(false);
  const banner = mac.getByRole("alert").filter({ hasText: "changed in two places" });
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(banner).toContainText("Hello from the web");
  await expect(banner).toContainText("Hello from the second device");
  await banner.getByRole("button", { name: "Keep both" }).click();
  await waitForSaved(mac);
  await expect(macBody).toContainText("Hello from the web");
  await expect(macBody).toContainText("Hello from the second device");
  await expect(web.getByRole("textbox", { name: "Document body" })).toContainText("Hello from the second device", { timeout: 15_000 });
});
