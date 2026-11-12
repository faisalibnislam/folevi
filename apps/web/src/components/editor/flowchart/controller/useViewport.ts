"use client";

// The canvas viewport: its measured size, the block's height (saved, being dragged, or full canvas), the
// view transform (pan and zoom), fitting the chart, and wheel zoom/pan.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { flowchartBounds, type FlowchartData, type Pt } from "../schema";
import { useFullCanvas } from "../../canvas/useFullCanvas";
import { listenPinch, useWheelArmed, wheelZoomRate } from "../../canvas/wheel";
import type { View } from "./types";

export const MIN_K = 0.2;
export const MAX_K = 2.5;
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/**
 * How far above a selection its floating bar sits (screen pixels, to the bar's top), and how much room it
 * needs under the toolbar to go there. High enough to clear the selected shape's top connection point, whose
 * press area reaches 26 px above the shape.
 */
export const BAR_LIFT = 64;
export const BAR_ROOM = 56;

export function useViewport({
  docRef,
  cardRef,
  wrapRef,
  svgRef,
  activeRef,
  savedHeight,
}: {
  docRef: RefObject<FlowchartData>;
  cardRef: RefObject<HTMLDivElement | null>;
  wrapRef: RefObject<HTMLDivElement | null>;
  svgRef: RefObject<SVGSVGElement | null>;
  activeRef: RefObject<boolean>;
  savedHeight: number;
}) {
  const [width, setWidth] = useState(0);
  const [liveHeight, setLiveHeight] = useState<number | null>(null);
  const [fullHeight, setFullHeight] = useState(0);
  // Full canvas (canvas/useFullCanvas.ts): fitted again once it has its new size, and on the way back.
  const { full, toggleFull, cardProps, handleKey } = useFullCanvas({
    cardRef,
    focusRef: wrapRef,
    onRefit: (on) => {
      const el = wrapRef.current;
      if (el) fitView(docRef.current, el.clientWidth, on ? el.clientHeight : liveHeight ?? savedHeight);
    },
  });
  const fullRef = useRef(full);
  fullRef.current = full;
  const height = full && fullHeight ? fullHeight : (liveHeight ?? savedHeight);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth);
      setFullHeight(el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [wrapRef]);

  const fitView = useCallback(
    (fc: FlowchartData = docRef.current, w = wrapRef.current?.clientWidth ?? 0, h = height) => {
      if (!w) return;
      const top = 52; // room for the toolbar
      const b = flowchartBounds(fc);
      if (!b) {
        setView({ x: w / 2, y: (h + top) / 2, k: 1 });
        return;
      }
      const pad = 40;
      const k = clamp(Math.min((w - pad * 2) / Math.max(1, b.w), (h - top - pad * 1.5) / Math.max(1, b.h), 1), MIN_K, MAX_K);
      setView({ k, x: w / 2 - (b.x + b.w / 2) * k, y: top + (h - top) / 2 - (b.y + b.h / 2) * k });
    },
    [docRef, wrapRef, height],
  );

  // Fit once, when the canvas first has a size.
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !width) return;
    fitted.current = true;
    fitView(docRef.current, width);
  }, [width, fitView, docRef]);

  const toWorld = useCallback(
    (clientX: number, clientY: number): Pt => {
      const r = svgRef.current!.getBoundingClientRect();
      const v = viewRef.current;
      return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
    },
    [svgRef],
  );

  const zoomAt = useCallback((k: number, sx: number, sy: number) => {
    const v = viewRef.current;
    const nk = clamp(k, MIN_K, MAX_K);
    const wx = (sx - v.x) / v.k;
    const wy = (sy - v.y) / v.k;
    setView({ k: nk, x: sx - wx * nk, y: sy - wy * nk });
  }, []);
  const zoomBy = (f: number) => zoomAt(viewRef.current.k * f, width / 2, height / 2);

  const viewCenter = (): Pt => {
    const v = viewRef.current;
    return { x: (width / 2 - v.x) / v.k, y: (height / 2 + 20 - v.y) / v.k };
  };

  // Wheel: ⌘/ctrl (and trackpad pinch) zooms. Plain scrolling pans the canvas only while it is being worked
  // in: it has the keyboard and the pointer was pressed in it and has not left since (canvas/wheel.ts).
  // Otherwise it scrolls the page as usual, so a canvas passed on the way down a note never traps the wheel.
  const wheelHere = useWheelArmed(wrapRef);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        zoomAt(viewRef.current.k * Math.exp(-e.deltaY * unit * wheelZoomRate(e)), e.clientX - r.left, e.clientY - r.top);
      } else if (activeRef.current && (wheelHere.current || fullRef.current)) {
        e.preventDefault();
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        setView((v) => ({ ...v, x: v.x - dx * unit, y: v.y - dy * unit }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    // Safari and the Mac app report a trackpad pinch as gesture events, not as a wheel.
    const stopPinch = listenPinch(el, { scale: () => viewRef.current.k, zoomAt: (k, x, y) => zoomAt(k, x, y) });
    return () => {
      el.removeEventListener("wheel", onWheel);
      stopPinch();
    };
  }, [zoomAt, svgRef, activeRef, wheelHere]);

  return { width, height, setLiveHeight, view, viewRef, setView, fitView, toWorld, zoomAt, zoomBy, viewCenter, full, toggleFull, fullCardProps: cardProps, fullKey: handleKey };
}
