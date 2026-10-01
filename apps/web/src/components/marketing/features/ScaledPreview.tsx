"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "../ui";

/**
 * A full-size picture of the app, drawn at `width` CSS pixels and scaled down to fit its box, so a card
 * cover stays as sharp as the picture on the feature page. The picture is decorative and inert (no focus,
 * no clicks), and live demos inside it hold still (demos/autoplay.ts checks `data-demo-still`). It is
 * centred when shorter than the box and shows its top when taller.
 */
export function ScaledPreview({ width = 1000, children, className }: { width?: number; children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const outer = box.current;
    const content = inner.current;
    if (!outer || !content) return;
    const measure = () => {
      const scale = outer.clientWidth / width;
      const h = content.offsetHeight * scale;
      setFit({ scale, top: Math.max(0, (outer.clientHeight - h) / 2) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    ro.observe(content);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div ref={box} aria-hidden="true" className={cx("relative overflow-hidden", className)}>
      <div
        ref={inner}
        inert
        data-demo-still=""
        className="pointer-events-none absolute left-0 origin-top-left select-none"
        style={{ width, top: fit?.top ?? 0, transform: `scale(${fit?.scale ?? 0.3})`, visibility: fit ? "visible" : "hidden" }}
      >
        {children}
      </div>
    </div>
  );
}
