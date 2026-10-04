"use client";
// Cuts the sheet it sits in at its page breaks (for pages rendered on the server, like a shared link).
import { useState } from "react";
import { usePageBreakMask } from "./usePageBreakMask";

export function SheetPageBreaks() {
  const [marker, setMarker] = useState<HTMLElement | null>(null);
  usePageBreakMask(marker?.closest<HTMLElement>(".fb-sheet") ?? null);
  return <span ref={setMarker} hidden />;
}
