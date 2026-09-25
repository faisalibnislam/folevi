import { expect, test } from "@playwright/test";
import { signIn, uniqueEmail } from "./helpers";

test("unverified email is held at the verification gate", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await signIn(context, { email: uniqueEmail("unverified"), unverified: true });
  await page.goto("/documents");
  await expect(page.getByRole("heading", { name: "Verify your email to continue" })).toBeVisible();
});

test("missing two-step verification is held at the MFA gate", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await signIn(context, { email: uniqueEmail("nomfa"), noMfa: true });
  await page.goto("/documents");
  await expect(page.getByRole("heading", { name: "Two-step verification is required" })).toBeVisible();
});

test("signed-out visitors are sent to sign in, and product URLs keep their return path", async ({ page }) => {
  await page.goto("/tasks/today");
  await expect(page).toHaveURL(/\/signin\?returnTo=%2Ftasks%2Ftoday/);
});

test("sessions can be listed and revoked", async ({ browser }) => {
  const email = uniqueEmail("sessions");
  const a = await browser.newContext();
  const pageA = await signIn(a, { email, name: "Session Person" });
  await pageA.goto("/documents");
  await pageA.getByRole("button", { name: "Continue" }).click();
  await pageA.getByRole("button", { name: "Continue" }).click();
  await pageA.getByRole("button", { name: "Open “Welcome to Folevi”" }).click();
  const b = await browser.newContext();
  const pageB = await signIn(b, { email, name: "Session Person" });
  await pageB.goto("/documents");
  await expect(pageB.getByRole("heading", { name: "All Documents", level: 2 })).toBeVisible();
  await pageA.goto("/settings/security");
  const other = pageA.getByRole("listitem").filter({ hasNotText: "This device" }).filter({ has: pageA.getByRole("button", { name: "Revoke" }) });
  await other.first().getByRole("button", { name: "Revoke" }).click();
  await pageB.reload();
  await expect(pageB.getByRole("heading", { name: "This session was signed out" })).toBeVisible({ timeout: 15_000 });
});
