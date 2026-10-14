import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { cleanSettings, DEFAULT_SETTINGS, isValidShortcut, loadSettings, saveSettings } from "./settings";
import { appUrl, dragFileName, isAppUrl, isExternalSafe, parseDeepLink } from "./urls";
import { restoreWindow, saveWindow } from "./windowState";

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

  test("paths stay inside the app", () => {
    expect(appUrl("/d/01ABC")).toBe("https://app.folevi.com/d/01ABC");
    expect(appUrl("//evil.example/x")).toBe("https://app.folevi.com/");
    expect(appUrl("https://evil.example/")).toBe("https://app.folevi.com/");
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
    expect(parseDeepLink("folevi:///d/01JAZ3XQ5V8K2M4N6P7R9S0T1U")).toEqual({ type: "open", path: "/d/01JAZ3XQ5V8K2M4N6P7R9S0T1U" });
    expect(parseDeepLink("folevi://tasks/today")).toEqual({ type: "open", path: "/tasks/today" });
    expect(parseDeepLink("folevi://")).toEqual({ type: "open", path: "/documents" });
    expect(parseDeepLink("folevi://new")).toEqual({ type: "new-note" });
    expect(parseDeepLink("folevi://quick-add")).toEqual({ type: "quick-add" });
    for (const bad of ["folevi://d/nope", "folevi://d/01JAZ3XQ5V8K2M4N6P7R9S0T1U/x", "folevi://admin", "folevi://d/%2F%2Fevil.com", "folevi://tasks/..%2F..%2Fx", "https://app.folevi.com/d/01JAZ3XQ5V8K2M4N6P7R9S0T1U", "folevi://new/x"]) {
      expect(parseDeepLink(bad)).toBeNull();
    }
  });

  test("a dragged note's file name is safe for Finder", () => {
    expect(dragFileName("Trip: day 1/2", "md")).toBe("Trip- day 1-2.md");
    expect(dragFileName("..hidden", "md")).toBe("hidden.md");
    expect(dragFileName("", "md")).toBe("Untitled.md");
  });
});
