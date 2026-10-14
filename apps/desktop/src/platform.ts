// What differs between Folevi for Mac and Folevi for Windows, as plain functions (no Electron, so the tests
// run anywhere). main.ts and settings.ts ask these instead of checking process.platform themselves.

/** The two systems the shell is built for. Anything that isn't Windows behaves as the Mac app. */
export type Platform = "mac" | "windows";

export const platformOf = (os: string = process.platform): Platform => (os === "win32" ? "windows" : "mac");

/** Windows' Start menu shortcut, toasts and taskbar group all go by this id (electron-builder.win.yml appId). */
export const WINDOWS_APP_ID = "com.folevi.app";

/**
 * Quick Add's shortcut until the person picks another. Alt+Space (⌥Space) is free on a Mac, but on Windows
 * it opens every window's system menu, so Windows gets Ctrl+Alt+Space.
 */
export const defaultShortcut = (platform: Platform): string => (platform === "windows" ? "Control+Alt+Space" : "Alt+Space");

/**
 * A menu accelerator written the Mac way ("Command+Shift+N") for this system: Windows has no Command key,
 * so it becomes Control there (Ctrl+Shift+N). Electron's CommandOrControl would do the same, but writing
 * Command keeps the Mac menu exactly as it was.
 */
export function menuAccelerator(accelerator: string, platform: Platform): string {
  if (platform === "mac") return accelerator;
  return accelerator
    .split("+")
    .map((part) => (part === "Command" || part === "Cmd" || part === "CommandOrControl" || part === "CmdOrCtrl" ? "Control" : part))
    .join("+");
}

/** Passed by Windows' "open at sign-in" entry, so a launch at sign-in starts quietly (macOS says so itself). */
export const LOGIN_ARG = "--opened-at-login";

/**
 * A folevi:// link among a launch's arguments. Windows starts the app (or hands the running one, via
 * second-instance) the link as an argument; macOS uses open-url instead, so there it's never found.
 */
export function linkFromArgv(argv: readonly string[]): string | null {
  return argv.find((a) => /^folevi:/i.test(a)) ?? null;
}

/**
 * The height of the strip Windows draws its minimize, maximize and close buttons in, at the window's top
 * right: down to the bottom of the web app's tab strip (8 px canvas margin, 4 px inset, 44 px bar).
 */
export const TITLE_BAR_HEIGHT = 56;

/** The window buttons' colours on Windows: drawn over the page (no fill of their own), symbols that read on it. */
export function titleBarOverlay(dark: boolean): { color: string; symbolColor: string; height: number } {
  // Fully transparent, but in the theme's colour: Windows picks the hover shade from it (dark on light).
  return { color: dark ? "#0E0E0F00" : "#FFFFFF00", symbolColor: dark ? "#F2F2F3" : "#1C1C1F", height: TITLE_BAR_HEIGHT };
}

/**
 * The unread dot on Windows' taskbar button (Windows has no number badge like the Dock's): a filled red
 * circle, `size` px square, as raw BGRA pixels for nativeImage.createFromBitmap. Edges are softened by
 * coverage so it stays round at 16 px.
 */
export function badgeDot(size = 16): Buffer {
  const pixels = Buffer.alloc(size * size * 4);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Coverage from a 4 x 4 grid of samples inside the pixel.
      let inside = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if ((x + (sx + 0.5) / 4 - r) ** 2 + (y + (sy + 0.5) / 4 - r) ** 2 <= (r - 0.5) ** 2) inside++;
      const alpha = Math.round((inside / 16) * 255);
      const i = (y * size + x) * 4;
      // Premultiplied BGRA: #E5484D.
      pixels[i] = Math.round((0x4d * alpha) / 255);
      pixels[i + 1] = Math.round((0x48 * alpha) / 255);
      pixels[i + 2] = Math.round((0xe5 * alpha) / 255);
      pixels[i + 3] = alpha;
    }
  }
  return pixels;
}

/** What the taskbar's unread dot says to a screen reader. */
export const badgeDescription = (n: number) => (n === 1 ? "1 unread notification" : `${n > 99 ? "99+" : n} unread notifications`);
