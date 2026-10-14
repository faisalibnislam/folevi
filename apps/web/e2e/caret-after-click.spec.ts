import { expect, test, type Page } from "@playwright/test";
import { newPerson, openShare, pick, showFolders, waitForSaved } from "./helpers";

// A key pressed right after the click that focuses a note goes where the click put the caret, not to the start
// of the note (the browser says where the caret went a moment after the click; CaretAfterClick in plugins.ts).

async function shareWith(page: Page, email: string, name: string) {
  await openShare(page);
  const share = page.getByRole("dialog", { name: /Share/ });
  await share.getByLabel("Email address").fill(email);
  await pick(share.getByLabel("Role"), "Can edit");
  await share.getByRole("button", { name: "Share", exact: true }).click();
  await expect(share.getByText(name)).toBeVisible();
  await share.getByRole("button", { name: "Close" }).click();
}

test("typing straight after clicking into a shared note that just opened lands at the click", async ({ browser }) => {
  const owner = await newPerson(browser, "Dana Owner");
  await showFolders(owner.page);
  const guest = await newPerson(browser, "Eli Guest");
  await showFolders(guest.page);
  await owner.page.getByRole("button", { name: "New note", exact: true }).click();
  await owner.page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await owner.page.getByRole("textbox", { name: "Title" }).fill("Click then type");
  await owner.page.keyboard.press("Enter");
  await owner.page.keyboard.type("First line here");
  await owner.page.keyboard.press("Enter");
  await owner.page.keyboard.type("Last line here");
  await waitForSaved(owner.page);
  // The owner stays in the note: live carets and quick saving are on while the guest types.
  await shareWith(owner.page, guest.email, "Eli Guest");

  const body = guest.page.getByRole("textbox", { name: "Document body" });
  for (let i = 0; i < 4; i++) {
    await guest.page.getByRole("navigation", { name: "Folio" }).getByRole("link", { name: "Shared with Me" }).click();
    await guest.page.getByRole("listitem").filter({ hasText: /Click then type/ }).getByRole("link").click();
    await expect(body).toHaveAttribute("contenteditable", "true");
    const last = body.locator("p", { hasText: "Last line here" });
    await expect(last).toBeVisible();
    // No pause between the click and the keys.
    await last.click();
    await guest.page.keyboard.press("Enter");
    await guest.page.keyboard.type(`Line ${i}`);
    await waitForSaved(guest.page);
    const lines = await body.evaluate((b) => [...b.querySelectorAll(":scope > p")].map((p) => [...p.childNodes].filter((n) => !(n instanceof HTMLElement && n.dataset.remoteCaret)).map((n) => n.textContent).join("")));
    expect(lines[0]).toBe("First line here");
    expect(lines[lines.indexOf("Last line here") + 1]).toBe(`Line ${i}`);
  }
  await expect(owner.page.getByRole("textbox", { name: "Document body" })).toContainText("Line 3", { timeout: 20_000 });
});
