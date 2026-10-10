import { expect, test } from "@playwright/test";
import { APP, newPerson } from "./helpers";

// Attachments and audio in the AI. Without a model key on the server (CI, local dev) nothing can be read,
// so this covers what works without one: attaching a file to a chat message (it uploads, shows as a chip
// and stays on the message), a Word file refused before anything is sent, and an audio block's Transcribe
// action saying plainly that the assistant isn't set up.

// Chromium's fake microphone (a steady tone) with the permission prompt answered.
test.use({ launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] } });

test("a file attached in the chat shows as a chip and stays on the message; a Word file is refused first", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, context } = await newPerson(browser, "Attach Person");
  await page.goto(`${APP}/ai`);
  await expect(page.getByRole("heading", { name: "Meet Foli", level: 2 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Attach files", exact: true })).toBeVisible();
  const picker = page.locator('input[type="file"]');

  await picker.setInputFiles({ name: "report.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("PK\u0003\u0004 not really a document") });
  const refused = page.getByRole("alert").filter({ hasText: "isn't supported yet" });
  await expect(refused).toBeVisible();
  await expect(page.getByRole("list", { name: "Attached files" })).toHaveCount(0);
  await refused.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(refused).toHaveCount(0);

  await picker.setInputFiles({ name: "ferry.txt", mimeType: "text/plain", buffer: Buffer.from("The ferry leaves at 9 on Friday.") });
  const composer = page.getByRole("list", { name: "Attached files" });
  await expect(composer.getByText("ferry.txt")).toBeVisible();
  // Uploaded: the chip's spinner is gone and the question can be sent.
  await expect(composer.getByText("Uploading")).toHaveCount(0, { timeout: 20_000 });
  await page.getByPlaceholder("Ask anything about your notes…").fill("When does the ferry leave?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("When does the ferry leave?").first()).toBeVisible();
  await expect(page.getByText(/isn.t set up|couldn.t|try again/i).first()).toBeVisible({ timeout: 30_000 });
  // The message keeps its file, the composer is empty again.
  await expect(page.getByRole("list", { name: "Attached files" })).toHaveCount(1);
  await expect(page.getByRole("list", { name: "Attached files" }).getByText("ferry.txt")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("list", { name: "Attached files" }).getByText("ferry.txt")).toBeVisible({ timeout: 20_000 });
  await context.close();
});

test("an audio block's Transcribe says plainly when the assistant isn't set up", async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, context } = await newPerson(browser, "Transcribe Person");
  await context.grantPermissions(["microphone"]);
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  await page.getByRole("textbox", { name: "Title" }).fill("Standup");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/record");
  await expect(page.getByRole("option", { name: "Audio recording" })).toBeVisible();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("dialog", { name: "Audio recording" });
  await expect(panel.getByText("Recording", { exact: true })).toBeVisible();
  await page.waitForTimeout(1_500);
  await panel.getByRole("button", { name: "Stop and save" }).click();
  await expect(panel).toBeHidden();

  const player = page.locator(".fb-audio");
  // Transcribe appears once the recording is uploaded.
  await expect(player.getByRole("link", { name: "Download" })).toHaveAttribute("href", /\/files\//, { timeout: 20_000 });
  const transcribe = player.getByRole("button", { name: "Transcribe", exact: true });
  await expect(transcribe).toBeVisible();
  await transcribe.click();
  const preview = page.getByRole("region", { name: "Transcript" });
  await expect(preview.getByText(/isn.t set up|couldn.t|try again/i)).toBeVisible({ timeout: 30_000 });
  // Nothing was added to the note.
  await expect(preview.getByRole("button", { name: "Insert below" })).toHaveCount(0);
  await preview.getByRole("button", { name: "Close" }).click();
  await expect(preview).toHaveCount(0);
  await context.close();
});
