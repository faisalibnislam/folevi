import { expect, test } from "@playwright/test";
import { APP } from "./helpers";

// The public pricing page: the free apps first, then Folevi Cloud's four plans for Personal or Team, monthly or
// yearly, then AI credits, credit packs and the questions. Prices come from the plan catalog (convex/lib/plans.ts).
const SITE = APP.replace("://app.", "://");

test("the pricing page switches between Personal and Team, yearly and monthly", async ({ page }) => {
  await page.goto(`${SITE}/pricing`);
  await expect(page.getByRole("heading", { level: 1, name: "Folevi is free." })).toBeVisible();
  // The plans are Folevi Cloud's, under the free apps (d5bbd276).
  const plans = page.getByRole("region", { name: "Folevi Cloud" });
  const card = (name: string) => plans.getByRole("group", { name: `${name} plan` });
  for (const name of ["Free", "Core", "Pro", "Pro AI"]) await expect(plans.getByRole("heading", { level: 3, name, exact: true })).toBeVisible();

  const audience = plans.getByRole("radiogroup", { name: "Plans for" });
  const billing = plans.getByRole("radiogroup", { name: "Billing" });
  await expect(audience.getByRole("radio", { name: "Personal" })).toHaveAttribute("aria-checked", "true");
  // Yearly is the default: one payment a year keeps the card fee to one charge.
  await expect(billing.getByRole("radio", { name: "Yearly" })).toHaveAttribute("aria-checked", "true");

  // Personal, yearly.
  await expect(card("Free").getByText("$0", { exact: true })).toBeVisible();
  await expect(card("Core").getByText("$20", { exact: true })).toBeVisible();
  await expect(card("Pro").getByText("$40", { exact: true })).toBeVisible();
  await expect(card("Pro AI").getByText("$100", { exact: true })).toBeVisible();
  await expect(card("Core").getByText("/ year", { exact: true })).toBeVisible();
  await expect(card("Core").getByText("$1.66 a month, billed yearly (save 17%)")).toBeVisible();
  // Free includes AI credits; Core has none included but can buy packs or use its own key; Pro AI has the most
  // credits (450 a month, not "unlimited": bc3a5855), and is the trial.
  await expect(card("Free").getByText("30 AI credits a month")).toBeVisible();
  await expect(card("Core").getByText("No AI credits included: buy credits when you want Foli AI")).toBeVisible();
  await expect(card("Pro AI").getByText("450 AI credits a month, the most of any plan")).toBeVisible();
  await expect(card("Pro AI").getByRole("link", { name: /^Try 7 days free/ })).toBeVisible();

  // Monthly.
  await billing.getByRole("radio", { name: "Monthly" }).click();
  await expect(billing.getByRole("radio", { name: "Monthly" })).toHaveAttribute("aria-checked", "true");
  await expect(card("Core").getByText("$2", { exact: true })).toBeVisible();
  await expect(card("Pro").getByText("$4", { exact: true })).toBeVisible();
  await expect(card("Pro AI").getByText("$10", { exact: true })).toBeVisible();
  await expect(card("Core").getByText("/ month", { exact: true })).toBeVisible();
  await expect(card("Core").getByText("or $20 a year (save 17%)")).toBeVisible();
  await expect(card("Core").getByText("$20", { exact: true })).toHaveCount(0);

  // Team: the same plans, per member (the arrow keys move the choice, as in a radio group).
  await audience.getByRole("radio", { name: "Personal" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(audience.getByRole("radio", { name: "Team" })).toHaveAttribute("aria-checked", "true");
  await expect(audience.getByRole("radio", { name: "Team" })).toBeFocused();
  await expect(card("Pro").getByText("$4", { exact: true })).toBeVisible();
  await expect(card("Pro").getByText("per member / month", { exact: true })).toBeVisible();
  await expect(card("Pro").getByText("10 GB per member")).toBeVisible();
  await expect(card("Pro AI").getByText("450 AI credits per member a month, the most of any plan")).toBeVisible();
  await expect(card("Free").getByText("Nobody is billed")).toBeVisible();

  await billing.getByRole("radio", { name: "Yearly" }).click();
  await expect(card("Core").getByText("$20", { exact: true })).toBeVisible();
  await expect(card("Core").getByText("per member / year", { exact: true })).toBeVisible();

  await audience.getByRole("radio", { name: "Personal" }).click();
  await expect(card("Pro").getByText("/ year", { exact: true })).toBeVisible();
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
  await expect(credits.getByText("$8", { exact: true })).toBeVisible();
  await expect(credits.getByText("1,000 credits", { exact: true })).toBeVisible();
  await expect(credits.getByText("$15", { exact: true })).toBeVisible();
  await expect(credits.getByText("Valid for 12 months from purchase.")).toBeVisible();

  const faq = page.getByRole("region", { name: "Questions" });
  for (const q of [
    "Are the apps free?",
    "What do I pay for?",
    "Can I use Foli AI without paying?",
    "How does the free trial work?",
    "Can I turn Foli AI off?",
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
  // Answers open on click.
  await expect(faq.getByText(/merchant of record/)).toBeHidden();
  await faq.getByText("How are taxes and payments handled?", { exact: true }).click();
  await expect(faq.getByText(/merchant of record/)).toBeVisible();
  await faq.getByText("How does the free trial work?", { exact: true }).click();
  await expect(faq.getByText(/7 days, with 100 AI credits and no card/)).toBeVisible();

  // The writing rules: no em dash anywhere on the page, and nothing about the old plans or Stripe.
  const text = await page.locator("body").innerText();
  expect(text).not.toContain(String.fromCharCode(0x2014));
  expect(text).not.toMatch(/Basic|Business|Stripe/);
});
