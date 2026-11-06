// The showcase's iPhone: this frame draws the iPhone app's own interface (components/iphone), as the iOS app's
// web view does. It says what the app checks (lib/nativeApp.ts inIosApp, lib/iphone.ts isIphoneApp): an iPhone's
// user agent, the bridge's platform and <html data-native="ios">. A frame has no safe areas, so the iPhone 17
// Pro's (62 pt top, 34 pt bottom) are written into the page's styles where they read env(safe-area-inset-*).

const INSETS: Record<string, string> = { top: "62px", bottom: "34px", left: "0px", right: "0px" };
const ENV = /env\(\s*safe-area-inset-(top|bottom|left|right)\s*(?:,[^()]*(?:\([^()]*\)[^()]*)*)?\)/g;

export const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

function withInsets(css: string): string {
  return css.replace(ENV, (_, side: string) => INSETS[side] ?? "0px");
}

/** Copies a stylesheet with the insets filled in, and turns the original off. */
async function rewrite(node: HTMLLinkElement | HTMLStyleElement): Promise<void> {
  if (node.dataset.showcaseInsets) return;
  node.dataset.showcaseInsets = "1";
  let css: string;
  if (node instanceof HTMLLinkElement) {
    try {
      css = await (await fetch(node.href)).text();
    } catch {
      return;
    }
  } else css = node.textContent ?? "";
  if (!ENV.test(css)) return;
  ENV.lastIndex = 0;
  const copy = document.createElement("style");
  copy.dataset.showcaseInsets = "copy";
  // Relative urls in a linked sheet resolve against the sheet, so they're made absolute first.
  const base = node instanceof HTMLLinkElement ? node.href : location.href;
  copy.textContent = withInsets(css).replace(/url\((['"]?)(?!data:|https?:|\/)([^'")]+)\1\)/g, (_, q: string, u: string) => `url(${q}${new URL(u, base).href}${q})`);
  node.after(copy);
  if (node instanceof HTMLLinkElement) node.disabled = true;
  else node.textContent = "";
}

function rewriteAll(): void {
  for (const n of document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style:not([data-showcase-insets])')) void rewrite(n);
}

export function fakePhone(): void {
  try {
    Object.defineProperty(navigator, "userAgent", { value: PHONE_UA, configurable: true });
    Object.defineProperty(navigator, "maxTouchPoints", { value: 5, configurable: true });
  } catch {
    // Not every browser lets a page say this; the bridge's platform still does.
  }
  const bridge = {
    platform: "ios",
    version: "1.0",
    haptic: () => undefined,
    setStatusBar: () => undefined,
    openExternal: async () => true,
    getSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }),
    setSettings: async () => ({ lock: false, lockAfter: 0, method: "faceID" }),
    onCommand: () => () => undefined,
  };
  Object.defineProperty(window, "foleviNative", { value: bridge, configurable: true });
  document.documentElement.setAttribute("data-native", "ios");
  rewriteAll();
  new MutationObserver(rewriteAll).observe(document.head, { childList: true, subtree: true });
}
