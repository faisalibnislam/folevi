import { expect, test } from "@playwright/test";
import { newPerson, waitForSaved } from "./helpers";

// Chromium's fake microphone (a steady tone) with the permission prompt answered.
test.use({ launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] } });

test.describe("audio recordings", () => {
  test("/Audio recording records, uploads, plays back and survives a reload", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Recording Tester");
    await context.grantPermissions(["microphone"]);
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
    await page.getByRole("textbox", { name: "Title" }).fill("Voice memo");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: "Document body" })).toBeFocused();

    await page.keyboard.type("/record");
    await expect(page.getByRole("option", { name: "Audio recording" })).toBeVisible();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("dialog", { name: "Audio recording" });
    await expect(panel.getByText("Recording", { exact: true })).toBeVisible();
    await page.waitForTimeout(1_500);
    await panel.getByRole("button", { name: "Pause" }).click();
    await expect(panel.getByText("Paused", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Resume" }).click();
    await page.waitForTimeout(1_000);
    await panel.getByRole("button", { name: "Stop and save" }).click();
    await expect(panel).toBeHidden();

    const player = page.locator(".fb-audio");
    await expect(player).toBeVisible();
    await expect(player).toContainText(/Recording \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.webm/);
    // The length measured while recording (about 2.5 s, pauses excluded).
    await expect(player.getByRole("slider", { name: "Position" })).toHaveAttribute("aria-valuetext", /^0:00 of 0:0[2-4]$/);
    // Uploaded: the download link is the signed file URL, served as audio with byte ranges.
    const download = player.getByRole("link", { name: "Download" });
    await expect(download).toHaveAttribute("href", /\/files\//, { timeout: 20_000 });
    const href = (await download.getAttribute("href"))!;
    const part = await page.request.get(href, { headers: { Range: "bytes=0-99" } });
    expect(part.status()).toBe(206);
    expect(part.headers()["content-type"]).toBe("audio/webm");
    expect(part.headers()["content-range"]).toMatch(/^bytes 0-99\/\d+$/);
    expect((await part.body()).length).toBe(100);

    await player.getByRole("button", { name: "Play", exact: true }).click();
    await expect(player.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await player.getByRole("button", { name: "Pause", exact: true }).click();

    await waitForSaved(page);
    await page.reload();
    await expect(page.locator(".fb-audio")).toContainText("Recording");
    await expect(page.locator(".fb-audio").getByRole("link", { name: "Download" })).toHaveAttribute("href", /\/files\//);
    await context.close();
  });

  test("closing the recorder throws the recording away", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Recording Canceller");
    await context.grantPermissions(["microphone"]);
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
    await page.keyboard.press("Enter");
    await page.keyboard.type("/record");
    await page.keyboard.press("Enter");
    const panel = page.getByRole("dialog", { name: "Audio recording" });
    await expect(panel.getByText("Recording", { exact: true })).toBeVisible();
    // Escape doesn't discard a recording in progress.
    await page.keyboard.press("Escape");
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Cancel and discard the recording" }).click();
    await expect(panel).toBeHidden();
    await expect(page.locator(".fb-audio")).toHaveCount(0);
    await context.close();
  });
});
