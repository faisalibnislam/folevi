import { afterEach, describe, expect, it, vi } from "vitest";
import { isIpadLayout, isIphoneApp } from "@/lib/iphone";
import { fold, formFactor, markPlatform, os, shell, touchPrimary, usesCommandKey } from "@/lib/platform";
import { PLATFORM_BOOT_SNIPPET } from "@/lib/platformQueries";

// One layout rule everywhere (the owner, 2026-11-24): width decides phone or not; touch decides tablet or desktop;
// the app the page is in only adds its own touches.

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/2.0";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) FoleviiOS/2.0";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
const CHROMEOS = "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

/** A window `width` wide, used by touch or not, with this user agent and touch points. */
function windowLike(width: number, opts: { touch?: boolean; ua?: string; touchPoints?: number } = {}) {
  vi.stubGlobal("matchMedia", (query: string) => {
    const max = /max-width: (\d+)px/.exec(query);
    const matches = max ? width <= Number(max[1]) : query.includes("pointer: coarse") ? !!opts.touch : false;
    return { matches, media: query, addEventListener: () => undefined, removeEventListener: () => undefined };
  });
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(opts.ua ?? MAC);
  Object.defineProperty(navigator, "maxTouchPoints", { value: opts.touchPoints ?? (opts.touch ? 5 : 0), configurable: true });
}

const app = (platform: "ios" | "android") => Object.defineProperty(window, "foleviNative", { value: { platform }, configurable: true });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as { foleviNative?: unknown }).foleviNative;
  for (const a of ["data-desktop", "data-native", "data-form", "data-shell", "data-os", "data-touch", "data-fold", "style"]) document.documentElement.removeAttribute(a);
  document.documentElement.style.cssText = "";
});

describe("formFactor: width decides, on every device", () => {
  it("a phone's browser is a phone", () => {
    windowLike(390, { touch: true, ua: IPHONE });
    expect(formFactor()).toBe("phone");
    expect(isIphoneApp()).toBe(true);
  });

  it("a narrow window on a computer is a phone too (the owner's pick)", () => {
    windowLike(600, { ua: WINDOWS });
    expect(formFactor()).toBe("phone");
    expect(isIphoneApp()).toBe(true);
  });

  it("an open iPhone Duo is an iPhone 951 pt wide, and gets the tablet layout", () => {
    windowLike(951, { touch: true, ua: IPHONE });
    app("ios");
    expect(formFactor()).toBe("tablet");
    expect(isIphoneApp()).toBe(false);
    expect(isIpadLayout()).toBe(true);
  });

  it("the folded Duo (and any iPhone) is a phone", () => {
    windowLike(390, { touch: true, ua: IPHONE });
    app("ios");
    expect(formFactor()).toBe("phone");
  });

  it("an iPad keeps the tablet layout with a keyboard and trackpad attached", () => {
    windowLike(1180, { touch: false, ua: IPAD, touchPoints: 5 });
    app("ios");
    expect(formFactor()).toBe("tablet");
  });

  it("the app's tablet look needs a touch screen (the iOS app's bridge in a desktop test browser stays a desktop)", () => {
    windowLike(1280, { touch: false, ua: MAC, touchPoints: 0 });
    app("ios");
    expect(formFactor()).toBe("desktop");
  });

  it("an Android tablet and a tablet's browser get the tablet layout", () => {
    windowLike(1280, { touch: true, ua: ANDROID.replace(" Mobile", "") });
    app("android");
    expect(formFactor()).toBe("tablet");
    delete (window as { foleviNative?: unknown }).foleviNative;
    windowLike(820, { touch: true, ua: IPAD, touchPoints: 5 });
    expect(formFactor()).toBe("tablet");
  });

  it("a laptop with a touch screen it can hover on stays a desktop", () => {
    windowLike(1440, { touch: false, ua: CHROMEOS, touchPoints: 10 });
    expect(formFactor()).toBe("desktop");
    expect(touchPrimary()).toBe(false);
  });

  it("the desktop apps are desktops, even on a touch screen", () => {
    windowLike(1440, { touch: true, ua: WINDOWS });
    document.documentElement.setAttribute("data-desktop", "windows");
    expect(shell()).toBe("windows");
    expect(formFactor()).toBe("desktop");
  });
});

describe("shell and os", () => {
  it("name the app, else read the system from the browser", () => {
    windowLike(1440, { ua: WINDOWS });
    expect([shell(), os(), usesCommandKey()]).toEqual(["browser", "windows", false]);
    windowLike(1440, { ua: MAC });
    expect([shell(), os(), usesCommandKey()]).toEqual(["browser", "mac", true]);
    windowLike(1024, { ua: MAC, touch: true, touchPoints: 5 });
    expect(os()).toBe("ios");
    windowLike(1440, { ua: CHROMEOS });
    expect(os()).toBe("chromeos");
    document.documentElement.setAttribute("data-desktop", "linux");
    expect([shell(), os(), usesCommandKey()]).toEqual(["linux", "linux", false]);
    document.documentElement.removeAttribute("data-desktop");
    windowLike(412, { ua: ANDROID, touch: true });
    app("android");
    expect([shell(), os()]).toEqual(["android", "android"]);
  });
});

describe("fold", () => {
  it("is null on a flat screen, and read from the app's marks while partly open (RebuildIPad.swift's contract)", () => {
    windowLike(951, { touch: true, ua: IPHONE });
    expect(fold()).toBeNull();
    const root = document.documentElement;
    root.setAttribute("data-fold", "");
    root.style.setProperty("--fold-start", "470px");
    root.style.setProperty("--fold-end", "482px");
    expect(fold()).toEqual({ orientation: "vertical", start: 470, size: 12 });
    // The page leaves an app's marks alone.
    markPlatform();
    expect(root.getAttribute("data-fold")).toBe("");
    expect(root.style.getPropertyValue("--fold-end")).toBe("482px");
  });

  it("reads Chromium's viewport segments, marks them, and clears only its own marks", () => {
    windowLike(1800, { touch: true, ua: ANDROID });
    const viewport = { segments: [{ x: 0, y: 0, width: 880, height: 1000 }, { x: 920, y: 0, width: 880, height: 1000 }] as { x: number; y: number; width: number; height: number }[] | null };
    Object.defineProperty(window, "viewport", { value: viewport, configurable: true });
    const root = document.documentElement;
    expect(fold()).toEqual({ orientation: "vertical", start: 880, size: 40 });
    markPlatform();
    expect([root.getAttribute("data-fold"), root.style.getPropertyValue("--fold-start"), root.style.getPropertyValue("--fold-end")]).toEqual(["", "880px", "920px"]);
    viewport.segments = null;
    markPlatform();
    expect(root.hasAttribute("data-fold")).toBe(false);
    delete (window as { viewport?: unknown }).viewport;
  });
});

describe("marks on <html>", () => {
  it("markPlatform and the boot script agree on the form", () => {
    for (const [w, touch, ua] of [
      [390, true, IPHONE],
      [820, true, IPAD],
      [1440, false, MAC],
      [600, false, WINDOWS],
    ] as const) {
      windowLike(w, { touch, ua });
      const root = document.documentElement;
      root.removeAttribute("data-form");
      new Function(PLATFORM_BOOT_SNIPPET)();
      const boot = root.getAttribute("data-form");
      markPlatform();
      expect(root.getAttribute("data-form")).toBe(boot);
    }
  });
});

describe("fold: placing things clear of it", () => {
  const foldAt = (start: number, end: number, horizontal = false) => {
    const root = document.documentElement;
    root.setAttribute("data-fold", horizontal ? "horizontal" : "");
    root.style.setProperty("--fold-start", `${start}px`);
    root.style.setProperty("--fold-end", `${end}px`);
  };

  it("reads the app's inline span without computing <html>'s style", () => {
    windowLike(1024, { touch: true, ua: IPHONE });
    foldAt(500, 524);
    const computed = vi.spyOn(window, "getComputedStyle");
    expect(fold()).toEqual({ orientation: "vertical", start: 500, size: 24 });
    expect(computed).not.toHaveBeenCalled();
  });

  it("keeps a popup on its anchor's side of a fold down the middle", async () => {
    const { popupSpan } = await import("@/components/ui/topLayer");
    windowLike(1024, { touch: true, ua: IPHONE });
    expect(popupSpan({ left: 400, right: 440 }).clamp(400, 200)).toBe(400);
    foldAt(500, 524);
    // Left of the fold: its right edge stops 8 px before it.
    expect(popupSpan({ left: 400, right: 440 }).clamp(400, 200)).toBe(500 - 8 - 200);
    // Past the fold: its left edge stays 8 px past it, even when it's too wide for that side.
    expect(popupSpan({ left: 530, right: 560 }).clamp(480, 200)).toBe(524 + 8);
    expect(popupSpan({ left: 530, right: 560 }).clamp(530, 900)).toBe(524 + 8);
    // A fold across leaves the sides alone.
    foldAt(400, 424, true);
    expect(popupSpan({ left: 400, right: 440 }).clamp(400, 200)).toBe(400);
  });

  it("puts a centred dialog past the fold", async () => {
    const { pastFoldFrame } = await import("@/components/ui/Dialog");
    expect(pastFoldFrame(null, null)).toEqual({ room: null, side: null });
    expect(pastFoldFrame({ orientation: "vertical", start: 500, size: 24 }, null)).toEqual({ room: null, side: { left: 540, right: 16, width: "calc(100% - 556px)" } });
    expect(pastFoldFrame({ orientation: "horizontal", start: 400, size: 24 }, { top: 52, bottom: 80 })).toEqual({ room: { top: 440, bottom: 80 }, side: null });
  });
});
