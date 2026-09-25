import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

export const APP = process.env.E2E_BASE_URL ?? "http://app.localhost:3000";

export function uniqueEmail(prefix = "e2e"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

/** Signs in through the development identity (local only) and returns a ready page. */
export async function signIn(
  context: BrowserContext,
  opts: { email: string; name?: string; unverified?: boolean; noMfa?: boolean; returnTo?: string },
): Promise<Page> {
  const form: Record<string, string> = { email: opts.email, name: opts.name ?? "Test Person", returnTo: opts.returnTo ?? "/documents" };
  if (opts.unverified) form.simulateUnverified = "on";
  if (opts.noMfa) form.simulateMfaMissing = "on";
  const res = await context.request.post(`${APP}/api/dev-auth/session`, { form, headers: { origin: APP }, maxRedirects: 0 });
  expect(res.status()).toBe(303);
  const page = await context.newPage();
  return page;
}

/** Signs in a brand-new person and completes onboarding; lands on the Welcome document. */
export async function newPersonWithWorkspace(browser: Browser, name = "Test Person"): Promise<{ context: BrowserContext; page: Page; email: string }> {
  const context = await browser.newContext();
  const email = uniqueEmail();
  const page = await signIn(context, { email, name });
  await page.goto(`${APP}/documents`);
  await page.getByRole("button", { name: "Continue" }).click({ timeout: 30_000 });
  await page.getByRole("radio", { name: "Light" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Open “Welcome to Folevi”" }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Welcome to Folevi");
  return { context, page, email };
}

export async function waitForSaved(page: Page) {
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-status", "saved", { timeout: 20_000 });
}
