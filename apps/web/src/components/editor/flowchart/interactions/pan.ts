"use client";

// Panning by dragging: with the middle button, while holding space, or with one finger on empty canvas.
// (Wheel panning and zoom live in controller/useViewport.ts, pinch in controller/useInteractions.ts.)
import { useState } from "react";
import type { FlowController, Interaction } from "../controller/types";

export function usePan(ctrl: FlowController) {
  const { viewRef, setView } = ctrl;
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);

  const interaction: Interaction = {
    press: ({ e, onBackground }) => {
      if (!(e.button === 1 || spaceDown || (onBackground && e.pointerType === "touch"))) return null;
      e.preventDefault();
      const sx = e.clientX;
      const sy = e.clientY;
      const start = viewRef.current;
      setPanning(true);
      return {
        move: (m) => setView({ ...start, x: start.x + (m.clientX - sx), y: start.y + (m.clientY - sy) }),
        end: () => setPanning(false),
        cancel: () => setPanning(false),
      };
    },
    keyDown: (e) => {
      if (e.key !== " " || e.metaKey || e.ctrlKey) return false;
      if (!spaceDown) setSpaceDown(true);
      return true;
    },
    keyUp: (e) => {
      if (e.key === " ") setSpaceDown(false);
    },
    blur: () => setSpaceDown(false),
  };

  return { interaction, /** For the canvas's data-panning and data-space (the cursor). */ panning, spaceDown };
}
