"use client";

// A visual block (mind map, flowchart, sticky notes, chart, wireframe, whiteboard) in the iPhone layout: in the
// note it's a picture of the block under a plain header, and a tap anywhere opens it full screen to work on
// (the block's own full canvas, canvas/useFullCanvas.ts), where a Done button brings it back. A canvas the size
// of the screen can't share a finger with the note's scrolling, and its desktop toolbar, zoom bar and height
// handle don't fit beside the text. Nothing changes on the website, the Mac app or the iPad's sidebar layout.
// Styles: editor-phone.css (.fb-vc-phone).
import { Expand } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { setBlockFullScreen } from "@/lib/engine/noteHost";
import { useIphoneApp } from "@/lib/iphone";

export function PhoneCanvasCover({ name, icon, empty, full, onOpen, onDone }: { name: string; icon: ReactNode; empty: boolean; full: boolean; onOpen: () => void; onDone: () => void }) {
  const phone = useIphoneApp();
  // Full screen: the app's own bars step aside (they'd cover the block's tools).
  useEffect(() => {
    if (!phone || !full) return;
    setBlockFullScreen(true);
    return () => setBlockFullScreen(false);
  }, [phone, full]);
  if (!phone) return null;
  if (full) {
    return (
      <button type="button" className="fb-vc-phone-done" onClick={onDone} onPointerDown={(e) => e.stopPropagation()}>
        Done
      </button>
    );
  }
  return (
    <button type="button" className="fb-vc-phone" aria-label={`Open ${name}`} onClick={onOpen}>
      <span className="fb-vc-phone-head">
        <span className="fb-vc-phone-icon" aria-hidden>
          {icon}
        </span>
        <span className="fb-vc-phone-name">
          {name}
          {empty ? <span className="fb-vc-phone-sub">Empty. Tap to start.</span> : null}
        </span>
        <span className="fb-vc-phone-open" aria-hidden>
          {empty ? "Start" : "Open"}
          {empty ? null : <Expand size={13} strokeWidth={2.2} />}
        </span>
      </span>
    </button>
  );
}
