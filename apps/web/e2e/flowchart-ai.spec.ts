import { expect, test, type Page } from "@playwright/test";
import { newPerson, waitForSaved } from "./helpers";

// Foli AI on the flowchart (docs/FLOWCHART_V2_PLAN.md, Intelligence) with a scripted model: development
// builds let `window.__foleviTestFlowchartAi` answer instead of the server (flowchart/aiClient.ts), so the
// previews, Apply and Discard, one-step undo, Check with jump-to, Explain, label suggestions, extending from
// a selection, the block menu's "Flowchart with Foli AI" and Tidy up (direction, keep my placement, and
// Tidy up with Foli AI) are tested without Gemini. The server side has its own tests
// (tests/convex/flowchart-ai.test.ts, packages/ai-prompts/test/flowchart-tasks.test.ts).

const SHOTS = process.env.FLOWCHART_SHOTS;

async function newNote(page: Page, title: string) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Intro");
  await waitForSaved(page);
}

/** The scripted model: one answer per task, every call recorded in window.__flowCalls. */
async function scriptModel(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __flowCalls: { task: string; args: Record<string, unknown> }[]; __foleviTestFlowchartAi: (task: string, args: Record<string, unknown>) => unknown };
    w.__flowCalls = [];
    const edge = (from: string, to: string, label = "") => ({ from, to, label, style: "solid", arrow: "end" });
    w.__foleviTestFlowchartAi = async (task, args) => {
      w.__flowCalls.push({ task, args });
      await new Promise((r) => setTimeout(r, 150));
      if (task === "draw" || task === "fromText")
        return {
          direction: "TD",
          nodes: [
            { id: "s", shape: "terminator", text: "Start", color: "neutral" },
            { id: "q", shape: "decision", text: "Approved?", color: "neutral" },
            { id: "a", shape: "process", text: "Ship it", color: "neutral" },
            { id: "e", shape: "terminator", text: "Done", color: "neutral" },
          ],
          edges: [edge("s", "q"), edge("q", "a", "Yes"), edge("a", "e")],
        };
      if (task === "extend") {
        const at = (args.nodeIds as string[])[0]!;
        return { nodes: [{ id: "x1", shape: "process", text: "Rework the draft", color: "neutral" }], edges: [edge(at, "x1", "No"), edge("x1", at)], labels: [] };
      }
      if (task === "explain") return { summary: "An approval flow for a release.", steps: ["Start", "Check the approval", "Ship it"], decisions: ["Approved work ships."], gaps: [], markdown: "An approval flow for a release.\n\n**Main path**\n\n1. Start\n2. Check the approval\n3. Ship it" };
      if (task === "labels")
        return {
          shapes: [
            { id: "a", text: "Ship the release", before: "Ship it", why: "Says what ships" },
            { id: "q", text: "Release approved?", before: "Approved?", why: "A clearer question" },
          ],
          connectors: [],
        };
      if (task === "arrange") {
        const data = JSON.parse(String(args.data)) as { nodes: { id: string }[] };
        return { direction: "LR", rows: data.nodes.map((n) => [n.id]) };
      }
      throw new Error(`No script for ${task}`);
    };
  });
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __flowCalls: { task: string; args: Record<string, unknown> }[] }).__flowCalls);

test.describe("Flowchart Foli AI", () => {
  test.setTimeout(180_000);

  test("draw with a preview, check and jump, extend from a selection, explain, clearer labels, one undo step each", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Flowchart AI Tester");
    await newNote(page, "Release");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/flowchart");
    await page.getByRole("option", { name: /Flowchart/ }).first().click();
    const canvas = page.getByRole("application", { name: /Flowchart/ });
    await expect(canvas).toBeVisible();
    await scriptModel(page);
    const tools = page.getByRole("toolbar", { name: "Flowchart tools" });
    const nodes = canvas.locator("[data-fc-node]");
    const preview = canvas.getByRole("region", { name: "Foli AI preview" });

    // Draw: the result is a preview first; Discard leaves the chart as it was.
    await canvas.getByRole("button", { name: "Create with AI" }).click();
    const panel = canvas.getByRole("dialog", { name: "Create a flowchart with AI" });
    await panel.getByRole("textbox", { name: "Describe the process" }).fill("How a release gets approved");
    await page.keyboard.press("Enter");
    await expect(preview).toContainText("Foli AI's flowchart");
    await expect(preview).toContainText("4 shapes");
    await expect(nodes).toHaveCount(4);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/preview-draw.png` });
    await preview.getByRole("button", { name: "Discard" }).click();
    await expect(preview).toHaveCount(0);
    await expect(nodes).toHaveCount(0);
    // Again, and Apply: one change, undone and redone in one step.
    await canvas.getByRole("button", { name: "Create with AI" }).click();
    await canvas.getByRole("dialog", { name: "Create a flowchart with AI" }).getByRole("textbox", { name: "Describe the process" }).fill("How a release gets approved");
    await page.keyboard.press("Enter");
    await preview.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("application", { name: "Flowchart, 4 shapes" })).toBeVisible();
    await canvas.focus();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(nodes).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(nodes).toHaveCount(4);
    expect((await calls(page)).map((c) => c.task)).toEqual(["draw", "draw"]);

    // Check: the decision has one way out and "Ship it"... is fine (it leads to Done). Jump selects it.
    const check = tools.getByRole("button", { name: /^Check/ });
    await expect(check).toHaveAccessibleName("Check, 1 to look at");
    await check.click();
    const checkPanel = canvas.getByRole("dialog", { name: "Check the flowchart" });
    const problems = checkPanel.getByRole("list", { name: "Problems found" });
    await expect(problems.getByRole("button")).toHaveCount(1);
    await expect(problems).toContainText("Decision with one way out");
    await problems.getByRole("button").first().click();
    await expect(canvas.getByRole("button", { name: /^Decision: Approved\?/ })).toHaveAttribute("aria-pressed", "true");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/check.png` });

    // Explain: a summary to read, then added to the note under the chart.
    await checkPanel.getByRole("button", { name: "Explain this flowchart" }).click();
    const explanation = checkPanel.getByRole("region", { name: "Explanation" });
    await expect(explanation).toContainText("An approval flow for a release.");
    await expect(explanation.getByRole("listitem")).toHaveCount(4);
    await explanation.getByRole("button", { name: "Add to note" }).click();
    await expect(page.locator(".fb-editor")).toContainText("Check the approval");

    // Clearer labels: each change shown; take one of the two.
    await tools.getByRole("button", { name: /^Check/ }).click();
    await expect(checkPanel).toHaveCount(0);
    await tools.getByRole("button", { name: /^Check/ }).click();
    await checkPanel.getByRole("button", { name: "Suggest clearer labels" }).click();
    const suggestions = checkPanel.getByRole("region", { name: "Suggested labels" });
    await expect(suggestions.getByRole("checkbox")).toHaveCount(2);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/labels.png` });
    await suggestions.getByRole("checkbox", { name: "Use “Release approved?”" }).click();
    await expect(suggestions.getByRole("checkbox", { name: "Use “Release approved?”" })).toHaveAttribute("aria-checked", "false");
    await suggestions.getByRole("button", { name: "Apply 1 selected" }).click();
    await expect(canvas.getByRole("button", { name: /^Process: Ship the release/ })).toBeVisible();
    await expect(canvas.getByRole("button", { name: /^Decision: Approved\?/ })).toBeVisible();
    await checkPanel.getByRole("button", { name: "Close check" }).click();

    // Extend from the selection: the decision's missing branch, beside it, previewed, one undo step.
    const decision = canvas.getByRole("button", { name: /^Decision: Approved\?/ });
    await decision.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Fill in missing branches" }).click();
    await expect(preview).toContainText("Foli AI's missing branches");
    await expect(preview).toContainText("1 new shape, 2 connectors");
    await expect(nodes).toHaveCount(5);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/preview-branches.png` });
    // Enter applies (the canvas has the keyboard).
    await canvas.focus();
    await page.keyboard.press("Enter");
    await expect(preview).toHaveCount(0);
    await expect(page.getByRole("application", { name: "Flowchart, 5 shapes" })).toBeVisible();
    // The new shape doesn't sit on any other.
    const boxes = await nodes.evaluateAll((els) => els.map((el) => (el as SVGGraphicsElement).getBBox()).map((b) => ({ x: b.x, y: b.y, w: b.width, h: b.height })));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      expect(a.x + 4 < b.x + b.w && a.x + a.w > b.x + 4 && a.y + 4 < b.y + b.h && a.y + a.h > b.y + 4, `shapes ${i} and ${j} overlap`).toBe(false);
    }
    await expect(tools.getByRole("button", { name: /^Check/ })).toHaveAccessibleName("Check");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(nodes).toHaveCount(4);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(nodes).toHaveCount(5);

    // Saved, and still there after a reload.
    await waitForSaved(page);
    await page.waitForTimeout(800);
    await waitForSaved(page);
    await page.reload();
    await expect(page.getByRole("application", { name: "Flowchart, 5 shapes" })).toBeVisible();
    await context.close();
  });

  test("Tidy up: direction, keep my placement, and Tidy up with Foli AI when the layout is still hard to read", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Flowchart Tidy Tester");
    await newNote(page, "Tidy");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/flowchart");
    await page.getByRole("option", { name: /Flowchart/ }).first().click();
    const canvas = page.getByRole("application", { name: /Flowchart/ });
    await scriptModel(page);
    const tools = page.getByRole("toolbar", { name: "Flowchart tools" });
    await canvas.getByRole("button", { name: "Create with AI" }).click();
    await canvas.getByRole("dialog", { name: "Create a flowchart with AI" }).getByRole("textbox", { name: "Describe the process" }).fill("Release");
    await page.keyboard.press("Enter");
    await canvas.getByRole("region", { name: "Foli AI preview" }).getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("application", { name: "Flowchart, 4 shapes" })).toBeVisible();

    const centres = () =>
      canvas.locator("[data-fc-node]").evaluateAll((els) =>
        els.map((el) => {
          const b = (el as SVGGraphicsElement).getBBox();
          return { id: el.getAttribute("data-fc-node")!, x: b.x + b.width / 2, y: b.y + b.height / 2 };
        }),
      );
    const spread = (pts: { x: number; y: number }[]) => ({ x: Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)), y: Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)) });
    // Top to bottom first.
    expect(spread(await centres()).y).toBeGreaterThan(spread(await centres()).x);

    // The layout options: left to right tidies at once (the shapes glide there), as one undo step.
    await tools.getByRole("button", { name: "Layout options" }).click();
    await expect(page.getByRole("menuitemradio", { name: "Top to bottom" })).toHaveAttribute("aria-checked", "true");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/tidy-menu.png` });
    await page.getByRole("menuitemradio", { name: "Left to right" }).click();
    await expect.poll(async () => spread(await centres()).x > spread(await centres()).y, { timeout: 5_000 }).toBe(true);
    await canvas.focus();
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => spread(await centres()).y > spread(await centres()).x, { timeout: 5_000 }).toBe(true);
    await page.keyboard.press("ControlOrMeta+Shift+z");

    // Keep my placement is remembered as a choice in the menu.
    await tools.getByRole("button", { name: "Layout options" }).click();
    const keep = page.getByRole("menuitemcheckbox", { name: /Keep my placement/ });
    await expect(keep).toHaveAttribute("aria-checked", "false");
    await keep.click();
    await tools.getByRole("button", { name: "Layout options" }).click();
    await expect(page.getByRole("menuitemcheckbox", { name: /Keep my placement/ })).toHaveAttribute("aria-checked", "true");
    // Not hard to read yet: no Foli AI offer.
    await expect(page.getByRole("menuitem", { name: "Tidy up with Foli AI" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Two shapes on top of each other (a duplicate): Foli AI's arrangement is offered, previewed, applied.
    await canvas.getByRole("button", { name: /^Process: Ship it/ }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(canvas.locator("[data-fc-node]")).toHaveCount(5);
    await tools.getByRole("button", { name: "Layout options" }).click();
    await page.getByRole("menuitem", { name: "Tidy up with Foli AI" }).click();
    const preview = canvas.getByRole("region", { name: "Foli AI preview" });
    await expect(preview).toContainText("Foli AI's arrangement");
    await expect(preview).toContainText("was 1 overlap");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/preview-arrange.png` });
    await preview.getByRole("button", { name: "Apply" }).click();
    await expect(preview).toHaveCount(0);
    const pts = await centres();
    expect(spread(pts).x).toBeGreaterThan(spread(pts).y);
    expect((await calls(page)).map((c) => c.task)).toEqual(["draw", "arrange"]);
    // The plain Tidy up button still lays it out at once.
    await tools.getByRole("button", { name: /Tidy up/ }).click();
    await context.close();
  });

  test("the block menu draws a list as a flowchart, previewed in a new block", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Flowchart List Tester");
    await newNote(page, "Steps");
    await scriptModel(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("- Write the draft");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Get it approved");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Ship it");
    await waitForSaved(page);
    const first = page.locator(".fb-editor > .fb").filter({ hasText: /^Write the draft$/ });
    const fb = (await first.boundingBox())!;
    await page.mouse.move(fb.x + 40, fb.y + fb.height / 2);
    const grip = page.getByRole("button", { name: /Drag to move, click for block options/ });
    await grip.click({ modifiers: ["Shift"] });
    await page.mouse.move(fb.x + 40, fb.y + fb.height / 2);
    await grip.click();
    await page.getByRole("menuitem", { name: "Flowchart with Foli AI" }).click();
    const canvas = page.getByRole("application", { name: /Flowchart/ });
    const preview = canvas.getByRole("region", { name: "Foli AI preview" });
    await expect(preview).toContainText("Foli AI's flowchart from the text", { timeout: 20_000 });
    const sent = await calls(page);
    expect(sent.map((c) => c.task)).toEqual(["fromText"]);
    expect(String(sent[0]!.args.text)).toBe("- Write the draft\n- Get it approved\n- Ship it");
    await preview.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("application", { name: "Flowchart, 4 shapes" })).toBeVisible();
    // The list stays in the note above the chart.
    await expect(page.locator(".fb-editor > .fb-bulleted")).toHaveText(["Write the draft", "Get it approved", "Ship it"]);

    // The note's Foli AI panel: "Flowchart" draws the whole note (read on the server) in a new block below the caret.
    await page.locator(".fb-editor > .fb-bulleted").last().click();
    await page.keyboard.press("End");
    await expect(page.getByRole("application", { name: "Flowchart, 4 shapes" })).toBeVisible();
    await page.getByRole("toolbar", { name: "Page tools" }).getByRole("button", { name: "Foli AI" }).click();
    await expect(page.getByRole("application", { name: "Flowchart, 4 shapes" })).toBeVisible();
    await page.getByRole("button", { name: "Flowchart", exact: true }).click();
    await expect(page.getByRole("application", { name: /Flowchart/ })).toHaveCount(2);
    const fromNote = page.getByRole("region", { name: "Foli AI preview" });
    await expect(fromNote).toContainText("Foli AI's flowchart from the note", { timeout: 20_000 });
    const last = (await calls(page)).at(-1)!;
    expect(last.task).toBe("fromText");
    expect(last.args.documentId).toMatch(/^[0-9A-Z]{26}$/);
    await fromNote.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByRole("application", { name: "Flowchart, 0 shapes" })).toBeVisible();
    await context.close();
  });
});

// Screenshots for review (FLOWCHART_SHOTS=<folder>): the panels and the preview in light, dark and at phone width.
test("screenshots: light, dark and phone width", async ({ browser }) => {
  test.skip(!SHOTS, "Set FLOWCHART_SHOTS to a folder to take the review screenshots.");
  test.setTimeout(180_000);
  const { context, page } = await newPerson(browser, "Flowchart Shots");
  await newNote(page, "Shots");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/flowchart");
  await page.getByRole("option", { name: /Flowchart/ }).first().click();
  const canvas = page.getByRole("application", { name: /Flowchart/ });
  await scriptModel(page);
  await canvas.getByRole("button", { name: "Create with AI" }).click();
  await canvas.getByRole("dialog", { name: "Create a flowchart with AI" }).getByRole("textbox", { name: "Describe the process" }).fill("Release");
  await page.keyboard.press("Enter");
  await canvas.getByRole("region", { name: "Foli AI preview" }).getByRole("button", { name: "Apply" }).click();
  for (const [scheme, size] of [["light", { width: 1280, height: 860 }], ["dark", { width: 1280, height: 860 }], ["light", { width: 390, height: 844 }], ["dark", { width: 390, height: 844 }]] as const) {
    await page.setViewportSize(size);
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), scheme);
    const tag = `${scheme}-${size.width}`;
    const card = page.locator(".fb-flowchart").first();
    await card.scrollIntoViewIfNeeded();
    // The Foli AI panel with a shape selected.
    await canvas.getByRole("button", { name: /^Decision: Approved\?/ }).click();
    await page.getByRole("toolbar", { name: "Flowchart tools" }).getByRole("button", { name: "AI", exact: true }).click();
    await page.waitForTimeout(300);
    await card.screenshot({ path: `${SHOTS}/panel-${tag}.png` });
    await page.keyboard.press("Escape");
    // Check, with an explanation.
    await page.getByRole("toolbar", { name: "Flowchart tools" }).getByRole("button", { name: /^Check/ }).click();
    await canvas.getByRole("dialog", { name: "Check the flowchart" }).getByRole("button", { name: "Explain this flowchart" }).click();
    await expect(canvas.getByRole("region", { name: "Explanation" })).toBeVisible();
    await card.screenshot({ path: `${SHOTS}/check-${tag}.png` });
    await canvas.getByRole("dialog", { name: "Check the flowchart" }).getByRole("button", { name: "Close check" }).click();
    // A preview of new steps.
    await canvas.getByRole("button", { name: /^Process: Ship it/ }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Add next steps" }).click();
    await expect(canvas.getByRole("region", { name: "Foli AI preview" })).toBeVisible();
    await card.screenshot({ path: `${SHOTS}/preview-${tag}.png` });
    await canvas.getByRole("region", { name: "Foli AI preview" }).getByRole("button", { name: "Discard" }).click();
    // The layout options.
    await page.getByRole("toolbar", { name: "Flowchart tools" }).getByRole("button", { name: "Layout options" }).click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/tidy-${tag}.png` });
    await page.keyboard.press("Escape");
  }
  await context.close();
});
