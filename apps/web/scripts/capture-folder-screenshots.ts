// Captures the folder screenshots on the home page (public/marketing/screenshots/folders-*.webp) from the
// running app: a new demo account with a few coloured folders and notes, a folder's page open, and the
// Move to folder dialog, each in light and dark.
//
// Run it against a local, non-production copy with a fresh Convex backend (it signs up a new account through
// the development mailbox, so it can't run against production):
//   1. `CONVEX_AGENT_MODE=anonymous npx convex dev` and `node scripts/setup-local.mjs` at the repo root
//   2. `pnpm dev` in apps/web (or `next dev --port <port>` with NEXT_PUBLIC_APP_URL set to match)
//   3. from apps/web: `E2E_BASE_URL=http://app.localhost:3000 node scripts/capture-folder-screenshots.ts [outDir]`
// Node 24 runs the TypeScript directly. outDir defaults to public/marketing/screenshots.
import { chromium, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { APP, createAccount, completeOnboarding, openTool, waitForSaved } from "../e2e/helpers.ts";

const OUT = resolve(process.argv[2] ?? resolve(import.meta.dirname, "../public/marketing/screenshots"));
/** The whole window is saved 2400 px wide (1440 × 900 at 2x, scaled for a 1200 px frame at 2x). */
const SAVE_WIDTH = 2400;
/** The Move to folder picture is the top-left of the window: the sidebar's folders and the dialog. */
const MOVE_CLIP = { x: 0, y: 0, width: 960, height: 640 };
const MOVE_WIDTH = 1440;
const QUALITY = 0.82;

/** New folders, after the two every account starts with (Projects and Personal). Colours are FOLDER_COLORS names. */
const NEW_FOLDERS = ["Clients", "Reading", "Travel"];
const COLORS: Record<string, string> = {
  Projects: "Summer sky",
  Personal: "Peach haze",
  Clients: "Ultramarine",
  Reading: "Irises",
  Travel: "Neon silk",
};

/** Notes to write, by folder (null is Drafts). `style` is a note style's name, or none for Plain. */
const NOTES: Array<{ folder: string | null; title: string; lines: string[]; style?: string }> = [
  { folder: "Projects", title: "Website refresh", style: "Blue haze", lines: ["New pricing page live by the 14th.", "Photos from the studio shoot go on the About page."] },
  { folder: "Clients", title: "Bakery rebrand: kickoff", style: "Wood thrush", lines: ["New logo and menu boards before the summer opening.", "Next call on Tuesday at 10."] },
  { folder: "Clients", title: "Bookshop website", style: "Ultramarine", lines: ["An events calendar and a gift card page.", "First mockups go out on Friday."] },
  { folder: "Reading", title: "Highlights this month", style: "Parchment", lines: ["Short passages worth keeping, with the page number next to each.", "Copy the good ones into the commonplace note."] },
  { folder: "Personal", title: "Running plan", style: "Aurora", lines: ["Three short runs and one long one each week.", "Rest day after the long run."] },
  { folder: null, title: "Ideas for the balcony", lines: ["Herbs in the window box, tomatoes by the rail.", "Ask about the watering can at the hardware store."] },
  // The folder in the screenshot: written last, so these lead its "Last edited" order.
  { folder: "Travel", title: "Photos to print", style: "Blue plaster", lines: ["Six from the coast for the hallway frames.", "Matte paper, the larger size."] },
  { folder: "Travel", title: "Budget", style: "Kraft", lines: ["Flights and the flat are paid.", "About 60 a day for food and trams."] },
  { folder: "Travel", title: "Museum hours", style: "Deco", lines: ["Most open at 10 and close at 6.", "Book the tile museum a day ahead."] },
  { folder: "Travel", title: "Train times", style: "Old street", lines: ["The 8:40 to the coast gets in before lunch.", "Last train back leaves at 22:15."] },
  { folder: "Travel", title: "Places to eat", style: "Irises", lines: ["The fish place by the market, closed on Mondays.", "Pastries near the tram stop."] },
  { folder: "Travel", title: "Packing list", style: "Peach haze", lines: ["Adapters, a light rain jacket and the small camera.", "Walking shoes that are already broken in."] },
  { folder: "Travel", title: "Lisbon in April", style: "Summer sky", lines: ["Four days in Alfama, flying back on the 21st.", "Book the tram tour and a table for the first night."] },
];

/** Notes every account starts with, moved into the new folders. */
const MOVES: Array<{ title: string; to: string }> = [
  { title: "Trip Sketch: Coastal Weekend", to: "Travel" },
  { title: "Reading Shelf", to: "Reading" },
];

const nav = (page: Page) => page.getByRole("navigation", { name: "Folio" });

async function folderIds(page: Page): Promise<Record<string, string>> {
  await page.goto(`${APP}/folders`);
  await page.getByRole("button", { name: "List", exact: true }).click();
  const links = page.getByRole("main").getByRole("list", { name: "Folders" }).getByRole("link");
  await expect(links).toHaveCount(2 + NEW_FOLDERS.length);
  const out: Record<string, string> = {};
  for (const link of await links.all()) {
    const href = (await link.getAttribute("href")) ?? "";
    const name = (await link.locator("span.font-medium").first().innerText()).split("\n")[0]!.trim();
    out[name] = href.replace(/^.*\/folders\//, "");
  }
  return out;
}

async function setColor(page: Page, folder: string, color: string) {
  const row = nav(page).locator(".group\\/folder").filter({ has: page.getByRole("link", { name: folder, exact: true }) });
  await row.hover();
  await row.getByRole("button", { name: `Folder options for ${folder}` }).click();
  await page.getByRole("menuitem", { name: "Change color…" }).click();
  await page.getByRole("dialog").getByRole("radio", { name: color, exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function writeNote(page: Page, href: string, note: (typeof NOTES)[number]) {
  await page.goto(`${APP}${href}`);
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}\?new=1/);
  const title = page.getByRole("textbox", { name: "Title" });
  await expect(title).toBeFocused();
  await title.fill(note.title);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Document body" })).toBeFocused();
  for (const [i, line] of note.lines.entries()) {
    if (i) await page.keyboard.press("Enter");
    await page.keyboard.type(line);
  }
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
  await card.getByRole("button", { name: new RegExp(`^Actions for ${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).click();
  await page.getByRole("menuitem", { name: "Move to folder…" }).click();
  await page.getByRole("dialog", { name: "Move to folder" }).getByRole("option", { name: folder }).click();
  await expect(page.getByRole("dialog", { name: "Move to folder" })).toHaveCount(0);
}

/** Hides development-only overlays (the Next.js dev tools badge) and the text caret. */
async function tidy(page: Page) {
  await page.addStyleTag({ content: "nextjs-portal, [data-nextjs-toast], [data-next-badge-root] { display: none !important; } * { caret-color: transparent !important; }" });
  await page.mouse.move(1439, 899);
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

async function shoot(page: Page, name: string, encoder: Page, opts: { width: number; clip?: { x: number; y: number; width: number; height: number } }) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(900);
    const png = await page.screenshot(opts.clip ? { clip: opts.clip } : {});
    const file = resolve(OUT, `${name}-${scheme}.webp`);
    writeFileSync(file, await toWebp(encoder, png, opts.width));
    console.log(`wrote ${file}`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" });
const { page } = await createAccount(context, { name: "Sam Rivera" });
await completeOnboarding(page);

// Folders: three new ones beside Projects and Personal, each with a colour.
await page.goto(`${APP}/documents`);
for (const name of NEW_FOLDERS) {
  await nav(page).getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill(name);
  await page.getByRole("button", { name: "Create folder" }).click();
  await expect(nav(page).getByRole("link", { name, exact: true })).toBeVisible();
}
for (const [name, color] of Object.entries(COLORS)) await setColor(page, name, color);
const ids = await folderIds(page);

for (const move of MOVES) await moveNote(page, move.title, move.to);
for (const note of NOTES) await writeNote(page, note.folder ? `/folders/${ids[note.folder]}` : "/drafts", note);

// Start from a tidy tab strip: Home, one open note, and the view on screen.
await page.goto(`${APP}/documents`);
await page.evaluate(() => {
  for (const key of Object.keys(localStorage)) if (key.startsWith("folevi:tabs:")) localStorage.removeItem(key);
});
await page.goto(`${APP}/folders/${ids.Travel}`);
await page.getByRole("main").getByRole("link", { name: /Lisbon in April/ }).first().click();
await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Lisbon in April");

mkdirSync(OUT, { recursive: true });
const encoder = await context.newPage();

// (a) A folder's page with its notes, the Folders section open in the sidebar.
await page.goto(`${APP}/folders/${ids.Travel}`);
await expect(page.getByRole("main").getByText("Packing list")).toBeVisible();
await tidy(page);
await shoot(page, "folders", encoder, { width: SAVE_WIDTH });

// (b) Moving a note from Drafts into a folder.
await page.goto(`${APP}/drafts`);
const draft = page.getByRole("main").getByRole("listitem").filter({ hasText: "Ideas for the balcony" }).first();
await draft.hover();
await draft.getByRole("button", { name: /^Actions for Ideas for the balcony/ }).click();
await page.getByRole("menuitem", { name: "Move to folder…" }).click();
await expect(page.getByRole("dialog", { name: "Move to folder" }).getByRole("option", { name: "Travel" })).toBeVisible();
await tidy(page);
await shoot(page, "folders-move", encoder, { width: MOVE_WIDTH, clip: MOVE_CLIP });

await browser.close();
