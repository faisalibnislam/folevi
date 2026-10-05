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

describe("bookmark addresses", () => {
  test("the real address is taken out of what was pasted next to the field's https://", async () => {
    const { webAddressIn } = await import("@/components/editor/autolink");
    expect(webAddressIn("https://involets.com/")).toBe("https://involets.com/");
    expect(webAddressIn("https://Address:https://involets.com/")).toBe("https://involets.com/");
    expect(webAddressIn("https://https://formkit.app")).toBe("https://formkit.app");
    expect(webAddressIn("Address: https://formkit.app/pricing")).toBe("https://formkit.app/pricing");
    expect(webAddressIn("example.com/page")).toBe("https://example.com/page");
    expect(webAddressIn("https://site.com/?next=https://other.com")).toBe("https://site.com/?next=https://other.com");
    expect(webAddressIn("not an address")).toBeNull();
  });
});
