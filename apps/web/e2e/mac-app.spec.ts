// Folevi for Mac on WebKit (apps/mac, docs/MAC_WEBKIT_PLAN.md §5.1, package WM1): the native Debug app, driven
// through its eval hook (apps/mac/scripts/mac.mjs, each run on a data folder of its own).
//   1. Parity: the answers the page reads from foleviShell have the shape and values the Electron app gave
//      (recorded in fixtures/mac-parity-electron.json from Electron 44 before it was removed, the same script on a
//      folder library), apart from the few listed where the native app does more.
//   2. Local mode: the first-launch choice, a library on this Mac, the mode switch loads the window again in the
//      library, a note written, the app killed while the journal holds the last edit, the next launch replays it.
//   3. Account mode and two places: a test account approved on the website's /connect, its session handed to the
//      app (the sign-in sheet itself can't be driven from a script); the page opens signed in, a note made in the
//      app reaches the website, Convex tokens come; the library is a second place whose runner wakes when it goes
//      into the background, runs at full speed with the app hidden while it's up, goes once its work is done and
//      wakes again for the next catch-up (BackgroundSync.swift), and a switch opens it in the window.
//   4. The window and its chrome: the page is marked as the Mac app, the window buttons sit on the page's spot
//      (and follow it when the sidebar hides), Settings > Desktop app's switches reach the app, File > New Note,
//      folevi-dev:// links (others ignored), Quick Add's panel adds to the library, Vision reads an image's words.
//   5. Every window, one library: Quick Add with the app hidden, File > New Window writing to the same library,
//      the first window seeing it, and all of it in the folder on disk.
//   6. A note's editor goes once the note is left, even when it was focused while Folevi was hidden (tiptap's focus
//      waited for a frame a hidden page never draws, components/editor/safeFocus.ts): collected after a full
//      garbage collection.
//
// Needs macOS, the Debug build (`node apps/mac/scripts/build.mjs`, or E2E_MAC_APP=<path to Folevi Dev.app>) and the
// shell export in apps/mac/web pointing at the dev server (`node apps/web/scripts/build-shell.mjs`).
// E2E_MAC_RUNNER_SECONDS sets how long 3 watches the runner (default 20).
//   E2E_BASE_URL=http://app.localhost:3002 E2E_NO_SERVER=1 npx playwright test e2e/mac-app.spec.ts --project account --workers=1
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, request as playwrightRequest, test } from "@playwright/test";
import { APP, newPerson } from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const shellDir = join(repo, "apps/mac/web");
const macApp = process.env.E2E_MAC_APP ?? join(repo, "apps/mac/build/DerivedData/Build/Products/Debug/Folevi Dev.app");
const macReady = process.platform === "darwin" && existsSync(macApp) && existsSync(join(shellDir, "index.html"));

/** apps/mac/scripts/mac.mjs (plain JavaScript, loaded by its address). */
interface Mac {
  launch(o: { dir: string; app?: string; env?: Record<string, string> }): Promise<{ pid: number }>;
  evaluate(dir: string, script: string): Promise<unknown>;
  command(dir: string, request: Record<string, unknown>): Promise<unknown>;
  waitFor(dir: string, script: string, timeoutMs?: number): Promise<unknown>;
}
const macScripts = pathToFileURL(join(repo, "apps/mac/scripts/mac.mjs")).href;
const mac = async (): Promise<Mac> => (await import(/* @vite-ignore */ macScripts)) as Mac;

test.describe.configure({ mode: "serial" });
test.skip(!macReady, "Needs macOS, the Debug build of apps/mac and the shell export in apps/mac/web.");

/** Starts the native app on a fresh data folder. */
async function launchMac(env: Record<string, string> = {}) {
  const m = await mac();
  const dir = mkdtempSync(join(tmpdir(), "folevi-mac-e2e-"));
  await m.launch({ dir, app: macApp, env: { FOLEVI_URL: APP, ...env } });
  const run = (body: string) => m.evaluate(dir, body);
  const cmd = async (name: string, request: Record<string, unknown> = {}) => {
    const r = (await m.command(dir, { cmd: name, ...request })) as { value?: unknown; error?: string };
    if (r.error) throw new Error(r.error);
    return r.value as Record<string, unknown>;
  };
  const until = (body: string, timeoutMs = 30_000) => m.waitFor(dir, body, timeoutMs);
  const quit = async () => {
    await m.command(dir, { cmd: "quit" }).catch(() => undefined);
    const pid = (JSON.parse(readFileSync(join(dir, "Debug", "app.json"), "utf8")) as { pid: number }).pid;
    await expect.poll(() => alive(pid), { timeout: 15_000 }).toBe(false);
  };
  return { m, dir, run, cmd, until, quit };
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Clicks the first button or link whose text is `text` (the first-launch screens). */
const click = (text: string) =>
  `const want = ${JSON.stringify(text)}; const el = [...document.querySelectorAll("button,a,[role=button]")].find((e) => e.innerText.trim().startsWith(want)); if (!el) return false; el.click(); return true;`;

/**
 * What the page reads from foleviShell, as plain values: run in both apps, in a page that has just set up a
 * library on this device and opened it. Self-contained (it's sent to the page as text).
 */
async function parity() {
  // The page's own object, called the way the page calls it (lib/shell/types.ts is the contract being checked).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const S = (window as unknown as { foleviShell: any }).foleviShell;
  const shape = (v: unknown): unknown =>
    v === null ? "null" : Array.isArray(v) ? (v.length ? [shape(v[0])] : []) : v instanceof Uint8Array ? `bytes` : typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, shape((v as Record<string, unknown>)[k])])) : typeof v;
  const err = async (p: Promise<unknown>) => {
    try {
      const v = await p;
      return { resolved: shape(v) };
    } catch (e) {
      const x = e as { name?: string; code?: string; message?: unknown; path?: string };
      return { name: x.name ?? null, code: x.code ?? null, message: typeof x.message === "string", path: x.path ?? null };
    }
  };
  const out: Record<string, unknown> = {};
  out.top = { platform: S.platform, initialMode: S.initialMode, deviceName: typeof S.deviceName, shellVersion: typeof S.shellVersion, places: S.places ? { current: S.places.current, background: S.places.background } : null };
  out.members = Object.keys(S).filter((k) => k !== "deviceFamily").sort();
  out.library = Object.keys(S.library).sort();
  out.journal = Object.keys(S.library.journal).sort();
  out.cloudMembers = Object.keys(S.library.cloud).sort();
  out.e2eeMembers = Object.keys(S.e2ee).sort();
  out.placesMembers = S.places ? Object.keys(S.places).sort() : null;
  out.info = shape(await S.library.info());
  const info = await S.library.info();
  out.infoValues = { kind: info.kind, configured: info.configured, encrypted: info.encrypted, locked: info.locked, available: info.available };
  out.lock = await S.lock.getSettings();
  out.e2eeSettings = await S.e2ee.settings();
  out.ai = shape(await S.ai.capabilities());
  out.aiKeys = (await S.ai.capabilities()).keys;
  out.cloud = shape(await S.library.cloud.status());
  out.secretsHas = await S.secrets.has("ai.openai");
  out.secretRefused = await err(S.secrets.set("auth.session", "x"));
  out.places = shape(await S.places.list());
  out.placesValues = (await S.places.list()).map((p: { kind: string; id: string; configured?: boolean; syncs?: string | null; unread: number; reminders: number; waiting: number }) => ({ kind: p.kind, id: p.id, configured: p.configured, syncs: p.syncs, unread: p.unread, reminders: p.reminders, waiting: p.waiting }));
  out.quickAdd = await S.places.quickAddPlace();
  out.convexToken = await S.auth.convexToken();
  out.readMissing = await err(S.library.read("notes/01J9ZDOC000000000000000999.fnote"));
  out.badPath = await err(S.library.read("../outside"));
  const path = "notes/01J9ZDOC000000000000000998.fnote";
  out.write = shape(await S.library.write(path, new Uint8Array([1, 2, 3]), { ifMatch: null }));
  out.writeAgain = shape(await S.library.write(path, new Uint8Array([1]), { ifMatch: null }));
  const read = await S.library.read(path);
  out.read = { shape: shape(read), bytes: Array.from(read.bytes as Uint8Array) };
  out.list = shape((await S.library.list("notes")).find((e: { path: string }) => e.path === path));
  out.removeMismatch = await err(S.library.remove(path, { ifMatch: "nope" }));
  await S.library.remove(path);
  out.readRemoved = await err(S.library.read(path));
  // (The page journals its own edits meanwhile: only the record added here is compared, and nothing is cut.)
  await S.library.journal.append(new Uint8Array([7, 8]));
  const records = await S.library.journal.readAll();
  out.journalHasOurs = records.some((r: Uint8Array) => r.length === 2 && r[0] === 7 && r[1] === 8);
  out.journalRecords = records.every((r: unknown) => r instanceof Uint8Array);
  out.unlockPlain = await err(S.library.unlock("anything"));
  out.conflicts = await S.library.conflictVersions(path).catch((e: { code?: string }) => ({ code: e.code }));
  out.calendarHttp = await S.http.calendar("http://example.com/a.ics");
  const keys = await S.e2ee.deviceKeys();
  out.deviceKeys = { id: (keys.deviceId as string).replace(/[0-9A-Z]{26}$/, "<ulid>"), x: keys.x25519Pub.length, ed: keys.ed25519Pub.length };
  out.sign = typeof (await S.e2ee.sign("device", '{"a":1}'));
  out.signBad = await err(S.e2ee.sign("nope", "{}"));
  out.openBad = await err(S.e2ee.open(new Uint8Array(10), "folevi/e2ee/v1/x"));
  out.lockBad = await err(S.lock.setSettings({ lockAfter: -1 }));
  out.lockRounded = await S.lock.setSettings({ lockAfter: 1000 });
  await S.lock.setSettings({ lockAfter: 0 });
  await S.e2ee.reset();
  out.placesSwitchUnknown = await err(S.places.switchTo("acct:nobody"));
  out.convexTokenOther = await S.places.convexToken("acct:nobody");
  return out;
}

test("1. the native app answers foleviShell as Electron did", async () => {
  test.setTimeout(240_000);

  // A folder library inside this test's own scratch folder (FOLEVI_TEST_FOLDER: a Debug build's "Choose a folder"
  // answer), as the recorded Electron run had.
  const scratch = mkdtempSync(join(tmpdir(), "folevi-parity-"));
  const macLib = join(scratch, "mac-library");
  mkdirSync(macLib);
  const ownLibrary = (info: { displayPath?: string } | null, dir: string) => {
    // displayPath reads "~/…" for a folder in the home folder: compare the folder's own name.
    if (!info || !String(info.displayPath ?? "").endsWith(dir.split("/").pop()!)) throw new Error(`Not the test's own library: ${JSON.stringify(info)}. Stopped before writing anything.`);
  };

  const app = await launchMac({ FOLEVI_TEST_FOLDER: macLib });
  let fromMac: Record<string, unknown> | undefined;
  try {
    await app.until(`return document.body.innerText.includes("Where should your notes live?")`, 60_000);
    ownLibrary((await app.run(`return await foleviShell.library.setup({ kind: "folder" })`)) as { displayPath?: string }, macLib);
    await app.run(`await foleviShell.setMode("local"); return true;`);
    await app.until(`return window.foleviShell && foleviShell.initialMode === "local" && document.readyState === "complete"`, 30_000);
    ownLibrary((await app.run(`return await foleviShell.library.info()`)) as { displayPath?: string }, macLib);
    fromMac = (await app.run(`return await (${parity.toString()})();`)) as Record<string, unknown>;
  } finally {
    await app.quit();
    rmSync(scratch, { recursive: true, force: true });
  }

  // Where the two differ on purpose, the same as the iPhone and iPad app (the shared Swift services):
  // - two refusals carry a code in the native app (invalid_argument) where Electron's had none;
  // - a calendar link that isn't https is refused in the iOS services' words, Electron's own differed.
  if (!fromMac) throw new Error("The app gave no answers.");
  const fromElectron = JSON.parse(readFileSync(join(here, "fixtures/mac-parity-electron.json"), "utf8")) as Record<string, unknown>;
  for (const r of [fromMac, fromElectron]) {
    for (const k of ["placesSwitchUnknown", "secretRefused"]) (r[k] as { code: unknown }).code = "(either)";
    (r.calendarHttp as { message: unknown }).message = typeof (r.calendarHttp as { message: unknown }).message;
  }
  expect(fromMac).toEqual(fromElectron);
});

test("2. local mode: the library on this Mac, the mode switch, and the journal after a crash", async () => {
  test.setTimeout(180_000);
  const app = await launchMac();
  try {
    await app.until(`return document.body.innerText.includes("Where should your notes live?")`, 60_000);
    expect(await app.run(click("Keep notes on my devices"))).toBe(true);
    await app.until(`return document.body.innerText.includes("This device only")`);
    expect(await app.run(click("This device only"))).toBe(true);
    await app.until(`return document.body.innerText.includes("Your library is ready")`);
    expect(await app.run(`return document.body.innerText`)).toContain("Folevi keeps your notes as files in");
    expect(await app.run(click("Open Folevi"))).toBe(true);
    await app.until(`return window.foleviShell && foleviShell.initialMode === "local" && foleviShell.places.current === "library"`);
    const state = await app.cmd("places");
    expect(state).toMatchObject({ current: "library", library: true, libraryConfigured: true, mode: "local", mains: ["library"] });

    // A note, then a crash while the journal holds the last edit. New note is pressed again (every 3 s at most) until
    // the note opens: a press while the first launch is still putting its starter notes in can go unanswered.
    await app.until(`if (/^\\/d\\//.test(location.pathname)) return true; if (!window.__newNoteAt || Date.now() - window.__newNoteAt > 3000) { window.__newNoteAt = Date.now(); const el = [...document.querySelectorAll("button")].find((e) => e.innerText.trim().startsWith("New note")); if (el) el.click(); } return false;`);
    await app.until(`return /^\\/d\\//.test(location.pathname) && document.activeElement && document.activeElement.tagName === "TEXTAREA"`);
    await app.run(`document.execCommand("insertText", false, "Written on WebKit"); return true;`);
    const noteId = String(await app.run(`return location.pathname.split("/")[2]`));
    await app.run(`await new Promise((r) => setTimeout(r, 2500)); const ed = document.querySelector("[contenteditable=true]"); ed.focus(); return true;`);
    const journal = join(app.dir, "library", readdirSync(join(app.dir, "library")).find((f) => f.startsWith("journal-"))!);
    const pid = (JSON.parse(readFileSync(join(app.dir, "Debug", "app.json"), "utf8")) as { pid: number }).pid;
    await app.run(`document.execCommand("insertText", false, "Kept by the journal"); return true;`);
    await expect.poll(() => statSync(journal).size, { timeout: 5_000, intervals: [10] }).toBeGreaterThan(5);
    process.kill(pid, "SIGKILL");
    // (Its eval hook's note goes with it, so the next launch starts a new app rather than waiting on this one.)
    rmSync(join(app.dir, "Debug", "app.json"), { force: true });
    const note = join(app.dir, "Documents", "Folevi Library", "notes", `${noteId}.fnote`);
    const before = existsSync(note) ? readFileSync(note, "utf8") : "";

    await app.m.launch({ dir: app.dir, app: macApp, env: { FOLEVI_URL: APP } });
    // The note by its folevi-dev:// link, as another app would open it.
    await app.cmd("open", { url: `folevi-dev://d/${noteId}` });
    await app.until(`const ed = document.querySelector("[contenteditable=true]"); return ed && ed.innerText.includes("Kept by the journal")`, 30_000);
    expect(await app.run(`return document.querySelector("textarea").value`)).toBe("Written on WebKit");
    await expect.poll(() => readFileSync(note, "utf8").includes("Kept by the journal"), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => statSync(journal).size, { timeout: 20_000 }).toBe(5);
    // (Whether the folder had the edit before the crash depends on timing; the page is what matters.)
    void before;
  } finally {
    await app.quit();
  }
});

const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

test("3. account mode and two places: signed in, a note syncs, the library's runner wakes, runs hidden and goes", async ({ browser }) => {
  test.setTimeout(300_000);
  const seconds = Number(process.env.E2E_MAC_RUNNER_SECONDS ?? 20);
  const person = await newPerson(browser, "Mac WebKit Person");
  // The sign-in the app's sheet would show: /connect approved in a browser, the code traded with its verifier.
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const q = new URLSearchParams({ client_id: "folevi-shell", redirect_uri: "folevi://auth/callback", code_challenge: challenge, code_challenge_method: "S256", state: "s1" });
  await person.page.goto(`${APP}/connect?${q}`);
  await expect(person.page.getByRole("heading", { name: "Sign in to Folevi app" })).toBeVisible({ timeout: 30_000 });
  const authorized = person.page.waitForResponse((r) => r.url().includes("/api/auth/native/authorize"));
  await person.page.getByRole("button", { name: "Continue" }).click();
  const { code } = (await (await authorized).json()) as { code: string };
  const api = await playwrightRequest.newContext();
  const res = await api.post(`${APP}/api/auth/native/token`, { data: { grant_type: "authorization_code", code, code_verifier: verifier, client_id: "folevi-shell", redirect_uri: "folevi://auth/callback", device_name: "E2E Mac WebKit" } });
  expect(res.status()).toBe(200);
  const token = ((await res.json()) as { access_token: string }).access_token;

  // A catch-up every 20 s instead of every 10 minutes, so the runner's second wake comes within the test.
  const app = await launchMac({ FOLEVI_BACKGROUND_INTERVAL: "20" });
  try {
    // A library first (the place the account joins), then the account.
    await app.until(`return document.body.innerText.includes("Where should your notes live?")`, 60_000);
    // A Debug build keeps "This device only" inside its own data folder (Paths.documentsFolder), never ~/Documents.
    const lib = (await app.run(`return await foleviShell.library.setup({ kind: "device" })`)) as { displayPath?: string };
    expect(lib.displayPath ?? "").toContain(app.dir.split("/").pop()!);
    await app.run(`await foleviShell.setMode("local"); return true;`);
    await app.until(`return window.foleviShell && foleviShell.places && foleviShell.places.current === "library" && document.readyState === "complete"`);
    const id = String(await app.cmd("test-session", { token }));
    expect(id).toMatch(/^acct:/);
    await app.until(`return window.foleviShell && foleviShell.places.current === ${JSON.stringify(id)} && foleviShell.initialMode === "account" && document.readyState === "complete"`, 30_000);
    // Signed in through the app's session (never in the page): the folio shows, Convex tokens come.
    await app.until(`return !!document.querySelector('nav[aria-label="Folio"]')`, 60_000);
    const jwt1 = await app.run(`return await foleviShell.auth.convexToken()`);
    const jwt2 = await app.run(`return await foleviShell.auth.convexToken()`);
    expect(typeof jwt1).toBe("string");
    expect(typeof jwt2).toBe("string");
    const claims = JSON.parse(Buffer.from(String(jwt1).split(".")[1]!, "base64url").toString()) as { email?: string };
    expect(claims.email).toBe(person.email);
    expect(String(await app.run(`return document.documentElement.outerHTML + JSON.stringify(localStorage)`))).not.toContain(token);
    const me = (await app.run(`const r = await foleviShell.auth.fetch("/api/auth/get-session", { method: "GET" }); return { status: r.status, body: JSON.parse(r.body) }`)) as { status: number; body: { user: { email: string } } };
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(person.email);

    // A note made in the app reaches the website.
    const title = `From the WebKit app ${Date.now().toString(36)}`;
    expect(await app.run(click("New note"))).toBe(true);
    await app.until(`return /^\\/d\\//.test(location.pathname) && document.activeElement && document.activeElement.tagName === "TEXTAREA"`, 30_000);
    await app.run(`document.execCommand("insertText", false, ${JSON.stringify(title)}); return true;`);
    await person.page.goto(`${APP}/documents`);
    await expect(person.page.getByText(title).first()).toBeVisible({ timeout: 60_000 });

    // The library is the other place, in the background: its runner, in no window on /place-sync, woke when the
    // library left the window, and is kept up (`wake` with a hold) while its timers are measured with the app hidden.
    const places = await app.cmd("places");
    expect(places).toMatchObject({ current: id, library: true, accounts: [id] });
    expect((places.background as { wanted: string[] }).wanted).toEqual(["library"]);
    expect(await app.cmd("wake", { place: "library", hold: seconds + 15 })).toBe(true);
    const runners = (await app.cmd("places")).runners as { place: string; url: string; inWindow: boolean }[];
    expect(runners.map((r) => r.place)).toEqual(["library"]);
    expect(runners[0]!.inWindow).toBe(false);
    expect(decodeURIComponent(runners[0]!.url)).toContain("/place-sync?place=library");
    const runner = async (script: string) => {
      const r = (await app.m.command(app.dir, { cmd: "runner-eval", place: "library", script })) as { value?: unknown; error?: string };
      if (r.error) throw new Error(r.error);
      return r.value;
    };
    await expect.poll(() => runner(`return [foleviShell.places.current, foleviShell.places.background, foleviShell.initialMode]`), { timeout: 30_000 }).toEqual(["library", true, "local"]);
    // A 1 s timer, each gap between its runs measured in the page (performance.now). WebKit's hidden-page throttling
    // and App Nap stretch every gap (1 s became 2 s and more); a loaded Mac only delays some. So most gaps stay
    // near 1 s (the median), none is a long stall, and the timer kept going the whole time.
    await runner(`window.__gaps = []; let last = performance.now(); window.__tick = setInterval(() => { const now = performance.now(); window.__gaps.push(now - last); last = now; }, 1000); return true;`);
    await app.cmd("hide", { value: true });
    await new Promise((r) => setTimeout(r, seconds * 1000));
    const gaps = ((await runner(`return window.__gaps`)) as number[]).slice();
    await app.cmd("hide", { value: false });
    const sorted = [...gaps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? Infinity;
    const summary = `${gaps.length} runs in ${seconds} s, gaps ${gaps.map((g) => Math.round(g)).join(", ")} ms`;
    expect(gaps.length, summary).toBeGreaterThanOrEqual(Math.floor(seconds * 0.5));
    expect(median, summary).toBeLessThan(1500);
    expect(sorted.at(-1) ?? Infinity, summary).toBeLessThan(10_000);
    // Once the hold is over and its page said nothing waits, the runner goes (its process with it); the next
    // catch-up wakes it again, and it goes again.
    const awakeNow = async () => ((await app.cmd("places")).runners as { place: string }[]).map((r) => r.place);
    const woke = async () => ((await app.cmd("places")).background as { log: { place: string; what: string }[] }).log.filter((l) => l.place === "library");
    await expect.poll(awakeNow, { timeout: 60_000, intervals: [250] }).toEqual([]);
    expect((await woke()).at(-1)?.what).toBe("released: done");
    await expect.poll(async () => (await woke()).some((l) => l.what === "catch up"), { timeout: 60_000 }).toBe(true);
    await expect.poll(async () => (await woke()).filter((l) => l.what.startsWith("released")).length, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
    // The list both places' pages read, and a switch to the library.
    const list = (await app.run(`return (await foleviShell.places.list()).map((p) => [p.kind, p.id])`)) as string[][];
    expect(list).toEqual([["library", "library"], ["account", id]]);
    await app.run(`await foleviShell.places.switchTo("library", { path: "/tasks" }); return true;`);
    await app.until(`return window.foleviShell && foleviShell.places.current === "library" && location.pathname === "/tasks"`, 30_000);
    // The account went into the background: its runner wakes at once (what was queued there goes up now).
    const after = await app.cmd("places");
    expect((after.background as { wanted: string[] }).wanted).toEqual([id]);
    expect((after.runners as { place: string }[]).map((r) => r.place)).toEqual([id]);
  } finally {
    await app.quit();
    await person.context.close();
  }
});

/** The app on a folder library of the test's own, opened in local mode (the main window on its Home). */
async function onFolderLibrary() {
  const library = mkdtempSync(join(tmpdir(), "folevi-mac-library-"));
  const app = await launchMac({ FOLEVI_TEST_FOLDER: library });
  await app.until(`return document.body.innerText.includes("Where should your notes live?")`, 60_000);
  const info = (await app.run(`return await foleviShell.library.setup({ kind: "folder" })`)) as { displayPath?: string };
  if (!String(info?.displayPath ?? "").endsWith(library.split("/").pop()!)) throw new Error(`Not the test's own library: ${JSON.stringify(info)}`);
  await app.run(`await foleviShell.setMode("local"); return true;`);
  await app.until(`return window.foleviShell && foleviShell.initialMode === "local" && document.readyState === "complete" && !!document.querySelector('nav[aria-label="Folio"]')`, 60_000);
  return { ...app, library };
}

/** Files in the library folder whose text includes `text`. */
const filesContaining = (dir: string, text: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name))
    .filter((f) => readFileSync(f).includes(text));

/** Types into Quick Add's field and presses Return (the panel's own page, through its eval hook). */
const quickAddTask = (title: string) => `
  const f = document.getElementById("qa-title");
  f.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(f, ${JSON.stringify(title)});
  f.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  f.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
  return true;`;

test("4. the window and its chrome: buttons on the page's spot, Settings, the menus, links, Quick Add, Vision", async ({ browser }) => {
  test.setTimeout(240_000);
  // An image with words in it, as a screenshot would be (drawn in a browser here).
  const shot = await browser.newPage({ viewport: { width: 900, height: 260 } });
  await shot.setContent('<body style="margin:40px;background:#fff;font:52px Helvetica">Departures to Wobbleton<br><span style="font-size:30px">Platform 4 at 10:45</span></body>');
  const png = (await shot.screenshot()).toString("base64");
  await shot.close();

  const app = await onFolderLibrary();
  try {
    // The page knows it's in the Mac app (on WebKit), and keeps room for the window buttons in its top bar.
    expect(await app.run(`const h = document.documentElement; return [h.getAttribute("data-desktop"), h.getAttribute("data-mac-engine"), typeof window.foleviDesktop?.onCommand]`)).toEqual(["mac", "webkit", "function"]);
    const spot = `const e = [...document.querySelectorAll(".ui-traffic-space")].find((x) => x.getBoundingClientRect().width > 0); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };`;
    const buttonsOnSpot = async () => {
      const box = (await app.run(spot)) as { x: number; y: number; width: number; height: number } | null;
      const bar = (await app.cmd("titleBar")) as { buttons: { x: number; midY: number; hidden: boolean }[]; spot: { x: number; y: number; height: number } | null };
      if (!box || !bar.spot) return null;
      return { width: box.width, close: { x: Math.round(bar.buttons[0]!.x - box.x), midY: Math.round(bar.buttons[0]!.midY - (box.y + box.height / 2)) }, hidden: bar.buttons.some((b) => b.hidden) };
    };
    // The close button 2 pt in from the spot's start, centred on it; the same once the sidebar hides (the spot
    // moves into the tab strip) and shows again.
    const onSpot = { width: 60, close: { x: 2, midY: 0 }, hidden: false };
    await expect.poll(buttonsOnSpot, { timeout: 15_000 }).toEqual(onSpot);
    const before = await app.run(spot);
    await app.cmd("menu", { action: "run", item: "view.sidebar" });
    await app.until(`return !document.querySelector('nav[aria-label="Folio"]') || document.querySelector('nav[aria-label="Folio"]').getBoundingClientRect().width === 0`, 15_000);
    await expect.poll(buttonsOnSpot, { timeout: 15_000 }).toEqual(onSpot);
    await app.cmd("menu", { action: "run", item: "view.sidebar" });
    await expect.poll(() => app.run(spot), { timeout: 15_000 }).toEqual(before);
    await expect.poll(buttonsOnSpot, { timeout: 15_000 }).toEqual(onSpot);

    // Settings > Desktop app (the Settings window): the shortcut, and the menu bar icon's switch reaches the app.
    const settings = await app.cmd("settings", { action: "show" });
    expect(settings).toMatchObject({ visible: true, selected: "desktop" });
    const inSettings = async (script: string) => ((await app.m.command(app.dir, { cmd: "evalIn", target: "settings", script })) as { value?: unknown }).value;
    await expect.poll(() => inSettings(`return document.body.innerText.includes("⌥Space")`), { timeout: 30_000 }).toBe(true);
    const flip = `const s = [...document.querySelectorAll("[role=switch]")].find((e) => e.getAttribute("aria-label") === "Menu bar icon"); s.click(); await new Promise((r) => setTimeout(r, 500)); return s.getAttribute("aria-checked");`;
    expect((await app.cmd("chrome")).statusItem).toBe(true);
    expect(await inSettings(flip)).toBe("false");
    await expect.poll(async () => (await app.cmd("chrome")).statusItem).toBe(false);
    expect(await inSettings(flip)).toBe("true");
    await expect.poll(async () => (await app.cmd("chrome")).statusItem).toBe(true);
    await app.cmd("settings", { action: "close" });

    // File > New Note opens a new note.
    await app.cmd("menu", { action: "run", item: "file.new-note" });
    await app.until(`return /^\\/d\\/[0-9A-Z]{26}$/.test(location.pathname)`, 20_000);

    // A folevi-dev:// link (from Shortcuts, Raycast, another app) opens the page it names; anything else is ignored.
    await app.cmd("open", { url: "folevi-dev://tasks/today" });
    await app.until(`return location.pathname === "/tasks/today"`, 20_000);
    await app.cmd("open", { url: "folevi-dev://admin" });
    await new Promise((r) => setTimeout(r, 1000));
    expect(await app.run(`return location.pathname`)).toBe("/tasks/today");

    // Quick Add: the panel, then the task lands in the Inbox (and the library's files).
    expect(await app.cmd("quickAdd", { action: "show" })).toMatchObject({ visible: true, place: "library" });
    await expect.poll(async () => ((await app.m.command(app.dir, { cmd: "evalIn", target: "quickAdd", script: `return !!document.getElementById("qa-title")` })) as { value?: unknown }).value, { timeout: 30_000 }).toBe(true);
    await app.m.command(app.dir, { cmd: "evalIn", target: "quickAdd", script: quickAddTask("Call the printer") });
    await expect.poll(async () => (await app.cmd("quickAdd")).visible, { timeout: 10_000 }).toBe(false);
    await app.cmd("open", { url: "folevi-dev://tasks/inbox" });
    await app.until(`return location.pathname === "/tasks/inbox" && document.body.innerText.includes("Call the printer")`, 30_000);
    await expect.poll(() => filesContaining(app.library, "Call the printer").length, { timeout: 30_000 }).toBeGreaterThan(0);

    // Vision reads the words in an image, on this Mac (what search in files uses).
    const read = (await app.run(`const b = Uint8Array.from(atob(${JSON.stringify(png)}), (c) => c.charCodeAt(0)); return await window.foleviDesktop.recognizeText(b, false);`)) as { text: string } | null;
    expect(read?.text ?? "").toContain("Wobbleton");
  } finally {
    await app.quit();
    rmSync(app.library, { recursive: true, force: true });
  }
});

test("5. every window, one library: Quick Add with the app hidden, a second window, all of it on disk", async () => {
  test.setTimeout(240_000);
  const app = await onFolderLibrary();
  try {
    // 1. The app hidden: Quick Add still adds to the library.
    await app.cmd("hide", { value: true });
    await app.cmd("quickAdd", { action: "show" });
    await expect.poll(async () => ((await app.m.command(app.dir, { cmd: "evalIn", target: "quickAdd", script: `return !!document.getElementById("qa-title")` })) as { value?: unknown }).value, { timeout: 30_000 }).toBe(true);
    await app.m.command(app.dir, { cmd: "evalIn", target: "quickAdd", script: quickAddTask("Water the plants") });
    await expect.poll(async () => (await app.cmd("quickAdd")).visible, { timeout: 10_000 }).toBe(false);
    await expect.poll(() => filesContaining(app.library, "Water the plants").length, { timeout: 30_000 }).toBeGreaterThan(0);
    await app.cmd("hide", { value: false });

    // 2. File > New Window: a second window on the same library writes a note, and the first one sees it.
    await app.cmd("menu", { action: "run", item: "file.new-window" });
    await expect.poll(async () => ((await app.m.command(app.dir, { cmd: "windows" })) as { value: { loaded: boolean }[] }).value.filter((w) => w.loaded).length, { timeout: 30_000 }).toBe(2);
    const inWindow = async (window: number, script: string) => {
      const r = (await app.m.command(app.dir, { cmd: "eval", window, script })) as { value?: unknown; error?: string };
      if (r.error) throw new Error(r.error);
      return r.value;
    };
    await expect.poll(() => inWindow(1, `return !!document.querySelector('nav[aria-label="Folio"]')`), { timeout: 60_000 }).toBe(true);
    expect(await inWindow(1, click("New note"))).toBe(true);
    await expect.poll(() => inWindow(1, `return /^\\/d\\//.test(location.pathname) && document.activeElement && document.activeElement.tagName === "TEXTAREA"`), { timeout: 30_000 }).toBe(true);
    await inWindow(1, `document.execCommand("insertText", false, "Written in a second window"); return true;`);
    await expect.poll(() => filesContaining(app.library, "Written in a second window").length, { timeout: 30_000 }).toBeGreaterThan(0);
    await inWindow(0, `history.pushState(null, "", "/documents"); window.dispatchEvent(new PopStateEvent("popstate")); return true;`);
    await expect.poll(() => inWindow(0, `return document.body.innerText.includes("Written in a second window")`), { timeout: 30_000 }).toBe(true);
    // The task Quick Add made with the app hidden is in that window's Inbox too.
    await inWindow(0, `history.pushState(null, "", "/tasks/inbox"); window.dispatchEvent(new PopStateEvent("popstate")); return true;`);
    await expect.poll(() => inWindow(0, `return document.body.innerText.includes("Water the plants")`), { timeout: 30_000 }).toBe(true);
  } finally {
    await app.quit();
    rmSync(app.library, { recursive: true, force: true });
  }
});

test("6. a note's editor goes once the note is left, even when it was focused while Folevi was hidden", async () => {
  test.setTimeout(240_000);
  const app = await onFolderLibrary();
  try {
    const newNote = `const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "New note").click(); const end = Date.now() + 20000; while (Date.now() < end && !(document.activeElement && document.activeElement.tagName === "TEXTAREA")) await sleep(100); return document.activeElement.tagName;`;
    const keep = (name: string) => `window.__editors ??= []; window.__editors.push([${JSON.stringify(name)}, new WeakRef(document.querySelector(".ProseMirror"))]); return window.__editors.length;`;
    // Typed with real keys (the app's Debug typeKeys), a block from the slash menu, and the editor focused from code,
    // as the app focuses it (tiptap's focus waits for a frame, which a window behind others never draws).
    // With Folevi hidden throughout (as with another app in front, or the screen locked), the page isn't drawn.
    await app.cmd("hide", { value: true });
    await app.until(`return document.visibilityState === "hidden"`, 10_000);
    for (const [title, block] of [["With a heading", "heading"], ["With a table", "table"], ["Plain", null]] as const) {
      expect(await app.run(newNote)).toBe("TEXTAREA");
      await app.cmd("typeKeys", { text: `${title}\nSome text${block ? `\n/${block}` : ""}` });
      if (block) {
        await app.until(`return !!document.querySelector('[role="option"]')`, 10_000);
        await app.cmd("typeKeys", { text: "\n" });
      }
      await app.run(`document.querySelector(".ProseMirror").editor.commands.focus("end"); return true;`);
      await app.run(keep(title));
    }
    expect(await app.run(newNote)).toBe("TEXTAREA");
    await app.run(`[...document.querySelectorAll("a,button")].find((e) => e.innerText.trim() === "Home").click(); return true;`);
    await app.until(`return location.pathname === "/documents"`);
    // A full collection (WebKit's, Debug only), twice: every left note's editor is gone, none kept detached.
    for (let i = 0; i < 2; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      await app.cmd("gc");
    }
    await new Promise((r) => setTimeout(r, 2000));
    const left = (await app.run(`return window.__editors.map(([n, r]) => [n, r.deref() ? "kept" : "collected"])`)) as string[][];
    expect(left).toEqual([
      ["With a heading", "collected"],
      ["With a table", "collected"],
      ["Plain", "collected"],
    ]);
  } finally {
    await app.cmd("hide", { value: false }).catch(() => undefined);
    await app.quit();
    rmSync(app.library, { recursive: true, force: true });
  }
});
