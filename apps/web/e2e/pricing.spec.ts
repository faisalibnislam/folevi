import { expect, test } from "@playwright/test";
import { APP } from "./helpers";

// The public pricing page: four plans for Personal or Team, monthly or yearly, then AI credits, credit packs
// and the questions. Prices come from the plan catalog (convex/lib/plans.ts).
const SITE = APP.replace("://app.", "://");

test("the pricing page switches between Personal and Team, monthly and yearly", async ({ page }) => {
  await page.goto(`${SITE}/pricing`);
  await expect(page.getByRole("heading", { level: 1, name: "Start free. Pay for room, or for AI." })).toBeVisible();
  const plans = page.getByRole("region", { name: "Plans" });
  const card = (name: string) => plans.getByRole("group", { name: `${name} plan` });
  for (const name of ["Free", "Core", "Pro", "Pro AI"]) await expect(plans.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();

  const audience = plans.getByRole("radiogroup", { name: "Plans for" });
  const billing = plans.getByRole("radiogroup", { name: "Billing" });
  await expect(audience.getByRole("radio", { name: "Personal" })).toHaveAttribute("aria-checked", "true");
  await expect(billing.getByRole("radio", { name: "Monthly" })).toHaveAttribute("aria-checked", "true");

  // Personal, monthly.
  await expect(card("Free").getByText("$0", { exact: true })).toBeVisible();
  await expect(card("Core").getByText("$1.99", { exact: true })).toBeVisible();
  await expect(card("Pro").getByText("$4.99", { exact: true })).toBeVisible();
  await expect(card("Pro AI").getByText("$12.99", { exact: true })).toBeVisible();
  await expect(card("Core").getByText("/ month", { exact: true })).toBeVisible();
  await expect(card("Core").getByText("or $19 a year (save 20%)")).toBeVisible();
  // Core has no AI, said plainly; Pro AI is unlimited with fair use, and is the trial.
  await expect(card("Core").getByText("No AI. Your notes stay yours: nothing is sent to an AI model")).toBeVisible();
  await expect(card("Core").getByText("No AI", { exact: true })).toBeVisible();
  await expect(card("Pro AI").getByText("Unlimited AI, fair use (550 credits a month)")).toBeVisible();
  await expect(card("Pro AI").getByRole("link", { name: /Try Pro AI free for 7 days/ })).toBeVisible();

  // Yearly.
  await billing.getByRole("radio", { name: "Yearly" }).click();
  await expect(billing.getByRole("radio", { name: "Yearly" })).toHaveAttribute("aria-checked", "true");
  await expect(card("Core").getByText("$19", { exact: true })).toBeVisible();
  await expect(card("Pro").getByText("$49", { exact: true })).toBeVisible();
  await expect(card("Pro AI").getByText("$149", { exact: true })).toBeVisible();
  await expect(card("Core").getByText("/ year", { exact: true })).toBeVisible();
  await expect(card("Core").getByText("$1.58 a month, billed yearly (save 20%)")).toBeVisible();
  await expect(card("Core").getByText("$1.99", { exact: true })).toHaveCount(0);

  // Team: the same plans, per member (the arrow keys move the choice, as in a radio group).
  await audience.getByRole("radio", { name: "Personal" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(audience.getByRole("radio", { name: "Team" })).toHaveAttribute("aria-checked", "true");
  await expect(audience.getByRole("radio", { name: "Team" })).toBeFocused();
  await expect(card("Core").getByText("$19", { exact: true })).toBeVisible();
  await expect(card("Core").getByText("per member / year", { exact: true })).toBeVisible();
  await expect(card("Pro").getByText("20 GB per member")).toBeVisible();
  await expect(card("Pro AI").getByText("Unlimited AI, fair use (550 credits per member a month)")).toBeVisible();
  await expect(card("Free").getByText("Nobody is billed")).toBeVisible();

  await billing.getByRole("radio", { name: "Monthly" }).click();
  await expect(card("Pro").getByText("$4.99", { exact: true })).toBeVisible();
  await expect(card("Pro").getByText("per member / month", { exact: true })).toBeVisible();

  await audience.getByRole("radio", { name: "Personal" }).click();
  await expect(card("Pro").getByText("/ month", { exact: true })).toBeVisible();
  await expect(plans.getByText(/per member/)).toHaveCount(0);
});

test("the pricing page explains AI credits and credit packs, answers questions, and has no em dash", async ({ page }) => {
  await page.goto(`${SITE}/pricing`);
  const credits = page.getByRole("region", { name: "AI credits" });
  await expect(credits.getByRole("heading", { level: 3, name: "What’s an AI credit?" })).toBeVisible();
  await expect(credits.getByText("about 1 credit", { exact: true })).toBeVisible();
  await expect(credits.getByText("about 2 credits", { exact: true })).toBeVisible();
  await expect(credits.getByText("3 to 5 credits", { exact: true })).toBeVisible();
  await expect(credits.getByRole("heading", { level: 3, name: "Credit packs" })).toBeVisible();
  await expect(credits.getByText("500 credits", { exact: true })).toBeVisible();
  await expect(credits.getByText("$7.99", { exact: true })).toBeVisible();
  await expect(credits.getByText("1,000 credits", { exact: true })).toBeVisible();
  await expect(credits.getByText("$14.99", { exact: true })).toBeVisible();
  await expect(credits.getByText("Valid for 12 months from purchase.")).toBeVisible();

  const faq = page.getByRole("region", { name: "Questions" });
  for (const q of [
    "How does the free trial work?",
    "What does “Unlimited AI, fair use” mean?",
    "When do AI credits reset?",
    "Do credit packs expire?",
    "What happens when I run out of AI credits?",
    "How does storage work?",
    "How are team plans billed?",
    "Do guests cost anything?",
    "Can I switch plans or cancel?",
    "How are taxes and payments handled?",
  ])
    await expect(faq.getByText(q, { exact: true })).toBeVisible();
  await expect(faq.getByText(/merchant of record/)).toBeVisible();
  await expect(faq.getByText(/7 days, with 100 AI credits and no card/)).toBeVisible();

  // The writing rules: no em dash anywhere on the page, and nothing about the old plans or Stripe.
  const text = await page.locator("body").innerText();
  expect(text).not.toContain(String.fromCharCode(0x2014));
  expect(text).not.toMatch(/Basic|Business|Stripe/);
});
