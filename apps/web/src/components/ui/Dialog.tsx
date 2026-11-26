"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "./Button";
import { isIpadNativeWide, sideInsets, useIphoneApp } from "@/lib/iphone";
import { Sheet } from "@/components/iphone/Sheet";
import { confirmAction, hasNative } from "@/lib/native/ui";
import { nativeChrome } from "@/lib/nativeApp";
import { fadeOut, type Closing } from "./closing";
import { useFold, type Fold } from "@/lib/platform";

/**
 * Folevi for Mac's note page (native chrome mode): the window's tab strip is drawn over the page's top
 * (--native-inset-top) and the note's floating dock sits at its bottom, so a dialog keeps between the two (and
 * scrolls inside when the window is short). Null elsewhere: the dialog centres in the whole window.
 */
/**
 * An iPhone Duo or a foldable partly open: a dialog that would centre in the window sits in the part past the
 * fold instead, 16 px clear of it (nothing interactive on the fold): right of a fold down the middle, below
 * one across. `room` (macFrameRoom) still holds where it applies.
 */
export function pastFoldFrame(f: Fold | null, room: { top: number; bottom: number } | null): { room: { top: number; bottom: number } | null; side: CSSProperties | null } {
  if (!f) return { room, side: null };
  const past = f.start + f.size + 16;
  if (f.orientation === "horizontal") return { room: { top: Math.max(room?.top ?? 0, past), bottom: Math.max(room?.bottom ?? 0, 16) }, side: null };
  // (Between `left` and `right` the dialog's auto margins centre it; the width fills that span, its max-width caps it.
  // On the right it keeps clear of the screen's side inset too: the iPhone Duo's status column, 84 pt open.)
  const right = 16 + (typeof window === "undefined" ? 0 : sideInsets().right);
  return { room, side: { left: past, right, width: `calc(100% - ${past + right}px)` } };
}

function macFrameRoom(): { top: number; bottom: number } | null {
  if (typeof window === "undefined" || (nativeChrome()?.platform !== "macos" && !isIpadNativeWide())) return null;
  const inset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--native-inset-top"));
  const dock = document.querySelector<HTMLElement>('[role="toolbar"][aria-label="Page tools"]')?.getBoundingClientRect();
  const bottom = dock && dock.height ? Math.max(0, window.innerHeight - dock.top) : 0;
  return { top: (Number.isFinite(inset) ? inset : 0) + 12, bottom: bottom + 12 };
}

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
  fit = false,
  confirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** The body is a column whose list (`min-h-0`) shrinks to fit a short window, so the list is the one thing that
   *  scrolls and its last row is never cut off under the dialog's edge (the owner, 2026-11-26). */
  fit?: boolean;
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
  const [macRoom, setRoom] = useState<{ top: number; bottom: number } | null>(null);
  const { room, side } = pastFoldFrame(useFold(), macRoom);
  // Closing fades out over 150 ms (a 4 px rise on the web; only the fade on the Mac and with Reduce Motion), then the
  // dialog closes and its content goes (2026-11-25 polish review: it used to vanish at once after its animated entry).
  const closing = useRef<Closing | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open) {
      closing.current?.cancel();
      closing.current = null;
      setRoom(macFrameRoom());
      if (!el.open) el.showModal();
      setShown(true);
      return;
    }
    if (!el.open) {
      setShown(false);
      return;
    }
    // Without the Web Animations API `done` runs at once, before `fade` is set: then it just closes.
    let fade: Closing | null = null;
    fade = fadeOut(el, () => {
      if (fade && closing.current !== fade) return;
      closing.current = null;
      el.close();
      setShown(false);
    });
    closing.current = fade;
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
      onKeyDown={(e) => macDialogKeys(e, ref.current, onClose)}
      className={`m-auto w-[calc(100%-2rem)] ${width} ui-pop ui-modal rounded-panel p-0 text-ink outline-none shadow-[var(--glass-edge),0_16px_48px_rgb(0_0_0/0.1),0_2px_8px_rgb(0_0_0/0.1)] open:animate-[folio-pop_520ms_var(--spring-pop)]`}
      style={room || side ? { ...side, ...(room ? { top: room.top, bottom: room.bottom, maxHeight: `calc(100dvh - ${room.top + room.bottom}px)` } : null) } : undefined}
    >
      {shown ? (
        <div className="flex max-h-[85dvh] flex-col" style={room ? { maxHeight: `min(85dvh, calc(100dvh - ${room.top + room.bottom}px))` } : undefined}>
          <header className="flex items-start gap-3 px-6 pb-2 pt-5">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="ui-display text-title-2 leading-snug">
                {title}
              </h2>
              {description ? (
                <div id={descId} className="mt-1 text-pretty text-subheadline text-muted">
                  {description}
                </div>
              ) : null}
            </div>
            <IconButton label="Close" onClick={onClose}>
              <X size={16} aria-hidden />
            </IconButton>
          </header>
          <div className={`min-h-0 flex-1 overflow-y-auto px-6 py-4 ${fit ? "flex flex-col" : ""}`}>{children}</div>
          {footer ? <footer className="flex justify-end gap-2 bg-[color-mix(in_oklab,var(--color-surface-sunken)_60%,transparent)] px-6 py-3.5 shadow-[inset_0_1px_0_var(--color-line)]">{footer}</footer> : null}
        </div>
      ) : null}
    </dialog>
  );
}

/**
 * Folevi for Mac (docs/MAC_POLISH_PLAN.md §3.14): Return is the dialog's default button (its primary one, at the
 * end of the footer) wherever a form or a control of its own doesn't take Return, and ⌘. cancels, as in a Mac
 * sheet. Escape closes it everywhere already (the <dialog>'s own cancel).
 */
function macDialogKeys(e: KeyboardEvent<HTMLDialogElement>, dialog: HTMLDialogElement | null, onClose: () => void) {
  if (!dialog || document.documentElement.getAttribute("data-desktop") !== "mac" || e.defaultPrevented) return;
  if (e.key === "." && e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey) {
    e.preventDefault();
    onClose();
    return;
  }
  if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.altKey || e.ctrlKey || e.nativeEvent.isComposing) return;
  const target = e.target instanceof Element ? e.target : null;
  if (!target || target.closest("form, textarea, button, a[href], select, [contenteditable='true'], [role='combobox'], [role='listbox'], [role='menu'], [role='option']")) return;
  const footer = [...dialog.querySelectorAll("footer")].pop();
  const primary = footer ? [...footer.querySelectorAll<HTMLButtonElement>("button.ui-btn-primary, button.ui-btn-danger")].filter((b) => !b.disabled).pop() : undefined;
  if (!primary) return;
  e.preventDefault();
  primary.click();
}
