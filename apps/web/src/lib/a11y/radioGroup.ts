"use client";

import { useLayoutEffect, useRef, type KeyboardEvent } from "react";

/**
 * A radio group's keys: the group is one Tab stop (the chosen option, or the first), and the arrow keys
 * move to the next or previous option and choose it. Spread `ref` and `onKeyDown` on the radiogroup.
 */
export function useRadioGroup<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  // After every render, as the chosen option can change with any of them.
  useLayoutEffect(() => {
    const radios = options(ref.current);
    const current = radios.find((r) => r.getAttribute("aria-checked") === "true") ?? radios[0];
    for (const r of radios) r.tabIndex = r === current ? 0 : -1;
  });
  const onKeyDown = (e: KeyboardEvent<T>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step || e.altKey || e.metaKey || e.ctrlKey) return;
    const radios = options(e.currentTarget);
    const i = radios.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    const next = radios[(i + step + radios.length) % radios.length]!;
    next.focus();
    next.click();
  };
  return { ref, onKeyDown };
}

function options(el: HTMLElement | null): HTMLElement[] {
  return el ? [...el.querySelectorAll<HTMLElement>('[role="radio"]')].filter((r) => !r.matches(":disabled")) : [];
}
