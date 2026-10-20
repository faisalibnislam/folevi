// Synced blocks (docs/SYNCED_BLOCKS.md): turning lines into a synced block, copying it into another note, an
// edit in one note showing live in the other, a reload keeping it, unsyncing, and someone who can't see the
// content getting "You don't have access".
import { expect, test, type Page } from "@playwright/test";
import { createWorkspace, newPerson, openShare, pick, switchTo, waitForSaved } from "./helpers";

type Clip = Record<string, string>;

async function newNote(page: Page, title: string): Promise<string> {
  const before = page.url();
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL((url) => url.href !== before && /^\/d\/[0-9A-Z]{26}$/.test(url.pathname) && url.searchParams.get("new") === "1");
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("");
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.keyboard.press("Enter");
  return page.url().replace(/\?.*$/, "");
}

/** Records what the next copy puts on the clipboard (read during the event, after the editor wrote it). */
async function recordClipboard(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __clip?: Record<string, string> | null };
    w.__clip = null;
    window.addEventListener(
      "copy",
      (e) => {
        const d = e.clipboardData;
        if (d) w.__clip = Object.fromEntries([...d.types].map((t) => [t, d.getData(t)]));
      },
      { once: true },
    );
  });
}
const recorded = async (page: Page): Promise<Clip> => {
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __clip?: unknown }).__clip))).toBe(true);
  return (await page.evaluate(() => (window as unknown as { __clip: Clip }).__clip))!;
};

/** Pastes `clip` at the end of the note open in `page` (its own editor, not a synced block's). */
async function paste(page: Page, clip: Clip) {
  await page.evaluate((c) => {
    const ed = (document.querySelector(".fb-editor") as unknown as { editor: { commands: { focus: (at: string) => void }; view: { dom: HTMLElement } } }).editor;
    ed.commands.focus("end");
    const data = new DataTransfer();
    for (const [k, v] of Object.entries(c)) data.setData(k, v);
    ed.view.dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, clip);
}

/** The synced block's own editor (in the note's first synced block). */
const syncedBody = (page: Page) => page.locator(".fb-synced").first().getByRole("textbox", { name: "Synced block" });
const syncedMenu = (page: Page) => page.locator(".fb-synced").first().getByRole("button", { name: /options$/ });

test.describe("synced blocks", () => {
  test.setTimeout(240_000);

  test("turn into, copy into another note, live edits, reload, unsync", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Sync Writer");
    const alpha = await newNote(page, "Alpha");
    await page.keyboard.type("Intro for alpha");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Shared agenda: budget review");
    await waitForSaved(page);

    // The block menu: Turn into synced block.
    const line = page.getByRole("textbox", { name: "Document body" }).locator("p.fb-paragraph", { hasText: "Shared agenda" });
    await line.hover({ position: { x: 20, y: 10 } });
    await page.getByRole("button", { name: /^Drag to move/ }).click();
    await page.getByRole("menu", { name: /Block options/ }).getByRole("menuitem", { name: "Turn into synced block" }).click();
    await expect(page.locator(".fb-synced")).toHaveCount(1);
    await expect(syncedBody(page)).toContainText("Shared agenda: budget review");
    await expect(syncedMenu(page)).toHaveAccessibleName("Synced, in 1 note, options");
    await waitForSaved(page);

    // Copy synced block (its own menu), then paste it into a second note: the same content, in 2 notes.
    await recordClipboard(page);
    await syncedMenu(page).click();
    await page.getByRole("menuitem", { name: /Copy synced block/ }).click();
    const clip = await recorded(page);
    expect(clip["application/x-folevi-blocks"] ?? clip["text/html"]).toBeTruthy();
    const beta = await newNote(page, "Beta");
    await page.keyboard.type("Intro for beta");
    await paste(page, clip);
    await expect(syncedBody(page)).toContainText("Shared agenda: budget review");
    await waitForSaved(page);
    await expect(syncedMenu(page)).toHaveAccessibleName("Synced, in 2 notes, options", { timeout: 20_000 });

    // The menu lists the other note; it opens from there.
    await syncedMenu(page).click();
    await expect(page.getByRole("menuitem", { name: "Alpha" })).toBeVisible();
    await page.keyboard.press("Escape");

    // Alpha open in a second window: an edit in Beta shows there live.
    const other = await context.newPage();
    await other.goto(alpha);
    await expect(syncedBody(other)).toContainText("Shared agenda: budget review");
    await syncedBody(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" and hiring");
    await expect(syncedBody(other)).toContainText("Shared agenda: budget review and hiring", { timeout: 20_000 });
    // And the other way round.
    await syncedBody(other).click();
    await other.keyboard.press("ControlOrMeta+End");
    await other.keyboard.press("Enter");
    await other.keyboard.type("Second shared line");
    await expect(syncedBody(page)).toContainText("Second shared line", { timeout: 20_000 });
    await waitForSaved(other);
    await waitForSaved(page);

    // Offline: an edit made with no connection syncs when it's back, and shows in the other note.
    await context.setOffline(true);
    await syncedBody(page).locator("p", { hasText: "Second shared line" }).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" (written offline)");
    await expect(page.getByTestId("sync-status")).toHaveAttribute("data-status", "offline", { timeout: 20_000 });
    await context.setOffline(false);
    await waitForSaved(page);
    await expect(syncedBody(other)).toContainText("Second shared line (written offline)", { timeout: 30_000 });

    // A reload keeps it, in both notes.
    await page.reload();
    await expect(syncedBody(page)).toContainText("budget review and hiring");
    await expect(syncedBody(page)).toContainText("Second shared line (written offline)");
    await expect(page.getByRole("textbox", { name: "Document body" }).first()).toContainText("Intro for beta");

    // Unsync in Alpha: Alpha keeps ordinary lines; Beta stays synced, now in 1 note.
    await syncedMenu(other).click();
    await other.getByRole("menuitem", { name: /^Unsync/ }).click();
    await expect(other.locator(".fb-synced")).toHaveCount(0);
    const alphaBody = other.getByRole("textbox", { name: "Document body" });
    await expect(alphaBody).toContainText("Shared agenda: budget review and hiring");
    await expect(alphaBody).toContainText("Second shared line (written offline)");
    await waitForSaved(other);
    await expect(syncedMenu(page)).toHaveAccessibleName("Synced, in 1 note, options", { timeout: 20_000 });
    // Alpha's copy is its own now: typing there leaves Beta alone.
    await alphaBody.locator("p.fb-paragraph", { hasText: "Second shared line" }).click();
    await other.keyboard.press("End");
    await other.keyboard.type(" (alpha only)");
    await waitForSaved(other);
    await other.reload();
    await expect(other.getByRole("textbox", { name: "Document body" })).toContainText("(alpha only)");
    await expect(syncedBody(page)).not.toContainText("(alpha only)");
    void beta;
    await context.close();
  });

  test("Insert panel and slash menu; someone who can't see the content gets a placeholder", async ({ browser }) => {
    const owner = await newPerson(browser, "Sync Owner");
    const reader = await newPerson(browser, "Sync Reader");
    const page = owner.page;

    // A synced block made in a team workspace's note, from the slash menu.
    await createWorkspace(page, "Synced Team");
    await newNote(page, "Team plan");
    await page.keyboard.type("/synced");
    await page.getByRole("option", { name: /Synced block/ }).first().click();
    await expect(page.locator(".fb-synced")).toHaveCount(1);
    await expect(syncedBody(page)).toBeFocused();
    await page.keyboard.type("Team-only roadmap");
    await waitForSaved(page);

    await recordClipboard(page);
    await syncedMenu(page).click();
    await page.getByRole("menuitem", { name: /Copy synced block/ }).click();
    const clip = await recorded(page);

    // Shown in a note of the owner's own Personal, which is shared with someone outside the workspace.
    await switchTo(page, "Personal");
    const mine = await newNote(page, "My overview");
    await page.keyboard.type("Visible to my reader");
    await paste(page, clip);
    await expect(syncedBody(page)).toContainText("Team-only roadmap");
    await waitForSaved(page);
    await openShare(page);
    const share = page.getByRole("dialog", { name: /Share/ });
    await share.getByLabel("Email address").fill(reader.email);
    await pick(share.getByLabel("Role"), "Can view");
    await share.getByRole("button", { name: "Share", exact: true }).click();
    await expect(share.getByText("Sync Reader")).toBeVisible();
    await share.getByRole("button", { name: "Close" }).click();

    // The reader sees the note, but not the workspace's content in it.
    await reader.page.goto(mine);
    await expect(reader.page.getByRole("textbox", { name: "Document body" })).toContainText("Visible to my reader");
    await expect(reader.page.locator(".fb-synced")).toContainText("You don't have access to this synced block");
    await expect(reader.page.locator(".fb-synced")).not.toContainText("Team-only roadmap");

    // The Insert panel adds one too (in the owner's note).
    await page.getByRole("textbox", { name: "Document body" }).first().click();
    await page.keyboard.press("ControlOrMeta+End");
    const insert = page.getByRole("toolbar", { name: "Page tools" }).getByRole("button", { name: "Insert", exact: true });
    await insert.click();
    await page.getByRole("region", { name: "Insert", exact: true }).getByRole("button", { name: "Synced block", exact: true }).first().click();
    await expect(page.locator(".fb-synced")).toHaveCount(2);
    await owner.context.close();
    await reader.context.close();
  });
});
