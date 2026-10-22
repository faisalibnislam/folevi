"use client";

import type { ButtonHTMLAttributes } from "react";
import { ArrowUp } from "lucide-react";

/**
 * The round send button of the iPhone app's composers (Foli AI's chat and the note's Foli AI sheet): 34 pt in
 * the heading's colour inside a 44 pt target, at 30 % while there's nothing to send.
 */
export function SendButton({ label, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} {...rest} className={`group grid h-11 w-11 flex-none place-items-center rounded-capsule outline-none disabled:pointer-events-none ${className}`}>
      <span className="grid h-[34px] w-[34px] place-items-center rounded-capsule bg-heading text-canvas transition-[opacity,transform] duration-150 group-active:scale-90 group-disabled:opacity-30 group-focus-visible:ring-2 group-focus-visible:ring-focus">
        <ArrowUp size={19} strokeWidth={2.4} aria-hidden />
      </span>
    </button>
  );
}
