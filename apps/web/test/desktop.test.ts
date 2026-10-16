// The Mac app's shortcut format and labels (lib/desktop.ts): the Mac's symbols, and what the shortcut
// recorder turns a key press into.
import { describe, expect, test } from "vitest";
import { acceleratorFrom, DEFAULT_QUICK_ADD_SHORTCUT, shortcutLabel } from "@/lib/desktop";

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
    expect(shortcutLabel("Command+Shift+K")).toBe("⇧⌘K");
    expect(shortcutLabel("Control+Alt+Space")).toBe("⌃⌥Space");
    expect(shortcutLabel("Command+Return")).toBe("⌘↩");
    expect(shortcutLabel("Alt+F5")).toBe("⌥F5");
    expect(shortcutLabel("")).toBe("None");
  });

  test("Quick Add's default is ⌥Space", () => {
    expect(DEFAULT_QUICK_ADD_SHORTCUT).toBe("Alt+Space");
    expect(shortcutLabel(DEFAULT_QUICK_ADD_SHORTCUT)).toBe("⌥Space");
  });
});

describe("recording a shortcut", () => {
  test("⌘ is Command, ⌃ is Control, ⌥ is Alt", () => {
    expect(acceleratorFrom(press(" ", "Space", { altKey: true }))).toBe("Alt+Space");
    expect(acceleratorFrom(press("K", "KeyK", { metaKey: true, shiftKey: true }))).toBe("Command+Shift+K");
    expect(acceleratorFrom(press(" ", "Space", { ctrlKey: true, altKey: true }))).toBe("Control+Alt+Space");
    expect(acceleratorFrom(press("Enter", "Enter", { metaKey: true }))).toBe("Command+Return");
  });

  test("letters by their place on the keyboard, not what ⌥ makes them type", () => {
    expect(acceleratorFrom(press("˚", "KeyK", { altKey: true }))).toBe("Alt+K");
  });

  test("it needs a modifier other than Shift, and isn't done while only modifiers are held", () => {
    expect(acceleratorFrom(press("K", "KeyK", { shiftKey: true }))).toBeNull();
    expect(acceleratorFrom(press("Control", "ControlLeft", { ctrlKey: true }))).toBeNull();
    expect(acceleratorFrom(press("Meta", "MetaLeft", { metaKey: true }))).toBeNull();
  });

  test("what's recorded reads back the way the Mac writes it", () => {
    const shortcut = acceleratorFrom(press(" ", "Space", { ctrlKey: true, altKey: true }))!;
    expect(shortcutLabel(shortcut)).toBe("⌃⌥Space");
  });
});
