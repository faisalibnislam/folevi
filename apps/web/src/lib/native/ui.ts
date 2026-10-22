// The native UI layer's one door (docs/IOS_POLISH_PLAN.md §4): screens call these, never `window.foleviNative`
// directly. Inside the iPhone and iPad app (and the Android app, where it has the piece) each one is the
// system's own: haptics, action sheets, alerts, the date and colour pickers, the share sheet, the keyboard's
// moves. Everywhere else (the website, the Mac app, an older app) the same call does Folevi's own version, so
// a caller never needs a second path.
//
// Menus stay Folevi's (components/ui/Menu.tsx, in Folevi's fonts, owner's decision D1); only the lifted
// preview of a long press is native (lib/native/lift.ts).

import { nativeApp, type Haptic, type NativeAction, type NativeBridge, type NativeKeyboardFrame, type NativeRect } from "@/lib/nativeApp";

export type { NativeKeyboardFrame, NativeRect } from "@/lib/nativeApp";

/** Which native pieces this app has (an older build has fewer; the website none). */
export function hasNative(piece: "actionSheet" | "alert" | "pickDate" | "pickColor" | "share" | "lift" | "keyboard"): boolean {
  const b = nativeApp();
  if (!b) return false;
  switch (piece) {
    case "lift":
      return typeof b.liftArm === "function" && typeof b.lift === "function" && typeof b.liftDrop === "function";
    case "keyboard":
      return typeof b.onKeyboard === "function";
    default:
      return typeof b[piece] === "function";
  }
}

// ---------------------------------------------------------------------------------------------- haptics

/**
 * What just happened, felt in the hand (§2.5). A sheet snapping to a detent is felt by nothing, as on iOS.
 * - "menu": a long press opened a menu
 * - "choose": a choice moved (a segmented control, a radio row, a sort)
 * - "toggle", "check": a switch flipped, a task checked
 * - "threshold": a swipe crossed its full-swipe point
 * - "lift", "land": a drag picked something up, put it down
 * - "refresh": pull to refresh let go past its point
 * - "destructive": something was deleted or moved to the Trash
 * - "failed", "done": something failed, or finished
 */
export type FeelMoment = "menu" | "choose" | "toggle" | "check" | "threshold" | "lift" | "land" | "refresh" | "destructive" | "failed" | "done";

export const FEEL: Record<FeelMoment, Haptic> = {
  menu: "medium",
  choose: "selection",
  toggle: "light",
  check: "light",
  threshold: "rigid",
  lift: "light",
  land: "soft",
  refresh: "medium",
  destructive: "warning",
  failed: "error",
  done: "success",
};

/** Kinds an app built before the native UI layer doesn't know: played as the nearest one it does. */
const OLDER: Partial<Record<Haptic, Haptic>> = { rigid: "medium", soft: "light", selection: "light" };

function play(bridge: NativeBridge, kind: Haptic) {
  // (hapticPrepare arrived with the new kinds: without it, the app is older.)
  bridge.haptic(typeof bridge.hapticPrepare === "function" ? kind : (OLDER[kind] ?? kind));
}

/** Feels `moment` in the iOS and Android apps; nothing elsewhere. */
export function feel(moment: FeelMoment): void {
  const b = nativeApp();
  if (b) play(b, FEEL[moment]);
}

/** Readies the haptic for `moment` (call on touchstart of a control that will fire it), so it plays on time. */
export function prepareFeel(moment: FeelMoment): void {
  nativeApp()?.hapticPrepare?.(FEEL[moment]);
}

// ----------------------------------------------------------------------------------- where on screen

/** An element's or a rectangle's place on screen in the visual viewport's CSS pixels (what the app draws in). */
export function screenRect(of: Element | DOMRect | NativeRect): NativeRect {
  const r: NativeRect = of instanceof Element ? of.getBoundingClientRect() : of;
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  const ox = vv?.offsetLeft ?? 0;
  const oy = vv?.offsetTop ?? 0;
  // (A DOMRect's x and y are its left and top, also with a negative size.)
  const x = Math.min(r.x, r.x + r.width);
  const y = Math.min(r.y, r.y + r.height);
  return { x: Math.round((x - ox) * 100) / 100, y: Math.round((y - oy) * 100) / 100, width: Math.round(Math.abs(r.width) * 100) / 100, height: Math.round(Math.abs(r.height) * 100) / 100 };
}

const anchorOf = (anchor?: Element | DOMRect | NativeRect | null): NativeRect | undefined => (anchor ? screenRect(anchor) : undefined);

// ------------------------------------------------------------------------- alerts and action sheets

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** The confirming button's words ("Delete", "Sign out"). */
  confirm: string;
  cancel?: string;
  /** Red, and felt as a warning when confirmed. */
  destructive?: boolean;
  /**
   * "alert" (the default): a centred alert. "sheet": an action sheet from the bottom (on iPad a popover from
   * `anchor`), as iOS asks before discarding or deleting from a menu.
   */
  style?: "alert" | "sheet";
  anchor?: Element | DOMRect | NativeRect | null;
}

/** Asks before doing something: true when confirmed. A native alert in the app; Folevi's dialog elsewhere. */
export async function confirmAction(o: ConfirmOptions): Promise<boolean> {
  const b = nativeApp();
  const cancel: NativeAction = { id: "cancel", title: o.cancel ?? "Cancel", style: "cancel" };
  const ok: NativeAction = { id: "confirm", title: o.confirm, style: o.destructive ? "destructive" : "default" };
  let chosen: string | null | undefined;
  if (b && o.style === "sheet" && typeof b.actionSheet === "function") {
    chosen = await b.actionSheet({ title: o.title, message: o.message, actions: [ok, cancel], anchor: anchorOf(o.anchor) }).catch(() => undefined);
  } else if (b && typeof b.alert === "function") {
    chosen = await b.alert({ title: o.title, message: o.message, actions: [cancel, ok] }).then((r) => r?.id ?? null, () => undefined);
  }
  if (chosen === undefined) {
    const { showConfirm } = await import("./fallbacks");
    chosen = (await showConfirm(o)) ? "confirm" : null;
  }
  const yes = chosen === "confirm";
  if (yes && o.destructive) feel("destructive");
  return yes;
}

export interface AskTextOptions {
  title: string;
  message?: string;
  /** What the field starts with (a rename: the current name, all selected). */
  value?: string;
  placeholder?: string;
  /** The field's label, for the dialog version and screen readers. Defaults to the placeholder or the title. */
  label?: string;
  confirm?: string;
  cancel?: string;
  capitalize?: "none" | "words" | "sentences";
  /** Longest text accepted (the dialog's field enforces it; the alert's is trimmed to it). */
  maxLength?: number;
}

/** One line of text (a rename, a new name): the trimmed text, or null when cancelled or left empty. */
export async function askText(o: AskTextOptions): Promise<string | null> {
  const b = nativeApp();
  const max = o.maxLength ?? 80;
  if (b && typeof b.alert === "function") {
    const r = await b
      .alert({
        title: o.title,
        message: o.message,
        actions: [
          { id: "cancel", title: o.cancel ?? "Cancel", style: "cancel" },
          { id: "confirm", title: o.confirm ?? "Save" },
        ],
        field: { value: o.value ?? "", placeholder: o.placeholder ?? "", capitalize: o.capitalize ?? "sentences" },
      })
      .catch(() => undefined);
    if (r !== undefined) {
      const text = r?.id === "confirm" ? (r.text ?? "").trim().slice(0, max) : "";
      return text || null;
    }
  }
  const { showAskText } = await import("./fallbacks");
  return showAskText({ ...o, maxLength: max });
}

export interface ChoiceAction {
  id: string;
  title: string;
  destructive?: boolean;
}

/**
 * A short list of things to do with something (an action sheet): the chosen id, or null when dismissed.
 * For a menu of a thing's options use the web Menu; this is for a question with a few answers.
 */
export async function chooseAction(o: { title?: string; message?: string; actions: ChoiceAction[]; cancel?: string; anchor?: Element | DOMRect | NativeRect | null }): Promise<string | null> {
  const b = nativeApp();
  if (b && typeof b.actionSheet === "function") {
    const actions: NativeAction[] = [...o.actions.map((a) => ({ id: a.id, title: a.title, style: a.destructive ? ("destructive" as const) : ("default" as const) })), { id: "\u0000cancel", title: o.cancel ?? "Cancel", style: "cancel" }];
    const r = await b.actionSheet({ title: o.title, message: o.message, actions, anchor: anchorOf(o.anchor) }).catch(() => undefined);
    if (r !== undefined) {
      const picked = r && r !== "\u0000cancel" ? r : null;
      if (picked && o.actions.find((a) => a.id === picked)?.destructive) feel("destructive");
      return picked;
    }
  }
  const { showChoice } = await import("./fallbacks");
  const picked = await showChoice(o);
  if (picked && o.actions.find((a) => a.id === picked)?.destructive) feel("destructive");
  return picked;
}

// ---------------------------------------------------------------------------------------------- pickers

export type PickDateMode = "date" | "time" | "dateAndTime";

export interface PickDateOptions {
  /** YYYY-MM-DD ("date"), HH:MM ("time") or YYYY-MM-DDTHH:MM ("dateAndTime"), local time. */
  value?: string | null;
  mode: PickDateMode;
  min?: string;
  max?: string;
  title?: string;
  /** Offers "Clear" (resolves { value: null }). */
  clearable?: boolean;
}

const DATE_SHAPE: Record<PickDateMode, RegExp> = {
  date: /^\d{4}-\d{2}-\d{2}$/,
  time: /^\d{2}:\d{2}$/,
  dateAndTime: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
};

/** Whether `value` is the shape `mode` uses. */
export const isPickedValue = (mode: PickDateMode, value: unknown): value is string => typeof value === "string" && DATE_SHAPE[mode].test(value);

/**
 * A date, a time or both: the system's picker in a sheet in the app, Folevi's calendar and time list in a
 * dialog elsewhere. Resolves { value } (null: cleared) or null when dismissed.
 */
export async function pickDate(o: PickDateOptions): Promise<{ value: string | null } | null> {
  const b = nativeApp();
  if (b && typeof b.pickDate === "function") {
    const r = await b.pickDate({ value: o.value ?? null, mode: o.mode, min: o.min, max: o.max, title: o.title, clearable: !!o.clearable }).catch(() => undefined);
    if (r !== undefined) {
      if (!r) return null;
      if (r.value === null) return o.clearable ? { value: null } : null;
      return isPickedValue(o.mode, r.value) ? { value: r.value } : null;
    }
  }
  const { showPickDate } = await import("./fallbacks");
  return showPickDate(o);
}

/**
 * A custom colour from the system's colour picker: "#rrggbb", or null when closed. Only in the app
 * (`hasNative("pickColor")`); elsewhere it resolves null and the caller keeps its own swatches.
 */
export async function pickColor(o: { value?: string; title?: string } = {}): Promise<string | null> {
  const b = nativeApp();
  if (!b || typeof b.pickColor !== "function") return null;
  const r = await b.pickColor(o).catch(() => null);
  return typeof r === "string" && /^#[0-9a-f]{6}$/i.test(r) ? r.toLowerCase() : null;
}

/**
 * The share sheet: the app's own (from `anchor` on iPad), else the browser's, else the link is copied.
 * Resolves "shared", "copied" or "cancelled".
 */
export async function shareContent(o: { title?: string; text?: string; url?: string; anchor?: Element | DOMRect | NativeRect | null }): Promise<"shared" | "copied" | "cancelled"> {
  const b = nativeApp();
  const data = { title: o.title, text: o.text, url: o.url };
  if (b && typeof b.share === "function") {
    const r = await b.share({ ...data, anchor: anchorOf(o.anchor) }).catch(() => undefined);
    if (r !== undefined) return r ? "shared" : "cancelled";
  }
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share(data);
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    }
  }
  const text = o.url ?? o.text ?? o.title ?? "";
  if (text && typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return "copied";
    } catch {
      /* no clipboard either */
    }
  }
  return "cancelled";
}

// ---------------------------------------------------------------------------------------------- keyboard

/**
 * iOS's keyboard curve as CSS (UIKit's curve 7, a spring with no overshoot, close to this over its 250 ms):
 * a bar that moves with the keyboard uses it with the frame's `duration`, so both land in the same frame.
 */
export const KEYBOARD_EASE = "cubic-bezier(0.19, 0.9, 0.24, 1)";

/** The CSS transition for something that moves with the keyboard to `frame`. */
export function keyboardTransition(frame: NativeKeyboardFrame, property = "transform"): string {
  if (frame.duration <= 0) return "none";
  return `${property} ${Math.round(frame.duration)}ms ${frame.curve === "linear" ? "linear" : KEYBOARD_EASE}`;
}

/** The keyboard's height from what the browser shows (no app): the part of the window the visual viewport lost. */
function viewportKeyboard(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  const covered = window.innerHeight - vv.height - vv.offsetTop;
  return covered > 40 ? Math.round(covered) : 0;
}

/**
 * Every move of the keyboard. In the app: its frame, duration and curve before it moves (and each frame while a
 * finger drags it down). Elsewhere: Capacitor's keyboard events or the visual viewport, without a duration.
 * Returns the function that stops.
 */
export function onKeyboardFrame(listener: (frame: NativeKeyboardFrame) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const b = nativeApp();
  if (b && typeof b.onKeyboard === "function") return b.onKeyboard(listener);
  let last = -1;
  const report = (height: number, duration = 0) => {
    if (height === last) return;
    last = height;
    listener({ height, duration, curve: duration ? "keyboard" : "linear", visible: height > 0 });
  };
  // Capacitor's Keyboard plugin (the Android app, an older iOS app): heights before the move.
  const willShow = (e: Event) => report(Math.round(Number((e as Event & { keyboardHeight?: number }).keyboardHeight) || viewportKeyboard()), 250);
  const willHide = () => report(0, 250);
  const fromViewport = () => report(viewportKeyboard());
  window.addEventListener("keyboardWillShow", willShow);
  window.addEventListener("keyboardWillHide", willHide);
  window.visualViewport?.addEventListener("resize", fromViewport);
  return () => {
    window.removeEventListener("keyboardWillShow", willShow);
    window.removeEventListener("keyboardWillHide", willHide);
    window.visualViewport?.removeEventListener("resize", fromViewport);
  };
}

/** Lets a drag down in a view that scrolls take the keyboard away with the finger (the note editor), or not. */
export function setKeyboardInteractiveDismiss(on: boolean): void {
  nativeApp()?.keyboard?.({ interactiveDismiss: on });
}
