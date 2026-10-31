#!/usr/bin/env node
// Folevi's menus, web vs native (docs/MAC_REBUILD_PLAN.md section 3.3: "menus and their order"): the same right
// click or click in the web frame (FOLEVI_WEB_FRAME=1) and in the native frame of the Debug app, on screens.mjs'
// scratch library, light and dark. For each menu: its rows as text (titles, shortcuts, checkmarks, separators,
// disabled and destructive rows), which must be the same, and its panel as a picture, diffed as screens.mjs does.
//
//   node apps/mac/scripts/menus.mjs [--only card,folder] [--size 1280x820]
//
// Run screens.mjs --fresh once first (it makes the library and its fixture notes). The web frame is measured first:
// where each target is (its element's centre) is where the native frame is clicked. Nothing here touches the
// installed app, its folder, its Keychain or the owner's library. Report in apps/mac/screens-report/menus.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { command, evaluate, launch, waitFor } from "./mac.mjs";
import { diffAll, writeReport } from "./diff.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const MAC = resolve(here, "..");
const repo = resolve(MAC, "../..");
const require = createRequire(join(repo, "apps/web/package.json"));
const { webkit } = require("@playwright/test");

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const [width, height] = (arg("--size") ?? "1280x820").split("x").map(Number);
const only = arg("--only")?.split(",");
const dir = join(MAC, "build", "run", "screens");
const library = join(MAC, "build", "run", "screens-library");
const out = join(MAC, "screens-report", "menus");

/** The element each menu opens from, in the web frame (a script returning it), and how: a right click or a click. */
const TARGETS = [
  // A note card on Home (HomeDashboard: the DocMenu without Select or Move up / down).
  { id: "card", link: "folevi-dev://documents", how: "rightClick", el: `return document.querySelector("main#main section [data-card-menu]")?.closest("li") ?? document.querySelector("main#main section ul li")` },
  // A note row in All notes as a list (DocumentBrowser's DocMenu).
  { id: "notes-card", link: "folevi-dev://notes", how: "rightClick", el: `return document.querySelector("main#main ul.grid > li") ?? document.querySelector("main#main ul > li")` },
  // A folder in the sidebar (FolderMenu).
  { id: "sidebar-folder", link: "folevi-dev://documents", how: "rightClick", el: `return [...document.querySelectorAll("nav a[href^='/folders/']")].find((a) => a.textContent.trim() === "Projects")` },
  // A folder card on the Folders page (FolderMenu).
  { id: "folder-card", link: "folevi-dev://folders", how: "rightClick", el: `return document.querySelector("main#main ul.grid > li") ?? document.querySelector("main#main [data-ctx-host]")` },
  // The sidebar's own menu (SidebarMenu), off a note.
  { id: "sidebar-menu", link: "folevi-dev://documents", how: "click", el: `return document.querySelector("nav button[aria-label='Sidebar']") ?? document.querySelector("button[aria-label='Sidebar']")` },
  // A tab (TabStrip's tab menu): All notes' tab.
  { id: "tab", link: "folevi-dev://notes", how: "rightClick", el: `return [...document.querySelectorAll("[data-tab]")].find((t) => t.textContent.includes("All notes"))` },
  // Empty space on Home (AppContextMenu's anywhere menu).
  { id: "anywhere", link: "folevi-dev://documents", how: "rightClick", point: { x: 980, y: 100 } },
  // A task row (TasksView's task menu).
  { id: "task", link: "folevi-dev://tasks/all", how: "rightClick", el: `return document.querySelector("main#main [data-task-row]") ?? document.querySelector("main#main li [role=checkbox]")?.closest("li")` },
];

const STILL = `if (!document.getElementById("__screensStill")) { const s = document.createElement("style"); s.id = "__screensStill"; s.textContent = "*, *::before, *::after { animation: none !important; transition: none !important; }"; document.documentElement.appendChild(s); } return true;`;

/** The open web menu: its rows in WebMenuWindow.rows' form and its panel's rect. */
const WEB_MENU = `
  const menu = [...document.querySelectorAll("[role=menu]")].filter((m) => m.matches(":popover-open") || m.getBoundingClientRect().width > 0).pop();
  if (!menu) return { open: false };
  const rows = [];
  for (const el of menu.querySelectorAll("[role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=separator], .ui-caps")) {
    if (el.getAttribute("role") === "separator") { rows.push("—"); continue; }
    if (el.classList.contains("ui-caps")) { rows.push("# " + el.textContent.trim()); continue; }
    const label = el.querySelector("[data-menu-part=label] .block, [data-menu-part=label]")?.textContent.trim() ?? el.textContent.trim();
    let t = label;
    const k = el.querySelector("[data-menu-part=shortcut]")?.textContent.trim();
    if (k) t += " [" + k + "]";
    if (el.getAttribute("aria-checked") === "true" || el.querySelector("[data-menu-part=check] svg")) t += " ✓";
    if (el.disabled || el.getAttribute("aria-disabled") === "true") t += " (off)";
    if (el.className.includes("!text-danger") || el.hasAttribute("data-danger")) t += " (danger)";
    rows.push(t);
  }
  const r = menu.getBoundingClientRect();
  return { open: true, rows, rect: { x: r.left, y: r.top, width: r.width, height: r.height } };`;

// Escape on each open menu (its own key handler closes it), then a press outside for any other popover.
const CLOSE_WEB = `for (const m of document.querySelectorAll("[role=menu]")) m.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 1, clientY: 1 })); document.activeElement?.blur?.(); await new Promise((r) => setTimeout(r, 200)); return document.querySelectorAll("[role=menu]").length`;

const ensure = (r) => {
  if (r && r.error) throw new Error(r.error);
  return r?.value;
};

/** Cuts `rect` (points; the picture is 2x) out of a picture, into `to`. */
async function crop(browser, from, rect, to) {
  const page = await browser.newPage();
  const png = await page.evaluate(async ({ url, r }) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = Math.round(r.width * 2);
    c.height = Math.round(r.height * 2);
    c.getContext("2d").drawImage(img, Math.round(r.x * 2), Math.round(r.y * 2), c.width, c.height, 0, 0, c.width, c.height);
    return c.toDataURL("image/png").split(",")[1];
  }, { url: `data:image/png;base64,${readFileSync(from).toString("base64")}`, r: rect });
  await page.close();
  writeFileSync(to, Buffer.from(png, "base64"));
}

const targets = TARGETS.filter((t) => !only || only.includes(t.id));
for (const d of ["web", "native", "diff"]) {
  rmSync(join(out, d), { recursive: true, force: true });
  mkdirSync(join(out, d), { recursive: true });
}
if (!existsSync(join(dir, "fixture.json"))) throw new Error("Run screens.mjs --fresh first (no scratch library).");

const points = {};
const rows = {};
const browser = await webkit.launch();
for (const kind of ["web", "native"]) {
  await launch({ dir, env: { FOLEVI_TEST_FOLDER: library, FOLEVI_FAKE_AI: "1", ...(kind === "web" ? { FOLEVI_WEB_FRAME: "1" } : {}) } });
  await waitFor(dir, kind === "web" ? `return document.readyState === "complete" && !!document.querySelector('nav[aria-label="Folio"]')` : `return !!window.__foleviEngine`, 90_000);
  await sleep(2000);
  for (const scheme of ["light", "dark"]) {
    ensure(await command(dir, { cmd: "appearance", value: scheme }));
    for (const t of targets) {
      const key = `${t.id}-${scheme}`;
      ensure(await command(dir, { cmd: "resize", width, height }));
      ensure(await command(dir, { cmd: "open", url: t.link }));
      await sleep(1600);
      if (kind === "web") {
        await evaluate(dir, STILL).catch(() => undefined);
        const at = t.point ?? (await evaluate(dir, `const el = (() => { ${t.el} })(); if (!el) return null; el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`));
        if (!at) {
          console.warn(`${key}: no ${t.id} in the web frame`);
          continue;
        }
        points[key] = at;
        await evaluate(dir, t.how === "click"
          ? `const el = document.elementFromPoint(${at.x}, ${at.y}); const b = el?.closest("button") ?? el; b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: ${at.x}, clientY: ${at.y} })); b.click(); return true`
          : `const el = document.elementFromPoint(${at.x}, ${at.y}); el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: ${at.x}, clientY: ${at.y}, button: 2 })); return true`);
        await sleep(500);
        const m = await evaluate(dir, WEB_MENU);
        rows[key] = { ...(rows[key] ?? {}), web: m.open ? m.rows : null };
        if (m.open) {
          const shot = join(out, "web", `${key}-window.png`);
          ensure(await command(dir, { cmd: "windowShot", out: shot }, 60_000));
          await crop(browser, shot, m.rect, join(out, "web", `${key}.png`));
          rmSync(shot, { force: true });
        }
        await evaluate(dir, CLOSE_WEB).catch(() => undefined);
      } else {
        const at = points[key];
        if (!at) continue;
        const m = ensure(await command(dir, { cmd: "menus", do: t.how, x: at.x, y: at.y }));
        rows[key] = { ...(rows[key] ?? {}), native: m?.open ? m.rows : null };
        if (m?.open) ensure(await command(dir, { cmd: "menus", do: "shot", out: join(out, "native", `${key}.png`) }));
        await command(dir, { cmd: "menus", do: "close" });
      }
      await sleep(300);
    }
  }
  await command(dir, { cmd: "quit" }).catch(() => undefined);
  await sleep(1500);
}

const threshold = { channel: 24, radius: 1, maxRatio: 0.01 };
const items = targets.flatMap((t) => ["light", "dark"].map((scheme) => ({ id: t.id, scheme })));
const results = await diffAll(browser, out, items, threshold);
await browser.close();
let same = true;
for (const r of results) {
  const k = rows[`${r.id}-${r.scheme}`] ?? {};
  const a = JSON.stringify(k.web ?? null);
  const b = JSON.stringify(k.native ?? null);
  r.rowsMatch = a === b;
  if (!r.rowsMatch) {
    same = false;
    r.reason = [r.reason, `rows differ: web ${a} | native ${b}`].filter(Boolean).join("; ");
  }
}
writeFileSync(join(out, "rows.json"), JSON.stringify(rows, null, 2));
writeReport(out, { title: "Menus: web vs Folevi for Mac", note: `The same right click or click in both frames, ${width} x ${height} pt; rows compared as text, panels as pictures.`, threshold, results, imageWidth: 300 });
for (const r of results) console.log(`${r.rowsMatch ? "rows ok  " : "ROWS DIFF"} ${r.pass ? "pass" : "FAIL"} ${r.id} ${r.scheme} ${r.ratio === undefined ? "" : `${(r.ratio * 100).toFixed(2)}%`}${r.reason ? ` ${r.reason}` : ""}`);
process.exit(same && results.every((r) => r.pass) ? 0 : 1);
