import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { cleanSettings, DEFAULT_SETTINGS, isValidShortcut, loadSettings, pageSettings, saveSettings, type ShellMode } from "./settings";
import {
  appUrl,
  dragFileName,
  isAppUrl,
  isExternalSafe,
  isSignInReturn,
  isSignInStart,
  linkTarget,
  originOf,
  parseDeepLink,
  SCREEN_RECORDING_SETTINGS,
  systemSettingsUrl,
  useBundledApp,
  useRemoteApp,
} from "./urls";
import { restoreWindow, saveWindow } from "./windowState";
import { createAppHandler, FILES_CSP, HANDOFF_PATH, isBlockedInLocalMode, localModeBlockPatterns, parseRange, safeFileType, safeSegments, shellCsp, shellRoot, type LibraryFiles } from "./protocol";

const dirs: string[] = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "folevi-shell-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("addresses", () => {
  test("only Folevi's own origin is the app; anything else goes to the browser, if it's safe to hand over", () => {
    expect(isAppUrl("https://app.folevi.com/d/01ABC")).toBe(true);
    expect(isAppUrl("https://app.folevi.com.evil.example/")).toBe(false);
    expect(isAppUrl("http://app.folevi.com/")).toBe(false);
    expect(isAppUrl("https://folevi.com/pricing")).toBe(false);
    expect(isAppUrl("not a url")).toBe(false);
    expect(isExternalSafe("https://example.com")).toBe(true);
    expect(isExternalSafe("mailto:hi@folevi.com")).toBe(true);
    expect(isExternalSafe("file:///etc/passwd")).toBe(false);
    expect(isExternalSafe("javascript:alert(1)")).toBe(false);
  });

  test("recording a call: the page can open only the Screen & System Audio Recording pane, never a URL it names", () => {
    expect(systemSettingsUrl("screen-recording")).toBe("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
    expect(SCREEN_RECORDING_SETTINGS).toBe(systemSettingsUrl("screen-recording"));
    for (const bad of ["x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture", "microphone", "", null, undefined, 1, { pane: "screen-recording" }]) expect(systemSettingsUrl(bad)).toBeNull();
  });

  test("custom schemes compare by scheme and host (Node gives them all the origin \"null\")", () => {
    expect(originOf("app://folevi/d/1")).toBe("app://folevi");
    expect(originOf("https://app.folevi.com:443/x")).toBe("https://app.folevi.com");
    expect(originOf("http://app.localhost:3002/x")).toBe("http://app.localhost:3002");
    expect(originOf("mailto:hi@folevi.com")).toBeNull();
    expect(originOf("nope")).toBeNull();
  });

  test("paths stay inside the app", () => {
    expect(appUrl("/d/01ABC")).toBe("https://app.folevi.com/d/01ABC");
    expect(appUrl("//evil.example/x")).toBe("https://app.folevi.com/");
    expect(appUrl("https://evil.example/")).toBe("https://app.folevi.com/");
  });
});

describe("the bundled interface's addresses", () => {
  afterEach(() => useRemoteApp());

  test("the app is app://folevi; the website stays the website", () => {
    useBundledApp();
    expect(appUrl("/d/01ABC")).toBe("app://folevi/d/01ABC");
    expect(appUrl("//evil.example/x")).toBe("app://folevi/");
    expect(isAppUrl("app://folevi/documents")).toBe(true);
    expect(isAppUrl("app://evil/documents")).toBe(false);
    expect(isAppUrl("other://folevi/documents")).toBe(false);
    expect(isAppUrl("https://app.folevi.com/documents")).toBe(false);
    expect(isAppUrl("foo://bar")).toBe(false);
    // Google sign-in still starts on the website.
    expect(isSignInStart("https://app.folevi.com/app-google?state=x")).toBe(true);
    expect(isSignInStart("app://folevi/app-google")).toBe(false);
  });

  test("links to the website's product pages open in the app; sign-in, share links and the rest in the browser", () => {
    useBundledApp();
    expect(linkTarget("https://app.folevi.com/d/01JAZ3XQ5V8K2M4N6P7R9S0T1U#block-1")).toEqual({ kind: "app", path: "/d/01JAZ3XQ5V8K2M4N6P7R9S0T1U#block-1" });
    expect(linkTarget("https://app.folevi.com/tasks/today?x=1")).toEqual({ kind: "app", path: "/tasks/today?x=1" });
    expect(linkTarget("app://folevi/calendar")).toEqual({ kind: "app", path: "/calendar" });
    for (const browser of ["https://app.folevi.com/signin", "https://app.folevi.com/app-google", "https://app.folevi.com/s/abc", "https://app.folevi.com/connect?x", "https://app.folevi.com/admin", "https://folevi.com/pricing", "https://example.com/d/1", "mailto:hi@folevi.com"]) {
      expect(linkTarget(browser)).toEqual({ kind: "browser" });
    }
    for (const ignored of ["file:///etc/passwd", "javascript:alert(1)", "app://evil/d/1", "folevi://d/1", "nope"]) expect(linkTarget(ignored)).toEqual({ kind: "ignore" });
  });

  test("the shell dev server is the app in development", () => {
    useBundledApp("http://127.0.0.1:3005/whatever");
    expect(appUrl("/documents")).toBe("http://127.0.0.1:3005/documents");
    expect(isAppUrl("http://127.0.0.1:3005/d/1")).toBe(true);
    useBundledApp("javascript:alert(1)");
    expect(appUrl("/documents")).toBe("app://folevi/documents");
  });

  test("without the switch nothing changes: the website is the app", () => {
    expect(appUrl("/d/1")).toBe("https://app.folevi.com/d/1");
    expect(linkTarget("https://app.folevi.com/signin")).toEqual({ kind: "app", path: "/signin" });
    expect(isAppUrl("app://folevi/")).toBe(false);
  });
});

// ---------------------------------------------------------------- app://folevi (protocol.ts)

/** A small export: index.html, a script, a font and a nested asset, plus a file outside it and a symlink out. */
function exportFolder() {
  const dir = scratch();
  const root = join(dir, "web");
  mkdirSync(join(root, "_next", "static", "chunks"), { recursive: true });
  writeFileSync(join(root, "index.html"), "<!doctype html><title>Folevi</title>");
  writeFileSync(join(root, "_next", "static", "chunks", "app.js"), "console.log(1)");
  writeFileSync(join(root, "logo.svg"), "<svg/>");
  writeFileSync(join(dir, "secret.txt"), "outside");
  symlinkSync(join(dir, "secret.txt"), join(root, "link.txt"));
  return root;
}

const SHA = "a".repeat(64);
const BYTES = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const library: LibraryFiles = {
  stat: async (sha) => (sha === SHA ? { size: BYTES.length, mime: null } : null),
  read: async (_sha, start, end) => BYTES.slice(start, end + 1),
};

function handler(mode: ShellMode = "account") {
  let current = mode;
  const h = createAppHandler({ root: exportFolder(), mode: () => current, csp: { serviceOrigin: "https://app.folevi.com" }, files: library });
  return { get: (path: string, init?: RequestInit) => h(new Request(`app://folevi${path}`, init)), raw: h, setMode: (m: ShellMode) => (current = m) };
}

describe("app://folevi", () => {
  test("serves the export's files with their types", async () => {
    const { get } = handler();
    const js = await get("/_next/static/chunks/app.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(js.headers.get("x-content-type-options")).toBe("nosniff");
    expect(js.headers.get("cache-control")).toContain("immutable");
    expect(await js.text()).toBe("console.log(1)");
    expect((await get("/logo.svg")).headers.get("content-type")).toBe("image/svg+xml");
    const head = await get("/_next/static/chunks/app.js", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  test("SPA fallback: every app path gets index.html; missing assets and server routes are 404s", async () => {
    const { get } = handler();
    for (const path of ["/", "/documents", "/d/01JAZ3XQ5V8K2M4N6P7R9S0T1U", "/tasks/today?x=1", "/settings/appearance/", "/calendar/2026-10", "/daily/2026-10-20"]) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await res.text()).toContain("<title>Folevi</title>");
    }
    for (const path of ["/_next/static/chunks/missing.js", "/api/auth/get-session", "/favicon.ico", "/covers/x.webp"]) expect((await get(path)).status, path).toBe(404);
    expect((await get("/documents", { method: "POST" })).status).toBe(405);
  });

  test("nothing outside the export: traversal, encodings, symlinks and other hosts are refused", async () => {
    const { get, raw } = handler();
    for (const path of ["/../secret.txt", "/%2e%2e/secret.txt", "/_next/%2e%2e/%2e%2e/secret.txt", "/..%2fsecret.txt", "/a%5c..%5csecret.txt", "/%00", "/bad%zz", "/a//b"]) {
      const res = await get(path);
      expect([400, 404], path).toContain(res.status);
      expect(await res.text()).not.toContain("outside");
    }
    expect((await get("/link.txt")).status).toBe(404);
    expect((await raw(new Request("app://other/index.html"))).status).toBe(404);
    expect(safeSegments("/a/./b")).toBeNull();
    expect(safeSegments("/a/b/")).toEqual(["a", "b"]);
    expect(safeSegments("/")).toEqual([]);
    expect(safeSegments("/caf%C3%A9")).toEqual(["café"]);
  });

  test("the page's policy follows the mode: local and the first-launch choice reach nothing; signed in reaches Folevi and Convex", async () => {
    const h = handler("local");
    const local = (await h.get("/documents")).headers.get("content-security-policy")!;
    expect(local).toContain("connect-src 'self';");
    expect(local).not.toMatch(/folevi\.com|convex/);
    h.setMode("unset");
    expect((await h.get("/")).headers.get("content-security-policy")).toBe(local);
    h.setMode("account");
    const account = (await h.get("/index.html")).headers.get("content-security-policy")!;
    expect(account).toContain("connect-src 'self' https://app.folevi.com https://*.convex.cloud wss://*.convex.cloud https://*.convex.site;");
    // Scripts never come from anywhere else, in either mode; only HTML carries the page policy.
    for (const p of [local, account]) {
      expect(p).toContain("script-src 'self' 'unsafe-inline';");
      expect(p).toContain("object-src 'none'");
    }
    expect((await h.get("/_next/static/chunks/app.js")).headers.get("content-security-policy")).toBeNull();
    expect(shellCsp("account", { serviceOrigin: "http://app.localhost:3002", extraConnect: ["http://127.0.0.1:3210"] })).toContain("http://app.localhost:3002 https://*.convex.cloud wss://*.convex.cloud https://*.convex.site http://127.0.0.1:3210;");
  });

  test("/_files/<sha256>: the library's bytes, with Range, nosniff and a policy that runs nothing", async () => {
    const { get } = handler();
    const all = await get(`/_files/${SHA}?type=image%2Fpng`);
    expect(all.status).toBe(200);
    expect(all.headers.get("content-type")).toBe("image/png");
    expect(all.headers.get("x-content-type-options")).toBe("nosniff");
    expect(all.headers.get("content-security-policy")).toBe(FILES_CSP);
    expect(all.headers.get("accept-ranges")).toBe("bytes");
    expect([...new Uint8Array(await all.arrayBuffer())]).toEqual([...BYTES]);
    const part = await get(`/_files/${SHA}`, { headers: { range: "bytes=2-5" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-5/10");
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([2, 3, 4, 5]);
    const tail = await get(`/_files/${SHA}`, { headers: { range: "bytes=-3" } });
    expect([...new Uint8Array(await tail.arrayBuffer())]).toEqual([7, 8, 9]);
    expect((await get(`/_files/${SHA}`, { headers: { range: "bytes=20-" } })).status).toBe(416);
    // A type that could run on the app's origin goes out as bytes.
    expect((await get(`/_files/${SHA}?type=text%2Fhtml`)).headers.get("content-type")).toBe("application/octet-stream");
    expect((await get(`/_files/${SHA}?type=image%2Fsvg%2Bxml`)).headers.get("content-type")).toBe("application/octet-stream");
    expect((await get(`/_files/${"b".repeat(64)}`)).status).toBe(404);
    for (const bad of ["/_files/ABC", `/_files/${SHA.toUpperCase()}`, `/_files/${SHA}/x`, "/_files/..%2Findex.html"]) expect([400, 404], bad).toContain((await get(bad)).status);
  });

  test("the handoff page is blank and runs nothing of its own", async () => {
    const res = await handler().get(HANDOFF_PATH);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(await res.text()).not.toContain("<script");
  });

  test("ranges and types", () => {
    expect(parseRange(null, 10)).toBeNull();
    expect(parseRange("bytes=0-", 10)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=5-100", 10)).toEqual({ start: 5, end: 9 });
    expect(parseRange("bytes=-20", 10)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=9-3", 10)).toBe("unsatisfiable");
    expect(parseRange("bytes=0-1,4-5", 10)).toBeNull();
    expect(parseRange("items=0-1", 10)).toBeNull();
    expect(safeFileType("audio/mp4; codecs=x")).toBe("audio/mp4");
    expect(safeFileType(null, "application/pdf")).toBe("application/pdf");
    expect(safeFileType("text/javascript", "text/html")).toBe("application/octet-stream");
  });

  test("where the export is: the app's Resources, or a development folder", () => {
    expect(shellRoot({ packaged: true, resourcesPath: "/R", appDir: "/A", env: { FOLEVI_SHELL_DIR: "/x" } })).toBe("/R/web");
    expect(shellRoot({ packaged: false, resourcesPath: "/R", appDir: "/A", env: {} })).toBe("/A/web");
    expect(shellRoot({ packaged: false, resourcesPath: "/R", appDir: "/A", env: { FOLEVI_SHELL_DIR: "/x/out-shell" } })).toBe("/x/out-shell");
  });
});

describe("local mode never contacts Folevi", () => {
  test("Folevi's and Convex's hosts are cancelled, over every scheme; everything else goes through", () => {
    for (const url of ["https://app.folevi.com/api/auth/get-session", "https://folevi.com/", "wss://peaceful-mockingbird-196.convex.cloud/api/1.46.0/sync", "https://x.convex.site/files/1", "http://app.localhost:3002/api"]) {
      expect(isBlockedInLocalMode(url, "app.localhost"), url).toBe(true);
    }
    for (const url of ["app://folevi/documents", "https://www.youtube-nocookie.com/embed/x", "https://notfolevi.com/", "https://folevi.com.evil.example/", "devtools://devtools", "nope"]) {
      expect(isBlockedInLocalMode(url, "app.folevi.com"), url).toBe(false);
    }
    const patterns = localModeBlockPatterns("app.folevi.com");
    expect(patterns).toContain("wss://*.convex.cloud/*");
    expect(patterns).toContain("https://*.folevi.com/*");
    expect(new Set(patterns).size).toBe(patterns.length);
  });
});

describe("settings", () => {
  test("Quick Add shortcuts need a modifier other than Shift and one key", () => {
    for (const ok of ["Alt+Space", "Control+Alt+Space", "Command+Shift+K", "Alt+F5", "Command+.", ""]) expect(isValidShortcut(ok)).toBe(true);
    for (const bad of ["Space", "K", "Shift+K", "Alt", "Alt+Alt+K", "Alt+Space+K", "Hyper+K", "Alt+Ü"]) expect(isValidShortcut(bad)).toBe(false);
  });

  test("anything unknown or of the wrong type is dropped; the rest is kept", () => {
    expect(cleanSettings({ quickAddShortcut: "K", openAtLogin: "yes", menuBarIcon: false, extra: 1 })).toEqual({ ...DEFAULT_SETTINGS, menuBarIcon: false });
    expect(cleanSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  test("the mode and the bundled switch come only from the file, never from the page", () => {
    expect(cleanSettings({ mode: "local", bundledShell: true }, DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings({ mode: "local", bundledShell: true }, DEFAULT_SETTINGS, true)).toEqual({ ...DEFAULT_SETTINGS, mode: "local", bundledShell: true });
    expect(cleanSettings({ mode: "cloud" }, { ...DEFAULT_SETTINGS, mode: "account" }, true).mode).toBe("account");
    expect(cleanSettings({ menuBarIcon: false }, { ...DEFAULT_SETTINGS, mode: "local", bundledShell: true })).toEqual({ ...DEFAULT_SETTINGS, menuBarIcon: false, mode: "local", bundledShell: true });
    expect(Object.keys(pageSettings({ ...DEFAULT_SETTINGS, mode: "local" })).sort()).toEqual(["menuBarIcon", "notifications", "openAtLogin", "quickAddShortcut"]);
    const file = join(scratch(), "settings.json");
    saveSettings(file, { ...DEFAULT_SETTINGS, mode: "account", bundledShell: true });
    expect(loadSettings(file)).toEqual({ ...DEFAULT_SETTINGS, mode: "account", bundledShell: true });
  });

  test("saved and read back; a broken file reads as the defaults", () => {
    const file = join(scratch(), "sub", "settings.json");
    expect(loadSettings(file)).toEqual(DEFAULT_SETTINGS);
    saveSettings(file, { ...DEFAULT_SETTINGS, quickAddShortcut: "Control+Alt+Space", openAtLogin: false });
    expect(loadSettings(file)).toEqual({ ...DEFAULT_SETTINGS, quickAddShortcut: "Control+Alt+Space", openAtLogin: false });
    writeFileSync(file, "{ not json");
    expect(loadSettings(file)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("window place", () => {
  const screen = [{ x: 0, y: 0, width: 1512, height: 944 }];

  test("reopens where it was, unless that's off every screen now (it keeps its size)", () => {
    const file = join(scratch(), "window.json");
    expect(restoreWindow(file, screen).bounds).toEqual({ width: 1280, height: 840 });
    saveWindow(file, { bounds: { x: 100, y: 50, width: 1100, height: 800 }, maximized: true });
    expect(restoreWindow(file, screen)).toEqual({ bounds: { x: 100, y: 50, width: 1100, height: 800 }, maximized: true });
    saveWindow(file, { bounds: { x: 3000, y: 50, width: 1100, height: 800 }, maximized: false });
    expect(restoreWindow(file, screen)).toEqual({ bounds: { width: 1100, height: 800 }, maximized: false });
    saveWindow(file, { bounds: { x: 0, y: 0, width: 10, height: 10 }, maximized: false });
    expect(restoreWindow(file, screen).bounds).toEqual({ width: 1280, height: 840 });
  });
});

describe("folevi:// links", () => {
  test("open a note (with its block), an app page, a new note or Quick Add; nothing else", () => {
    expect(parseDeepLink("folevi://d/01JAZ3XQ5V8K2M4N6P7R9S0T1U")).toEqual({ type: "open", path: "/d/01JAZ3XQ5V8K2M4N6P7R9S0T1U" });
    expect(parseDeepLink("folevi://d/01jaz3xq5v8k2m4n6p7r9s0t1u#b123")).toEqual({ type: "open", path: "/d/01JAZ3XQ5V8K2M4N6P7R9S0T1U#b123" });
    expect(parseDeepLink("folevi://d/01JAZ3XQ5V8K2M4N6P7R9S0T1U#block-01JAZ3XQ5V8K2M4N6P7R9S0T1V")).toEqual({ type: "open", path: "/d/01JAZ3XQ5V8K2M4N6P7R9S0T1U#block-01JAZ3XQ5V8K2M4N6P7R9S0T1V" });
    expect(parseDeepLink("folevi:///d/01JAZ3XQ5V8K2M4N6P7R9S0T1U")).toEqual({ type: "open", path: "/d/01JAZ3XQ5V8K2M4N6P7R9S0T1U" });
    expect(parseDeepLink("folevi://tasks/today")).toEqual({ type: "open", path: "/tasks/today" });
    expect(parseDeepLink("folevi://")).toEqual({ type: "open", path: "/documents" });
    expect(parseDeepLink("folevi://new")).toEqual({ type: "new-note" });
    expect(parseDeepLink("folevi://quick-add")).toEqual({ type: "quick-add" });
    for (const bad of ["folevi://d/nope", "folevi://d/01JAZ3XQ5V8K2M4N6P7R9S0T1U/x", "folevi://admin", "folevi://d/%2F%2Fevil.com", "folevi://tasks/..%2F..%2Fx", "https://app.folevi.com/d/01JAZ3XQ5V8K2M4N6P7R9S0T1U", "folevi://new/x"]) {
      expect(parseDeepLink(bad)).toBeNull();
    }
  });

  test("a Google or Apple sign-in starts only on Folevi's /app-google page and ends only on folevi://auth/google", () => {
    expect(isSignInStart("https://app.folevi.com/app-google?client_id=folevi-app&state=x")).toBe(true);
    // Sign in with Apple goes the same way (the same page, with provider=apple), so Mac apps already installed handle it.
    expect(isSignInStart("https://app.folevi.com/app-google?client_id=folevi-app&state=x&provider=apple")).toBe(true);
    for (const bad of ["https://evil.com/app-google", "https://app.folevi.com/signin", "http://app.folevi.com/app-google", "folevi://auth/google"]) expect(isSignInStart(bad)).toBe(false);
    expect(isSignInReturn("folevi://auth/google?code=abc&state=x")).toBe(true);
    for (const bad of ["folevi://auth/other?code=abc", "folevi://d/01JAZ3XQ5V8K2M4N6P7R9S0T1U", "https://app.folevi.com/auth/google", `folevi://auth/google?code=${"a".repeat(1200)}`]) expect(isSignInReturn(bad)).toBe(false);
  });

  test("a dragged note's file name is safe for Finder", () => {
    expect(dragFileName("Trip: day 1/2", "md")).toBe("Trip- day 1-2.md");
    expect(dragFileName("..hidden", "md")).toBe("hidden.md");
    expect(dragFileName("", "md")).toBe("Untitled.md");
  });
});
