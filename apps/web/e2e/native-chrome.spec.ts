// Native chrome mode (docs/NATIVE_APP_PLAN.md sections 3 and 8): the page as the native apps' engine and note page,
// driven by a fake native host. The host marks the page before its first paint (`window.__foleviNativeChrome`), takes
// the engine's batches from a stand-in for WebKit's message handler, and calls `__foleviEngine.handle` as Swift
// does. Runs on a local library (the FakeShell), so no account or network is needed:
//   E2E_LOCAL_BASE_URL=http://localhost:3010 E2E_BASE_URL=http://localhost:3010 E2E_NO_SERVER=1 \
//     npx playwright test e2e/native-chrome.spec.ts --project local --workers=1
import type { Page } from "@playwright/test";
import { expect, prepareContext, test } from "./fixtures/localShell";
import type { EngineBatch, EventMessage, HomeValue, ListDiff, Reply, UpdateMessage } from "../src/lib/engine/protocol";

declare global {
  interface Window {
    __nativePosts: string[];
  }
}

/** The fake host: the marker and the message handler, before any of the page's code runs. */
async function nativeHost(page: Page) {
  await page.addInitScript(() => {
    window.__nativePosts = [];
    (window as unknown as { __foleviNativeChrome: unknown }).__foleviNativeChrome = { platform: "macos", protocol: 1, place: "library" };
    (window as unknown as { webkit: unknown }).webkit = { messageHandlers: { foleviEngine: { postMessage: (json: string) => window.__nativePosts.push(json) } } };
  });
}

let next = 0;
/** One message to the engine, as Swift sends it (a JSON string), and its reply. */
async function call(page: Page, message: Record<string, unknown>): Promise<Reply> {
  const json = JSON.stringify({ v: 1, id: `m${++next}`, ...message });
  const reply = await page.evaluate((m) => (window as unknown as { __foleviEngine: { handle(m: string): Promise<string> } }).__foleviEngine.handle(m), json);
  return JSON.parse(reply) as Reply;
}

async function value<T>(page: Page, message: Record<string, unknown>): Promise<T> {
  const reply = await call(page, message);
  if (!reply.ok) throw new Error(`${reply.error.code}: ${reply.error.message}`);
  return reply.value as T;
}

/** Everything the engine posted so far, in order. */
async function posted(page: Page): Promise<(UpdateMessage | EventMessage)[]> {
  const raw = await page.evaluate(() => window.__nativePosts);
  return raw.flatMap((json) => {
    const v = JSON.parse(json) as EngineBatch | { bodyId: string };
    return Array.isArray(v) ? v : [];
  });
}

const updates = async (page: Page, sub: string) => (await posted(page)).filter((m): m is UpdateMessage => m.kind === "update" && m.sub === sub);
const events = async (page: Page, name: string) => (await posted(page)).filter((m): m is EventMessage => m.kind === "event" && m.name === name);

test.describe("native chrome mode", { tag: "@local" }, () => {
  test("the page is the engine: no web frame, live views, commands and the note page", async ({ page, backendMode }) => {
    test.skip(backendMode !== "local", "runs on a local library");
    test.setTimeout(180_000);
    await nativeHost(page);
    await page.goto("/native");

    // The bridge is there at once, and says when the data layer is up.
    await expect.poll(() => page.evaluate(() => typeof (window as unknown as { __foleviEngine?: unknown }).__foleviEngine), { timeout: 60_000 }).toBe("object");
    const hello = await value<{ protocol: number; place: string | null }>(page, { kind: "hello", app: { platform: "macos", version: "1.1.00", build: "e2e", protocol: 1 } });
    expect(hello.protocol).toBe(1);
    await expect.poll(async () => (await events(page, "engine.ready")).length, { timeout: 60_000 }).toBeGreaterThan(0);

    // No web chrome: no sidebar, tab strip or floating Foli AI; the idle page draws nothing.
    await expect(page.locator("[data-native-content]")).toBeAttached();
    await expect(page.locator("html")).toHaveAttribute("data-native-chrome", "");
    await expect(page.getByRole("link", { name: "All notes" })).toHaveCount(0);
    await expect(page.getByRole("navigation")).toHaveCount(0);

    // A live view: Home.
    expect(await value(page, { kind: "watch", sub: "home", place: "library", name: "home", args: {} })).toEqual({ sub: "home" });
    await expect.poll(async () => (await updates(page, "home")).some((u) => u.value && (u.value as HomeValue).recentsLoaded), { timeout: 30_000 }).toBe(true);

    // And a windowed list: All notes.
    await value(page, { kind: "watch", sub: "all", place: "library", name: "notes.list", args: { view: "all" }, window: { start: 0, count: 50 } });
    await expect.poll(async () => (await updates(page, "all")).length, { timeout: 30_000 }).toBeGreaterThan(0);
    const firstList = (await updates(page, "all"))[0]!.diff as ListDiff;
    expect(firstList.reset).toBe(true);

    // A command: a new note shows up in Home's recents and at the top of All notes.
    const created = await value<{ id: string }>(page, { kind: "command", place: "library", name: "note.create", args: { title: "Written natively" } });
    await expect
      .poll(async () => (await updates(page, "home")).some((u) => (u.value as HomeValue | undefined)?.recents.some((r) => r.id === created.id && r.title === "Written natively")), { timeout: 30_000 })
      .toBe(true);
    await expect.poll(async () => (await updates(page, "all")).some((u) => u.diff?.order?.[0] === created.id), { timeout: 30_000 }).toBe(true);

    // Errors: another place, an unknown view.
    const mismatch = await call(page, { kind: "watch", sub: "x", place: "acct:someone", name: "home", args: {} });
    expect(mismatch.ok ? null : mismatch.error.code).toBe("place_mismatch");
    const unknown = await call(page, { kind: "query", place: "library", name: "nope", args: {} });
    expect(unknown.ok ? null : unknown.error.code).toBe("unknown_view");

    // The note page: shown by an editor command, with no web bars, and note.ready once it's drawn.
    expect(await value(page, { kind: "editor", name: "note.show", args: { id: created.id } })).toMatchObject({ id: created.id });
    await expect.poll(async () => (await events(page, "note.ready")).some((e) => (e.data as { id: string }).id === created.id), { timeout: 60_000 }).toBe(true);
    await expect(page.getByRole("textbox", { name: /title/i }).or(page.getByText("Written natively")).first()).toBeVisible();
    await expect(page.getByRole("toolbar", { name: "Note tools" })).toHaveCount(0);
    await expect.poll(async () => (await events(page, "note.meta")).some((e) => (e.data as { id: string; found: boolean }).found), { timeout: 30_000 }).toBe(true);

    // The editor command API: the keyboard toolbar's state, and a panel opened by command.
    const state = await value<{ noteId: string; canEdit: boolean }>(page, { kind: "editor", name: "state" });
    expect(state).toMatchObject({ noteId: created.id, canEdit: true });
    await value(page, { kind: "editor", name: "panel.open", args: { panel: "style" } });
    await expect.poll(async () => (await events(page, "editor.panel")).some((e) => (e.data as { panel: string | null }).panel === "style"), { timeout: 10_000 }).toBe(true);

    // Navigation is native's: window.open and links ask with navigate.request; the page doesn't move.
    await page.evaluate(() => window.open("/d/someone_else", "_blank"));
    await expect.poll(async () => (await events(page, "navigate.request")).map((e) => e.data), { timeout: 10_000 }).toContainEqual({ route: "/d/someone_else", noteId: "someone_else", external: false, newTab: true });
    await expect(page).toHaveURL(new RegExp(`/d/${created.id}`));

    // The gate: the app is up, so there's no screen for native to show instead.
    const gate = await value<{ gate: { gate: string | null } }>(page, { kind: "hello", app: { platform: "macos", version: "1.1.00", build: "e2e", protocol: 1 } });
    expect(gate.gate.gate).toBeNull();

    // Back to a list screen: the note goes, the page is idle again.
    await value(page, { kind: "editor", name: "note.close" });
    await expect(page).toHaveURL(/\/native$/);
    const none = await call(page, { kind: "editor", name: "undo" });
    expect(none.ok ? null : none.error.code).toBe("no_note");
  });

  test("first launch: gate.changed names the mode choice, and gate.act presses its button", async ({ browser, backendMode }, testInfo) => {
    test.skip(backendMode !== "local", "runs on a local library");
    test.setTimeout(120_000);
    const context = await browser.newContext();
    await prepareContext(context, testInfo, { initialMode: "unset", configured: false, libraryName: `native-${Date.now()}` });
    const page = await context.newPage();
    await nativeHost(page);
    await page.goto("/native");
    await expect.poll(() => page.evaluate(() => typeof (window as unknown as { __foleviEngine?: unknown }).__foleviEngine), { timeout: 60_000 }).toBe("object");
    await expect
      .poll(async () => (await value<{ gate: { gate: string | null } }>(page, { kind: "hello", app: { platform: "macos", version: "1.1.00", build: "e2e", protocol: 1 } })).gate.gate, { timeout: 60_000 })
      .toBe("modeChoice");
    const hello = await value<{ gate: { actions: { id: string }[] } }>(page, { kind: "hello", app: { platform: "macos", version: "1.1.00", build: "e2e", protocol: 1 } });
    expect(hello.gate.actions.map((a) => a.id)).toEqual(["account", "local"]);
    expect(await value(page, { kind: "command", place: "library", name: "gate.act", args: { action: "local" } })).toEqual({ ok: true });
    await expect.poll(async () => (await events(page, "gate.changed")).map((e) => (e.data as { gate: string | null }).gate), { timeout: 30_000 }).toContain("librarySetup");
    await context.close();
  });

  test("without the marker nothing changes: no engine global, the web frame as before", async ({ page, backendMode }) => {
    test.skip(backendMode !== "local", "runs on a local library");
    await page.goto("/documents");
    await expect(page.getByRole("link", { name: "All notes" }).first()).toBeVisible({ timeout: 60_000 });
    expect(await page.evaluate(() => typeof (window as unknown as { __foleviEngine?: unknown }).__foleviEngine)).toBe("undefined");
    await expect(page.locator("[data-native-content]")).toHaveCount(0);
  });
});
