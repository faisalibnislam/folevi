import { expect, test } from "@playwright/test";
import { newPersonWithWorkspace, waitForSaved, showFolders, pick } from "./helpers";

// docs/SYNC_PROTOCOL.md §Routing: a page from another workspace is edited through the same queue.
test("an outsider with “Can edit” edits a shared page and the owner sees the change live", async ({ browser }) => {
  const owner = await newPersonWithWorkspace(browser, "Owner Person");
  await showFolders(owner.page);
  const guest = await newPersonWithWorkspace(browser, "Outside Editor");
  await showFolders(guest.page);

  await owner.page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Home" }).click();
  await owner.page.getByRole("link", { name: /Project Atlas Brief/ }).first().click();
  const docUrl = owner.page.url();
  await owner.page.getByRole("button", { name: "Share" }).click();
  const share = owner.page.getByRole("dialog", { name: /Share/ });
  await share.getByLabel("Email address").fill(guest.email);
  await pick(share.getByLabel("Role"), "Can edit");
  await share.getByRole("button", { name: "Share", exact: true }).click();
  await expect(share.getByText("Outside Editor")).toBeVisible();
  await share.getByRole("button", { name: "Close" }).click();

  // The guest opens it from Shared with Me while their own workspace stays selected.
  await guest.page.getByRole("link", { name: "Shared with Me" }).click();
  await guest.page.getByRole("link", { name: /Project Atlas Brief/ }).click();
  const body = guest.page.getByRole("textbox", { name: "Document body" });
  await expect(body).toHaveAttribute("contenteditable", "true");
  await body.getByRole("heading", { name: "Why now" }).click();
  await guest.page.keyboard.press("End");
  await guest.page.keyboard.press("Enter");
  await guest.page.keyboard.type("Edited from another workspace");
  await waitForSaved(guest.page);
  await expect(guest.page.getByText("Not saved")).toHaveCount(0);

  // The owner sees it without reloading, and it survives a reload.
  await expect(owner.page.getByRole("textbox", { name: "Document body" })).toContainText("Edited from another workspace", { timeout: 20_000 });
  await owner.page.goto(docUrl);
  await expect(owner.page.getByRole("textbox", { name: "Document body" })).toContainText("Edited from another workspace");

  // A deep link keeps working after a reload on the guest's side too (queue is account-wide).
  await guest.page.reload();
  await expect(guest.page.getByRole("textbox", { name: "Document body" })).toContainText("Edited from another workspace");
  await waitForSaved(guest.page);
});
