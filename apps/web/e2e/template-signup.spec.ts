import { expect, test } from "@playwright/test";
import { APP, completeOnboarding, confirmEmail, signUp, uniqueEmail } from "./helpers";

// "Use this template" on folevi.com links to /signup?template=<key>. The template opens as the person's
// first page once onboarding ends, and straight away for someone already signed in.

test("a template picked before sign-up opens as the first page after onboarding", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const email = uniqueEmail("template");
  await page.goto(`${APP}/signup?template=meeting-notes`);
  await signUp(page, { email, name: "Template Person" });
  await confirmEmail(page, email);
  await page.getByRole("button", { name: "Skip setup" }).click({ timeout: 30_000 });
  // The last step names the template instead of the Welcome page.
  await page.getByRole("button", { name: "Open “Meeting Notes”" }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Meeting Notes", { timeout: 20_000 });
  await expect(page.getByRole("textbox", { name: "Document body" }).getByRole("heading", { name: "Agenda" })).toBeVisible();
  // It's opened once: a reload doesn't make another copy.
  expect(await page.evaluate(() => localStorage.getItem("folevi:pending-template"))).toBeNull();
  await context.close();
});

test("signed in already, the template opens straight away; unknown keys are ignored", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const email = uniqueEmail("template");
  await signUp(page, { email, name: "Signed In Person" });
  await confirmEmail(page, email);
  await completeOnboarding(page);
  await page.goto(`${APP}/signup?template=daily-page`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Daily Page", { timeout: 20_000 });
  expect(new URL(page.url()).searchParams.get("template")).toBeNull();
  await page.goto(`${APP}/signup?template=not-a-template`);
  await page.waitForURL(/\/documents/);
  expect(await page.evaluate(() => localStorage.getItem("folevi:pending-template"))).toBeNull();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveCount(0);
  await context.close();
});
