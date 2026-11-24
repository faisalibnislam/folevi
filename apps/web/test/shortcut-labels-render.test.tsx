import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ariaShortcut, IconButton, Kbd } from "@/components/ui/Button";
import { withKeyLabels } from "@/lib/shortcuts";

// One web app on every system: a shortcut on screen reads ⌘K on Apple's systems and Ctrl+K on Windows, Linux,
// Android and Chromebooks. The server can't know which, so it draws the Mac's and the page switches once it runs.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const platform = (value: string) => vi.spyOn(navigator, "platform", "get").mockReturnValue(value);

/** Renders into the page (hydration's second pass included) and returns the container. */
function render(node: ReactNode): HTMLElement {
  const el = document.createElement("div");
  document.body.append(el);
  act(() => createRoot(el).render(node));
  return el;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("shortcut labels on screen", () => {
  test("a button's tooltip and its shortcut for assistive tech, on Windows", () => {
    platform("Win32");
    const button = render(<IconButton label="New note" shortcut="⌘⌥N" />).querySelector("button")!;
    expect(button.getAttribute("title")).toBe("New note (Ctrl+Alt+N)");
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Control+Alt+N");
  });

  test("on a Mac they stay the Mac's", () => {
    platform("MacIntel");
    const button = render(<IconButton label="New note" shortcut="⌘⌥N" />).querySelector("button")!;
    expect(button.getAttribute("title")).toBe("New note (⌘⌥N)");
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Meta+Alt+N");
  });

  test("a key cap on Linux", () => {
    platform("Linux x86_64");
    expect(render(<Kbd>⌘K</Kbd>).querySelector("kbd")!.textContent).toBe("Ctrl+K");
  });

  test("the server draws the Mac's, so the first paint matches it", () => {
    platform("Win32");
    expect(renderToString(<Kbd>⌘K</Kbd>)).toContain("⌘K");
  });

  test("ARIA writes ⌘ as Control off Apple's systems, once", () => {
    expect(ariaShortcut("⌘⇧K", false)).toBe("Control+Shift+K");
    expect(ariaShortcut("⌘⌃K", false)).toBe("Control+K");
    expect(ariaShortcut("⌘⇧K")).toBe("Meta+Shift+K");
  });

  test("hints with several shortcuts in them", () => {
    expect(withKeyLabels("Shortcuts: ⌘⌥0–3 headings, Tab / ⇧Tab to nest, ⌥⇧↑↓ to move, ⌘. for block options.", false)).toBe(
      "Shortcuts: Ctrl+Alt+0–3 headings, Tab / Shift+Tab to nest, Alt+Shift+↑↓ to move, Ctrl+. for block options.",
    );
    expect(withKeyLabels("Show all tabs (⌘⇧\\)", false)).toBe("Show all tabs (Ctrl+Shift+\\)");
  });
});
