// A sheet floating inset from the iPhone's screen edges follows the screen's own corners
// (lib/iphone.ts displayCornerRadius, Shell sets --iphone-sheet-bottom).
import { afterEach, describe, expect, test } from "vitest";
import { displayCornerRadius } from "@/lib/iphone";

const setScreen = (width: number, height: number) => {
  Object.defineProperty(window.screen, "width", { value: width, configurable: true });
  Object.defineProperty(window.screen, "height", { value: height, configurable: true });
};

describe("the iPhone's screen corners", () => {
  afterEach(() => setScreen(1024, 768));

  test("each iPhone screen size has its corner radius, in portrait or landscape", () => {
    setScreen(402, 874);
    expect(displayCornerRadius()).toBe(62);
    setScreen(874, 402);
    expect(displayCornerRadius()).toBe(62);
    setScreen(393, 852);
    expect(displayCornerRadius()).toBe(55);
    setScreen(390, 844);
    expect(displayCornerRadius()).toBe(47.33);
  });

  test("a size it doesn't know (or a square-cornered screen) leaves the token's corner", () => {
    setScreen(375, 667);
    expect(displayCornerRadius()).toBeNull();
  });
});
