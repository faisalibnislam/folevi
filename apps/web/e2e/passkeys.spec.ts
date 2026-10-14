import { expect, test } from "@playwright/test";
import { APP, newPerson } from "./helpers";

// Chromium's virtual WebAuthn authenticator stands in for Touch ID: it keeps passkeys for this tab and
// answers every request as if the person touched the sensor.
test("a passkey added in Settings signs the person in without a password", async ({ browser }) => {
  const { page } = await newPerson(browser, "Pat Passkey");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });

  await page.goto(`${APP}/settings/security`);
  const card = page.getByRole("region", { name: "Passkeys" });
  await expect(card.getByText("No passkeys yet.")).toBeVisible();
  await card.getByRole("button", { name: "Add a passkey" }).click();
  const naming = page.getByRole("dialog", { name: "Add a passkey" });
  await expect(naming.getByLabel("Name")).toHaveValue(/on /);
  await naming.getByLabel("Name").fill("Test laptop");
  await naming.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Passkey added" })).toBeVisible({ timeout: 20_000 });
  const list = card.getByRole("list", { name: "Your passkeys" });
  await expect(list.getByText("Test laptop")).toBeVisible();

  await card.getByRole("button", { name: "Rename Test laptop" }).click();
  const renaming = page.getByRole("dialog", { name: "Rename passkey" });
  await renaming.getByLabel("Name").fill("Work laptop");
  await renaming.getByRole("button", { name: "Save" }).click();
  await expect(list.getByText("Work laptop")).toBeVisible();

  // Sign out, then back in with the passkey alone: no password, no authenticator code.
  await page.getByRole("navigation", { name: "Folio" }).getByRole("button", { name: /Personal, workspaces and account$/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL(/\/signin/);
  await expect(page.getByLabel("Email")).toHaveAttribute("autocomplete", "username webauthn");
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await page.waitForURL((url) => !/\/(signin|two-factor)/.test(url.pathname), { timeout: 20_000 });

  // Removing it: it's gone from the list, and from sign-in.
  await page.goto(`${APP}/settings/security`);
  await card.getByRole("button", { name: "Remove Work laptop" }).click();
  await page.getByRole("dialog", { name: "Remove this passkey?" }).getByRole("button", { name: "Remove" }).click();
  await expect(card.getByText("No passkeys yet.")).toBeVisible();
});
