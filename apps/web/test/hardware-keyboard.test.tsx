// Keyboard hints ("Arrow keys move between days") show only with a keyboard to use them: a computer, or an
// iPad or phone once a key a software keyboard doesn't send is pressed.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";

const pointer = (fine: boolean) =>
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("fine") ? fine : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));

async function mount() {
  const { useHardwareKeyboard } = await import("@/lib/hooks/useHardwareKeyboard");
  const Hint = () => createElement("p", null, useHardwareKeyboard() ? "keys" : "touch");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(Hint)));
  return { text: () => host.textContent, done: () => (root.unmount(), host.remove()) };
}

describe("useHardwareKeyboard", () => {
  test("a touch screen: no hint until an arrow key comes from a keyboard; typing letters doesn't count", async () => {
    vi.resetModules();
    pointer(false);
    const m = await mount();
    expect(m.text()).toBe("touch");
    await act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" })));
    expect(m.text()).toBe("touch");
    await act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" })));
    expect(m.text()).toBe("keys");
    m.done();
    vi.unstubAllGlobals();
  });

  test("a computer (a fine pointer): the hint from the start", async () => {
    vi.resetModules();
    pointer(true);
    const m = await mount();
    expect(m.text()).toBe("keys");
    m.done();
    vi.unstubAllGlobals();
  });
});
