// The app's screens, the web's against the new frame's, whole screen, in the iOS Simulator (docs/IOS_REBUILD_PLAN.md,
// I3): one scratch library seeded on a fresh install (local mode on this device: the sample notes and folders,
// plus a few notes made and starred through the engine), then each screen opened in the web frame
// (FOLEVI_WEB_FRAME=1, the web draws it) and in the new frame (FOLEVI_REBUILD=1), light and dark, the status bar
// and home indicator left out, compared as gate-match.mjs compares the gates. Report in apps/ios/match-report/screens.
//
// Times ("4 mins ago") come from the clock on both sides: run with --no-seed an hour or more after seeding for
// shots that can't fall either side of a minute.
//
// --styles measures the web's elements for the native screens instead (packages/design-tokens/match/app-styles/
// phone.json, in the web frame) into app-styles-cache/phone.ios.json; `node scripts/web-styles.mjs --no-samples`
// puts them in WebStyles.
//
// The Vault (I6): the library's Vault set up with a scratch PIN (VAULT_PIN) and a few items, then unlocked before
// each of its shots (the web by its passcode field, the new frame through the engine). "vault-setup" is shot only
// when seeding, before the Vault exists.
//
//   node scripts/screen-match.mjs --app <App.app> [--device "iPhone 18 Pro"] [--only home,...] [--no-seed] [--styles]
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { extract } from "../../../scripts/style-extract.mjs";
import { GATES, simulator } from "./gates.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const app = arg("--app");
const device = arg("--device", "iPhone 18 Pro");
const only = arg("--only")?.split(",");
const styles = process.argv.includes("--styles");
if (!app) throw new Error("Pass --app <path to the built App.app>");
const sim = simulator(device);

/** The scratch Vault's passcode (a scratch library on a Simulator; nothing real). */
const VAULT_PIN = "246810";
/** Types the scratch PIN into every field of the web's Vault card (React's own value setter, then its input event). */
const FILL_PIN = `const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; for (const i of document.querySelectorAll("main input")) { set.call(i, "${VAULT_PIN}"); i.dispatchEvent(new Event("input", { bubbles: true })); } return true;`;

/** The screens, by route. `ready` is text the web shows once the screen is drawn. */
// `scroll`: the screen scrolled down by that many points (FOLEVI_REBUILD_SCROLL in the new frame).
export const SCREENS = [
  { id: "home", path: "/documents", ready: "All notes" },
  { id: "home-lower", path: "/documents", ready: "All notes", scroll: 420 },
  { id: "notes", path: "/notes", ready: "Packing list" },
  { id: "drafts", path: "/drafts", ready: "Packing list" },
  { id: "starred", path: "/starred", ready: "Packing list" },
  { id: "archive", path: "/archive", ready: "Old receipts" },
  { id: "trash", path: "/trash", ready: "Trash is empty" },
  { id: "folders", path: "/folders", ready: "Projects" },
  // A folder by its name (`folder`): its id is looked up in the web frame first.
  { id: "folder", folder: "Personal", ready: "Reading Shelf" },
  // Search: the web opens it from Home's field (`press`), types (`type`) and lets go of the keyboard; the new frame
  // opens its route (`native`) without the keyboard.
  { id: "search", path: "/documents", ready: "All notes", press: "Search in Personal", native: "/search" },
  { id: "search-trip", path: "/documents", ready: "All notes", press: "Search in Personal", type: "trip", native: "/search?q=trip" },
  // The Vault (I6). `beforeVault`: shot right after the library is seeded, before its Vault is set up. `unlock`: the
  // Vault opened first; `tab` a tab pressed, `menu` a section from the ⋯ menu, `row` a row pressed (the web);
  // `native` the route the new frame opens and `nativeEnv` its debug hooks.
  // `measureJs`: run in the web frame before its styles are measured (--styles): the passcode typed, so the buttons
  // are measured enabled (natively they fade by themselves when disabled).
  { id: "vault-setup", path: "/vault", ready: "Set up your Vault", beforeVault: true, measureJs: FILL_PIN },
  { id: "vault-locked", path: "/vault", ready: "The Vault is locked", measureJs: FILL_PIN },
  { id: "vault-files", path: "/vault", ready: "The Vault is locked", unlock: "Upload" },
  { id: "vault-passwords", path: "/vault", ready: "The Vault is locked", unlock: "Upload", tab: "Passwords & Credentials", native: "/vault/passwords" },
  { id: "vault-item", path: "/vault", ready: "The Vault is locked", unlock: "Upload", tab: "Passwords & Credentials", row: "Bank", native: "/vault/passwords", nativeEnv: { FOLEVI_VAULT_ITEM: "Bank" } },
  { id: "vault-health", path: "/vault", ready: "The Vault is locked", unlock: "Upload", menu: "Health", native: "/vault/health" },
  { id: "vault-trash", path: "/vault", ready: "The Vault is locked", unlock: "Upload", menu: "Trash", native: "/vault/trash" },
  { id: "vault-settings", path: "/vault", ready: "The Vault is locked", unlock: "Upload", menu: "Settings", native: "/vault/settings" },
];
const screens = SCREENS.filter((s) => !only || only.includes(s.id));

const waitUntil = (what, test, ms = 60000) => {
  for (let t = 0; t < ms; t += 500) {
    try {
      if (test()) return;
    } catch {
      /* the page is loading */
    }
    sim.sleep(500);
  }
  throw new Error(`${what}: never`);
};

// The scratch library: a fresh install in today's frame, "This device", a note made and one starred.
if (!process.argv.includes("--no-seed")) {
  sim.appearance("light");
  sim.open(app, GATES.find((g) => g.id === "library-ready"), {});
  sim.press("Open Folevi");
  waitUntil("the engine", () => sim.evalJs("return Boolean(window.__foleviEngine)"));
  sim.sleep(3000);
  const made = sim.command("note.create", { text: "Packing list\nPassport, charger, the good socks.", open: false });
  sim.command("note.star", { ids: [made.id], starred: true });
  const old = sim.command("note.create", { text: "Old receipts\nKept for the tax year, then archived.", open: false });
  sim.command("note.archive", { ids: [old.id], archived: true });
  sim.sleep(2000);
  console.log("seeded");
}

/** A view read once from the engine in the page (as `sim.command` sends commands). */
const query = (name, args = {}) =>
  sim.evalJs(`const marker = window.__foleviNativeChrome; const reply = JSON.parse(await window.__foleviEngine.handle({ v: 1, id: "script-" + Date.now(), kind: "query", place: marker?.place ?? null, name: ${JSON.stringify(name)}, args: ${JSON.stringify(args)} })); if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.value;`);
/** The Vault opened through the engine (the new frame's shots). */
const unlockVault = () => {
  waitUntil("the engine", () => sim.evalJs("return Boolean(window.__foleviEngine)"));
  waitUntil("the Vault's state", () => ["locked", "open"].includes(query("vault.summary").state), 20000);
  const v = query("vault.summary");
  if (v.state === "locked") sim.command("vault.unlock", { vaultId: v.vaultId, passcode: VAULT_PIN });
  waitUntil("the Vault open", () => query("vault.summary").state === "open", 20000);
};

// Not seeded again: the build goes over the seeded install (its data stays).
if (process.argv.includes("--no-seed")) sim.simctl("install", sim.udid, app);

// Folders named by screens: their ids, from Home's folder links in the web frame.
if (screens.some((s) => s.folder)) {
  sim.relaunch({ FOLEVI_WEB_FRAME: "1" });
  waitUntil("Home", () => sim.evalJs("return document.body.innerText.includes(\"All notes\")"));
  sim.sleep(1500);
  for (const s of screens.filter((x) => x.folder)) {
    const href = sim.evalJs(`return [...document.querySelectorAll("a[href^='/folders/']")].find((a) => (a.getAttribute("aria-label") ?? a.textContent).startsWith(${JSON.stringify(s.folder)}))?.getAttribute("href") ?? null`);
    if (!href) throw new Error(`no folder called ${s.folder}`);
    s.path = href;
  }
}

/** Opens `screen` in the frame `env` names, on the seeded install. */
const open = (screen, env) => {
  const native = env.FOLEVI_REBUILD === "1";
  const extra = native && screen.scroll ? { FOLEVI_REBUILD_SCROLL: String(screen.scroll) } : {};
  const route = native ? (screen.native ?? screen.path) : screen.path;
  const opens = native && route !== "/documents" ? { FOLEVI_REBUILD_OPEN: route, FOLEVI_GATE_NO_KEYBOARD: "1", ...(screen.nativeEnv ?? {}) } : {};
  sim.relaunch({ ...env, ...extra, ...opens });
  waitUntil("the page", () => sim.evalJs('return document.readyState === "complete"'));
  if (native && screen.unlock) unlockVault();
  if (!native && screen.path === "/vault") return openWebVault(screen);
  if (!native) {
    if (sim.evalJs("return location.pathname") !== screen.path) sim.evalJs(`location.assign(${JSON.stringify(screen.path)}); return true;`);
    waitUntil(screen.ready, () => sim.evalJs(`return document.body.innerText.includes(${JSON.stringify(screen.ready)})`));
    if (screen.press) {
      sim.sleep(1000);
      sim.press(screen.press);
      sim.sleep(1200);
      if (screen.type) {
        sim.evalJs(`const i = document.querySelector("dialog input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(screen.type)}); i.dispatchEvent(new Event("input", { bubbles: true })); return true;`);
        sim.sleep(1500);
      }
      sim.evalJs("document.activeElement?.blur(); return true");
    }
    if (screen.scroll) {
      sim.sleep(1500);
      sim.evalJs(`document.querySelector("main#main").scrollTo(0, ${screen.scroll}); return true;`);
    }
  }
  sim.sleep(2500);
};

/** The web's Vault: unlocked by its passcode field, then a tab, a ⋯ section or a row pressed, no field focused. */
function openWebVault(screen) {
  if (sim.evalJs("return location.pathname") !== "/vault") sim.evalJs(`location.assign("/vault"); return true;`);
  waitUntil(screen.ready, () => sim.evalJs(`return document.body.innerText.includes(${JSON.stringify(screen.ready)})`));
  sim.sleep(800);
  if (screen.unlock) {
    sim.evalJs(`const i = document.querySelector("main input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(VAULT_PIN)}); i.dispatchEvent(new Event("input", { bubbles: true })); setTimeout(() => [...document.querySelectorAll("button[type=submit]")].find((b) => b.textContent.includes("Unlock"))?.click(), 200); return true;`);
    waitUntil(screen.unlock, () => sim.evalJs(`return document.body.innerText.includes(${JSON.stringify(screen.unlock)})`));
    sim.sleep(1000);
  }
  if (screen.tab) sim.evalJs(`[...document.querySelectorAll("[role=tab]")].find((b) => b.textContent.includes(${JSON.stringify(screen.tab)})).click(); return true;`);
  if (screen.menu) {
    sim.evalJs(`document.querySelector("button[aria-label='More in the Vault']").click(); return true;`);
    sim.sleep(800);
    sim.evalJs(`[...document.querySelectorAll("[role^=menuitem]")].find((b) => b.textContent.trim() === ${JSON.stringify(screen.menu)}).click(); return true;`);
  }
  if (screen.row) {
    sim.sleep(1200);
    sim.evalJs(`[...document.querySelectorAll("main li button")].find((b) => b.textContent.includes(${JSON.stringify(screen.row)})).click(); return true;`);
  }
  sim.sleep(1200);
  sim.evalJs("document.activeElement?.blur(); return true");
  sim.sleep(2000);
}

/** The scratch library's Vault: set up with VAULT_PIN, its recovery key marked saved (never shown or kept), a folder,
 * a note, a small file, a login, and one in the Trash. In today's frame, through the engine. */
function seedVault() {
  sim.relaunch({});
  waitUntil("the engine", () => sim.evalJs("return Boolean(window.__foleviEngine)"));
  sim.sleep(2500);
  if (query("vault.summary").state === "setUp") sim.command("vault.setUp", { passcode: VAULT_PIN });
  sim.sleep(1500);
  unlockVault();
  const vaultId = query("vault.summary").vaultId;
  sim.command("vault.recoverySaved", { vaultId });
  sim.command("vault.folder.create", { vaultId, name: "Taxes" });
  sim.command("vault.note.create", { vaultId, title: "Wi-Fi at the cabin" });
  sim.command("vault.file.upload", { vaultId, name: "insurance.txt", mime: "text/plain", data: Buffer.from("Policy 12345\nRenews in March.").toString("base64") });
  sim.command("vault.item.save", { vaultId, kind: "login", title: "Bank", values: { username: "sam@example.com", password: "scratch-password-1", website: "https://bank.example" }, notes: "" });
  const old = sim.command("vault.item.save", { vaultId, kind: "login", title: "Old router", values: { username: "admin", password: "scratch-password-2" }, notes: "" });
  sim.command("vault.item.remove", { vaultId, itemId: old.id });
  sim.sleep(2000);
  console.log("vault seeded");
}

if (styles) {
  const spec = JSON.parse(readFileSync(join(repo, "packages/design-tokens/match/app-styles/phone.json"), "utf8"));
  const out = { light: {}, dark: {} };
  // (The Vault's set-up screen before its Vault exists, the rest after.)
  const measuring = [...screens.filter((s) => s.beforeVault), ...screens.filter((s) => !s.beforeVault)];
  for (const screen of measuring) {
    if (screen === measuring.find((s) => !s.beforeVault && s.path === "/vault") && !process.argv.includes("--no-seed")) seedVault();
    if (screen.beforeVault && process.argv.includes("--no-seed")) continue;
    open(screen, { FOLEVI_WEB_FRAME: "1" });
    if (screen.measureJs) {
      sim.evalJs(screen.measureJs);
      sim.sleep(800);
      sim.evalJs("document.activeElement?.blur(); return true");
    }
    for (const scheme of ["light", "dark"]) {
      sim.appearance(scheme);
      sim.sleep(1200);
      const tags = Object.fromEntries(Object.entries(spec.styles).filter(([, t]) => t.screen === screen.id));
      Object.assign(out[scheme], sim.evalJs(`return (${extract.toString()})(${JSON.stringify(tags)})`));
    }
  }
  sim.appearance("light");
  const wanted = Object.entries(spec.styles).filter(([, t]) => screens.some((s) => s.id === t.screen)).map(([id]) => id);
  const missing = wanted.filter((id) => !out.light[id]);
  if (missing.length) console.warn(`not found on the iPhone: ${missing.join(", ")}`);
  const file = join(repo, "packages/design-tokens/match/app-styles-cache/phone.ios.json");
  // Screens measured before stay unless measured again.
  let kept = { light: {}, dark: {} };
  try {
    kept = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    /* none yet */
  }
  writeFileSync(file, JSON.stringify({ light: { ...kept.light, ...out.light }, dark: { ...kept.dark, ...out.dark } }, null, 1) + "\n");
  console.log(`wrote phone.ios.json (${Object.keys(out.light).length} styles)`);
  process.exit(0);
}

const outDir = join(repo, "apps/ios/match-report/screens");
for (const d of ["web", "native", "diff"]) mkdirSync(join(outDir, d), { recursive: true });
// The status bar and the home indicator are the system's: cropped away (points at 3x).
const TOP = 62 * 3;
const BOTTOM = 34 * 3;
const crop = (path) => {
  const info = execFileSync("sips", ["-g", "pixelHeight", "-g", "pixelWidth", path], { encoding: "utf8" });
  const h = Number(/pixelHeight: (\d+)/.exec(info)[1]);
  const w = Number(/pixelWidth: (\d+)/.exec(info)[1]);
  execFileSync("sips", ["-c", String(h - TOP - BOTTOM), String(w), "--cropOffset", String(TOP), "0", path], { stdio: "pipe" });
};
const shoot = (screen) => {
  for (const [side, env] of [["web", { FOLEVI_WEB_FRAME: "1" }], ["native", { FOLEVI_REBUILD: "1" }]]) {
    open(screen, env);
    for (const scheme of ["light", "dark"]) {
      sim.appearance(scheme);
      sim.sleep(1500);
      const path = join(outDir, side, `${screen.id}-${scheme}.png`);
      sim.screenshot(path);
      crop(path);
    }
    sim.appearance("light");
  }
  console.log(`${screen.id}: shot`);
};
const seeding = !process.argv.includes("--no-seed");
const shooting = process.argv.includes("--diff-only") ? [] : screens;
for (const screen of shooting.filter((s) => s.beforeVault && seeding)) shoot(screen);
if (seeding && screens.some((s) => s.path === "/vault")) seedVault();
for (const screen of shooting.filter((s) => !s.beforeVault)) shoot(screen);

const require = createRequire(join(repo, "apps/web/package.json"));
const { webkit } = require("@playwright/test");
const { diffAll, writeReport } = await import(join(repo, "apps/mac/scripts/diff.mjs"));
const spec = JSON.parse(readFileSync(join(repo, "packages/design-tokens/match/specimens.json"), "utf8"));
const threshold = { ...spec.threshold, sizeSlack: 1 };
const browser = await webkit.launch();
const results = await diffAll(browser, outDir, screens.flatMap((s) => ["light", "dark"].map((scheme) => ({ id: s.id, scheme }))), threshold);
await browser.close();
writeReport(outDir, { title: "iPhone screens", note: "Whole screens in the Simulator, one seeded scratch library; the status bar and home indicator are left out.", threshold, results });
