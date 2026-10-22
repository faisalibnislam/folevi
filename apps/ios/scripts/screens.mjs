// Screenshots every screen of the iOS app in a Simulator, light and dark (docs/IOS_POLISH_PLAN.md): a Debug
// build of the built-in interface in local mode with the starter library, driven through simulator.mjs eval.
//   node scripts/screens.mjs "<booted device name>" <out dir> [only,these,screens]
// NOTE=/d/<id> and FOLDER=/folders/<id> pick the note and folder (another device's library has other ids).
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const IOS = join(dirname(fileURLToPath(import.meta.url)), "..");
const [device, out, only] = process.argv.slice(2);
const booted = Object.values(JSON.parse(execFileSync("xcrun", ["simctl", "list", "devices", "-j"], { encoding: "utf8" })).devices).flat().find((d) => d.name === device && d.state === "Booted");
if (!booted) throw new Error(`No booted Simulator called ${device}`);
const udid = booted.udid;
const sleep = (ms) => execFileSync("sleep", [String(ms / 1000)]);
const evalJs = (js) => {
  try {
    return execFileSync("node", ["scripts/simulator.mjs", "eval", js, device], { cwd: IOS, encoding: "utf8" }).trim();
  } catch (e) {
    return String(e.stdout ?? e);
  }
};
// A page is ready once its screen has a title and nothing is loading (on a busy Mac the dev server can take
// far longer than a fixed wait; a click before then finds nothing to open).
const ready = () => evalJs(`return !!document.querySelector("main h1, h1") && !document.querySelector("[aria-busy=true]") && document.readyState === "complete"`).includes("true");
const go = (path) => {
  evalJs(`location.href = ${JSON.stringify(path)}; return 1`);
  sleep(1500);
  for (let i = 0; i < 40 && !ready(); i++) sleep(500);
  sleep(800);
};
// element.click() opens the app's menus and sheets in the Simulator's WebKit (checked on the combined build,
// 2026-10-22). A menu button that didn't open (the page was still settling) is clicked once more.
const click = (selectorJs) => {
  const run = () => evalJs(`const el = (${selectorJs}); if (!el) return "missing"; el.click(); await new Promise((r) => setTimeout(r, 350)); return el.getAttribute("aria-haspopup") && el.getAttribute("aria-expanded") === "false" ? "closed" : "ok"`);
  const first = run();
  if (/missing|closed/.test(first)) {
    sleep(1000);
    return run();
  }
  return first;
};
const byLabel = (label) => `[...document.querySelectorAll("button[aria-label], a[aria-label]")].filter(b => b.getBoundingClientRect().width > 0).find(b => b.getAttribute("aria-label") === ${JSON.stringify(label)})`;
const byText = (text, sel = "button, a, [role=menuitem], [role=menuitemradio]") => `[...document.querySelectorAll(${JSON.stringify(sel)})].filter(b => b.getBoundingClientRect().width > 0).find(b => b.textContent.trim().startsWith(${JSON.stringify(text)}))`;

// The library's own notes and folder (ids differ per library): the first ones Home links to, unless given.
go("/documents");
const links = JSON.parse(evalJs(`return [...new Set([...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")))]`) || "{}").value ?? [];
const notes = links.filter((h) => /^\/d\/[0-9A-Z]{26}$/.test(h));
const NOTE = process.env.NOTE ?? notes[0] ?? "/notes";
const TABLE = process.env.TABLE ?? notes[1] ?? NOTE;
const TRIP = process.env.TRIP ?? notes[2] ?? NOTE;
const FOLDER = process.env.FOLDER ?? links.find((h) => h.startsWith("/folders/")) ?? "/folders";

const screens = [
  ["home", () => go("/documents")],
  ["home-bottom", () => (go("/documents"), evalJs("document.querySelector('[data-iphone-scroll], main')?.scrollTo(0, 99999); window.scrollTo(0, 99999); return 1"), sleep(600))],
  ["home-plus-menu", () => (go("/documents"), click(byLabel("Create")), sleep(700))],
  ["home-more-menu", () => (go("/documents"), click(byLabel("More")), sleep(700))],
  ["account-sheet", () => (go("/documents"), click(`[...document.querySelectorAll("button")].find(b => (b.getAttribute("aria-label") || "").endsWith("account and places"))`), sleep(900))],
  ["search", () => (go("/documents"), click(`[...document.querySelectorAll("button")].find(b => b.textContent.trim().startsWith("Search in"))`), sleep(900))],
  ["notes-cards", () => go("/notes")],
  ["notes-list", () => (go("/notes"), click(`[...document.querySelectorAll("button[aria-haspopup=menu]")].find(b => b.getBoundingClientRect().top < 120)`), sleep(500), click(byText("List")), sleep(800))],
  ["notes-select", () => (go("/notes"), click(byText("Select", "button")), sleep(700))],
  ["note-card-longpress", () => (go("/notes"), evalJs(`const li = document.querySelector("main li [href^='/d/']"); const r = li.getBoundingClientRect(); li.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 })); return 1`), sleep(800))],
  ["drafts", () => go("/drafts")],
  ["starred-empty", () => go("/starred")],
  ["folders", () => go("/folders")],
  ["folder", () => go(FOLDER)],
  ["folder-more-menu", () => (go(FOLDER), click(`[...document.querySelectorAll("button[aria-haspopup=menu]")].find(b => b.getBoundingClientRect().top < 120)`), sleep(700))],
  ["templates", () => go("/templates")],
  ["archive-empty", () => go("/archive")],
  ["trash", () => go("/trash")],
  ["note", () => go(NOTE)],
  ["note-scrolled", () => (go(NOTE), evalJs("document.querySelector('main')?.scrollTo(0, 900); return 1"), sleep(600))],
  ["note-actions-menu", () => (go(NOTE), click(byLabel("Document actions")), sleep(700))],
  ["note-keyboard", () => (go(TRIP), evalJs(`const p = document.querySelector("[contenteditable=true] p"); p?.focus(); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); p?.dispatchEvent(new MouseEvent("click", { bubbles: true })); return !!p`), sleep(1500))],
  ["note-insert", () => (go(NOTE), click(byLabel("Insert")), sleep(900))],
  ["note-format", () => (go(NOTE), click(byLabel("Format")), sleep(900))],
  ["note-style", () => (go(NOTE), click(byLabel("Style")), sleep(1200))],
  ["note-foli", () => (go(NOTE), click(byLabel("Foli AI")), sleep(1200))],
  ["note-share", () => (go(NOTE), click(byLabel("Share")), sleep(900))],
  ["note-block-longpress", () => (go(NOTE), evalJs(`const p = document.querySelector("[contenteditable=true] p"); const r = p.getBoundingClientRect(); p.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.x + 30, clientY: r.y + r.height / 2 })); return 1`), sleep(800))],
  ["note-table", () => go(TABLE)],
  ["note-trip", () => go(TRIP)],
  ["tasks-today", () => go("/tasks/today")],
  ["tasks-upcoming", () => go("/tasks/upcoming")],
  ["tasks-quick-add", () => (go("/tasks/today"), click(byLabel("Quick task")), sleep(900))],
  ["calendar", () => go("/calendar")],
  ["foli-ai", () => (go("/documents"), click(`[...document.querySelectorAll("button[aria-label='Foli AI'], a[aria-label='Foli AI'], button")].filter(b => b.getBoundingClientRect().width > 0).reverse().find(b => (b.getAttribute("aria-label") || b.textContent.trim()).includes("Foli AI"))`), sleep(1500))],
  ["settings", () => go("/settings")],
  ["settings-library", () => go("/settings/library")],
  ["settings-ai", () => go("/settings/ai")],
  ["settings-appearance", () => go("/settings/appearance")],
  ["settings-data", () => go("/settings/data")],
  ["settings-this-device", () => go("/settings/this-device")],
];

const wanted = only ? new Set(only.split(",")) : null;
for (const appearance of ["light", "dark"]) {
  execFileSync("xcrun", ["simctl", "ui", udid, "appearance", appearance]);
  const dir = join(out, appearance);
  mkdirSync(dir, { recursive: true });
  for (const [name, setup] of screens) {
    if (wanted && !wanted.has(name)) continue;
    setup();
    sleep(400);
    execFileSync("xcrun", ["simctl", "io", udid, "screenshot", "--type=jpeg", join(dir, `${name}.jpg`)], { stdio: "ignore" });
    // Close whatever opened (a menu, a sheet) before the next screen.
    evalJs(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); document.activeElement?.blur?.(); return 1`);
    console.log(appearance, name);
  }
}
execFileSync("xcrun", ["simctl", "ui", udid, "appearance", "light"]);
