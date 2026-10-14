// The desktop apps' shortcut format and labels (lib/desktop.ts): the Mac's symbols, Windows' names, and
// the room Windows' window buttons take at the top right of the tab strip.
import { describe, expect, test } from "vitest";
import { acceleratorFrom, defaultQuickAddShortcut, deviceName, shortcutLabel, WINDOW_CONTROLS_WIDTH, windowControlsWidth } from "@/lib/desktop";

const press = (key: string, code: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
  key,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("shortcut labels", () => {
  test("the Mac writes symbols, in the Mac's order", () => {
    expect(shortcutLabel("Alt+Space")).toBe("⌥Space");
    expect(shortcutLabel("Command+Shift+K", "mac")).toBe("⇧⌘K");
    expect(shortcutLabel("Control+Alt+Space", "mac")).toBe("⌃⌥Space");
    expect(shortcutLabel("")).toBe("None");
  });

  test("Windows writes names joined with +, Ctrl first", () => {
    expect(shortcutLabel("Control+Alt+Space", "windows")).toBe("Ctrl+Alt+Space");
    expect(shortcutLabel("Alt+Control+Space", "windows")).toBe("Ctrl+Alt+Space");
    expect(shortcutLabel("Shift+Control+K", "windows")).toBe("Ctrl+Shift+K");
    expect(shortcutLabel("Super+Shift+K", "windows")).toBe("Win+Shift+K");
    expect(shortcutLabel("Control+Return", "windows")).toBe("Ctrl+Enter");
    expect(shortcutLabel("Alt+F5", "windows")).toBe("Alt+F5");
    expect(shortcutLabel("", "windows")).toBe("None");
  });

  test("Quick Add's default: ⌥Space on a Mac, Ctrl+Alt+Space on Windows", () => {
    expect(shortcutLabel(defaultQuickAddShortcut("mac"), "mac")).toBe("⌥Space");
    expect(shortcutLabel(defaultQuickAddShortcut("windows"), "windows")).toBe("Ctrl+Alt+Space");
    expect(deviceName("mac")).toBe("this Mac");
    expect(deviceName("windows")).toBe("this PC");
  });
});

describe("recording a shortcut", () => {
  test("on a Mac, ⌘ is Command", () => {
    expect(acceleratorFrom(press(" ", "Space", { altKey: true }))).toBe("Alt+Space");
    expect(acceleratorFrom(press("K", "KeyK", { metaKey: true, shiftKey: true }), "mac")).toBe("Command+Shift+K");
  });

  test("on Windows, Ctrl+Alt+Space is Control+Alt+Space and the Windows key is Super", () => {
    expect(acceleratorFrom(press(" ", "Space", { ctrlKey: true, altKey: true }), "windows")).toBe("Control+Alt+Space");
    expect(acceleratorFrom(press("K", "KeyK", { metaKey: true, shiftKey: true }), "windows")).toBe("Super+Shift+K");
    expect(acceleratorFrom(press("Enter", "Enter", { ctrlKey: true }), "windows")).toBe("Control+Return");
    // Still needs a modifier other than Shift, and isn't done while only modifiers are held.
    expect(acceleratorFrom(press("K", "KeyK", { shiftKey: true }), "windows")).toBeNull();
    expect(acceleratorFrom(press("Control", "ControlLeft", { ctrlKey: true }), "windows")).toBeNull();
    expect(acceleratorFrom(press("OS", "MetaLeft", { metaKey: true }), "windows")).toBeNull();
  });

  test("what's recorded reads back the way the system writes it", () => {
    const shortcut = acceleratorFrom(press(" ", "Space", { ctrlKey: true, altKey: true }), "windows")!;
    expect(shortcutLabel(shortcut, "windows")).toBe("Ctrl+Alt+Space");
  });
});

describe("Windows' window buttons", () => {
  test("the strip leaves room for them: the window's width beyond the usable title bar area", () => {
    expect(windowControlsWidth({ x: 0, width: 1142, height: 56 }, 1280)).toBe(138);
    // Larger text or scaling makes them wider.
    expect(windowControlsWidth({ x: 0, width: 1096.4, height: 56 }, 1280)).toBe(184);
  });

  test("without the overlay's numbers (or with nonsense) it's the usual three buttons", () => {
    expect(WINDOW_CONTROLS_WIDTH).toBe(138);
    expect(windowControlsWidth(null, 1280)).toBe(138);
    expect(windowControlsWidth(undefined, 1280)).toBe(138);
    expect(windowControlsWidth({ x: 0, width: 0, height: 0 }, 1280)).toBe(138);
    expect(windowControlsWidth({ x: 0, width: 1280, height: 56 }, 1280)).toBe(138);
    expect(windowControlsWidth({ x: 0, width: 200, height: 56 }, 1280)).toBe(138);
    expect(windowControlsWidth({ x: 0, width: 1142, height: 56 }, 0)).toBe(138);
  });
});
