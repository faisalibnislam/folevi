"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "../ui";

/**
 * A full-size picture of the app, drawn at up to `width` CSS pixels and scaled down to fit its box, so a card
 * cover stays as sharp as the picture on the feature page. The picture is decorative and inert (no focus,
 * no clicks), and live demos inside it hold still (demos/autoplay.ts checks `data-demo-still`). It always
 * fills its box: when the picture is shorter, its stage grows to the box's height (the theme background
 * runs edge to edge) with the app piece centred in it; when taller, it shows its top.
 *
 * The picture is only put on the page when its box comes near the screen, so a page of cards (the
 * features index) doesn't fetch every card's artwork at once; until then the box is an empty frame.
 */
export function ScaledPreview({
  width = 1000,
  children,
  className,
}: {
  width?: number;
  children: ReactNode;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; minHeight: number; width: number } | null>(null);
  const [near, setNear] = useState(false);

  useLayoutEffect(() => {
    const outer = box.current;
    if (!outer || near) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setNear(true), {
      rootMargin: "400px 0px",
    });
    io.observe(outer);
    return () => io.disconnect();
  }, [near]);

  useLayoutEffect(() => {
    const outer = box.current;
    const content = inner.current;
    if (!outer || !content) return;
    const measure = () => {
      // Drawn at a width that suits the box (its layout reflows to it), so a small card isn't a tiny copy
      // of a wide screen: about 1.6× the box, at least 520 px, at most the picture's own width.
      const drawn = Math.round(Math.min(width, Math.max(520, outer.clientWidth * 1.6)));
      const scale = outer.clientWidth / drawn;
      // At least the box's height, in the picture's own (unscaled) pixels.
      setFit({ scale, minHeight: outer.clientHeight / scale, width: drawn });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    return () => ro.disconnect();
  }, [width, near]);

  return (
    <div ref={box} aria-hidden="true" className={cx("relative overflow-hidden", className)}>
      {near ? (
        <div
          ref={inner}
          inert
          data-demo-still=""
          // A preview fills its card edge to edge: the card's corners clip it, so its stage has none of its
          // own, and the stage stretches to the box's height with the picture centred in it.
          className="pointer-events-none absolute left-0 top-0 flex origin-top-left select-none flex-col [&>*]:flex [&>*]:flex-1 [&>*]:flex-col [&>*]:justify-center [&>.mk-stage]:rounded-none"
          style={{
            width: fit?.width ?? width,
            minHeight: fit?.minHeight,
            transform: `scale(${fit?.scale ?? 0.3})`,
            visibility: fit ? "visible" : "hidden",
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
