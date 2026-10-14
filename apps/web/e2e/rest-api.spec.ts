import { expect, request, test } from "@playwright/test";
import { APP, newPerson } from "./helpers";

// A personal access token made in Settings, used the way a script would (no Folevi cookies), then revoked.
test("a token made in Settings reads and writes through the REST API until it's revoked", async ({ browser }) => {
  const { page, context } = await newPerson(browser, "Api Person");
  await page.goto(`${APP}/settings/connected-apps`);
  const card = page.getByRole("region", { name: "Personal access tokens" });
  await expect(card.getByText("No tokens yet.")).toBeVisible();
  await card.getByRole("button", { name: "New token" }).click();

  const dialog = page.getByRole("dialog", { name: "New personal access token" });
  await dialog.getByLabel("Name").fill("E2E script");
  await dialog.getByRole("checkbox", { name: "Create notes and add to them" }).click();
  await dialog.getByRole("checkbox", { name: "See tasks" }).click();
  await dialog.getByRole("combobox", { name: "Expires" }).click();
  await page.getByRole("option", { name: "In 30 days" }).click();
  await dialog.getByRole("button", { name: "Create token" }).click();

  const shown = page.getByRole("dialog", { name: "Copy your new token" });
  const token = await shown.getByLabel("Your new token").inputValue();
  expect(token).toMatch(/^fvpat_[A-Za-z0-9_-]{43}$/);
  await shown.getByRole("button", { name: "Done" }).click();
  const row = card.getByRole("listitem", { name: "E2E script" });
  await expect(row).toContainText("Reads and adds to notes, reads tasks in Personal");
  await expect(row).toContainText("not used yet");

  const api = await request.newContext();
  const auth = { authorization: `Bearer ${token}` };
  const places = await api.get(`${APP}/api/v1/places`, { headers: auth });
  expect(places.status()).toBe(200);
  expect((await places.json()).data).toEqual([{ id: "personal", name: "Personal" }]);

  const made = await api.post(`${APP}/api/v1/notes`, { headers: { ...auth, "idempotency-key": `e2e-${Date.now()}` }, data: { title: "From a script", markdown: "- [ ] Water the plants" } });
  expect(made.status(), await made.text()).toBe(201);
  const note = await made.json();
  const got = await api.get(`${APP}/api/v1/notes/${note.id}`, { headers: auth });
  expect((await got.json()).markdown).toContain("Water the plants");
  const tasks = await api.get(`${APP}/api/v1/tasks`, { headers: auth });
  expect((await tasks.json()).data.map((t: { text: string }) => t.text)).toContain("Water the plants");
  // Not given tasks:write.
  const denied = await api.post(`${APP}/api/v1/tasks`, { headers: auth, data: { text: "Nope" } });
  expect(denied.status()).toBe(403);
  expect((await denied.json()).error.code).toBe("insufficient_scope");

  // The note is there in the app, and the token shows it was used.
  await page.goto(`${APP}/d/${note.id}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveText("From a script");
  await page.goto(`${APP}/settings/connected-apps`);
  await expect(row).toContainText("last used");

  await row.getByRole("button", { name: "Revoke…" }).click();
  await row.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(card.getByText("No tokens yet.")).toBeVisible();
  expect((await api.get(`${APP}/api/v1/places`, { headers: auth })).status()).toBe(401);
  const spec = await api.get(`${APP}/api/v1/openapi.json`);
  expect((await spec.json()).openapi).toBe("3.1.0");
  await api.dispose();
  await context.close();
});
