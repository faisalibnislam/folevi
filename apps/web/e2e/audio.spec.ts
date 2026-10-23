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

  test("in the Mac app: Microphone or Call; a call records the mic and the Mac's sound, and without the permission it says so and opens System Settings", async ({ browser }) => {
    const { context, page } = await newPerson(browser, "Call Recorder");
    await context.grantPermissions(["microphone"]);
    // The Mac app's bridge (foleviDesktop, lib/desktop.ts), with call capture; Chromium's fake devices stand in
    // for the screen and its sound. `__access` is what macOS says about Screen & System Audio Recording.
    await page.addInitScript(() => {
      const w = window as unknown as { __opened: string[]; __access: string; foleviDesktop: unknown };
      w.__opened = [];
      w.__access = "denied";
      const noop = () => {};
      w.foleviDesktop = {
        platform: "mac",
        callCapture: true,
        setBadge: noop,
        notify: noop,
        setRecent: noop,
        setStatus: noop,
        getSettings: async () => null,
        setSettings: async () => null,
        placeWindowButtons: noop,
        pauseShortcut: noop,
        closeQuickAdd: noop,
        sizeQuickAdd: noop,
        openInMain: noop,
        onCommand: () => noop,
        screenAccess: async () => w.__access,
        openSystemSettings: (pane: string) => w.__opened.push(pane),
      };
    });
    await page.reload();
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
    await page.getByRole("textbox", { name: "Title" }).fill("Call");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/record");
    await page.keyboard.press("Enter");
    const panel = page.getByRole("dialog", { name: "Audio recording" });
    await expect(panel.getByText("Record audio", { exact: true })).toBeVisible();
    await expect(panel).toContainText("Let everyone on the call know you’re recording.");

    // Without the permission: the reason, and the way to System Settings.
    await panel.getByRole("button", { name: "Call (mic and Mac sound)" }).click();
    await expect(panel.getByRole("alert")).toHaveText("Folevi needs Screen & System Audio Recording permission to hear the call. Turn it on in System Settings > Privacy & Security, then try again.");
    await panel.getByRole("button", { name: "Open System Settings" }).click();
    expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual(["screen-recording"]);

    // Allowed: Try again records the call (up to three hours), with the reminder.
    await page.evaluate(() => ((window as unknown as { __access: string }).__access = "granted"));
    await panel.getByRole("button", { name: "Try again" }).click();
    await expect(panel.getByText("Recording the call", { exact: true })).toBeVisible();
    await expect(panel).toContainText("/ 3:00:00");
    await expect(panel).toContainText("Let everyone on the call know you’re recording.");
    await page.waitForTimeout(1_500);
    await panel.getByRole("button", { name: "Stop and save" }).click();
    await expect(panel).toBeHidden();
    await expect(page.locator(".fb-audio")).toContainText(/Recording \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.webm/);
    await context.close();
  });
});
