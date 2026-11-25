import type { ReactNode } from "react";

/**
 * Icons that stand for one control's states (Copy and Copied, Play and Pause, a sync state), all in one place: the
 * one for `index` shows and the others fade out, rather than one icon replacing another at once (2026-11-25 polish
 * review). The hidden ones go to a quarter size, blurred, so the change reads as the icon turning into the other.
 * With Reduce Motion it's a plain fade (globals.css). The control's words or label still say the state.
 */
export function SwapIcons({ index, icons, className = "" }: { index: number; icons: ReactNode[]; className?: string }) {
  return (
    <span aria-hidden className={`inline-grid flex-none place-items-center ${className}`}>
      {icons.map((icon, i) => (
        <span
          key={i}
          className={`inline-grid place-items-center [grid-area:1/1] transition-[opacity,scale,filter] duration-150 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:scale-100 motion-reduce:blur-none ${
            i === index ? "scale-100 opacity-100 blur-none" : "pointer-events-none scale-[0.25] opacity-0 blur-[4px]"
          }`}
        >
          {icon}
        </span>
      ))}
    </span>
  );
}
