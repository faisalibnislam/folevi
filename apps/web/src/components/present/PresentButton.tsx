"use client";

// The Present button on a shared page: shows the page as slides, full screen (Presentation.tsx), loaded on
// first use.
import { lazy, Suspense, useState } from "react";
import { Presentation as PresentIcon } from "lucide-react";
import type { PresentationProps } from "./Presentation";

const Presentation = lazy(() => import("./Presentation").then((m) => ({ default: m.Presentation })));

export function PresentButton(props: Omit<PresentationProps, "onClose">) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="ui-btn ui-btn-secondary fb-present-open inline-flex h-8 items-center gap-1.5 rounded-control px-3 text-callout font-medium" onClick={() => setOpen(true)} aria-keyshortcuts="Meta+Alt+P">
        <PresentIcon size={14} aria-hidden />
        Present
      </button>
      {open ? (
        <Suspense fallback={null}>
          <Presentation {...props} onClose={() => setOpen(false)} />
        </Suspense>
      ) : null}
    </>
  );
}
