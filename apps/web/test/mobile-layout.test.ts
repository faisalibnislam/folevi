// Which layout the mobile app's page takes (lib/iphone.ts over lib/platform.ts): the phone interface with its bottom
// bar, or the sidebar layout. Width decides, on every device, never the model (the owner, 2026-11-24,
// docs/claude-context/memory/web-everywhere-layout-rules-2026-11-24.md): under 700 px the phone layout, wider the
// sidebar. So a phone turned sideways gets the sidebar, iPhone Duo open across gets the sidebar and held upright
// (669 points wide) the phone layout, and an Android tablet or an open foldable the sidebar.
import { afterEach, describe, expect, test } from "vitest";
import { isIpadLayout, isIphoneApp } from "@/lib/iphone";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FoleviiOS/2.0";
const IPAD_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) FoleviiOS/2.0";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36 FoleviAndroid/2.0";

/** A tiny evaluator for the media queries lib/iphone.ts asks (min/max width and height, "and", ","). */
function matches(query: string, width: number, height: number): boolean {
  return query.split(",").some((part) =>
    part
      .split(" and ")
      .map((c) => c.trim().replace(/^\(|\)$/g, ""))
      .every((c) => {
        const [name, raw] = c.split(":").map((s) => s.trim());
        const v = parseFloat(raw ?? "");
        if (name === "min-width") return width >= v;
        if (name === "max-width") return width <= v;
        if (name === "min-height") return height >= v;
        if (name === "max-height") return height <= v;
        return false;
      }),
  );
}

function app(platform: "ios" | "android", ua: string, width: number, height: number, touchPoints = 5) {
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
  Object.defineProperty(window.navigator, "maxTouchPoints", { value: touchPoints, configurable: true });
  (window as unknown as { foleviNative?: { platform: string } }).foleviNative = { platform };
  window.matchMedia = ((q: string) => ({ matches: matches(q, width, height), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
}

describe("the mobile app's layout", () => {
  afterEach(() => {
    delete (window as unknown as { foleviNative?: unknown }).foleviNative;
  });

  test("an iPhone: the phone layout upright, the sidebar sideways (wider than 700)", () => {
    app("ios", IPHONE_UA, 402, 874);
    expect(isIphoneApp()).toBe(true);
    expect(isIpadLayout()).toBe(false);
    app("ios", IPHONE_UA, 956, 440);
    expect(isIphoneApp()).toBe(false);
    expect(isIpadLayout()).toBe(true);
  });

  test("iPhone Duo: closed is the phone; open across the sidebar; open upright (669 wide) the phone", () => {
    app("ios", IPHONE_UA, 466, 678);
    expect(isIphoneApp()).toBe(true);
    app("ios", IPHONE_UA, 951, 669);
    expect(isIphoneApp()).toBe(false);
    expect(isIpadLayout()).toBe(true);
    app("ios", IPHONE_UA, 669, 951);
    expect(isIphoneApp()).toBe(true);
  });

  test("an iPad takes the sidebar layout, and the phone layout in a narrow window", () => {
    app("ios", IPAD_UA, 1032, 1376);
    expect(isIphoneApp()).toBe(false);
    expect(isIpadLayout()).toBe(true);
    app("ios", IPAD_UA, 375, 1376);
    expect(isIphoneApp()).toBe(true);
  });

  test("Android: a phone upright is the phone layout; sideways, a tablet or an open foldable the sidebar", () => {
    app("android", ANDROID_UA, 412, 915);
    expect(isIphoneApp()).toBe(true);
    app("android", ANDROID_UA, 915, 412);
    expect(isIphoneApp()).toBe(false);
    app("android", ANDROID_UA, 1280, 800);
    expect(isIphoneApp()).toBe(false);
    expect(isIpadLayout()).toBe(true);
    app("android", ANDROID_UA, 884, 1104);
    expect(isIphoneApp()).toBe(false);
  });
});
