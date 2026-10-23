// How much memory Folevi for Mac keeps in a realistic setup (docs/MAC_WEBKIT_PLAN.md "Memory"): not a pass or fail
// test, a measurement. It sets the native Debug app up as someone who uses it all day would have it (a library and
// two accounts, so two places in the background; three windows, one with several notes in tabs, one of them with a
// flowchart and a whiteboard; Quick Add and Settings opened and closed), lets it settle, then puts a footprint on
// every process (the app, each page's WebKit content process, WebKit's GPU and networking processes), idle and while
// typing, and writes them to the file E2E_MAC_MEMORY names.
//
//   E2E_MAC_MEMORY=/tmp/memory.json E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 \
//     npx playwright test e2e/mac-memory.spec.ts --project account --workers=1
//
// E2E_MAC_APP: the app (default apps/mac's Debug build); E2E_MAC_SHELL_DIR: the built-in interface it shows (default
// its own); E2E_MAC_MEMORY_SETTLE: seconds to wait before measuring (default 90, longer than anything the app lets go
// of after a while); E2E_MAC_MEMORY_KEEP=1 leaves the app running.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, request as playwrightRequest, test, type Browser } from "@playwright/test";
import { APP, newPerson } from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const out = process.env.E2E_MAC_MEMORY;
const macApp = process.env.E2E_MAC_APP ?? join(repo, "apps/mac/build/DerivedData/Build/Products/Debug/Folevi Dev.app");
const shellDir = process.env.E2E_MAC_SHELL_DIR;
const settle = Number(process.env.E2E_MAC_MEMORY_SETTLE ?? 90);

interface Mac {
  evaluate(dir: string, script: string, window?: number): Promise<unknown>;
  command(dir: string, request: Record<string, unknown>): Promise<unknown>;
  waitFor(dir: string, script: string, timeoutMs?: number): Promise<unknown>;
}
const mac = async (): Promise<Mac> => (await import(/* @vite-ignore */ pathToFileURL(join(repo, "apps/mac/scripts/mac.mjs")).href)) as Mac;

test.skip(!out || process.platform !== "darwin" || !existsSync(macApp), "A measurement: set E2E_MAC_MEMORY to the file for the numbers (macOS, the Debug build of apps/mac).");

const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A new test account and a session for the app (the sign-in its sheet would do: /connect approved, the code traded). */
async function account(browser: Browser, name: string) {
  const person = await newPerson(browser, name);
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const q = new URLSearchParams({ client_id: "folevi-shell", redirect_uri: "folevi://auth/callback", code_challenge: challenge, code_challenge_method: "S256", state: "s1" });
  await person.page.goto(`${APP}/connect?${q}`);
  await expect(person.page.getByRole("heading", { name: "Sign in to Folevi app" })).toBeVisible({ timeout: 30_000 });
  const authorized = person.page.waitForResponse((r) => r.url().includes("/api/auth/native/authorize"));
  await person.page.getByRole("button", { name: "Continue" }).click();
  const { code } = (await (await authorized).json()) as { code: string };
  const api = await playwrightRequest.newContext();
  const res = await api.post(`${APP}/api/auth/native/token`, { data: { grant_type: "authorization_code", code, code_verifier: verifier, client_id: "folevi-shell", redirect_uri: "folevi://auth/callback", device_name: "E2E Mac memory" } });
  expect(res.status()).toBe(200);
  return { person, token: ((await res.json()) as { access_token: string }).access_token };
}

// In the page: waits, keys, and the editor's slash menu (the same steps a person takes, through DOM events).
const PAGE_KIT = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = f(); if (v) return v; await sleep(100); } throw new Error("timed out: " + f); };
  const key = (el, k) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: k, bubbles: true, cancelable: true }));
  const newNote = async (title, body) => {
    [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "New note").click();
    const field = await until(() => /^\\/d\\//.test(location.pathname) && document.activeElement && document.activeElement.tagName === "TEXTAREA" && document.activeElement);
    document.execCommand("insertText", false, title);
    await sleep(300);
    key(field, "Enter");
    await until(() => document.activeElement && document.activeElement.isContentEditable);
    document.execCommand("insertText", false, body);
    await sleep(300);
  };
  const block = async (word, name, done) => {
    document.querySelector(".ProseMirror").editor.chain().focus("end").insertContent({ type: "paragraph" }).focus("end").run();
    await sleep(300);
    document.execCommand("insertText", false, "/" + word);
    const opt = await until(() => [...document.querySelectorAll('[role="option"]')].find((o) => name.test(o.textContent)));
    opt.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    opt.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    opt.click();
    await until(done, 30000);
  };
`;

/** Footprint (MB) of a process, from `footprint` (the number Activity Monitor's Memory column shows). */
function footprintMB(pid: number): number | null {
  try {
    const text = execFileSync("footprint", ["-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const m = /Footprint:\s*([\d.]+)\s*([KMG])B/.exec(text);
    return m ? Math.round(Number(m[1]) * (m[2] === "G" ? 1024 : m[2] === "K" ? 1 / 1024 : 1) * 10) / 10 : null;
  } catch {
    return null;
  }
}

interface Snapshot {
  app: number;
  views: { role: string; place: string | null; url: string; pid: number; inWindow: boolean; visible: boolean; panel: string }[];
  helpers: { pid: number; name: string }[];
}

/** Every process of the app with what it's for and its footprint, and the total. */
function measure(snap: Snapshot) {
  const rows: { process: string; pid: number; mb: number | null }[] = [{ process: "app", pid: snap.app, mb: footprintMB(snap.app) }];
  const byPid = new Map<number, string[]>();
  for (const v of snap.views) {
    if (!v.pid) continue;
    const path = v.url.replace(/^app:\/\/folevi/, "") || "(blank)";
    const what = v.panel ? v.panel : v.role === "main" ? `window ${path}` : v.role === "runner" ? `runner ${v.place}` : `${v.role} ${path}`;
    byPid.set(v.pid, [...(byPid.get(v.pid) ?? []), what]);
  }
  for (const [pid, what] of byPid) rows.push({ process: `WebContent (${what.join(", ")})`, pid, mb: footprintMB(pid) });
  for (const h of snap.helpers) {
    if (byPid.has(h.pid)) continue;
    const name = h.name.replace("com.apple.WebKit.", "");
    // A content process with no page: WebKit's spare or cached one.
    rows.push({ process: name.startsWith("WebContent") ? `${name} (no page)` : name, pid: h.pid, mb: footprintMB(h.pid) });
  }
  const total = Math.round(rows.reduce((t, r) => t + (r.mb ?? 0), 0) * 10) / 10;
  return { total, rows };
}

test("memory in a realistic setup, per process, idle and typing", async ({ browser }) => {
  test.setTimeout(20 * 60_000);
  const a = await account(browser, "Mac Memory One");
  const b = await account(browser, "Mac Memory Two");
  const m = await mac();
  const dir = mkdtempSync(join(tmpdir(), "folevi-mac-memory-"));
  const library = join(dir, "library");
  mkdirSync(library, { recursive: true });
  // Through LaunchServices (`open`), so the app is responsible for its WebKit processes and `cmd memory` lists every
  // one of them, kept and cached ones included (started from a script, the script's app would be).
  const env = { FOLEVI_USER_DATA: dir, FOLEVI_URL: APP, FOLEVI_TEST_FOLDER: library, ...(shellDir ? { FOLEVI_SHELL_DIR: shellDir } : {}) };
  execFileSync("open", ["-n", "-a", macApp, ...Object.entries(env).flatMap(([k, v]) => ["--env", `${k}=${v}`])]);
  await expect.poll(() => existsSync(join(dir, "Debug", "app.json")), { timeout: 60_000 }).toBe(true);
  await m.waitFor(dir, "return (window.foleviDesktop ? 1 : 0) && document.readyState === 'complete'", 60_000);
  const run = (body: string, window?: number) => m.evaluate(dir, body, window);
  const cmd = async (name: string, request: Record<string, unknown> = {}) => {
    const r = (await m.command(dir, { cmd: name, ...request })) as { value?: unknown; error?: string };
    if (r.error) throw new Error(r.error);
    return r.value as Record<string, unknown>;
  };
  const until = (body: string, timeoutMs = 60_000) => m.waitFor(dir, body, timeoutMs);
  const timeline: { at: number; what: string }[] = [];
  const started = Date.now();
  const mark = (what: string) => timeline.push({ at: Math.round((Date.now() - started) / 1000), what });
  try {
    // The library on this Mac (a folder of the test's own), then the two accounts: the first open, the second a place
    // in the background.
    await until(`return document.body.innerText.includes("Where should your notes live?")`);
    const info = (await run(`return await foleviShell.library.setup({ kind: "folder" })`)) as { displayPath?: string };
    expect(String(info.displayPath)).toContain(library.split("/").pop()!);
    await run(`await foleviShell.setMode("local"); return true;`);
    await until(`return window.foleviShell && foleviShell.places && foleviShell.places.current === "library" && !!document.querySelector('nav[aria-label="Folio"]')`);
    const one = String(await cmd("test-session", { token: a.token }));
    await until(`return window.foleviShell && foleviShell.places.current === ${JSON.stringify(one)} && !!document.querySelector('nav[aria-label="Folio"]')`);
    await cmd("test-session", { token: b.token, open: false });
    mark("library and two accounts");

    // Notes in tabs: one with a flowchart and a whiteboard, three plain ones.
    await run(`${PAGE_KIT}
      await newNote("Plans", "A flowchart and a whiteboard below.");
      await block("flowchart", /Flowchart/, () => document.querySelector('[role="application"][aria-label*="Flowchart"]'));
      await block("whiteboard", /Whiteboard/, () => document.querySelector(".fb-whiteboard svg.fb-whiteboard-canvas"));
      return true;`);
    for (const title of ["Meeting notes", "Reading list", "Ideas"]) await run(`${PAGE_KIT} await newNote(${JSON.stringify(title)}, "Some text for ${title}."); return true;`);
    // Back on the note with the canvases (the others stay open in their tabs).
    await run(`${PAGE_KIT} [...document.querySelectorAll("a,button")].find((e) => e.innerText.trim() === "Plans").click(); await until(() => document.querySelector(".fb-whiteboard")); return true;`);
    mark("four notes in tabs, the first with a flowchart and a whiteboard");

    // Two more windows.
    await cmd("newWindow", { path: "/tasks" });
    await cmd("newWindow", { path: "/calendar" });
    await sleep(5000);
    mark("three windows");

    // Quick Add and Settings, opened and closed.
    await cmd("quickAdd", { action: "show" });
    await expect.poll(async () => (await cmd("quickAdd")).loaded, { timeout: 30_000 }).toBe(true);
    await sleep(2000);
    await cmd("quickAdd", { action: "hide" });
    await cmd("settings", { action: "show", section: "appearance" });
    await sleep(4000);
    await cmd("settings", { action: "close" });
    mark("Quick Add and Settings opened and closed");

    const result: Record<string, unknown> = { at: new Date().toISOString(), app: macApp, shell: shellDir ?? null, settleSeconds: settle, timeline };
    result.afterSetup = measure((await cmd("memory")) as unknown as Snapshot);
    await sleep(settle * 1000);
    mark("settled");
    const idle = [];
    for (let i = 0; i < 3; i++) {
      idle.push(measure((await cmd("memory")) as unknown as Snapshot));
      await sleep(10_000);
    }
    result.idle = idle;

    // Typing into the note in the first window: a character every 120 ms.
    const windows = (await cmd("windows")) as unknown as { index: number; url: string }[];
    const first = windows.find((w) => /\/d\//.test(w.url))?.index ?? 0;
    await run(`const ed = document.querySelector(".ProseMirror"); ed.editor.commands.focus("end"); const words = "the quick brown fox jumps over the lazy dog ".split(""); let i = 0; window.__memTyping = setInterval(() => document.execCommand("insertText", false, words[i++ % words.length]), 120); return true;`, first);
    await sleep(20_000);
    const typing = [];
    for (let i = 0; i < 3; i++) {
      typing.push(measure((await cmd("memory")) as unknown as Snapshot));
      await sleep(5000);
    }
    await run(`clearInterval(window.__memTyping); return true;`, first);
    result.typing = typing;
    mark("typed");
    // When the places' runners woke and went (BackgroundSync).
    result.background = ((await cmd("places")) as { background?: unknown }).background ?? null;
    writeFileSync(out!, JSON.stringify(result, null, 2));
    const avg = (xs: { total: number }[]) => Math.round(xs.reduce((t, x) => t + x.total, 0) / xs.length);
    console.log(`memory: after setup ${(result.afterSetup as { total: number }).total} MB, idle ${avg(idle)} MB, typing ${avg(typing)} MB -> ${out}`);
  } finally {
    if (!process.env.E2E_MAC_MEMORY_KEEP) await m.command(dir, { cmd: "quit" }).catch(() => undefined);
    await a.person.context.close();
    await b.person.context.close();
    if (process.env.E2E_MAC_MEMORY_KEEP) console.log(`left running on ${dir}; read ${readFileSync(join(dir, "Debug", "app.json"), "utf8")}`);
  }
});
