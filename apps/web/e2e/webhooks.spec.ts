import { expect, test } from "@playwright/test";
import { APP, newPerson } from "./helpers";

// Webhooks in Settings → Connected apps: only https addresses, the signing secret shown once, on and off, delete.
test("a webhook is added with its secret shown once, switched off and on, and deleted", async ({ browser }) => {
  const { page, context } = await newPerson(browser, "Hook Person");
  await page.goto(`${APP}/settings/connected-apps`);
  const card = page.getByRole("region", { name: "Webhooks" });
  await expect(card.getByText("No webhooks yet.")).toBeVisible();
  await card.getByRole("button", { name: "Add webhook" }).click();

  const dialog = page.getByRole("dialog", { name: "Add a webhook" });
  const address = dialog.getByLabel("Endpoint address");
  // A private address is refused by the server.
  await address.fill("https://192.168.1.20/hook");
  await dialog.getByRole("button", { name: "Add webhook" }).click();
  await expect(dialog.getByRole("alert")).toContainText("private or local networks");
  await address.fill("https://example.com/folevi-hook");
  await dialog.getByRole("checkbox", { name: "A comment is written" }).click();
  await dialog.getByRole("button", { name: "Add webhook" }).click();

  const shown = page.getByRole("dialog", { name: "Copy the signing secret" });
  await expect(shown.getByLabel("Signing secret")).toHaveValue(/^whsec_[A-Za-z0-9_-]{32}$/);
  await shown.getByRole("button", { name: "Done" }).click();

  const row = card.getByRole("listitem", { name: "https://example.com/folevi-hook" });
  await expect(row).toContainText("note.created, task.completed, comment.created in Personal");
  await expect(row).toContainText("Nothing sent yet");
  const toggle = row.getByRole("switch", { name: "Send events to https://example.com/folevi-hook" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await row.getByRole("button", { name: "Recent deliveries" }).click();
  await expect(row.getByText("No deliveries yet.")).toBeVisible();
  // The secret isn't shown again anywhere.
  await expect(page.getByText(/whsec_/)).toHaveCount(0);

  await row.getByRole("button", { name: "Delete…" }).click();
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(card.getByText("No webhooks yet.")).toBeVisible();
  await context.close();
});
