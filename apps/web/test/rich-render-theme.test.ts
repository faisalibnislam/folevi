import { afterEach, describe, expect, test, vi } from "vitest";
import { onThemeChange } from "@/components/editor/richRender";

// Diagrams and code previews draw again when the note's look changes (richRender.ts onThemeChange), not when only
// the page-break mask on its sheet moves (docs/WEB_PERFORMANCE.md).
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("onThemeChange with a note's sheet", () => {
  let stop: () => void = () => undefined;
  afterEach(() => {
    stop();
    document.body.innerHTML = "";
  });

  test("the sheet's colours, palette and theme count; its page-break mask doesn't", async () => {
    const sheet = document.createElement("div");
    sheet.className = "fb-sheet";
    sheet.setAttribute("style", "background-color: rgb(255, 255, 255)");
    const block = document.createElement("div");
    sheet.appendChild(block);
    document.body.appendChild(sheet);
    const cb = vi.fn();
    stop = onThemeChange(cb, block);

    sheet.setAttribute("style", "background-color: rgb(255, 255, 255); mask-image: url(\"data:image/svg+xml,a\"); mask-size: 10px 10px");
    sheet.style.setProperty("-webkit-mask-position", "-40px -40px");
    await flush();
    expect(cb).not.toHaveBeenCalled();

    sheet.style.setProperty("background-color", "rgb(250, 240, 230)");
    await flush();
    expect(cb).toHaveBeenCalledTimes(1);

    sheet.setAttribute("data-palette", "warm");
    await flush();
    expect(cb).toHaveBeenCalledTimes(2);

    sheet.setAttribute("data-palette", "warm");
    await flush();
    expect(cb).toHaveBeenCalledTimes(2);

    document.documentElement.setAttribute("data-theme", "dark");
    await flush();
    expect(cb).toHaveBeenCalledTimes(3);
    document.documentElement.removeAttribute("data-theme");
  });
});
