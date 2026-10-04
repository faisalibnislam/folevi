import { describe, expect, test } from "vitest";
import { keyLabel, withKeyLabels } from "@/lib/shortcuts";

describe("shortcut labels", () => {
  test("Mac labels are kept on a Mac", () => {
    expect(keyLabel("⌘⇧K", true)).toBe("⌘⇧K");
  });
  test("elsewhere they use Ctrl, Alt and Shift, in that order", () => {
    expect(keyLabel("⌘⇧K", false)).toBe("Ctrl+Shift+K");
    expect(keyLabel("⌥⇧↑", false)).toBe("Alt+Shift+↑");
    expect(keyLabel("⇧⌘⌥M", false)).toBe("Ctrl+Alt+Shift+M");
    expect(keyLabel("⌘↵", false)).toBe("Ctrl+Enter");
    expect(keyLabel("⌘⇧⌫", false)).toBe("Ctrl+Shift+Backspace");
    expect(keyLabel("⇧Tab", false)).toBe("Shift+Tab");
    expect(keyLabel("Tab", false)).toBe("Tab");
  });
  test("inside a label", () => {
    expect(withKeyLabels("Bold (⌘B)", false)).toBe("Bold (Ctrl+B)");
    expect(withKeyLabels("Link (⌘⇧K)", false)).toBe("Link (Ctrl+Shift+K)");
  });
});
