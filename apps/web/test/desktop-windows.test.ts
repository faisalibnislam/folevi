// Folevi for Windows (apps/desktop, data-desktop="windows"): the page writes shortcuts as Windows does, records
// the Windows key as "Super", defaults Quick Add to Ctrl+Alt+Space, names the device "this PC" and checks spelling
// with Folevi's own checker (the Mac and the phones use the system's).
import { afterEach, describe, expect, test } from "vitest";
import { acceleratorFrom, defaultQuickAddShortcut, shortcutLabel, WINDOWS_QUICK_ADD_SHORTCUT, type DesktopBridge } from "@/lib/desktop";
import { deviceWords } from "@/lib/shell/words";
import type { FoleviShell } from "@/lib/shell";

const press = (key: string, code: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
  key,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

afterEach(() => {
  delete (window as { foleviDesktop?: unknown }).foleviDesktop;
  delete (window as { __foleviTestShell?: unknown }).__foleviTestShell;
});

describe("shortcuts on Windows", () => {
  test("labels use Windows' names and order", () => {
    expect(shortcutLabel("Control+Alt+Space", "windows")).toBe("Ctrl+Alt+Space");
    expect(shortcutLabel("Command+Shift+K", "windows")).toBe("Win+Shift+K");
    expect(shortcutLabel("Super+Alt+N", "windows")).toBe("Win+Alt+N");
    expect(shortcutLabel("Alt+Control+Return", "windows")).toBe("Ctrl+Alt+Enter");
    expect(shortcutLabel("", "windows")).toBe("None");
  });

  test("the Windows key is recorded as Super; Ctrl and Alt as on the Mac", () => {
    expect(acceleratorFrom(press("k", "KeyK", { metaKey: true, shiftKey: true }), "windows")).toBe("Super+Shift+K");
    expect(acceleratorFrom(press(" ", "Space", { ctrlKey: true, altKey: true }), "windows")).toBe("Control+Alt+Space");
    expect(acceleratorFrom(press("k", "KeyK", { shiftKey: true }), "windows")).toBeNull();
  });

  test("Quick Add defaults to Ctrl+Alt+Space in the Windows app, Alt+Space on the Mac", () => {
    expect(WINDOWS_QUICK_ADD_SHORTCUT).toBe("Control+Alt+Space");
    expect(defaultQuickAddShortcut("windows")).toBe("Control+Alt+Space");
    expect(defaultQuickAddShortcut("mac")).toBe("Alt+Space");
    window.foleviDesktop = { platform: "windows" } as unknown as DesktopBridge;
    expect(defaultQuickAddShortcut()).toBe("Control+Alt+Space");
  });
});

describe("words on Windows", () => {
  test("the built-in interface calls the device this PC", () => {
    // (The test hook lib/shell reads outside production builds: this isn't a shell build.)
    (window as { __foleviTestShell?: unknown }).__foleviTestShell = { platform: "windows", shellVersion: "1.5.68", initialMode: "local" } as unknown as FoleviShell;
    const w = deviceWords();
    expect(w.here).toBe("this PC");
    expect(w.Here).toBe("This PC");
    expect(w.files).toBe("File Explorer");
    expect(w.signInPlace).toBe("your browser");
    expect(w.ios).toBe(false);
  });
});

describe("Linux", () => {
  test("labels and the Super key", () => {
    expect(shortcutLabel("Control+Alt+Space", "linux")).toBe("Ctrl+Alt+Space");
    expect(shortcutLabel("Super+Shift+K", "linux")).toBe("Super+Shift+K");
    expect(acceleratorFrom(press("k", "KeyK", { metaKey: true, ctrlKey: true }), "linux")).toBe("Super+Control+K");
    expect(defaultQuickAddShortcut("linux")).toBe("Control+Alt+Space");
  });

  test("the device is this computer", () => {
    (window as { __foleviTestShell?: unknown }).__foleviTestShell = { platform: "linux", shellVersion: "1.5.68", initialMode: "local" } as unknown as FoleviShell;
    expect(deviceWords().here).toBe("this computer");
    expect(deviceWords().files).toBe("your file manager");
  });
});

describe("the desktop app's contract (apps/desktop, Tauri)", () => {
  test("the desktop app's default shortcut matches the page's", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const settings = readFileSync(resolve(__dirname, "../../desktop/src-tauri/src/settings.rs"), "utf8");
    expect(settings).toContain(`DEFAULT_QUICK_ADD_SHORTCUT: &str = "${WINDOWS_QUICK_ADD_SHORTCUT}"`);
  });

  test("the caption buttons' room is the variable host.js sets", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const host = readFileSync(resolve(__dirname, "../../desktop/src-tauri/bridge/host.js"), "utf8");
    const css = readFileSync(resolve(__dirname, "../src/app/globals.css"), "utf8");
    expect(host).toContain('"--win-caption-inset"');
    expect(css).toContain(':root[data-desktop="windows"] .ui-tabbar { right: var(--win-caption-inset,');
  });
});
