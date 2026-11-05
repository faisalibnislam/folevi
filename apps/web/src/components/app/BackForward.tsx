"use client";

import { useEffect } from "react";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useBackForward } from "@/lib/app/tabs";
import { PillButton } from "@/components/iphone/Glass";

const BTN =
  "grid h-9 w-9 flex-none place-items-center rounded-control text-muted transition-colors hover:bg-accent-soft hover:text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:pointer-events-none disabled:opacity-30";

/**
 * Back and Forward, Finder style: the tab on screen keeps its own (going back to a page now in another tab
 * switches to that tab), and back again. Greyed out when there's nowhere to go. Where no tab is on screen (Settings) the browser's.
 */
export function BackForward({ ipad }: { /** The iPad's look: iPadOS chevrons on 44 pt round buttons, no ⌘ hints. */ ipad?: boolean } = {}) {
  const { back, forward, canBack, canForward } = useBackForward();
  // ⌘[ and ⌘] (Ctrl elsewhere), as in a browser; the Mac app has no browser to do it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || (e.key !== "[" && e.key !== "]")) return;
      e.preventDefault();
      if (e.key === "[" && canBack) back();
      else if (e.key === "]" && canForward) forward?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back, forward, canBack, canForward]);
  if (ipad)
    return (
      <div className="flex flex-none items-center" role="group" aria-label="History">
        <PillButton label="Back" disabled={!canBack} onClick={back}>
          <ChevronLeft size={24} strokeWidth={2.2} aria-hidden />
        </PillButton>
        <PillButton label="Forward" disabled={!canForward} onClick={() => forward?.()}>
          <ChevronRight size={24} strokeWidth={2.2} aria-hidden />
        </PillButton>
      </div>
    );
  return (
    <div className="flex flex-none items-center" role="group" aria-label="History">
      <button type="button" aria-label="Back" title="Back (⌘[)" disabled={!canBack} onClick={back} className={BTN}>
        <ArrowLeft size={15} aria-hidden />
      </button>
      <button type="button" aria-label="Forward" title="Forward (⌘])" disabled={!canForward} onClick={() => forward?.()} className={BTN}>
        <ArrowRight size={15} aria-hidden />
      </button>
    </div>
  );
}
