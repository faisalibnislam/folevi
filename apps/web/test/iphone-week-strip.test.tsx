// The Calendar's week strip on the iPhone (components/iphone/WeekStrip.tsx, owner's decision D4): the picked
// day's week with today marked, dots on days with something on them, the grabber opening the whole month
// (only its own weeks) and a day picked there folding it back to the week.
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { WeekStrip } from "@/components/iphone/WeekStrip";

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function Harness({ start, onPick }: { start: string; onPick?: (d: string) => void }) {
  const [selected, setSelected] = useState(start);
  return (
    <WeekStrip
      today="2026-10-22"
      selected={selected}
      onSelect={(d) => {
        onPick?.(d);
        setSelected(d);
      }}
      marked={(d) => d === "2026-10-23" || d === "2026-10-30"}
    />
  );
}

async function render(start = "2026-10-22", onPick?: (d: string) => void) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<Harness start={start} onPick={onPick} />));
  // The days that can be used now (pages out of view are inert).
  const live = () => [...host.querySelectorAll<HTMLButtonElement>("button[data-date]")].filter((b) => !b.closest("[inert]"));
  const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === label);
  return { host, live, button };
}

describe("WeekStrip", () => {
  test("the picked day's week, Monday first, today picked and marked as today, dots where there's something", async () => {
    const { live } = await render();
    const days = live();
    expect(days.map((b) => b.dataset.date)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    const today = days[3]!;
    expect(today.getAttribute("aria-pressed")).toBe("true");
    expect(today.getAttribute("aria-current")).toBe("date");
    expect(today.getAttribute("aria-label")).toMatch(/^Today, /);
    expect(days[4]!.getAttribute("aria-label")).toMatch(/has tasks or events$/);
    expect(days[5]!.getAttribute("aria-label")).not.toMatch(/has tasks or events$/);
  });

  test("picking another day of the week picks it", async () => {
    const picked: string[] = [];
    const { live } = await render("2026-10-22", (d) => picked.push(d));
    await act(async () => live()[5]!.click());
    expect(picked).toEqual(["2026-10-24"]);
    expect(live()[5]!.getAttribute("aria-pressed")).toBe("true");
    // Today stays marked while another day is picked.
    expect(live()[3]!.getAttribute("aria-current")).toBe("date");
  });

  test("the grabber opens the month (its five weeks for October 2026) and a day there folds it back", async () => {
    vi.useFakeTimers();
    const { live, button } = await render();
    await act(async () => button("Show the whole month")!.click());
    // (The month slides out from the week over two frames, then settles.)
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    const month = live().map((b) => b.dataset.date);
    expect(month[0]).toBe("2026-09-28");
    expect(month).toHaveLength(35);
    expect(month).toContain("2026-10-31");
    expect(button("Show the week")!.getAttribute("aria-expanded")).toBe("true");
    await act(async () => live().find((b) => b.dataset.date === "2026-10-30")!.click());
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(button("Show the whole month")!.getAttribute("aria-expanded")).toBe("false");
    expect(live().map((b) => b.dataset.date)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
  });
});
