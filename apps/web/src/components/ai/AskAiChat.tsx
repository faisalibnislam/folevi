"use client";

import { forwardRef, lazy, Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useIphoneApp } from "@/lib/iphone";
import { AiIcon } from "@/components/ai/AiIcon";
import { useAppRouter } from "@/lib/app/router";
import { modKey } from "@/lib/hooks/useEngine";

/** The launcher's shadow: soft black at 10%. */
const SHADOW = "shadow-[0_8px_24px_rgb(0_0_0/0.1),0_2px_6px_rgb(0_0_0/0.1),inset_0_0_0_1px_rgb(255_255_255/0.12)]";

export interface AskAiProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  initial?: string;
  /** Only this folder's notes. */
  folder?: { id: string; name: string };
  /** No floating button (the phone's navigation drawer is open over the page). */
  hideLauncher?: boolean;
}

const loadPanel = () => import("./AskAiPanel").then((m) => ({ default: m.AskAiPanel }));
const AskAiPanel = lazy(loadPanel);

/** The floating "Ask Foli AI" button. */
export const AskAiLauncher = forwardRef<HTMLButtonElement, { open: boolean; onClick: () => void; onWarm?: () => void }>(function AskAiLauncher({ open, onClick, onWarm }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={open}
      aria-keyshortcuts="Meta+J"
      title={open ? "Close Foli AI" : `Ask Foli AI (${modKey()}J)`}
      onClick={onClick}
      onPointerEnter={onWarm}
      onFocus={onWarm}
      className={`ui-fab fixed bottom-9 right-[calc(2.25rem+var(--tools-panel,0px))] z-[70] inline-flex h-12 items-center gap-2.5 rounded-panel bg-black pl-4 pr-5 text-[15px] font-medium text-white ${SHADOW} transition-[transform,background-color] duration-200 hover:-translate-y-0.5 hover:bg-[#1c1c1f] active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black max-sm:bottom-3 max-sm:right-3`}
    >
      {open ? <X size={18} aria-hidden /> : <AiIcon size={17} />}
      <span>Ask Foli AI</span>
    </button>
  );
});

/**
 * Ask AI (⌘J): a chat with your notes that pops out from a floating button in the bottom-right corner. Also opened
 * from the command palette, a folder's menu and the note's AI panel. Shown only where AI is included and turned on
 * (never on Core), and not on the AI page itself. Until it's first opened only the button is here: the chat's code
 * (AskAiPanel.tsx) loads then (or as the pointer reaches the button), and stays for the rest of the visit.
 */
export function AskAiChat(props: AskAiProps) {
  const [wanted, setWanted] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { route } = useAppRouter();
  const iphone = useIphoneApp();
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (props.open) setWanted(true);
  }, [props.open]);
  if (wanted) {
    return (
      <Suspense fallback={null}>
        <AskAiPanel {...props} />
      </Suspense>
    );
  }
  // On a note (the floating bar's AI button opens it), the AI page and the phone (a sheet), there's no button.
  if (!mounted || iphone || route.name === "doc" || route.name === "ai" || props.hideLauncher) return null;
  return createPortal(
    <div className="ai-chat">
      <AskAiLauncher open={false} onClick={props.onOpen} onWarm={() => void loadPanel()} />
    </div>,
    document.body,
  );
}
