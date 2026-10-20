"use client";

// The block's height: drag the bar under the canvas, or focus it and use the arrow keys.
import { useRef } from "react";
import { LIMITS } from "../schema";
import type { FlowController } from "../controller/types";

const HEIGHT_STEP = 40;
const clampH = (h: number) => Math.round(Math.max(LIMITS.minFlowchartHeight, Math.min(LIMITS.maxFlowchartHeight, h)));

export function HeightHandle({ ctrl }: { ctrl: FlowController }) {
  const { height, savedHeight, setLiveHeight } = ctrl;
  const { updateAttributes } = ctrl.props;
  const resizing = useRef<{ startY: number; startH: number } | null>(null);
  const commitHeight = (h: number) => {
    setLiveHeight(null);
    if (h !== savedHeight) updateAttributes({ height: h });
  };

  return (
    <div
      className="fb-wb-resize"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Flowchart height"
      aria-valuemin={LIMITS.minFlowchartHeight}
      aria-valuemax={LIMITS.maxFlowchartHeight}
      aria-valuenow={height}
      tabIndex={0}
      title="Drag to resize (or use the arrow keys)"
      onKeyDown={(e) => {
        const delta = e.key === "ArrowDown" ? HEIGHT_STEP : e.key === "ArrowUp" ? -HEIGHT_STEP : 0;
        if (!delta) return;
        e.preventDefault();
        commitHeight(clampH(height + delta));
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        resizing.current = { startY: e.clientY, startH: height };
      }}
      onPointerMove={(e) => {
        const r = resizing.current;
        if (!r) return;
        setLiveHeight(clampH(r.startH + (e.clientY - r.startY)));
      }}
      onPointerUp={() => {
        if (!resizing.current) return;
        resizing.current = null;
        commitHeight(height);
      }}
      onPointerCancel={() => {
        resizing.current = null;
        setLiveHeight(null);
      }}
    >
      <span aria-hidden />
    </div>
  );
}
