import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { APP, completeOnboarding, createAccount, grantPlatformRole, newPerson, pick, settle, uniqueEmail } from "./helpers";

// The marketing site is the app host without "app." (folevi.com / app.folevi.com; locally localhost / app.localhost).
const SITE = APP.replace("://app.", "://");

// One support staff member for the whole file, reused through the saved browser session.
let staffState: Awaited<ReturnType<import("@playwright/test").BrowserContext["storageState"]>> | null = null;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const { page, account } = await createAccount(context, { name: "Sam Support" });
  await completeOnboarding(page);
  grantPlatformRole(account.email, "support_admin");
  staffState = await context.storageState();
  await context.close();
});

async function staffPage(browser: Browser, path: string): Promise<Page> {
  const context = await browser.newContext({ storageState: staffState ?? undefined });
  const page = await context.newPage();
  await page.goto(`${APP}${path}`);
  await expect(page.getByRole("navigation", { name: "Admin" })).toBeVisible({ timeout: 30_000 });
  return page;
}

/** Support mail captured by the development mailbox (non-production only), by template key. */
async function mailboxKeys(request: APIRequestContext, email: string, wanted: string): Promise<string[]> {
  for (let i = 0; i < 40; i++) {
    const res = await request.get(`${APP}/api/dev/mailbox?to=${encodeURIComponent(email)}`);
    const { messages } = (await res.json()) as { messages: { key: string }[] };
    const keys = messages.map((m) => m.key);
    if (keys.includes(wanted)) return keys;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no ${wanted} email for ${email}`);
}

let pageRequest = { email: "", number: 0 };

test("a visitor sends a request from the support page and gets a confirmation email", async ({ page }) => {
  const email = uniqueEmail("support-visitor");
  await page.goto(`${SITE}/support`);
  await expect(page.getByRole("heading", { level: 1, name: "How can we help?" })).toBeVisible();
  // The FAQ is also published as FAQPage structured data.
  const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(ld.join("\n")).toContain('"FAQPage"');
  await expect(page.getByRole("link", { name: "support@folevi.com" }).first()).toBeVisible();

  const form = page.getByRole("form", { name: "Contact support" });
  // Nothing is sent until the form is valid; errors are tied to their fields.
  await form.getByRole("button", { name: "Send message" }).click();
  await expect(form.getByLabel("Your name")).toHaveAttribute("aria-invalid", "true");
  await form.getByLabel("Your name").fill("Vera Visitor");
  await form.getByLabel("Email").fill(email);
  await pick(form.getByRole("combobox", { name: "Topic" }), "Billing and plans");
  await form.getByLabel("Message").fill("Can I switch from monthly to yearly billing without losing my notes?");
  await form.getByRole("button", { name: "Send message" }).click();

  const status = page.getByRole("status");
  await expect(status).toContainText(/Your request number is #\d+/, { timeout: 20_000 });
  const number = Number(/#(\d+)/.exec((await status.textContent()) ?? "")![1]);
  expect(number).toBeGreaterThan(1000);
  expect(await mailboxKeys(page.context().request, email, "support_ticket_received")).toContain("support_ticket_received");
  pageRequest = { email, number };
});

test("staff find a request by address or number in the Support inbox", async ({ browser }) => {
  test.skip(!pageRequest.number, "needs the request from the support page");
  const page = await staffPage(browser, "/admin/support");
  await expect(page.getByRole("heading", { level: 1, name: "Support" })).toBeVisible();
  await page.getByRole("searchbox", { name: "Ticket number or email" }).fill(pageRequest.email);
  await page.getByRole("button", { name: "Search" }).click();
  const row = page.getByRole("row", { name: new RegExp(`#${pageRequest.number}`) });
  await expect(row).toContainText("Vera Visitor");
  await expect(row).toContainText("Support page");
  await page.getByRole("searchbox", { name: "Ticket number or email" }).fill(`#${pageRequest.number}`);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("link", { name: `#${pageRequest.number}` })).toBeVisible();
  await page.context().close();
});

test("a signed-in person contacts support from the app, staff reply, and the reply shows in Help", async ({ browser }) => {
  const requester = await newPerson(browser, "Rita Requester");
  const page = requester.page;
  await page.goto(`${APP}/help`);
  await expect(page.getByRole("heading", { name: "Your support requests" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Contact support" }).first().click();

  const dialog = page.getByRole("dialog", { name: "Contact support" });
  await expect(dialog).toBeVisible();
  // The account comes from the session: the address is shown, locked.
  await expect(dialog.getByLabel("Email")).toHaveValue(requester.email);
  await expect(dialog.getByLabel("Email")).toHaveAttribute("readonly", "");
  await expect(dialog.getByLabel("Your name")).toHaveValue("Rita Requester");
  await pick(dialog.getByRole("combobox", { name: "Topic" }), "Sync and offline");
  await dialog.getByLabel("Message").fill("A page on my laptop still says Offline after reconnecting.");
  await dialog.getByRole("button", { name: "Send message" }).click();
  const status = dialog.getByRole("status");
  await expect(status).toContainText(/Your request number is #\d+/, { timeout: 20_000 });
  const number = Number(/#(\d+)/.exec((await status.textContent()) ?? "")![1]);
  await dialog.getByRole("button", { name: "Done" }).click();

  const requests = page.getByRole("list", { name: "Your support requests" });
  const item = requests.getByRole("button", { name: new RegExp(`#${number} · A page on my laptop`) });
  await expect(item).toBeVisible();
  await expect(item).toContainText("No reply yet");

  // Staff: the Support nav shows unread work; the ticket says who sent it and that they were signed in.
  const staff = await staffPage(browser, "/admin/support");
  await expect(staff.getByRole("link", { name: /^Support \d+ unread$/ })).toBeVisible();
  await staff.getByRole("link", { name: `#${number}` }).click();
  await expect(staff.getByRole("heading", { level: 1 })).toContainText("A page on my laptop still says Offline");
  await expect(staff.getByText("Sent while signed in to this account.")).toBeVisible();
  // An internal note first: staff only.
  await staff.getByRole("radio", { name: "Internal note" }).click();
  await staff.getByRole("textbox", { name: "Internal note" }).fill("Checked: the sync log shows a pending batch.");
  await staff.getByRole("button", { name: "Add note" }).click();
  await expect(staff.getByRole("list", { name: `Messages in ticket ${number}` })).toContainText("Checked: the sync log shows a pending batch.");
  // Then the reply, which is emailed and becomes Pending.
  await staff.getByRole("radio", { name: "Reply to requester" }).click();
  await staff.getByRole("textbox", { name: "Reply" }).fill("Thanks Rita. Open that page once while online and it will send the waiting edits.");
  await staff.getByRole("button", { name: "Send reply" }).click();
  await expect(staff.getByRole("list", { name: `Messages in ticket ${number}` })).toContainText("Open that page once while online");
  await expect(staff.getByRole("combobox", { name: "Status" })).toContainText("Pending");
  await staff.context().close();

  // The requester sees the reply (never the note) in Help, and got it by email.
  await expect(item).toContainText("1 reply", { timeout: 20_000 });
  await item.click();
  const thread = page.getByRole("list", { name: `Messages in request ${number}` });
  await expect(thread).toContainText("Folevi support");
  await expect(thread).toContainText("Open that page once while online");
  await expect(thread).not.toContainText("sync log shows a pending batch");
  expect(await mailboxKeys(page.context().request, requester.email, "support_reply")).toEqual(expect.arrayContaining(["support_ticket_received", "support_reply"]));
  await requester.context.close();
});

for (const scheme of ["light", "dark"] as const) {
  test(`the support page has no serious accessibility violations (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`${SITE}/support`);
    await expect(page.getByRole("heading", { level: 1, name: "How can we help?" })).toBeVisible();
    await settle(page);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
  });
}
