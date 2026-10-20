"use client";

// The shell of the canvas's own panels (shape library, icons, colours, notes, page links): a titled glass
// panel inside the canvas (so it works in full canvas and never covers the note), closed with its button
// or Esc, which gives the keyboard back to the canvas. Keys typed in it never reach the canvas.
import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export function FlowPanel({
  title,
  onClose,
  children,
  className = "",
  style,
  labelledBy,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  /** Placement (the docked panels use the stylesheet's; popovers pass their own). */
  style?: React.CSSProperties;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Focus goes into the panel (its first field or button) when it opens.
    const first = ref.current?.querySelector<HTMLElement>("[data-autofocus], input, textarea, button:not(.fc-panel-close)");
    (first ?? ref.current)?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      ref={ref}
      className={`fc-panel ${className}`}
      role="dialog"
      aria-label={labelledBy ? undefined : title}
      aria-labelledby={labelledBy}
      tabIndex={-1}
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          onClose();
        }
      }}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <div className="fc-panel-head">
        <h3 className="fc-panel-title">{title}</h3>
        <button type="button" className="fc-btn fc-panel-close" aria-label={`Close ${title.toLowerCase()}`} title="Close (Esc)" onClick={onClose}>
          <X size={14} aria-hidden />
        </button>
      </div>
      {children}
    </div>
  );
}
