"use client";

// A visual block (flowchart, mind map, sticky notes, wireframe, whiteboard) squeezed narrower than its tools
// can work in, as in one of four columns: in the note it's a fitted picture of the block that nothing in it
// takes a click or a key, with Open canvas to work on it in the block's own full canvas
// (canvas/useFullCanvas.ts). The card's width is watched here, so each block only puts this in its card. The
// iPhone layout has its own cover (PhoneCanvasCover.tsx). Styles: narrow-canvas.css.
import "./narrow-canvas.css";
import { Expand } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useIphoneApp } from "@/lib/iphone";

/** Narrower than this, a block's toolbar and canvas don't fit to work in. */
export const NARROW_CANVAS_WIDTH = 320;

export function NarrowCanvasCover({ name, full, onOpen, onFit }: { name: string; full: boolean; onOpen: () => void; onFit?: () => void }) {
  const phone = useIphoneApp();
  const ref = useRef<HTMLSpanElement>(null);
  const [narrow, setNarrow] = useState(false);
  const onFitRef = useRef(onFit);
  useLayoutEffect(() => {
    onFitRef.current = onFit;
  });

  // The card's width (full canvas fills the window, so it's never narrow there).
  useLayoutEffect(() => {
    const card = ref.current?.closest<HTMLElement>(".fb-canvas-card");
    if (!card || phone || full) return setNarrow(false);
    const read = () => setNarrow(card.getBoundingClientRect().width < NARROW_CANVAS_WIDTH);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(card);
    return () => ro.disconnect();
  }, [phone, full]);

  // Marked on the card for the styles, and its canvas out of reach of the keyboard too. (Laid out before the
  // block's own effects, so full canvas finds its canvas focusable again.)
  const on = narrow && !full && !phone;
  useLayoutEffect(() => {
    const card = ref.current?.closest<HTMLElement>(".fb-canvas-card");
    const body = card?.querySelector<HTMLElement>(".fb-canvas-body");
    if (!card || !on) return;
    card.dataset.narrow = "";
    body?.setAttribute("inert", "");
    // Fitted to the card's width once its tools are out of the way.
    const id = requestAnimationFrame(() => onFitRef.current?.());
    return () => {
      cancelAnimationFrame(id);
      delete card.dataset.narrow;
      body?.removeAttribute("inert");
    };
  }, [on]);

  return (
    <span ref={ref} className="fb-narrow-canvas" hidden={!on}>
      {on ? (
        <button type="button" className="fb-narrow-canvas-open" onClick={onOpen} onPointerDown={(e) => e.stopPropagation()}>
          <Expand size={13} strokeWidth={2.2} aria-hidden />
          Open canvas<span className="sr-only">, {name}</span>
        </button>
      ) : null}
    </span>
  );
}
