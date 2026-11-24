// Folevi for Windows' own parts: the keys it adds, how it was started, the title bar's colors, the taskbar badge,
// the update feeds, sign-in's start page, the version it carries and how it's built (both architectures, natively).
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { join, resolve } from "node:path";
import { keyAction, type KeyInput } from "./keys";
import { linkFromArgs, startedHidden, HIDDEN_ARG } from "./launch";
import { accentColor, CAPTION_HEIGHT, captionColors, cleanTheme, windowBackground } from "./chrome";
import { badgeDescription, badgePixels, badgePng, badgeText, encodePng } from "./badge";
import { canUpdate, feedUrl, UPDATE_BASE_URL } from "./updateFeed";
import { cleanSignInOptions, signInStart } from "./authBridge";
import { DEFAULT_SETTINGS, isValidShortcut } from "./settings";
import { linkTarget, useBundledApp, useRemoteApp } from "./urls";

const DESKTOP = resolve(__dirname, "..");
const REPO = resolve(DESKTOP, "../..");

const key = (k: string, mods: Partial<Pick<KeyInput, "control" | "alt" | "shift" | "meta">> = {}, code?: string): KeyInput => ({
  type: "keyDown",
  key: k,
  code,
  control: false,
  alt: false,
  shift: false,
  meta: false,
  ...mods,
});

describe("keys Folevi adds on Windows (keys.ts)", () => {
  test("tabs, as in a browser, go to the page as its menu commands", () => {
    expect(keyAction(key("t", { control: true }))).toEqual({ kind: "menu", id: "file.new-tab" });
    expect(keyAction(key("w", { control: true }))).toEqual({ kind: "menu", id: "file.close-tab" });
    expect(keyAction(key("F4", { control: true }))).toEqual({ kind: "menu", id: "file.close-tab" });
    expect(keyAction(key("T", { control: true, shift: true }))).toEqual({ kind: "menu", id: "file.reopen-closed-tab" });
    expect(keyAction(key("Tab", { control: true }))).toEqual({ kind: "menu", id: "go.next-tab" });
    expect(keyAction(key("Tab", { control: true, shift: true }))).toEqual({ kind: "menu", id: "go.previous-tab" });
    expect(keyAction(key("PageDown", { control: true }))).toEqual({ kind: "menu", id: "go.next-tab" });
    expect(keyAction(key("3", { control: true }, "Digit3"))).toEqual({ kind: "menu", id: "go.tab-3" });
    expect(keyAction(key("9", { control: true }, "Numpad9"))).toEqual({ kind: "menu", id: "go.tab-9" });
    expect(keyAction(key("|", { control: true, shift: true }, "Backslash"))).toEqual({ kind: "menu", id: "file.tab-overview" });
  });

  test("Back and Forward with Alt and the arrows, as in File Explorer and Edge", () => {
    expect(keyAction(key("ArrowLeft", { alt: true }))).toEqual({ kind: "menu", id: "go.back" });
    expect(keyAction(key("ArrowRight", { alt: true }))).toEqual({ kind: "menu", id: "go.forward" });
  });

  test("windows, printing, zoom, full screen and Settings", () => {
    expect(keyAction(key("N", { control: true, shift: true }))).toEqual({ kind: "new-window" });
    expect(keyAction(key("W", { control: true, shift: true }))).toEqual({ kind: "close-window" });
    expect(keyAction(key("p", { control: true }))).toEqual({ kind: "print" });
    expect(keyAction(key("=", { control: true }))).toEqual({ kind: "zoom", by: 1 });
    expect(keyAction(key("-", { control: true }))).toEqual({ kind: "zoom", by: -1 });
    expect(keyAction(key("0", { control: true }))).toEqual({ kind: "zoom", by: 0 });
    expect(keyAction(key("F11"))).toEqual({ kind: "fullscreen" });
    expect(keyAction(key(",", { control: true }))).toEqual({ kind: "settings" });
  });

  test("everything else stays the page's: its own Ctrl shortcuts, typing, AltGr and key releases", () => {
    for (const k of ["k", "b", "i", "n", "f", "z", "c", "v", "a", "s", "Enter"]) expect(keyAction(key(k, { control: true }))).toBeNull();
    expect(keyAction(key("t"))).toBeNull();
    expect(keyAction(key("w", { control: true, alt: true }))).toBeNull();
    expect(keyAction(key("t", { control: true, meta: true }))).toBeNull();
    expect(keyAction({ ...key("t", { control: true }), type: "keyUp" })).toBeNull();
    expect(keyAction(key("Tab"))).toBeNull();
  });

  test("a development run on a Mac uses ⌘ instead of Ctrl", () => {
    expect(keyAction(key("t", { meta: true }), { mac: true })).toEqual({ kind: "menu", id: "file.new-tab" });
    expect(keyAction(key("t", { control: true }), { mac: true })).toBeNull();
  });
});

describe("how the app was started (launch.ts)", () => {
  test("a folevi:// link among the arguments, as Windows passes it", () => {
    expect(linkFromArgs(["C:\\Program Files\\Folevi\\Folevi.exe", "folevi://d/01J0000000000000000000000A"])).toBe("folevi://d/01J0000000000000000000000A");
    expect(linkFromArgs(["Folevi.exe", "--allow-file-access", "FOLEVI://new"])).toBe("FOLEVI://new");
    expect(linkFromArgs(["Folevi.exe", "https://folevi.com"])).toBeNull();
    expect(linkFromArgs(["Folevi.exe", `folevi://${"x".repeat(3000)}`])).toBeNull();
  });

  test("a start at sign-in stays in the notification area", () => {
    expect(HIDDEN_ARG).toBe("--hidden");
    expect(startedHidden(["Folevi.exe", "--hidden"])).toBe(true);
    expect(startedHidden(["Folevi.exe"])).toBe(false);
  });
});

describe("the window's top (chrome.ts)", () => {
  test("clear caption buttons with symbols in the page's ink, 48 px tall", () => {
    expect(CAPTION_HEIGHT).toBe(48);
    expect(captionColors(false)).toEqual({ color: "#00000000", symbolColor: "#1C1C1E", height: 48 });
    expect(captionColors(true).symbolColor).toBe("#F2F2F2");
    expect(windowBackground(false)).toBe("#FFFFFF");
    expect(windowBackground(true)).toBe("#0E0E0F");
  });

  test("Windows' accent color as #RRGGBB, anything else none", () => {
    expect(accentColor("0078d4ff")).toBe("#0078D4");
    expect(accentColor("#a1b2c3")).toBe("#A1B2C3");
    expect(accentColor("")).toBeNull();
    expect(accentColor(false)).toBeNull();
    expect(accentColor("red")).toBeNull();
  });

  test("the page's look is checked", () => {
    expect(cleanTheme({ dark: true })).toEqual({ dark: true });
    expect(cleanTheme({ dark: "yes" })).toBeNull();
    expect(cleanTheme(null)).toBeNull();
  });
});

describe("the taskbar badge (badge.ts)", () => {
  test("the count as Windows shows it: up to 9, then 9+", () => {
    expect(badgeText(0)).toBe("");
    expect(badgeText(-2)).toBe("");
    expect(badgeText(Number.NaN)).toBe("");
    expect(badgeText(4)).toBe("4");
    expect(badgeText(12)).toBe("9+");
    expect(badgeDescription(3)).toBe("3 unread");
    expect(badgeDescription(40)).toBe("More than 9 unread");
    expect(badgeDescription(0)).toBe("");
  });

  test("a real 32 px PNG: a red circle, clear corners, white figures", () => {
    expect(badgePng(0)).toBeNull();
    const png = badgePng(5)!;
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(32);
    expect(png.readUInt32BE(20)).toBe(32);
    // The IDAT holds every row (a filter byte and 32 RGBA pixels each).
    const idat = png.indexOf("IDAT");
    const rows = inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)));
    expect(rows.length).toBe(32 * (32 * 4 + 1));
    const px = badgePixels("5");
    const at = (x: number, y: number) => [...px.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4)];
    expect(at(0, 0)[3]).toBe(0);
    expect(at(16, 3)).toEqual([0xd9, 0x30, 0x25, 255]);
    expect(px.some((_, i) => i % 4 === 0 && px[i] === 255 && px[i + 1] === 255 && px[i + 2] === 255)).toBe(true);
    expect(encodePng(new Uint8Array(4), 1).length).toBeGreaterThan(40);
  });
});

describe("updates (updateFeed.ts)", () => {
  test("one feed per architecture on folevi.com, as the builds publish them", () => {
    expect(UPDATE_BASE_URL).toBe("https://folevi.com/download/windows");
    expect(feedUrl("arm64", UPDATE_BASE_URL)).toBe("https://folevi.com/download/windows/arm64");
    expect(feedUrl("x64", "https://example.test/feeds/")).toBe("https://example.test/feeds/x64");
    expect(feedUrl("ia32", UPDATE_BASE_URL)).toBeNull();
    const builder = readFileSync(join(DESKTOP, "electron-builder.yml"), "utf8");
    expect(builder).toContain("url: https://folevi.com/download/windows/${arch}");
  });

  test("only an installed Windows copy updates itself", () => {
    const base = { platform: "win32", packaged: true, env: {}, portable: false };
    expect(canUpdate(base)).toBe(true);
    expect(canUpdate({ ...base, portable: true })).toBe(false);
    expect(canUpdate({ ...base, packaged: false })).toBe(false);
    expect(canUpdate({ ...base, platform: "darwin" })).toBe(false);
    expect(canUpdate({ ...base, env: { FOLEVI_UPDATES: "off" } })).toBe(false);
  });
});

describe("sign-in's start page (authBridge.ts)", () => {
  const o = { challenge: "c", state: "s", clientId: "folevi-shell", redirectUri: "folevi://auth/callback" };
  test("Google and Apple go straight to /app-google, everything else to /connect", () => {
    const service = new URL("https://app.folevi.com");
    const google = signInStart(service, { ...o, provider: "google" });
    expect(google.pathname).toBe("/app-google");
    expect(google.searchParams.get("provider")).toBe("google");
    expect(google.searchParams.get("code_challenge_method")).toBe("S256");
    expect(signInStart(service, { ...o, provider: "apple" }).searchParams.get("provider")).toBe("apple");
    const plain = signInStart(service, { ...o, provider: "github" });
    expect(plain.pathname).toBe("/connect");
    expect(plain.searchParams.has("provider")).toBe(false);
    expect(signInStart(service, o).pathname).toBe("/connect");
  });

  test("the page's options are checked", () => {
    expect(cleanSignInOptions({ provider: "google" })).toEqual({ provider: "google" });
    expect(cleanSignInOptions({ provider: "evil" })).toEqual({});
    expect(cleanSignInOptions("google")).toEqual({});
  });
});

describe("settings and links", () => {
  test("Quick Add starts as Ctrl+Alt+Space on Windows (Alt+Space is Windows' window menu)", () => {
    if (process.platform !== "darwin") expect(DEFAULT_SETTINGS.quickAddShortcut).toBe("Control+Alt+Space");
    expect(isValidShortcut("Control+Alt+Space")).toBe(true);
    expect(isValidShortcut("Super+Shift+K")).toBe(true);
  });

  test("the app's pages on the website open in the app: the same list as the web app's", () => {
    const routes = readFileSync(join(REPO, "apps/web/src/lib/app/routes.ts"), "utf8");
    const web = new Set([.../APP_ROUTE_HEADS = new Set\(\[([\s\S]*?)\]\)/.exec(routes)![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
    useBundledApp(null);
    try {
      for (const head of ["documents", "d", "tasks", "calendar", "vault", "settings", "quick-add"]) {
        expect(web.has(head)).toBe(true);
        expect(linkTarget(`https://app.folevi.com/${head}/x`).kind).toBe("app");
      }
      expect(linkTarget("https://app.folevi.com/s/abc").kind).toBe("browser");
    } finally {
      useRemoteApp();
    }
  });
});

describe("the build (electron-builder.yml, scripts/)", () => {
  const yml = readFileSync(join(DESKTOP, "electron-builder.yml"), "utf8");
  const main = readFileSync(join(DESKTOP, "src/main.ts"), "utf8");

  test("installers and ZIPs for Windows on ARM and on Intel/AMD, never one build for both", () => {
    expect(yml).toMatch(/target: nsis\s+arch:\s+- x64\s+- arm64/);
    expect(yml).toMatch(/target: zip\s+arch:\s+- x64\s+- arm64/);
    expect(yml).toContain("artifactName: Folevi-Setup-${version}-${arch}.${ext}");
    const dist = readFileSync(join(DESKTOP, "scripts/dist.mjs"), "utf8");
    expect(dist).toContain("One architecture a run");
  });

  test("Windows ties notifications to the same id the installer gives the shortcut", () => {
    const appId = /^appId: (\S+)$/m.exec(yml)![1];
    expect(main).toContain(`APP_USER_MODEL_ID = "${appId}"`);
    expect(appId).toBe("com.folevi.windows");
  });

  test("folevi:// links are registered, and no native modules need rebuilding", () => {
    expect(yml).toMatch(/schemes:\s+- folevi/);
    const pkg = JSON.parse(readFileSync(join(DESKTOP, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(["electron-updater"]);
  });

  test("the version is Folevi's one version, in semver form for Windows", async () => {
    const { toSemver, readFoleviVersion } = (await import(join(DESKTOP, "scripts/version.mjs"))) as { toSemver: (v: string) => string; readFoleviVersion: (repo?: string) => string };
    expect(toSemver("1.5.68")).toBe("1.5.68");
    expect(toSemver("2.0.00")).toBe("2.0.0");
    expect(toSemver("1.0.09")).toBe("1.0.9");
    expect(() => toSemver("1.5")).toThrow();
    const pkg = JSON.parse(readFileSync(join(DESKTOP, "package.json"), "utf8")) as { version: string; foleviVersion: string };
    expect(pkg.foleviVersion).toBe(readFoleviVersion(REPO));
    expect(pkg.version).toBe(toSemver(pkg.foleviVersion));
  });

  test("a build people install carries a production Windows export", async () => {
    const { exportProblems, archsFrom } = (await import(join(DESKTOP, "scripts/dist.mjs"))) as {
      exportProblems: (dir: string, o?: { devShell?: boolean; version?: string }) => string[];
      archsFrom: (v: string | null) => string[];
    };
    expect(archsFrom(null)).toEqual(["arm64", "x64"]);
    expect(archsFrom("x64")).toEqual(["x64"]);
    expect(() => archsFrom("ia32")).toThrow();
    expect(exportProblems(join(DESKTOP, "no-such-folder"))[0]).toMatch(/no interface/);
  });
});

describe("where the library is, as Windows says it (library/locations.ts)", () => {
  test("folders in the person's own folder by their File Explorer names", async () => {
    const { displayPath } = await import("./library/locations");
    expect(displayPath("C:\\Users\\Ada\\Documents\\Folevi Library", "C:\\Users\\Ada", "win32")).toBe("Documents › Folevi Library");
    expect(displayPath("C:\\Users\\Ada\\OneDrive\\Notes", "C:\\Users\\Ada", "win32")).toBe("OneDrive › Notes");
    expect(displayPath("D:\\Shared\\Folevi", "C:\\Users\\Ada", "win32")).toBe("D:\\Shared\\Folevi");
    expect(displayPath("/Users/ada/Documents/Folevi Library", "/Users/ada", "darwin")).toBe("~/Documents/Folevi Library");
  });
});
