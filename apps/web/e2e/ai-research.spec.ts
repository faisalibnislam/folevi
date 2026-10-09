import { expect, test } from "@playwright/test";
import { APP, newPerson } from "./helpers";

// Web research in the chat. Without a model key on the server (CI, local dev) nothing can search, so this
// covers what works without one: the Web switch shows (off) and sends, Research starts a job that ends
// saying the assistant isn't set up (or failed), the job is listed on the AI page, and turning web research
// off in Settings hides both.
test("the Web switch sends, Research starts and fails plainly without a key, and the setting hides both", async ({ browser }) => {
  test.setTimeout(180_000);
  const { page, context } = await newPerson(browser, "Research Person");
  await page.goto(`${APP}/ai`);
  await expect(page.getByRole("heading", { name: "What can I help you with?" })).toBeVisible();
  const modes = page.getByRole("group", { name: "How Foli helps" });

  // Chat with the Web switch: off by default, then on, then a question.
  const web = page.getByRole("button", { name: "Web", exact: true });
  await expect(web).toBeVisible();
  await expect(web).toHaveAttribute("aria-pressed", "false");
  await web.click();
  await expect(web).toHaveAttribute("aria-pressed", "true");
  const box = page.getByPlaceholder("Ask anything. Answers use your notes and the web…");
  await box.fill("When does the first ferry leave?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("When does the first ferry leave?").first()).toBeVisible();
  await expect(page.getByText(/isn.t set up|couldn.t|try again/i).first()).toBeVisible({ timeout: 30_000 });

  // Research: a new chat in Research mode starts a job, which fails without a key.
  await page.goto(`${APP}/ai`);
  await expect(page.getByRole("heading", { name: "What can I help you with?" })).toBeVisible();
  await modes.getByRole("button", { name: "Research", exact: true }).click();
  await expect(modes.getByRole("button", { name: "Research", exact: true })).toHaveAttribute("aria-pressed", "true");
  // The Web switch belongs to Chat.
  await expect(page.getByRole("button", { name: "Web", exact: true })).toHaveCount(0);
  await page.getByPlaceholder("What should I research?").fill("Compare ferry and train to the coast");
  await page.getByRole("button", { name: "Start research", exact: true }).click();
  await expect(page.getByText("Compare ferry and train to the coast").first()).toBeVisible();
  await expect(page.getByText(/isn.t set up|didn.t finish|couldn.t|try again/i).first()).toBeVisible({ timeout: 60_000 });
  // The job is listed on the AI page.
  const list = page.getByRole("region", { name: "Research" });
  await expect(list.getByText("Compare ferry and train to the coast")).toBeVisible({ timeout: 30_000 });

  // Settings > AI: web research off hides the switch and Research.
  await page.goto(`${APP}/settings/ai`);
  const setting = page.getByRole("switch", { name: "Web research" });
  await expect(setting).toBeVisible();
  await setting.click();
  await expect(page.getByText("Web research turned off")).toBeVisible();
  await page.goto(`${APP}/ai`);
  await expect(page.getByRole("heading", { name: "What can I help you with?" })).toBeVisible();
  await expect(modes.getByRole("button", { name: "Agent", exact: true })).toBeVisible();
  await expect(modes.getByRole("button", { name: "Research", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Web", exact: true })).toHaveCount(0);
  await context.close();
});
