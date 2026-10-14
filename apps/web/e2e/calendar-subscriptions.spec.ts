import { expect, test } from "@playwright/test";
import { APP, newPerson, seedExternalCalendar } from "./helpers";

/** Today in the browser, as YYYY-MM-DD, and its time zone. */
async function localToday(page: import("@playwright/test").Page) {
  return await page.evaluate(() => {
    const d = new Date();
    return { date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, zone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  });
}

test("subscribed calendar: events show read-only in month and week, with their details as plain text", async ({ browser }) => {
  const { page, email } = await newPerson(browser, "Calendar Subscriber");
  const { date, zone } = await localToday(page);
  const day = date.replace(/-/g, "");
  const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10).replace(/-/g, "");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:review@e2e",
    `DTSTART;TZID=${zone}:${day}T100000`,
    `DTEND;TZID=${zone}:${day}T110000`,
    "SUMMARY:Design review",
    "LOCATION:Room 5",
    "DESCRIPTION:Agenda at https://example.com/agenda\\n<b>Bring sketches</b>",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:holiday@e2e",
    `DTSTART;VALUE=DATE:${day}`,
    `DTEND;VALUE=DATE:${next}`,
    "SUMMARY:Company holiday",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  seedExternalCalendar(email, "Team", "plum", ics);

  await page.goto(`${APP}/calendar`);
  await page.getByRole("radio", { name: "month" }).click();
  const cell = page.locator(`[role="gridcell"][data-date="${date}"]`);
  const review = cell.getByRole("button", { name: "Design review, 10:00, from Team" });
  await expect(review).toBeVisible();
  await expect(cell.getByRole("button", { name: "Company holiday, all day, from Team" })).toBeVisible();
  // Events have no checkbox: they aren't tasks.
  await expect(page.getByRole("checkbox", { name: /Design review/ })).toHaveCount(0);

  // Details: time, place and the description as text (the address isn't made a link, the markup stays text).
  await review.click();
  const details = page.getByRole("dialog", { name: "Design review" });
  await expect(details).toContainText("10:00 to 11:00");
  await expect(details).toContainText("Room 5");
  await expect(details).toContainText("Agenda at https://example.com/agenda");
  await expect(details).toContainText("<b>Bring sketches</b>");
  await expect(details.getByRole("link")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);

  // The week shows the timed event on the hour grid and the all-day one in the all-day row.
  await page.getByRole("radio", { name: "week" }).click();
  await expect(page.getByRole("button", { name: "Design review, 10:00 to 11:00, from Team" })).toBeVisible();
  await expect(page.locator(`[role="gridcell"][data-date="${date}"]`).getByRole("button", { name: "Company holiday, all day, from Team" })).toBeVisible();
});

test("Calendars: private links are refused, a load error is said plainly, rename and remove", async ({ browser }) => {
  const { page } = await newPerson(browser, "Calendar Adder");
  await page.goto(`${APP}/calendar`);
  await page.getByRole("button", { name: "Calendars" }).click();
  const panel = page.getByRole("dialog", { name: "Calendars" });
  const form = panel.getByRole("form", { name: "Add calendar" });

  await form.getByLabel("Calendar link (ICS)").fill("http://192.168.1.10/calendar.ics");
  await form.getByRole("button", { name: "Add" }).click();
  await expect(form.getByRole("alert")).toHaveText("Calendars on private or local networks can't be added.");

  // A public address that isn't there: added, then the fetch says why it failed.
  await form.getByLabel("Calendar link (ICS)").fill("webcal://www.example.com/folevi-e2e-missing.ics");
  await form.getByLabel("Name (optional)").fill("Example");
  await form.getByRole("button", { name: "Add" }).click();
  const row = panel.getByRole("listitem", { name: "Example" });
  await expect(row).toBeVisible();
  await expect(row.getByRole("status")).toHaveText("Couldn't load this calendar: the address returned 404.", { timeout: 30_000 });

  await row.getByRole("button", { name: "Edit Example" }).click();
  await row.getByLabel("Name").fill("Example feed");
  await row.getByText("Coral").click();
  await row.getByRole("button", { name: "Save" }).click();
  const renamed = panel.getByRole("listitem", { name: "Example feed" });
  await expect(renamed).toBeVisible();

  await renamed.getByRole("button", { name: "Edit Example feed" }).click();
  await renamed.getByRole("button", { name: "Remove" }).click();
  await renamed.getByRole("button", { name: "Remove calendar" }).click();
  await expect(panel.getByRole("listitem")).toHaveCount(0);
});
