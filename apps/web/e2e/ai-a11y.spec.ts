import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { APP, newPerson, openTool, settle, waitForSaved } from "./helpers";

// Accessibility of every Foli surface (docs/AI_ASSISTANT.md milestone 9): axe over the AI page, the
// floating chat, the note's AI sidebar (Write, Ask, Agent, Study), the inline composer (on a light page and
// on a night page), the graph (graph and list), Related and Settings > AI, in light and dark; then the
// keyboard: focus returns when panels close, the graph's arrow keys, and streaming answers that aren't read
// out word by word. Without a model key (CI, local dev) the composer's request is refused, so its diff view
// is scanned only when a key is set.

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Serious and critical violations on the page, or inside `include`. */
async function scan(page: Page, label: string, include?: string) {
  await settle(page);
  let builder = new AxeBuilder({ page }).withTags(TAGS).disableRules(["region"]);
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${label}: ${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} ${n.failureSummary ?? ""}`).slice(0, 3).join(" | ")}`);
}

async function newNote(page: Page, title: string, body: string) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.keyboard.press("Enter");
  await page.keyboard.type(body);
  await waitForSaved(page);
  return page.url().replace(/\?.*$/, "");
}

test("every Foli surface has no serious accessibility violations, light and dark", async ({ browser }) => {
  test.setTimeout(420_000);
  const { page, context } = await newPerson(browser, "Foli A11y");
  const note = await newNote(page, "Harbour plans", "We chose the harbour hall. Sam sends the deck by Friday. See [[Venue list");
  await page.getByRole("option", { name: /Create page “Venue list”/ }).click();
  await waitForSaved(page);

  const problems: string[] = [];
  for (const scheme of ["light", "dark"] as const) {
    await page.evaluate((s) => localStorage.setItem("folevi:appearance", s), scheme);

    // The AI page, new chat (the first-time introduction is on it until dismissed).
    await page.goto(`${APP}/ai`);
    await expect(page.getByRole("heading", { name: "Meet Foli", level: 2 })).toBeVisible({ timeout: 30_000 });
    problems.push(...(await scan(page, `${scheme} /ai`)));

    // The floating chat, from Home (a note's sidebar lists its pages, and AI lives in the note's own panel).
    await page.goto(`${APP}/documents`);
    const launcher = page.getByRole("button", { name: "Ask Foli" });
    await launcher.click();
    const chat = page.getByRole("dialog", { name: "Foli" });
    await expect(chat).toBeVisible();
    problems.push(...(await scan(page, `${scheme} floating chat`, ".ai-chat")));
    await page.keyboard.press("Escape");
    await expect(chat).toBeHidden();

    // The note's AI sidebar, each mode.
    await page.goto(note);
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Harbour plans", { timeout: 30_000 });
    await page.getByRole("toolbar", { name: "Page tools" }).getByRole("button", { name: "Foli" }).click();
    const modes = page.getByRole("group", { name: "What Foli should do" });
    for (const mode of ["Write", "Ask", "Study"]) {
      await modes.getByRole("button", { name: mode, exact: true }).click();
      await expect(modes.getByRole("button", { name: mode, exact: true })).toHaveAttribute("aria-pressed", "true");
      problems.push(...(await scan(page, `${scheme} note AI ${mode}`)));
    }

    // Related.
    await page.getByRole("group", { name: "Page" }).getByRole("button", { name: "Document actions" }).click();
    await page.getByRole("menuitem", { name: "Related notes" }).click();
    await expect(page.getByRole("region", { name: "Related", exact: true })).toBeVisible();
    problems.push(...(await scan(page, `${scheme} Related`)));
    await page.keyboard.press("Escape");

    // The graph, then its list.
    await page.goto(`${APP}/graph`);
    await expect(page.getByRole("application", { name: /Graph of \d+ notes/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /Harbour plans, note/ })).toBeVisible({ timeout: 30_000 });
    problems.push(...(await scan(page, `${scheme} graph`)));
    await page.getByRole("group", { name: "View" }).getByRole("button", { name: "List" }).click();
    problems.push(...(await scan(page, `${scheme} graph list`)));
    await page.getByRole("group", { name: "View" }).getByRole("button", { name: "Graph" }).click();

    // Settings > AI.
    await page.goto(`${APP}/settings/ai`);
    await expect(page.getByRole("switch", { name: "Web research" })).toBeVisible({ timeout: 30_000 });
    problems.push(...(await scan(page, `${scheme} settings/ai`)));
  }
  expect(problems).toEqual([]);
  await context.close();
});

test("the inline composer reads well on a light page and on a night page, and shows its changes accessibly", async ({ browser }) => {
  test.setTimeout(240_000);
  const { page, context } = await newPerson(browser, "Composer A11y");
  await newNote(page, "Draft", "This sentence could be written a bit more clearly than it is now.");
  const body = page.getByRole("textbox", { name: "Document body" });
  const first = body.locator("p.fb-paragraph").first();

  const problems: string[] = [];
  for (const scheme of ["light", "dark"] as const) {
    for (const sheet of ["plain", "night"] as const) {
      await page.evaluate((s) => localStorage.setItem("folevi:appearance", s), scheme);
      await page.reload();
      await expect(first).toBeVisible({ timeout: 30_000 });
      if (sheet === "night") {
        await openTool(page, "Style");
        const color = page.getByRole("radio", { name: "Document color: Night" });
        if (!(await color.isVisible())) await page.getByRole("button", { name: "Document color" }).click();
        await color.click();
        await expect(page.locator("article.fb-sheet")).toHaveAttribute("data-sheet", "night");
        await page.keyboard.press("Escape");
      }
      await first.click({ clickCount: 3 });
      await page.getByRole("toolbar", { name: "Text formatting" }).getByRole("button", { name: /^Ask Foli/ }).click();
      const ai = page.getByRole("dialog", { name: "Foli" });
      await expect(ai).toBeVisible();
      problems.push(...(await scan(page, `${scheme} ${sheet} composer`, '[role="dialog"][popover]')));
      await ai.getByRole("listbox", { name: "AI suggestions" }).getByRole("option", { name: "Improve writing", exact: true }).click();
      // With a model key: the changes view. Without one: the refusal. Either way, scanned.
      const changes = ai.getByRole("group", { name: "Changes to the selected text" });
      await expect(changes.or(ai.getByRole("alert"))).toBeVisible({ timeout: 60_000 });
      problems.push(...(await scan(page, `${scheme} ${sheet} composer result`, '[role="dialog"][popover]')));
      // Closing gives focus back to the note.
      await page.keyboard.press("Escape");
      await expect(ai).toHaveCount(0);
      await expect(body).toBeFocused();
    }
  }
  expect(problems).toEqual([]);
  await context.close();
});

test("keyboard: focus comes back when panels close, the graph moves node to node, answers aren't read out word by word, motion can be reduced", async ({ browser }) => {
  test.setTimeout(180_000);
  const { page, context } = await newPerson(browser, "Keys Person");
  await newNote(page, "Packing", "Tent, stove and see [[Route notes");
  await page.getByRole("option", { name: /Create page “Route notes”/ }).click();
  await waitForSaved(page);

  // The floating chat: Escape closes it and focus goes back to the button that opened it.
  await page.goto(`${APP}/documents`);
  const launcher = page.getByRole("button", { name: "Ask Foli" });
  await launcher.focus();
  await page.keyboard.press("Enter");
  const chat = page.getByRole("dialog", { name: "Foli" });
  await expect(chat.getByRole("textbox", { name: /Ask about your notes/ })).toBeFocused();
  // The messages aren't a live region (that would read every streamed word); one polite status says when an answer is ready.
  expect(await chat.locator('[aria-live="polite"]').evaluateAll((els) => els.filter((e) => e.textContent && e.textContent.length > 200).length)).toBe(0);
  await expect(chat.locator('[role="status"][aria-live="polite"][aria-atomic="true"]')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(launcher).toBeFocused();

  // Reduced motion: the chat opens without its rise animation.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await launcher.click();
  const moving = await chat.evaluate((el) => {
    const cs = getComputedStyle(el);
    return cs.animationName !== "none" && parseFloat(cs.animationDuration) > 0.01;
  });
  expect(moving).toBe(false);
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // The graph: Tab reaches one node, arrow keys move between nodes, Enter opens a note.
  await page.goto(`${APP}/graph`);
  const graph = page.getByRole("application", { name: /Graph of \d+ notes/ });
  await expect(graph).toBeVisible({ timeout: 30_000 });
  const nodes = graph.getByRole("button");
  await expect(nodes.first()).toBeVisible({ timeout: 30_000 });
  await expect(graph.locator('[role="button"][tabindex="0"]')).toHaveCount(1);
  await graph.locator('[role="button"][tabindex="0"]').focus();
  const start = await page.evaluate(() => document.activeElement?.getAttribute("data-node"));
  let moved = false;
  for (const key of ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"]) {
    await page.keyboard.press(key);
    if ((await page.evaluate(() => document.activeElement?.getAttribute("data-node"))) !== start) {
      moved = true;
      break;
    }
  }
  expect(moved).toBe(true);
  // The focused node says what it is.
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/d\/[0-9A-Z]{26}/);

  // The note's AI sidebar: its controls are reachable with Tab, and closing the panel doesn't strand focus.
  await expect(page.getByRole("textbox", { name: "Title" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("toolbar", { name: "Page tools" }).getByRole("button", { name: "Foli" }).click();
  const modes = page.getByRole("group", { name: "What Foli should do" });
  await modes.getByRole("button", { name: "Ask", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(modes.getByRole("button", { name: "Ask", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Summarize this" })).toBeVisible();
  await page.getByRole("button", { name: "Close panel" }).first().click();
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  await context.close();
});
