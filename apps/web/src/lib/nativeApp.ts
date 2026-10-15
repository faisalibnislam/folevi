// The iPhone and iPad app (apps/ios) shows this site in Capacitor's web view and adds `window.foleviNative`
// (apps/ios/ios/App/App/bridge.js): haptics, the status bar's colour, links that open in an in-app Safari
// view, folevi:// links, and the Face ID lock's settings. It also marks the page `data-native="ios"` before
// the first paint (safe areas in globals.css). In a browser and in the Mac app it's absent: nativeApp() is null.
//
// App Store rule 3.1.1: inside the iOS app nothing may sell or point at buying (plans, prices, checkout,
// credit packs). Every purchase surface asks canPurchaseHere() first; text written by the server that says
// where to buy goes through withoutPurchaseHints().

/** The Face ID lock, kept on the device (never on Folevi's servers). */
export interface NativeSettings {
  lock: boolean;
  /** Seconds in the background before the app asks to unlock again. */
  lockAfter: LockAfter;
  /** What unlocks this device; "none" when it has no passcode (the lock can't be turned on). */
  method: "faceID" | "touchID" | "opticID" | "passcode" | "none";
}

export type LockAfter = 0 | 60 | 300 | 900;

export type NativeCommand = { type: "link"; url: string };

export type Haptic = "light" | "medium" | "heavy" | "success" | "warning" | "error";

export interface NativeBridge {
  platform: "ios";
  version: string;
  haptic(kind: Haptic): void;
  /** The status bar's text for the page's theme (light text on a dark page). */
  setStatusBar(theme: "light" | "dark"): void;
  /** Opens a link outside the app: web pages in an in-app Safari view. Resolves false when it can't. */
  openExternal(url: string): Promise<boolean>;
  getSettings(): Promise<NativeSettings | null>;
  /** Turning the lock on asks to unlock once first; resolves with the settings as they now are. */
  setSettings(patch: Partial<Pick<NativeSettings, "lock" | "lockAfter">>): Promise<NativeSettings>;
  onCommand(listener: (command: NativeCommand) => void): () => void;
}

declare global {
  interface Window {
    foleviNative?: NativeBridge;
  }
}

/** The iPhone and iPad app's bridge, or null in a browser (and in the Mac app). */
export function nativeApp(): NativeBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.foleviNative;
  return bridge && bridge.platform === "ios" ? bridge : null;
}

/** Whether the page is inside the iOS app: the bridge, or the mark it leaves on the page. */
export function inIosApp(): boolean {
  if (typeof document === "undefined") return false;
  return nativeApp() !== null || document.documentElement.dataset.native === "ios";
}

/**
 * Whether this page may offer plans, prices and purchases. Not inside the iOS app (App Store rule 3.1.1):
 * there plans are managed on folevi.com, and nothing in the app links to buying.
 */
export const canPurchaseHere = (): boolean => !inIosApp();

/** What Settings > Plan & billing says in the iOS app, in place of plans and checkout. */
export const MANAGED_ELSEWHERE = "Plans and billing are managed on folevi.com, not in this app.";

/**
 * Server messages end with where to buy ("Buy more in Settings → Plan & billing.", "Upgrade to use it.").
 * In the iOS app those sentences go; the rest (what happened, when credits reset) stays.
 */
export function withoutPurchaseHints(text: string, iosApp: boolean = inIosApp()): string {
  if (!iosApp || !text) return text;
  const kept = text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !PURCHASE_HINT.test(sentence))
    .join(" ")
    .trim();
  return kept || NOT_ON_PLAN;
}

const NOT_ON_PLAN = "This isn't part of your plan.";

/** A sentence that sends the reader to buy, upgrade or change plans. */
const PURCHASE_HINT = /\b(buy|upgrade[sd]?|purchase|checkout|choose a plan|change (your )?plans?|see plans|switch to (pro|core|a paid)|choose in settings)\b|Plan (&|and) billing/i;

/** A light tap in the hand inside the iOS app; nothing elsewhere. */
export function haptic(kind: Haptic = "light"): void {
  nativeApp()?.haptic(kind);
}
