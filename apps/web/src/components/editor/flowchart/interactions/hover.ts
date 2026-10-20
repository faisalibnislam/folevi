"use client";

// Which shape the mouse is near (not touch): it shows that shape's connection handles. A margin around
// each shape keeps them while reaching for one.
import { useState } from "react";
import { nodeAt } from "../ops";
import type { FlowController, Interaction } from "../controller/types";

export function useHover(ctrl: FlowController) {
  const { docRef, toWorld, viewRef } = ctrl;
  const [hover, setHover] = useState<string | null>(null);

  const interaction: Interaction = {
    hover: (e) => {
      if (e.pointerType === "touch") return;
      const n = nodeAt(docRef.current, toWorld(e.clientX, e.clientY), 26 / viewRef.current.k);
      const next = n?.id ?? null;
      if (next !== hover) setHover(next);
    },
    leave: () => setHover(null),
    blur: () => setHover(null),
  };

  return { interaction, /** The hovered shape's id. */ hover };
}
