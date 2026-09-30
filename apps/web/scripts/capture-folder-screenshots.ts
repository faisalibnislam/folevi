// Captures the Folders page screenshot on the home page and /features/folders
// (public/marketing/screenshots/folders-light.webp and folders-dark.webp) from the running app: a new demo
// account with twelve coloured folders and a few notes in each (content/demoFolders.ts), then the Folders
// page in light and dark.
//
// Run it against a local, non-production copy with a fresh Convex backend (it signs up a new account through
// the development mailbox, so it can't run against production):
//   1. `CONVEX_AGENT_MODE=anonymous npx convex dev` and `node scripts/setup-local.mjs` at the repo root
//   2. `pnpm dev` in apps/web (or `next dev --port <port>` with NEXT_PUBLIC_APP_URL set to match)
//   3. from apps/web: `E2E_BASE_URL=http://app.localhost:3000 node scripts/capture-folder-screenshots.ts [outDir]`
// Node 24 runs the TypeScript directly. outDir defaults to public/marketing/screenshots. It takes a few
// minutes: every folder and note is made through the app's own screens.
import { chromium, expect, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { APP, createAccount, completeOnboarding, openTool, waitForSaved } from "../e2e/helpers.ts";
import { DEMO_DRAFT, DEMO_FOLDERS, DEMO_MOVES, type DemoNote } from "../src/components/marketing/content/demoFolders.ts";

const OUT = resolve(process.argv[2] ?? resolve(import.meta.dirname, "../public/marketing/screenshots"));
/** The window, captured at 2x and saved 2400 px wide (for a frame up to 1200 px wide at 2x). */
const VIEWPORT = { width: 1440, height: 1100 };
const SAVE_WIDTH = 2400;
const QUALITY = 0.82;
/** Every account starts with these two folders. */
const SEEDED = new Set(["Projects", "Personal"]);
const COLOR_NAMES = new Map(
  (JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../packages/design-tokens/covers/folder-colors.json"), "utf8")) as { id: string; name: string }[]).map((c) => [c.id, c.name]),
);

const nav = (page: Page) => page.getByRole("navigation", { name: "Folio" });
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Opens the Folders page in its list layout (rows with a link and a menu each). */
async function folderList(page: Page) {
  await page.goto(`${APP}/folders`);
  await page.getByRole("button", { name: "List", exact: true }).click();
  const links = page.getByRole("main").getByRole("list", { name: "Folders" }).getByRole("link");
  await expect(links).toHaveCount(DEMO_FOLDERS.length);
  return links;
}

async function folderIds(page: Page): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const link of await (await folderList(page)).all()) {
    const href = (await link.getAttribute("href")) ?? "";
    const name = (await link.locator("span.font-medium").first().innerText()).split("\n")[0]!.trim();
    out[name] = href.replace(/^.*\/folders\//, "");
  }
  return out;
}

async function setColor(page: Page, folder: string, color: string) {
  const row = page.getByRole("main").getByRole("listitem").filter({ has: page.getByRole("link", { name: new RegExp(`^${escape(folder)}\\b`) }) });
  await row.hover();
  await row.getByRole("button", { name: `Folder options for ${folder}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Change color…" }).click();
  await page.getByRole("dialog").getByRole("radio", { name: color, exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function writeNote(page: Page, href: string, note: DemoNote) {
  await page.goto(`${APP}${href}`);
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  const title = page.getByRole("textbox", { name: "Title" });
  await expect(title).toBeFocused();
  await title.fill(note.title);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Document body" })).toBeFocused();
  await page.keyboard.type(note.lines[0]);
  await page.keyboard.press("Enter");
  await page.keyboard.type(note.lines[1]);
  if (note.style) {
    await openTool(page, "Style");
    await page.getByRole("group", { name: "Note Style" }).getByRole("button").first().click();
    await page.getByRole("radio", { name: `Note style: ${note.style}` }).click();
  }
  await waitForSaved(page);
}

async function moveNote(page: Page, title: string, folder: string) {
  await page.goto(`${APP}/notes`);
  const card = page.getByRole("main").getByRole("listitem").filter({ hasText: title }).first();
  await card.hover();
  await card.getByRole("button", { name: new RegExp(`^Actions for ${escape(title)}`) }).click();
  await page.getByRole("menuitem", { name: "Move to folder…" }).click();
  await page.getByRole("dialog", { name: "Move to folder" }).getByRole("option", { name: folder, exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Move to folder" })).toHaveCount(0);
}

/** Hides development-only overlays (the Next.js dev tools badge) and the text caret. */
async function tidy(page: Page) {
  await page.addStyleTag({ content: "nextjs-portal, [data-nextjs-toast], [data-next-badge-root] { display: none !important; } * { caret-color: transparent !important; }" });
  await page.mouse.move(VIEWPORT.width - 1, VIEWPORT.height - 1);
  await page.waitForTimeout(600);
}

/** Encodes a PNG screenshot as WebP in the browser (Chromium's encoder), scaled to `width`. */
async function toWebp(page: Page, png: Buffer, width: number): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    async ({ src, width, quality }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const height = Math.round((img.height * width) / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, width, height);
      return canvas.toDataURL("image/webp", quality);
    },
    { src: `data:image/png;base64,${png.toString("base64")}`, width, quality: QUALITY },
  );
  return Buffer.from(dataUrl.split(",")[1]!, "base64");
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, colorScheme: "light" });
const { page } = await createAccount(context, { name: "Sam Rivera" });
await completeOnboarding(page);

// Folders, made from the sidebar, then a colour each from the folder's menu.
await page.goto(`${APP}/documents`);
for (const { name } of DEMO_FOLDERS.filter((f) => !SEEDED.has(f.name))) {
  await nav(page).getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill(name);
  await page.getByRole("button", { name: "Create folder" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
const ids = await folderIds(page);
for (const folder of DEMO_FOLDERS) await setColor(page, folder.name, COLOR_NAMES.get(folder.color) ?? folder.color);
// Back to the grid of folder cards (the layout is remembered on this device).
await page.getByRole("button", { name: "Grid", exact: true }).click();

// Notes: the starter notes moved into their folders, then new ones written in each folder and one in Drafts.
for (const move of DEMO_MOVES) await moveNote(page, move.title, move.to);
for (const folder of DEMO_FOLDERS) for (const note of folder.notes) await writeNote(page, `/folders/${ids[folder.name]}`, note);
await writeNote(page, "/drafts", DEMO_DRAFT);

// A tidy tab strip: Home, the Folders page and one open note.
await page.evaluate(() => {
  for (const key of Object.keys(localStorage)) if (key.startsWith("folevi:tabs:")) localStorage.removeItem(key);
});
await page.goto(`${APP}/folders/${ids.Travel}`);
await page.getByRole("main").getByRole("link", { name: /Lisbon in April/ }).first().click();
await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Lisbon in April");

// The Folders page: every folder as a card, with its newest notes showing through the cover.
await page.goto(`${APP}/folders`);
await expect(page.getByRole("main").getByRole("list", { name: "Folders" }).getByRole("listitem")).toHaveCount(DEMO_FOLDERS.length);
await tidy(page);
mkdirSync(OUT, { recursive: true });
const encoder = await context.newPage();
for (const scheme of ["light", "dark"] as const) {
  await page.emulateMedia({ colorScheme: scheme });
  await page.waitForTimeout(1200);
  const file = resolve(OUT, `folders-${scheme}.webp`);
  writeFileSync(file, await toWebp(encoder, await page.screenshot(), SAVE_WIDTH));
  console.log(`wrote ${file}`);
}

await browser.close();
