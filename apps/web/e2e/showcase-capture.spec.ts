import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { APP, completeOnboarding, createAccount, createWorkspace, openTool, pick, pickDate, showFolders, signIn, switchTo, waitForSaved } from "./helpers";

// Frames of the real web app for the marketing home page's showcase (components/marketing/home/DeviceShowcase.tsx):
// a demo workspace ("Studio", Maya Patel and Sam Okafor) built through the UI on the dev deployment, then one PNG
// per chapter step in public/marketing/showcase/web/. Run it on purpose only:
//   SHOWCASE_CAPTURE=1 E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 npx playwright test e2e/showcase-capture.spec.ts --project=account
// SHOWCASE_ACCOUNT_FILE (optional) is where the test accounts' sign-in details are written (never in the repo).
// The iPhone beside the Mac window gets its own frames: the web app's iPhone interface (components/iphone, what
// the iPhone app shows) on a second device signed in as Maya, in public/marketing/showcase/iphone(-html)/.
test.skip(!process.env.SHOWCASE_CAPTURE, "Set SHOWCASE_CAPTURE=1 to capture the showcase frames.");

const OUT = fileURLToPath(new URL("../public/marketing/showcase/web/", import.meta.url));
/** Each frame as plain HTML (the live DOM, no scripts) with the app's CSS in one shared file. */
const HTML_OUT = fileURLToPath(new URL("../public/marketing/showcase/web-html/", import.meta.url));
/** The iPhone's frames: WebP, and HTML like the Mac window's. */
const PHONE_OUT = fileURLToPath(new URL("../public/marketing/showcase/iphone/", import.meta.url));
const PHONE_HTML_OUT = fileURLToPath(new URL("../public/marketing/showcase/iphone-html/", import.meta.url));
/** PNG originals, kept out of the repo (only WebP is committed). */
const PNG_OUT = process.env.SHOWCASE_PNG_DIR;
const PHONE_PNG = `${PNG_OUT ?? `${tmpdir()}/showcase-png`}/iphone`;
const DEBUG = process.env.SHOWCASE_DEBUG; // a folder for extra screenshots while working on this spec
/** Studio's logo, uploaded in Settings right after the workspace is made. */
const LOGO = fileURLToPath(new URL("./fixtures/studio-logo.png", import.meta.url));
/** Maya's and Sam's profile pictures, uploaded in Account settings once each account is made. */
const AVATAR = (key: string) => fileURLToPath(new URL(`./fixtures/${key}-avatar.jpg`, import.meta.url));

/** The demo Vault's passcode (a test value on the dev deployment). */
const VAULT_PASSCODE = "246810";

const VIEW = { viewport: { width: 1280, height: 800 }, colorScheme: "light" as const, reducedMotion: "reduce" as const };

/**
 * The iPhone 17 Pro: 402 × 874 points at 3x. The app's web view fills the screen (viewport-fit=cover) and the page
 * keeps clear of the status bar and the home indicator with env(safe-area-inset-*), which WebKit gives as 62 pt at
 * the top and 34 at the bottom in portrait. Chromium takes the same insets through DevTools (setSafeAreaInsetsOverride),
 * and the HTML copies have them written in, so the status bar's 62 pt stay empty for the showcase to draw it.
 */
const PHONE = { width: 402, height: 874, scale: 3, insets: { top: 62, right: 0, bottom: 34, left: 0 } };
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/1.0";

/** What the iPhone app gives the page before its first script (as in iphone-app.spec.ts): its bridge and <html data-native="ios">. */
function fakeBridge() {
  const bridge = {
    platform: "ios",
    version: "1.0",
    haptic: () => undefined,
    setStatusBar: () => undefined,
    openExternal: async () => true,
    getSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }),
    setSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }),
    onCommand: () => () => undefined,
  };
  Object.defineProperty(window, "foleviNative", { value: bridge });
  const mark = () => document.documentElement?.setAttribute("data-native", "ios");
  mark();
  if (!document.documentElement) new MutationObserver((_, watch) => document.documentElement && (mark(), watch.disconnect())).observe(document, { childList: true });
}

/** Dev-only overlays and nudges that aren't part of the app people see. */
const HIDE = `
nextjs-portal, [data-nextjs-toast], [data-nextjs-dev-tools-button], .ui-toasts { display: none !important; }
*, *::before, *::after { caret-color: transparent !important; }
`;

/**
 * Folevi for Mac shows the window's traffic lights where the web app has its logo (Sidebar.tsx): the frames are
 * of the Mac window, so they draw the lights there (12 px buttons, 8 px apart).
 */
const MAC_LIGHTS = `
a[aria-label="Folevi"].ui-browser-only > svg { visibility: hidden; }
a[aria-label="Folevi"].ui-browser-only { position: relative; }
a[aria-label="Folevi"].ui-browser-only::before {
  content: ""; position: absolute; left: 6px; top: 50%; width: 52px; height: 12px; margin-top: -6px;
  background:
    radial-gradient(circle at 6px 6px, #ff5f57 5.5px, #e0443e 5.6px, #e0443e 6px, transparent 6.2px),
    radial-gradient(circle at 26px 6px, #febc2e 5.5px, #dea123 5.6px, #dea123 6px, transparent 6.2px),
    radial-gradient(circle at 46px 6px, #28c840 5.5px, #1aab29 5.6px, #1aab29 6px, transparent 6.2px);
}
`;

/** Where a device's HTML frames go, and how its CSS is made to look the same in any browser. */
interface Target {
  dir: string;
  base: string;
  rules: Set<string>;
  /** A touch screen (the iPhone): coarse pointer, no hover. */
  touch: boolean;
  /** Safe-area insets written in place of env(safe-area-inset-*). */
  insets?: Record<"top" | "right" | "bottom" | "left", number>;
}
const MAC_HTML: Target = { dir: HTML_OUT, base: "/marketing/showcase/web-html/", rules: new Set(), touch: false };
const PHONE_HTML: Target = { dir: PHONE_HTML_OUT, base: "/marketing/showcase/iphone-html/", rules: new Set(), touch: true, insets: PHONE.insets };

/**
 * The frames were taken in light mode with reduced motion (and on the iPhone, a touch screen): the copies keep that
 * whatever the visitor's browser is, so media queries about the device are answered here once and for all.
 */
function fixed(text: string, t: Target) {
  const yes = "(min-width: 0px)";
  const no = "(max-width: 0px)";
  const answers: Record<string, boolean> = {
    "(pointer: coarse)": t.touch,
    "(any-pointer: coarse)": t.touch,
    "(pointer: fine)": !t.touch,
    "(any-pointer: fine)": !t.touch,
    "(hover: hover)": !t.touch,
    "(any-hover: hover)": !t.touch,
    "(hover: none)": t.touch,
    "(any-hover: none)": t.touch,
    "(prefers-color-scheme: dark)": false,
    "(prefers-color-scheme: light)": true,
    "(prefers-reduced-motion: reduce)": true,
    "(prefers-reduced-motion: no-preference)": false,
  };
  // (In selectors these read escaped, as in .pointer-coarse\:h-11, so only the queries themselves change, nested ones too.)
  let out = text;
  for (const [query, on] of Object.entries(answers)) out = out.replaceAll(query, on ? yes : no);
  // The copies' top layer is pinned in place (see snapshot()): what it matched, its markers match.
  out = out.replaceAll(":popover-open", "[data-popover-open]").replaceAll(":modal", "[data-modal]");
  return withInsets(out, t);
}

function withInsets(text: string, t: Target) {
  const insets = t.insets;
  if (!insets) return text;
  return text.replace(/env\(\s*safe-area-inset-(top|right|bottom|left)\s*(?:,[^()]*(?:\([^()]*\)[^()]*)*)?\)/g, (_m, side: keyof typeof insets) => `${insets[side]}px`);
}

/** A still frame: nothing animates or moves in when the copy loads, and no scroll bars. */
const STILL = `
*, *::before, *::after { animation: none !important; transition: none !important; }
* { scrollbar-width: none !important; }
`;

/** The page as static HTML: the live DOM without scripts, scroll positions kept, images made local. */
async function snapshot(page: Page, name: string, t: Target = MAC_HTML) {
  const { html, rules, remote } = await page.evaluate(() => {
    const abs = (text: string, base: string) => text.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (_m, _q, u: string) => (u.startsWith("data:") ? `url("${u}")` : `url("${new URL(u, base).href}")`));
    const rules: string[] = [];
    for (const sheet of [...document.styleSheets, ...((document as Document & { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? [])]) {
      try {
        const base = sheet.href ?? location.href;
        for (const rule of sheet.cssRules) rules.push(abs(rule.cssText, base));
      } catch {
        // A stylesheet from another origin: not readable, and the app has none that matter here.
      }
    }
    // Scroll positions don't survive a copy: mark scrolled boxes and move their content by the same amount.
    const all = [...document.querySelectorAll<HTMLElement>("body *")];
    const scrolled = all.map((el, i) => ({ i, x: el.scrollLeft, y: el.scrollTop })).filter((s) => s.x || s.y);
    // Open popovers and modal dialogs sit in the browser's top layer, which a copy doesn't reopen: pin them where
    // they are (above everything, in the order they were opened) with the dimmed backdrop a modal has.
    const lifted = all
      .map((el, i) => ({ i, el }))
      .filter(({ el }) => el.matches(":popover-open") || el.matches("dialog:modal"))
      .map(({ i, el }) => {
        const backdrop = getComputedStyle(el, "::backdrop");
        return {
          i,
          r: el.getBoundingClientRect(),
          display: getComputedStyle(el).display,
          backdrop: { background: backdrop.background, backdropFilter: backdrop.backdropFilter, opacity: backdrop.opacity },
        };
      });
    const live = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")];
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    const cloned = [...clone.querySelectorAll<HTMLElement>("body *")];
    for (const s of scrolled) {
      const el = cloned[s.i];
      if (!el) continue;
      el.style.overflow = "hidden";
      for (const child of [...el.children] as HTMLElement[]) child.style.translate = `${-s.x}px ${-s.y}px`;
    }
    for (const [n, l] of lifted.entries()) {
      const el = cloned[l.i];
      if (!el) continue;
      const z = 2147483000 + n * 2;
      // Still a popover or a dialog (their own styles keep applying), marked open, held on screen.
      if (el.tagName === "DIALOG") {
        el.setAttribute("open", "");
        el.setAttribute("data-modal", "");
      } else {
        el.setAttribute("data-popover-open", "");
      }
      const pinned: Record<string, string> = {
        position: "fixed", inset: "auto", margin: "0", left: `${l.r.left}px`, top: `${l.r.top}px`, width: `${l.r.width}px`, height: `${l.r.height}px`,
        "max-width": "none", "max-height": "none", "box-sizing": "border-box", transform: "none", translate: "none", scale: "none", "z-index": String(z + 1),
        display: l.display === "none" ? "block" : l.display,
      };
      for (const [k, v] of Object.entries(pinned)) el.style.setProperty(k, v, "important");
      const bd = l.backdrop;
      if (bd.background && !/^rgba\(0, 0, 0, 0\)\s*none/.test(bd.background) || (bd.backdropFilter && bd.backdropFilter !== "none")) {
        const dim = document.createElement("div");
        dim.setAttribute("aria-hidden", "true");
        Object.assign(dim.style, { position: "fixed", inset: "0", zIndex: String(z), background: bd.background, backdropFilter: bd.backdropFilter, opacity: bd.opacity, pointerEvents: "none" });
        el.before(dim);
      }
    }
    // Form fields keep what's in them (a value, a tick, a choice) as markup.
    clone.querySelectorAll<HTMLElement>("input, textarea, select").forEach((n, i) => {
      const field = live[i];
      if (!field) return;
      if (n.tagName === "TEXTAREA") n.textContent = field.value;
      else if (n.tagName === "SELECT") n.querySelectorAll("option").forEach((o, k) => (k === (field as HTMLSelectElement).selectedIndex ? o.setAttribute("selected", "") : o.removeAttribute("selected")));
      else if ((field as HTMLInputElement).type === "checkbox" || (field as HTMLInputElement).type === "radio") (field as HTMLInputElement).checked ? n.setAttribute("checked", "") : n.removeAttribute("checked");
      else n.setAttribute("value", field.value);
    });
    clone.querySelectorAll("script, noscript, link, style, iframe").forEach((n) => n.remove());
    clone.querySelectorAll("[contenteditable]").forEach((n) => n.setAttribute("contenteditable", "false"));
    const remote: string[] = [];
    clone.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
      const live = document.querySelector<HTMLImageElement>(`img[src="${CSS.escape(img.getAttribute("src") ?? "")}"]`);
      const src = live?.currentSrc || new URL(img.getAttribute("src") ?? "", location.href).href;
      img.removeAttribute("srcset");
      img.removeAttribute("sizes");
      img.setAttribute("src", src);
      img.setAttribute("loading", "eager");
      if (!src.startsWith(location.origin) && !src.startsWith("data:")) remote.push(src);
    });
    // Pictures drawn as backgrounds (inline styles) come along too.
    clone.querySelectorAll<HTMLElement>("[style*='url(']").forEach((el) => {
      for (const m of (el.getAttribute("style") ?? "").matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
        const u = new URL(m[2]!, location.href).href;
        if (!u.startsWith(location.origin) && !u.startsWith("data:")) remote.push(m[2]!);
      }
    });
    return { html: clone.outerHTML, rules, remote };
  });
  mkdirSync(`${t.dir}assets`, { recursive: true });
  // The app's CSS, shared by all frames: every rule once, in the order first seen (written after the last frame).
  const sameSite = (text: string) => text.replaceAll(`${APP}/`, "/");
  for (const rule of rules) t.rules.add(fixed(sameSite(rule), t));
  // Insets in inline styles (class names like pt-[calc(env(safe-area-inset-top)+52px)] stay as they are: the CSS's
  // selectors keep them escaped, only the values change).
  let body = sameSite(html).replace(/ style="[^"]*"/g, (attr) => withInsets(attr, t));
  // Images from the backend's file storage are copied next to the frames (named by their content, so a picture
  // shown in many frames, like the workspace's logo, is one file).
  for (const url of [...new Set(remote)]) {
    const res = await page.request.get(url);
    const bytes = await res.body();
    const type = res.headers()["content-type"] ?? "";
    const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : type.includes("svg") ? "svg" : "jpg";
    const file = `assets/${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}.${ext}`;
    writeFileSync(`${t.dir}${file}`, bytes);
    body = body.replaceAll(url, file).replaceAll(url.replaceAll("&", "&amp;"), file);
  }
  if (/convex\.(cloud|site)/.test(body)) throw new Error(`${name}: a backend URL is left in the HTML`);
  body = body.replace("<head>", `<head><base href="${t.base}"><link rel="stylesheet" href="app.css">`);
  writeFileSync(`${t.dir}${name}.html`, `<!doctype html>\n${body}`);
}

/** Writes a device's shared CSS (after its last frame). */
function writeCss(t: Target) {
  writeFileSync(`${t.dir}app.css`, [...t.rules, STILL].join("\n"));
}

async function frame(page: Page, name: string) {
  // The pointer rests on the window's bottom-left corner, away from hover states and tooltips.
  await page.mouse.move(2, 798);
  await page.addStyleTag({ content: HIDE + MAC_LIGHTS });
  await page.waitForTimeout(600);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}${name}.png` });
  await snapshot(page, name);
}

/** An iPhone frame: no keyboard (nothing focused) unless typing is the point, no toasts. */
async function phoneFrame(phone: Page, name: string, opts: { typing?: boolean } = {}) {
  if (!opts.typing) await phone.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await phone.addStyleTag({ content: HIDE });
  await phone.waitForTimeout(800);
  mkdirSync(PHONE_PNG, { recursive: true });
  await phone.screenshot({ path: `${PHONE_PNG}/${name}.png` });
  await snapshot(phone, name, PHONE_HTML);
}

/** Opens a screen on the iPhone and waits for its interface. */
async function phoneGo(phone: Page, path: string) {
  await phone.goto(path.startsWith("http") ? path : `${APP}${path}`);
  await expect(phone.locator("html")).toHaveAttribute("data-iphone", "", { timeout: 30_000 });
  await phone.waitForTimeout(1500);
}

async function debug(page: Page, name: string) {
  if (!DEBUG) return;
  mkdirSync(DEBUG, { recursive: true });
  await page.screenshot({ path: `${DEBUG}/${name}.png` });
}

async function person(browser: Browser, key: string, name: string, scale: number): Promise<{ context: BrowserContext; page: Page; email: string; password: string; totpSecret: string }> {
  const context = await browser.newContext({ ...VIEW, deviceScaleFactor: scale });
  context.setDefaultTimeout(30_000);
  const { page, account } = await createAccount(context, { name, email: `${key}-${Date.now().toString(36)}@example.com` });
  await completeOnboarding(page);
  await page.goto(`${APP}/settings/account`);
  await page.getByLabel("Upload profile picture").setInputFiles(AVATAR(key));
  await expect(page.getByRole("group", { name: "Profile picture" }).locator("img")).toBeVisible({ timeout: 30_000 });
  await page.goto(`${APP}/documents`);
  return { context, page, email: account.email, password: account.password, totpSecret: account.totpSecret };
}

const nav = (page: Page) => page.getByRole("navigation", { name: "Folio" });

async function newFolder(page: Page, name: string, color: string, parent?: string) {
  await showFolders(page);
  if (parent) {
    await nav(page).getByRole("button", { name: `Folder options for ${parent}` }).click();
    await page.getByRole("menuitem", { name: "New folder inside…" }).click();
  } else {
    await page.getByRole("button", { name: "New folder" }).click();
  }
  await page.getByLabel("Folder name").fill(name);
  await page.getByRole("button", { name: "Create folder" }).click();
  await expect(nav(page).getByRole("link", { name, exact: true })).toBeVisible();
  await nav(page).getByRole("button", { name: `Folder options for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Change color…" }).click();
  await page.getByRole("radiogroup", { name: "Folder color" }).getByRole("radio", { name: color, exact: true }).click();
}

/** A new note in a folder: open the folder, New note, title. Leaves the caret at the start of the body. */
async function newNoteIn(page: Page, folder: string, title: string) {
  await showFolders(page);
  await nav(page).getByRole("link", { name: folder, exact: true }).click();
  await page.getByRole("button", { name: "New note", exact: true }).first().click();
  await page.waitForURL(/\/d\/[0-9A-Z]{26}/);
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Document body" })).toBeFocused();
}

async function setTheme(page: Page, theme: string) {
  await openTool(page, "Style");
  await page.getByRole("group", { name: "Note Theme" }).getByRole("button").first().click();
  await page.getByRole("radiogroup", { name: "Note theme" }).getByRole("radio", { name: `Note theme: ${theme}` }).click();
  await page.getByRole("dialog", { name: "Note theme" }).getByRole("button", { name: "Done" }).click();
  // Close the Style panel again.
  await page.getByRole("toolbar", { name: "Page tools" }).getByRole("button", { name: "Style", exact: true }).click();
}

test("capture the showcase frames from the real app", async ({ browser }) => {
  test.setTimeout(1_500_000);
  const maya = await person(browser, "maya", "Maya Patel", 2);
  const sam = await person(browser, "sam", "Sam Okafor", 1);
  if (process.env.SHOWCASE_ACCOUNT_FILE) {
    writeFileSync(
      process.env.SHOWCASE_ACCOUNT_FILE,
      JSON.stringify({ app: APP, workspace: "Studio", maya: { email: maya.email, password: maya.password, totpSecret: maya.totpSecret }, sam: { email: sam.email, password: sam.password, totpSecret: sam.totpSecret } }, null, 2),
    );
  }
  const page = maya.page;

  // ---- Setup: everything except what the frames show being made. ----

  // The Studio workspace and its folders.
  await createWorkspace(page, "Studio");
  // Its logo (the account row at the sidebar's bottom shows it in every frame, and the iPhone's account button).
  await page.goto(`${APP}/settings/workspace`);
  await page.getByLabel("Upload workspace logo").setInputFiles(LOGO);
  await expect(page.getByRole("group", { name: "Workspace logo" }).locator("img")).toBeVisible({ timeout: 30_000 });
  await page.goto(`${APP}/documents`);
  await expect(page.getByRole("navigation", { name: "Folio" }).locator("img").first()).toBeVisible({ timeout: 30_000 });
  await newFolder(page, "Spring launch", "Coral");
  await newFolder(page, "Content plan", "Blue");
  await newFolder(page, "Team wiki", "Green");
  await newFolder(page, "Onboarding", "Emerald", "Team wiki");
  await newFolder(page, "Personal", "Pink");

  // Sam joins Studio (an invitation from Members, accepted from his notifications).
  await page.goto(`${APP}/settings/members`);
  await page.getByPlaceholder("name@example.com").fill(sam.email);
  await page.getByRole("button", { name: "Invite" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Invitation sent/ })).toBeVisible();
  await sam.page.goto(`${APP}/documents`);
  await sam.page.getByRole("button", { name: /Notifications/ }).click();
  await sam.page.getByRole("button", { name: "Accept invitation" }).first().click();
  await switchTo(sam.page, "Studio");
  await page.goto(`${APP}/documents`);

  // Team wiki pages and a few more notes, so Home looks lived in.
  const notes: [string, string, string, string[]][] = [
    ["Onboarding", "Onboarding", "Blossoms", ["Welcome to Studio! Your first week, step by step.", "Day one: laptop, accounts and a coffee with your buddy.", "Day two: read How we write and the Release checklist."]],
    ["Team wiki", "How we write", "Parchment", ["Short sentences. Plain words. One idea per paragraph.", "Write for the reader who is in a hurry: lead with what changed and why it matters."]],
    ["Team wiki", "Release checklist", "Harbor blue", ["Before every release:", "Changelog written and reviewed", "Screenshots updated", "Support team briefed"]],
    ["Personal", "Reading list", "Poppy print", ["Books for the autumn:", "The Creative Act by Rick Rubin", "Four Thousand Weeks by Oliver Burkeman", "Tomorrow, and Tomorrow, and Tomorrow"]],
    ["Personal", "Weekly review", "Summer sky", ["Wins: press kit is done and the pricing page draft is in.", "Next week: launch on Thursday, then a quiet Friday.", "Remember: thank-you notes to the beta testers."]],
  ];
  for (const [folder, title, theme, lines] of notes) {
    await newNoteIn(page, folder, title);
    for (const [i, line] of lines.entries()) {
      if (i) await page.keyboard.press("Enter");
      await page.keyboard.type(line);
    }
    await setTheme(page, theme);
    await waitForSaved(page);
  }

  // The Content plan collection (a table view; the board is added on camera).
  await newNoteIn(page, "Content plan", "Content plan");
  const contentUrl = page.url().replace(/\?.*$/, "");
  await page.keyboard.type("/collection");
  await expect(page.getByRole("option", { name: /Database/ })).toBeVisible();
  await page.keyboard.press("Enter");
  let coll = page.getByRole("region", { name: /^Collection / });
  await expect(coll).toBeVisible();
  await coll.getByRole("textbox", { name: "Collection name" }).fill("Content plan");
  await coll.getByRole("textbox", { name: "Collection name" }).press("Enter");
  coll = page.getByRole("region", { name: "Collection Content plan" });
  await expect(coll).toBeVisible();
  await coll.getByRole("button", { name: /View settings/ }).click();
  const settings = page.getByRole("dialog", { name: /settings/ });
  await settings.getByLabel("Options for Status (comma-separated)").fill("Ideas, Doing, Done");
  await settings.getByLabel("Options for Status (comma-separated)").press("Tab");
  await settings.getByRole("button", { name: "Delete property Date" }).click();
  await page.getByRole("button", { name: "Delete property", exact: true }).click();
  await expect(coll.getByRole("columnheader", { name: "Date" })).toHaveCount(0);
  await page.waitForTimeout(500);
  if (!(await settings.isVisible())) await coll.getByRole("button", { name: /View settings/ }).click();
  for (const [name, type] of [["Type", "Single select"], ["Owner", "Text"]] as const) {
    await settings.getByRole("textbox", { name: "New property" }).fill(name);
    await pick(settings.getByRole("combobox", { name: "Property type" }), type);
    await settings.getByRole("button", { name: "Add", exact: true }).click();
    await expect(settings.getByRole("textbox", { name: `Name of property ${name}` })).toBeVisible();
  }
  await settings.getByLabel("Options for Type (comma-separated)").fill("Blog, Email, Video");
  await settings.getByLabel("Options for Type (comma-separated)").press("Tab");
  await settings.getByRole("button", { name: "Close" }).click();
  const plan = [
    ["Launch post", "Blog", "Sam", "Doing"],
    ["Customer story", "Blog", "Ines", "Doing"],
    ["Spring newsletter", "Email", "Maya", "Done"],
    ["Feature video", "Video", "Sam", "Ideas"],
  ];
  // Enter in a row's name adds the next row, so each name is typed into the row Enter made.
  await coll.getByRole("button", { name: "New row" }).click();
  for (const [i, [name]] of plan.entries()) {
    const rowName = coll.getByRole("textbox", { name: "Row name" });
    await expect(rowName).toHaveCount(i + 1);
    await rowName.nth(i).fill(name!);
    if (i < plan.length - 1) await rowName.nth(i).press("Enter");
    else await rowName.nth(i).evaluate((el) => (el as HTMLInputElement).blur());
  }
  await expect(coll.getByRole("textbox", { name: "Row name" })).toHaveCount(plan.length);
  for (const [name, type, owner, status] of plan) {
    await pick(coll.getByRole("combobox", { name: `Type for ${name}` }), type!);
    await pick(coll.getByRole("combobox", { name: `Status for ${name}` }), status!);
    await coll.getByRole("textbox", { name: `Owner for ${name}` }).fill(owner!);
    await coll.getByRole("textbox", { name: `Owner for ${name}` }).press("Enter");
  }
  await waitForSaved(page);

  // The Spring launch page: titled and themed; its words are typed on camera.
  await newNoteIn(page, "Spring launch", "Spring launch");
  const springUrl = page.url().replace(/\?.*$/, "");
  await setTheme(page, "Irises");
  await waitForSaved(page);

  // Bookmarks: the launch page and the content plan (they show in the sidebar and on Home).
  for (const [url, title] of [[springUrl, "Spring launch"], [contentUrl, "Content plan"]] as const) {
    await page.goto(url);
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(title);
    await page.getByRole("group", { name: "Page" }).getByRole("button", { name: "Document actions" }).click();
    await page.getByRole("menuitem", { name: /^Bookmark/ }).click();
    await showFolders(page);
    await expect(nav(page).getByRole("group", { name: "Bookmarked pages" }).getByRole("link", { name: title })).toBeVisible();
  }

  // This week's tasks, with due dates.
  await nav(page).getByRole("link", { name: /^Tasks( \d+)?$/ }).click();
  const day = (offset: number) =>
    page.evaluate((o) => {
      const d = new Date();
      d.setDate(d.getDate() + o);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }, offset);
  for (const [task, offset] of [["Send the press kit", 0], ["Review the launch post", 1], ["Publish the pricing page", 2], ["Thank-you notes to beta testers", 4]] as const) {
    await page.getByRole("button", { name: "Add task" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Quick add task" });
    await dialog.getByLabel("Task").fill(task);
    await dialog.getByRole("button", { name: /^Due date/ }).click();
    await pickDate(page.getByRole("dialog", { name: "Choose due date" }), await day(offset));
    await dialog.getByRole("button", { name: "Add task" }).click();
    await expect(dialog).toBeHidden();
  }
  await page.getByRole("link", { name: /^All( \d+)?$/ }).click();

  // The team's Vault: set up with a test passcode, three items.
  await nav(page).getByRole("link", { name: "Vault" }).click();
  await expect(page.getByRole("heading", { name: /^Set up your/ })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Choose a passcode").fill(VAULT_PASSCODE);
  await page.getByLabel("Type it again").fill(VAULT_PASSCODE);
  await page.getByRole("button", { name: "Set up the Vault" }).click();
  await expect(page.getByRole("heading", { name: "Save your Vault recovery key" })).toBeVisible({ timeout: 60_000 });
  const groups = (await page.getByRole("list", { name: "Your recovery key" }).locator("li").allInnerTexts()).map((g) => g.replace(/^Group \d+:\s*/, "").trim());
  await page.getByRole("button", { name: "I've saved it" }).click();
  await page.getByLabel("Group 3").fill(groups[2]!);
  await page.getByLabel("Group 7").fill(groups[6]!);
  await page.getByRole("button", { name: "Check and continue" }).click();
  await page.getByRole("tab", { name: "Passwords & Credentials" }).click();
  const items: [string, string, Record<string, string>][] = [
    ["Login", "Bank login", { Username: "maya@studio.example", Password: "Harbor-Lantern-42-Quiet", Website: "https://bank.example", "2FA secret": "JBSWY3DPEHPK3PXP" }],
    ["API key", "Stripe API key", { Service: "Stripe", Key: "sk_test_demo_4eC39HqLyjWDarjtT1zdp7dc", Environment: "Test" }],
    ["Wi-Fi", "Studio Wi-Fi", { "Network name": "Studio 5G", Password: "Blue-Irises-Spring-12", Security: "WPA3" }],
  ];
  for (const [kind, title, fields] of items) {
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const add = page.getByRole("dialog", { name: "Add to the Vault" });
    await pick(add.getByRole("combobox", { name: "Kind" }), kind);
    await add.getByLabel("Title").fill(title);
    for (const [label, value] of Object.entries(fields)) await add.getByLabel(label, { exact: true }).fill(value);
    await add.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("region", { name: title })).toBeVisible({ timeout: 30_000 });
  }

  // The same tabs in every frame: Home, Spring launch, Content plan, Tasks, Vault.
  const strip = page.getByRole("navigation", { name: "Open pages" });
  await strip.getByRole("link").filter({ hasNotText: /^$/ }).last().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Close all tabs" }).click();
  // Opened from the sidebar, each in its own tab (a reload would replace the current tab instead).
  await showFolders(page);
  const bookmarks = nav(page).getByRole("group", { name: "Bookmarked pages" });
  await bookmarks.getByRole("link", { name: "Spring launch" }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Spring launch");
  await showFolders(page);
  await bookmarks.getByRole("link", { name: "Content plan" }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Content plan");
  await showFolders(page);
  await nav(page).getByRole("link", { name: /^Tasks( \d+)?$/ }).click();
  await expect(page.getByRole("button", { name: "Add task" }).first()).toBeVisible();
  await nav(page).getByRole("link", { name: "Vault" }).click();
  await expect(page.getByRole("button", { name: "Lock", exact: true }).or(page.getByRole("heading", { name: "The Vault is locked" })).first()).toBeVisible();
  // Folders stay in view under a collapsed Bookmarks.
  await nav(page).getByRole("button", { name: "Collapse Bookmarks" }).click();
  const tab = (name: RegExp) => strip.getByRole("link", { name });
  await debug(page, "09-tabs");

  // Maya's iPhone: her account signed in on a second device.
  const phoneContext = await browser.newContext({
    viewport: { width: PHONE.width, height: PHONE.height },
    deviceScaleFactor: PHONE.scale,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  phoneContext.setDefaultTimeout(30_000);
  await phoneContext.addInitScript(fakeBridge);
  const phone = await signIn(phoneContext, maya, { returnTo: "/documents" });
  const cdp = await phoneContext.newCDPSession(phone);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: PHONE.insets });
  await phoneGo(phone, "/documents");
  const rootBar = phone.getByRole("button", { name: /: account and places$/ });
  if ((await rootBar.getAttribute("aria-label")) !== "Studio: account and places") {
    await rootBar.click();
    await phone.getByRole("dialog", { name: "Account" }).getByRole("button", { name: /^Studio/ }).click();
  }
  await expect(phone.getByRole("button", { name: "Studio: account and places" })).toBeVisible();
  // A new device gets the account's encryption keys once (approved from Maya's Mac, the codes compared), then
  // asks for the Vault's passcode like any other.
  await phoneGo(phone, "/vault");
  await phone.getByRole("button", { name: "Approve from another device" }).click();
  const incoming = page.getByRole("dialog", { name: "Approve a new device?" });
  await expect(incoming.getByRole("button", { name: "They match" })).toBeEnabled({ timeout: 60_000 });
  await incoming.getByRole("button", { name: "They match" }).click();
  await expect(incoming).toBeHidden();
  await expect(phone.getByLabel("Passcode")).toBeVisible({ timeout: 60_000 });
  await phoneGo(phone, "/documents");
  await debug(phone, "10-phone");

  // ---- Frames ----

  // Chapter 1, write: the Spring launch page.
  await tab(/^Spring launch$/).click();
  await page.getByRole("textbox", { name: "Document body" }).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("Launch day is Thursday the 12th. Here's who does what.");
  await waitForSaved(page);
  await frame(page, "write-1");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/table");
  await expect(page.getByRole("option", { name: /Simple table/ })).toBeVisible();
  await frame(page, "write-2");
  await page.keyboard.press("Enter");
  await expect(page.locator(".fb-editor table.fb-table")).toBeVisible();
  const cell = (r: number, c: number) => page.getByRole("textbox", { name: `Row ${r}, column ${c}` });
  await cell(1, 1).click();
  const rows = [
    ["Task", "Owner", "Status"],
    ["Press kit", "Maya", "Done"],
    ["Launch post", "Sam", "Doing"],
    ["Pricing page", "Ines", "Doing"],
  ];
  for (const [r, row] of rows.entries()) {
    for (const [c, text] of row.entries()) {
      if (r || c) await page.keyboard.press("Tab");
      await page.keyboard.type(text);
    }
  }
  await page.keyboard.press("Escape");
  // The closing line goes in the empty paragraph under the table.
  await page.locator(".fb-editor > p.fb-paragraph").last().click();
  await page.keyboard.type("Press kit, launch post, pricing page.");
  await waitForSaved(page);
  await frame(page, "write-3");
  await phoneGo(phone, springUrl);
  await expect(phone.getByRole("textbox", { name: "Document body" })).toContainText("Pricing page");
  await phoneFrame(phone, "write-1");
  await phoneGo(phone, "/documents");

  // Chapter 2, together: Sam in the same page, a comment, his reply.
  await sam.page.goto(springUrl);
  const samBody = sam.page.getByRole("textbox", { name: "Document body" });
  await expect(samBody).toContainText("Here's who does what");
  await samBody.locator("p").first().click();
  await sam.page.keyboard.press("End");
  const mayaBody = page.getByRole("textbox", { name: "Document body" });
  await expect(mayaBody.locator('[data-remote-caret="Sam"]')).toBeVisible({ timeout: 30_000 });
  await frame(page, "together-1");

  // Maya comments on the launch-day line (⌘⌥M), mentioning Sam.
  await mayaBody.locator("p").first().click();
  await page.waitForTimeout(500);
  await page.keyboard.press("ControlOrMeta+Alt+KeyM");
  const card = page.getByRole("dialog", { name: "Comments" });
  const composer = card.getByRole("textbox").first();
  await expect(composer).toBeFocused();
  await page.keyboard.type("@Sam");
  await expect(page.getByRole("option", { name: /Sam Okafor/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(composer).toHaveValue(/@Sam Okafor $/);
  await page.keyboard.type("can the embargo lift at 9am on the 12th?");
  await page.keyboard.press("Enter");
  await expect(card.getByText("can the embargo lift")).toBeVisible();
  await frame(page, "together-2");

  // Sam answers from the note's Comments; Maya resolves the thread.
  await sam.page.getByRole("tab", { name: /^Comments/ }).click();
  await sam.page.getByRole("tabpanel").getByText("can the embargo lift").click();
  const reply = sam.page.getByRole("textbox", { name: "Reply" }).first();
  await reply.click();
  await sam.page.keyboard.type("Yes, 9am works. I'll schedule the launch post for then.");
  await sam.page.keyboard.press("Enter");
  await expect(card.getByText("9am works")).toBeVisible({ timeout: 30_000 });
  await frame(page, "together-3");
  // On the iPhone: the note's Comments sheet with the thread.
  await phoneGo(phone, springUrl);
  await phone.getByRole("toolbar", { name: "Note tools" }).getByRole("button", { name: "Comments" }).click();
  const phoneComments = phone.locator("dialog[open]").last();
  await expect(phoneComments.getByText("can the embargo lift").first()).toBeVisible();
  // Tapping the thread opens it on its line, with Sam's reply.
  await phoneComments.getByText("can the embargo lift").first().click();
  await expect(phone.getByText("9am works").first()).toBeVisible();
  await phoneFrame(phone, "together-1");
  await phoneGo(phone, "/documents");
  await card.getByRole("button", { name: "Resolve thread" }).click();
  await expect(card.getByText(/^Resolved/)).toBeVisible();
  await frame(page, "together-4");
  await card.getByRole("button", { name: "Close comments" }).click();
  await sam.page.goto(`${APP}/documents`);

  // Chapter 3, tasks: this week's list, one ticked, then the calendar.
  await tab(/^Tasks/).click();
  await page.getByRole("link", { name: /^All( \d+)?$/ }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Thank-you notes to beta testers" })).toBeVisible();
  await page.mouse.move(5, 790);
  await frame(page, "tasks-1");
  // On the iPhone: the coming days' tasks with their dates.
  await phoneGo(phone, "/tasks/upcoming");
  await expect(phone.getByText("Thank-you notes to beta testers").first()).toBeVisible();
  await phoneFrame(phone, "tasks-1");
  await page.getByRole("listitem").filter({ hasText: "Send the press kit" }).getByRole("checkbox").click();
  await page.waitForTimeout(300);
  await page.mouse.move(5, 790);
  await frame(page, "tasks-2");
  await page.getByRole("link", { name: "Calendar" }).first().click();
  await expect(page.getByRole("gridcell").filter({ hasText: "Review the launch post" })).toBeVisible();
  await frame(page, "tasks-3");
  // The iPhone's Calendar tab: the week strip and the agenda.
  await phoneGo(phone, "/calendar");
  await expect(phone.getByText("Review the launch post").first()).toBeVisible();
  await phoneFrame(phone, "tasks-2");
  // Back to the four tabs (the calendar opened its own).
  await page.goBack();
  await strip.getByRole("button", { name: /^Close Calendar/ }).click().catch(() => undefined);

  // Chapter 4, board: the Content plan as a table, then as a board by Status.
  await tab(/^Content plan$/).click();
  coll = page.getByRole("region", { name: "Collection Content plan" });
  await expect(coll.getByRole("textbox", { name: "Row name" })).toHaveCount(plan.length);
  await page.mouse.click(5, 790);
  await frame(page, "board-1");
  await phoneGo(phone, contentUrl);
  await expect(phone.getByRole("region", { name: "Collection Content plan" })).toBeVisible();
  await phoneFrame(phone, "board-1");
  await pick(coll.getByRole("combobox", { name: "Add view" }), "Board");
  await expect(coll.getByRole("group", { name: "Views" }).getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(5, 790);
  await frame(page, "board-2");
  await phoneGo(phone, contentUrl);
  const phoneColl = phone.getByRole("region", { name: "Collection Content plan" });
  await expect(phoneColl).toBeVisible();
  const phoneBoard = phoneColl.getByRole("group", { name: "Views" }).getByRole("button", { name: "Board" }).or(phoneColl.getByRole("tab", { name: "Board" }));
  if ((await phoneBoard.getAttribute("aria-pressed")) !== "true" && (await phoneBoard.getAttribute("aria-selected")) !== "true") await phoneBoard.click();
  await phone.waitForTimeout(800);
  await phoneFrame(phone, "board-2");

  // Chapter 6, the Vault: open with the three items (secrets hidden), then locked.
  await tab(/^Vault/).click();
  if (await page.getByRole("heading", { name: "The Vault is locked" }).isVisible()) {
    await page.getByLabel("Passcode").fill(VAULT_PASSCODE);
    await page.getByRole("button", { name: "Unlock" }).click();
  }
  await page.getByRole("tab", { name: "Passwords & Credentials" }).click();
  await page.getByRole("button", { name: /^Bank login/ }).click();
  await expect(page.getByRole("region", { name: "Bank login" })).toContainText("••••");
  await page.mouse.move(5, 790);
  await frame(page, "vault-2");
  await page.getByRole("button", { name: "Lock", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The Vault is locked" })).toBeVisible();
  await page.mouse.move(5, 790);
  await frame(page, "vault-1");
  // On the iPhone: locked, then opened with the passcode.
  try {
    await phoneGo(phone, "/vault");
    await expect(phone.getByLabel("Passcode")).toBeVisible();
    await phoneFrame(phone, "vault-1");
    await phone.getByLabel("Passcode").fill(VAULT_PASSCODE);
    await phone.getByRole("button", { name: "Unlock", exact: true }).click();
    await phone.getByRole("tab", { name: "Passwords & Credentials" }).click();
    await expect(phone.getByText("Stripe API key").first()).toBeVisible({ timeout: 30_000 });
    await phoneFrame(phone, "vault-2");
  } catch (e) {
    await debug(phone, "60-phone-vault-failed");
    console.log(`The iPhone's Vault wasn't captured: ${(e as Error).message.split("\n")[0]}`);
  }

  // Home, then chapter 5, Foli AI, asked from Home.
  await strip.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Recent notes" })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.mouse.move(5, 790);
  await frame(page, "home-1");
  await phoneGo(phone, "/documents");
  await expect(phone.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await phone.waitForTimeout(1500);
  await phoneFrame(phone, "home-1");
  await page.getByRole("button", { name: "Ask Foli AI" }).click();
  const ai = page.getByRole("dialog", { name: "Foli AI" });
  await expect(ai).toBeVisible();
  await ai.getByRole("textbox").first().fill("What's left before the launch?");
  await frame(page, "ai-1");
  await page.keyboard.press("Enter");
  try {
    await expect(ai.locator(".fb-ai-answer")).toBeVisible({ timeout: 90_000 });
    // Until the answer has finished (its sources are listed at the end).
    await expect(ai.getByRole("button", { name: /Regenerate/ })).toBeVisible({ timeout: 90_000 });
    await page.waitForTimeout(2000);
    await frame(page, "ai-2");
  } catch {
    await debug(page, "50-ai-failed");
    console.log("Foli AI did not answer on this deployment: ai-2 not captured.");
  }

  // Foli AI on the iPhone: its sheet from the tab bar, asked the same.
  try {
    await phone.getByRole("group", { name: "Create" }).getByRole("button", { name: "Foli AI" }).click();
    const phoneAi = phone.locator("dialog[open]").last();
    await expect(phoneAi).toBeVisible();
    await phoneAi.getByRole("textbox").first().fill("What's left before the launch?");
    await phoneFrame(phone, "ai-1", { typing: true });
    await phoneAi.getByRole("textbox").first().press("Enter");
    await expect(phoneAi.locator(".fb-ai-answer")).toBeVisible({ timeout: 90_000 });
    await expect(phoneAi.getByRole("button", { name: /Regenerate/ })).toBeVisible({ timeout: 90_000 });
    await phone.waitForTimeout(2000);
    // The sheet follows the answer to its end: back up to the question, with the answer under it.
    await phoneAi.getByText("What's left before the launch?", { exact: true }).last().evaluate((el) => el.scrollIntoView({ block: "start" }));
    await phone.waitForTimeout(800);
    await phoneFrame(phone, "ai-2");
  } catch (e) {
    await debug(phone, "51-phone-ai-failed");
    console.log(`Foli AI on the iPhone wasn't captured: ${(e as Error).message.split("\n")[0]}`);
  }
  await phoneContext.close();

  // A WebP copy of each frame (quality 82), when cwebp is installed.
  for (const file of readdirSync(OUT).filter((f) => f.endsWith(".png"))) {
    try {
      execFileSync("cwebp", ["-quiet", "-q", "82", `${OUT}${file}`, "-o", `${OUT}${file.replace(/\.png$/, ".webp")}`]);
    } catch {
      console.log("cwebp isn't installed: PNG frames only.");
      break;
    }
  }
  // The iPhone's, from its PNGs (kept out of the repo like the Mac's).
  mkdirSync(PHONE_OUT, { recursive: true });
  for (const file of readdirSync(PHONE_PNG).filter((f) => f.endsWith(".png"))) {
    try {
      execFileSync("cwebp", ["-quiet", "-q", "82", `${PHONE_PNG}/${file}`, "-o", `${PHONE_OUT}${file.replace(/\.png$/, ".webp")}`]);
    } catch {
      break;
    }
  }
  writeCss(MAC_HTML);
  writeCss(PHONE_HTML);
  // The PNG originals leave the repo's folder (only WebP is committed).
  if (PNG_OUT) {
    mkdirSync(PNG_OUT, { recursive: true });
    for (const file of readdirSync(OUT).filter((f) => f.endsWith(".png"))) renameSync(`${OUT}${file}`, `${PNG_OUT}/${file}`);
  }
});
