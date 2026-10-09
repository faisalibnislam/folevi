import { afterEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { announce } from "@/lib/a11y/announce";
import { useRadioGroup } from "@/lib/a11y/radioGroup";

describe("accessibility helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  test("announce reads each message once, through one polite region", () => {
    vi.useFakeTimers();
    announce("Moved up");
    vi.advanceTimersByTime(60);
    const regions = document.querySelectorAll('[aria-live="polite"]');
    expect(regions).toHaveLength(1);
    expect(regions[0]!.textContent).toBe("Moved up");
    // The same message again is emptied first, so it's read again.
    announce("Moved up");
    expect(regions[0]!.textContent).toBe("");
    vi.advanceTimersByTime(60);
    expect(regions[0]!.textContent).toBe("Moved up");
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
  });

  test("a radio group is one Tab stop and the arrow keys choose", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const picked: string[] = [];
    function Group({ value }: { value: string }) {
      const group = useRadioGroup();
      return (
        <div role="radiogroup" ref={group.ref} onKeyDown={group.onKeyDown}>
          {["a", "b", "c"].map((v) => (
            <button key={v} type="button" role="radio" aria-checked={v === value} onClick={() => picked.push(v)}>
              {v}
            </button>
          ))}
        </div>
      );
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(<Group value="b" />));
    const radios = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    radios[1]!.focus();
    act(() => {
      radios[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(document.activeElement).toBe(radios[2]);
    expect(picked).toEqual(["c"]);
    act(() => {
      radios[2]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(picked).toEqual(["c", "a"]);
    act(() => root.unmount());
  });
});
