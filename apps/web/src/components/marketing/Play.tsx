"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "./ui";

/**
 * Plays a static picture when it scrolls into view: the parts marked `data-step` appear one after another,
 * hold, and the sequence loops gently while the picture stays on screen. Still with reduced motion, and in
 * card covers (data-demo-still).
 */
export function Play({ children, className, hold = 4500 }: { children: ReactNode; className?: string; hold?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || el.closest("[data-demo-still]") || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const steps = [...el.querySelectorAll<HTMLElement>("[data-step]")];
    steps.forEach((s, i) => s.style.setProperty("--i", String(i)));
    const length = steps.length * 320 + 500 + hold;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const play = () => {
      el.removeAttribute("data-playing");
      void el.offsetWidth; // restart the animations
      el.setAttribute("data-playing", "");
      timer = setTimeout(play, length);
    };
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) {
        if (!timer) play();
      } else if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }, { threshold: 0.3 });
    el.setAttribute("data-play", "");
    io.observe(el);
    return () => {
      io.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [hold]);
  return (
    <div ref={ref} className={cx("mk-play", className)}>
      {children}
    </div>
  );
}
