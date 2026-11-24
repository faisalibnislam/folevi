// The keyboard shortcuts Folevi for Windows adds on top of the page's own (the page is the web app, which already
// has its Ctrl shortcuts). These are the ones a browser keeps for itself, so the web app never binds them: tabs
// (Ctrl+T, Ctrl+W, Ctrl+Shift+T, Ctrl+Tab, Ctrl+1 to Ctrl+9), Back and Forward (Alt+Left, Alt+Right, the mouse's
// side buttons are handled in main.ts), a new window, printing, zoom and full screen. Read from Electron's
// before-input-event, so no menu bar is needed (Windows apps with their own title bar have none).
// Tab commands go to the page as menu commands (apps/web/src/lib/desktop.ts MAC_MENU_COMMANDS), which opens and
// closes tabs exactly as the web app does.

/** What Electron's before-input-event hands over (Input), the parts read here. */
export interface KeyInput {
  type: string;
  key: string;
  code?: string;
  control: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  isAutoRepeat?: boolean;
}

export type KeyAction =
  | { kind: "menu"; id: string }
  | { kind: "new-window" }
  | { kind: "print" }
  | { kind: "zoom"; by: 1 | -1 | 0 }
  | { kind: "fullscreen" }
  | { kind: "devtools" }
  | { kind: "settings" }
  | { kind: "close-window" };

/** The digit a key is (from `code`, so Shift and keyboard layouts don't change it), or null. */
function digit(input: KeyInput): number | null {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(input.code ?? "");
  if (m) return Number(m[1]);
  return /^[1-9]$/.test(input.key) ? Number(input.key) : null;
}

/**
 * The action for a key press, or null to leave it to the page. `mod` is Ctrl on Windows (and ⌘ when the app runs
 * on a Mac for development, so the same keys can be tried there).
 */
export function keyAction(input: KeyInput, o: { mac?: boolean } = {}): KeyAction | null {
  if (input.type !== "keyDown") return null;
  const mod = o.mac ? input.meta : input.control;
  const other = o.mac ? input.control : input.meta;
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  if (other) return null;

  // F11: full screen; F12 or Ctrl+Shift+I: the developer tools (development builds, main.ts decides).
  if (!mod && !input.alt && !input.shift && key === "F11") return { kind: "fullscreen" };
  if ((!mod && !input.alt && !input.shift && key === "F12") || (mod && input.shift && !input.alt && key === "i")) return { kind: "devtools" };

  // Back and Forward: Alt+Left and Alt+Right, as in every Windows browser and File Explorer.
  if (input.alt && !mod && !input.shift && key === "ArrowLeft") return { kind: "menu", id: "go.back" };
  if (input.alt && !mod && !input.shift && key === "ArrowRight") return { kind: "menu", id: "go.forward" };

  if (!mod || input.alt) return null;
  // Ctrl+Tab and Ctrl+Shift+Tab, Ctrl+PageDown and Ctrl+PageUp: the next and previous tab.
  if (key === "Tab") return { kind: "menu", id: input.shift ? "go.previous-tab" : "go.next-tab" };
  if (!input.shift && key === "PageDown") return { kind: "menu", id: "go.next-tab" };
  if (!input.shift && key === "PageUp") return { kind: "menu", id: "go.previous-tab" };
  const n = digit(input);
  if (n !== null && !input.shift) return { kind: "menu", id: `go.tab-${n}` };
  if (input.shift) {
    if (key === "t") return { kind: "menu", id: "file.reopen-closed-tab" };
    if (key === "n") return { kind: "new-window" };
    if (key === "w") return { kind: "close-window" };
    if (key === "\\" || input.code === "Backslash") return { kind: "menu", id: "file.tab-overview" };
    return null;
  }
  if (key === "t") return { kind: "menu", id: "file.new-tab" };
  if (key === "w" || key === "F4") return { kind: "menu", id: "file.close-tab" };
  if (key === "p") return { kind: "print" };
  if (key === ",") return { kind: "settings" };
  if (key === "=" || key === "+") return { kind: "zoom", by: 1 };
  if (key === "-") return { kind: "zoom", by: -1 };
  if (key === "0") return { kind: "zoom", by: 0 };
  return null;
}
