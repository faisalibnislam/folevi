"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "./Button";
import { useIphoneApp } from "@/lib/iphone";
import { Sheet } from "@/components/iphone/Sheet";
import { confirmAction, hasNative } from "@/lib/native/ui";

/**
 * A dialog that only asks before doing something (Delete, Sign out): inside the iOS and Android apps it's the
 * system's own alert instead (docs/IOS_POLISH_PLAN.md §4.2), with these words; elsewhere the dialog as drawn.
 */
export interface DialogConfirm {
  /** The confirming button's words, as on the dialog's own button ("Delete folder"). */
  label: string;
  destructive?: boolean;
  cancel?: string;
  /** The alert's message, when the dialog's description isn't plain text. */
  message?: string;
  /** Runs when confirmed (the dialog's onClose runs after, as when it's dismissed). */
  onConfirm: () => void;
  /** "sheet": an action sheet from the bottom (on iPad from `anchor`), as iOS asks before deleting from a menu. */
  style?: "alert" | "sheet";
}

/**
 * Modal dialog on the native <dialog> element: focus trapping, Escape to close, inert background and
 * focus restoration are provided by the browser.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  confirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** A confirmation: the system's alert in the apps (see DialogConfirm). */
  confirm?: DialogConfirm;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  // The content mounts once the dialog is open (before the browser paints), so a field marked autoFocus
  // takes the focus. Rendered with the dialog still closed, its focus went nowhere and the browser then
  // put it on the Close button, ringed, every time a dialog opened.
  const [shown, setShown] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
    setShown(open);
  }, [open]);
  // A confirmation in the apps: the system's alert, asked once each time the dialog opens.
  const [native] = useState(() => Boolean(confirm) && hasNative("alert"));
  const asking = useRef(false);
  const latest = useRef({ confirm, onClose, title, description });
  latest.current = { confirm, onClose, title, description };
  useEffect(() => {
    if (!native || !open || asking.current) return;
    asking.current = true;
    const { confirm: c, title: t, description: d } = latest.current;
    void confirmAction({ title: t, message: c?.message ?? (typeof d === "string" ? d : undefined), confirm: c!.label, cancel: c?.cancel, destructive: c?.destructive, style: c?.style }).then((yes) => {
      asking.current = false;
      if (yes) latest.current.confirm?.onConfirm();
      latest.current.onClose();
    });
  }, [native, open]);
  // In the iPhone app a dialog is a sheet from the bottom (a short one, a glass card in the middle).
  const iphone = useIphoneApp();
  if (native) return null;
  if (iphone) {
    return (
      <Sheet open={open} onClose={onClose} title={title} description={description} footer={footer} variant={size === "sm" ? "card" : "sheet"} size={size === "lg" || size === "xl" ? "large" : "fit"}>
        {children ? <div className="px-5 pb-5 pt-2">{children}</div> : null}
      </Sheet>
    );
  }
  const width = size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-3xl" : size === "xl" ? "max-w-5xl" : "max-w-lg";
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={`m-auto w-[calc(100%-2rem)] ${width} ui-pop rounded-panel p-0 text-ink outline-none backdrop:bg-transparent shadow-[var(--glass-edge),0_16px_48px_rgb(0_0_0/0.1),0_2px_8px_rgb(0_0_0/0.1)] open:animate-[folio-rise_180ms_var(--ease-folio)]`}
    >
      {open && shown ? (
        <div className="flex max-h-[85dvh] flex-col">
          <header className="flex items-start gap-3 px-6 pb-2 pt-5">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="ui-display text-[21px] leading-snug">
                {title}
              </h2>
              {description ? (
                <div id={descId} className="mt-1 text-sm text-muted">
                  {description}
                </div>
              ) : null}
            </div>
            <IconButton label="Close" onClick={onClose}>
              <X size={16} aria-hidden />
            </IconButton>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
          {footer ? <footer className="flex justify-end gap-2 bg-[color-mix(in_oklab,var(--color-surface-sunken)_60%,transparent)] px-6 py-3.5 shadow-[inset_0_1px_0_var(--color-line)]">{footer}</footer> : null}
        </div>
      ) : null}
    </dialog>
  );
}
