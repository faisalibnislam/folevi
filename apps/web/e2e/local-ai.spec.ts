// Foli AI in local mode on the Mac (WP11), with the FakeShell's scripted model (e2e/fixtures/localShell.ts):
// Settings > AI shows Apple Intelligence's state and the person's own keys (added, tested, removed, never shown
// again), the model can be picked, and once a model is there Foli AI appears and answers from the library,
// streaming, with nothing sent to Folevi (the fixture's network guard fails the test otherwise). Local only:
//   E2E_LOCAL_BASE_URL=http://localhost:3003 E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 \
//     npx playwright test e2e/local-ai.spec.ts --project local
import type { Page } from "@playwright/test";
import { expect, prepareContext, test } from "./fixtures/localShell";

const KEY = "sk-test-local-ai-0123456789abcdefghijkl";
const sidebar = (page: Page) => page.getByRole("navigation", { name: "Folio" });

async function openSettingsAi(page: Page) {
  await page.goto("/settings/ai");
  await expect(page.getByRole("heading", { name: "Your own keys" })).toBeVisible({ timeout: 60_000 });
}

test("no model yet: Settings > AI explains, and Foli AI stays out of sight", { tag: "@local" }, async ({ page }) => {
  await openSettingsAi(page);
  await expect(page.getByTestId("local-ai-on-device")).toHaveAttribute("data-status", "notEnabled");
  await expect(page.getByText("Turn on Apple Intelligence in System Settings")).toBeVisible();
  for (const p of ["openai", "anthropic", "google"]) await expect(page.getByTestId(`local-ai-key-${p}`)).toHaveAttribute("data-stored", "false");
  await expect(page.getByTestId("local-ai-model-none")).toBeVisible();
  // No prices, plans or credits anywhere in it.
  await expect(page.getByText(/credits|Upgrade|See plans|\$\d/)).toHaveCount(0);
  await expect(sidebar(page).getByRole("link", { name: "Work with Foli AI" })).toHaveCount(0);
  await page.goto("/ai");
  await expect(page.getByRole("heading", { name: "Set up Foli AI on this Mac" })).toBeVisible({ timeout: 30_000 });
});

test("your own key: added write-only, tested, picked, used for a chat answered from the library, removed", { tag: "@local" }, async ({ page, localShell }) => {
  // A note to answer from.
  await page.goto("/documents");
  await page.getByRole("button", { name: "New note", exact: true }).first().click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}/);
  await page.getByRole("textbox", { name: "Title" }).fill("Lisbon trip");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Take tram 28 to the castle.");
  await page.waitForTimeout(800);

  await openSettingsAi(page);
  const row = page.getByTestId("local-ai-key-openai");
  await row.getByRole("button", { name: "Add key…" }).click();
  await row.getByLabel("OpenAI key").fill(KEY);
  await row.getByRole("button", { name: "Save" }).click();
  await expect(row).toHaveAttribute("data-stored", "true");
  await expect(row.getByText("It's kept in this Mac's Keychain and can't be shown again.")).toBeVisible();
  // The key is in the native store only: the page has no way to read it, and it isn't anywhere in the page.
  expect(await page.evaluate(() => window.__foleviTestShellControl!.secretValue("ai.openai"))).toBe(KEY);
  expect(await page.content()).not.toContain(KEY);
  const calls = await localShell.calls(page);
  expect(calls.filter((c) => c.call === "secrets.set")).toEqual([{ call: "secrets.set", detail: { name: "ai.openai" } }]);
  await row.getByRole("button", { name: "Test" }).click();
  await expect(row.getByText("Your OpenAI key works.")).toBeVisible();

  // The model: OpenAI's default, then a pick.
  const model = page.getByTestId("local-ai-model");
  await expect(model).toHaveAttribute("data-active", "openai:gpt-6.1-sol");
  await model.getByRole("combobox", { name: "OpenAI model" }).click();
  await page.getByRole("option", { name: "GPT-6 Astra" }).click();
  await expect(model).toHaveAttribute("data-active", "openai:gpt-6-astra");

  // Foli AI shows now, and answers from the library through the key, streaming.
  await expect(sidebar(page).getByRole("link", { name: "Work with Foli AI" })).toBeVisible();
  await sidebar(page).getByRole("link", { name: "Work with Foli AI" }).click();
  const box = page.getByPlaceholder("Ask anything, or ask Foli AI to tidy or organize…");
  await box.fill("How do I get to the castle in Lisbon?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("Here is what your notes say, from this Mac")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "What else is there?" })).toBeVisible();
  // Nothing server-only is offered in the chat: no research, no web, no files.
  await expect(page.getByRole("button", { name: "Research" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Attach/ })).toHaveCount(0);
  const generated = (await localShell.calls(page)).filter((c) => c.call === "ai.generate").map((c) => c.detail as { provider: string; model: string; system: string; prompt: string });
  expect(generated.length).toBeGreaterThanOrEqual(2);
  expect(generated.every((g) => g.provider === "openai")).toBe(true);
  // The search-terms call uses the quick model; the answer the picked one, with the note as data.
  expect(generated[0]!.model).toBe("gpt-6-luna");
  const answer = generated.find((g) => g.system.includes("Answer questions using the person's notes"))!;
  expect(answer.model).toBe("gpt-6-astra");
  expect(answer.prompt).toContain("tram 28");

  // Removing the key hides Foli AI again.
  await openSettingsAi(page);
  await page.getByTestId("local-ai-key-openai").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByTestId("local-ai-key-openai")).toHaveAttribute("data-stored", "false");
  await expect(sidebar(page).getByRole("link", { name: "Work with Foli AI" })).toHaveCount(0);
});

test("Apple Intelligence on: Foli AI runs on this Mac with no key", { tag: "@local" }, async ({ browser }, testInfo) => {
  const context = await browser.newContext();
  await prepareContext(context, testInfo, { ai: { onDevice: true }, libraryName: "on-device" });
  const page = await context.newPage();
  await openSettingsAi(page);
  await expect(page.getByTestId("local-ai-on-device")).toHaveAttribute("data-status", "available");
  await expect(page.getByText("Answering now: Apple Intelligence, on this Mac.")).toBeVisible();
  await expect(sidebar(page).getByRole("link", { name: "Work with Foli AI" })).toBeVisible();
  // Library settings point to Settings > AI.
  await page.goto("/settings/library");
  await page.getByTestId("library-ai-keys").getByRole("link", { name: "Settings, under AI" }).click();
  await expect(page.getByRole("heading", { name: "Your own keys" })).toBeVisible();
  await context.close();
});
