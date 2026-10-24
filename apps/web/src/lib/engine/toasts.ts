// Toasts in native chrome mode go to native as `toast` events instead of being drawn by the page
// (components/ui/Toast.tsx asks `nativeToast` first). A toast's button (Undo, Retry) is kept here for a minute
// under an id that native sends back with `toast.action`.
import type { ToastEvent } from "./protocol";

type Sink = (event: ToastEvent) => void;

let sink: Sink | null = null;
const actions = new Map<string, { run: () => void; at: number }>();
let next = 0;
const KEEP_MS = 60_000;

/** Set by the bridge host while it's installed (null when it isn't). */
export function setToastSink(s: Sink | null): void {
  sink = s;
}

/**
 * Sends a toast to native; false when there's no native host to show it (the page draws it then).
 * `tone` is the page's: "neutral", "success" or "error".
 */
export function nativeToast(message: string, opts?: { tone?: string; action?: { label: string; onClick: () => void } }): boolean {
  if (!sink) return false;
  const now = Date.now();
  for (const [k, v] of actions) if (now - v.at > KEEP_MS) actions.delete(k);
  let action: ToastEvent["action"] = null;
  if (opts?.action) {
    const id = `t${++next}`;
    actions.set(id, { run: opts.action.onClick, at: now });
    action = { id, label: opts.action.label };
  }
  const tone = opts?.tone === "error" ? "error" : opts?.tone === "success" ? "success" : "info";
  sink({ message, tone, undo: null, action });
  return true;
}

/** Runs a toast's button; false when the id is unknown or too old. */
export function runToastAction(id: string): boolean {
  const a = actions.get(id);
  if (!a) return false;
  actions.delete(id);
  a.run();
  return true;
}
