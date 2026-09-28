import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { expect, test } from "@playwright/test";
import { APP, newPersonWithWorkspace, waitForSaved } from "./helpers";

test("workspace export downloads a ZIP with Markdown documents and a manifest", async ({ browser }) => {
  const { page, context } = await newPersonWithWorkspace(browser, "Export Tester");
  await waitForSaved(page);
  await page.goto(`${APP}/settings/data`);
  const download = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("button", { name: "Export workspace (.zip)" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/-folevi-export-\d{4}-\d{2}-\d{2}\.zip$/);
  await expect(page.getByText(/Exported \d+ documents/)).toBeVisible({ timeout: 30_000 });

  const zip = unzipSync(new Uint8Array(readFileSync((await file.path())!)));
  const names = Object.keys(zip);
  expect(names).toContain("manifest.json");
  expect(names.some((n) => /Welcome to Folevi\.md$/.test(n))).toBe(true);
  const manifest = JSON.parse(strFromU8(zip["manifest.json"]!)) as { documents: { title: string }[] };
  expect(manifest.documents.map((d) => d.title)).toContain("Welcome to Folevi");
  await context.close();
});

test("account deletion is scheduled with a grace period and can be canceled", async ({ browser }) => {
  const { page, context, email } = await newPersonWithWorkspace(browser, "Deletion Tester");
  await page.goto(`${APP}/settings/security`);
  await page.getByRole("button", { name: "Delete my account…" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete your account?" });
  const schedule = dialog.getByRole("button", { name: "Schedule deletion" });
  // Nothing happens until the address is typed exactly.
  await expect(schedule).toBeDisabled();
  await dialog.getByLabel(/to confirm/).fill("someone-else@example.com");
  await expect(schedule).toBeDisabled();
  await dialog.getByLabel(/to confirm/).fill(email);
  await schedule.click();
  await expect(page.getByText("Account deletion scheduled")).toBeVisible();
  await expect(page.getByText(/Scheduled for /)).toBeVisible();

  // The person can still sign in during the grace period and cancel.
  await page.getByRole("button", { name: "Cancel deletion" }).click();
  await expect(page.getByText("Deletion canceled")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete my account…" })).toBeVisible();
  await context.close();
});
