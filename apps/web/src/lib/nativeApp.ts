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

/**
 * This iPhone or iPad, and the REST API token its widgets, share extension, Shortcuts and Spotlight use
 * (lib/nativeDevice.ts). The token itself never comes back to the page; only which one the app holds.
 */
export interface NativeDevice {
  /** The app's install id on this device. */
  id: string;
  family: "iPhone" | "iPad";
  /** "iPhone 18 Pro", or "" when the app doesn't know the model's name. */
  model: string;
  /** The account the app's token is for, and the token's id; null when it holds none. */
  accountId: string | null;
  tokenId: string | null;
  /** Whether the camera's document scanner works here (not in the Simulator). */
  scanner: boolean;
}

/** A file handed over by the app: base64 bytes with a name and type. */
export interface NativeFile {
  name: string;
  type: string;
  data: string;
}

/** Something shared to Folevi (the share extension) while it couldn't reach Folevi, kept for the app. */
export interface NativeShare {
  id: string;
  title: string;
  text: string;
  url: string;
  /** "personal" or a workspace's id, as GET /api/v1/places names it; null for Personal. */
  place: string | null;
  files: NativeFile[];
}

/** A scanned document: each page as a JPEG, and the text read from them. */
export interface NativeScan {
  pages: NativeFile[];
  text: string;
}

/** Notifications on this iPhone or iPad (Apple's push service), as the app reports them. */
export interface NativePushStatus {
  /** iOS's answer: not asked yet, turned off in iOS Settings, or allowed. */
  permission: "notDetermined" | "denied" | "granted";
  /** Turned on in Folevi on this device. */
  enabled: boolean;
  /** Whether Folevi has asked iOS before (so a first reminder doesn't ask again). */
  asked: boolean;
  /** Apple's device token (hex) while enabled, for push.registerApns. */
  token: string | null;
  environment: "sandbox" | "production";
  bundleId: string;
}

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
  // Stage 2 (widgets, the share extension, Shortcuts, Spotlight, the scanner). Optional: an
  // older app doesn't have them.
  device?(): Promise<NativeDevice | null>;
  /** Keeps the device's token in the Keychain for the app's extensions. */
  setCredential?(credential: { token: string; tokenId: string; accountId: string }): Promise<boolean>;
  /** Signing out: the token, the widgets' copy of tasks and notes, and Spotlight's entries go. */
  clearCredential?(): Promise<void>;
  /** Shares the extension kept (offline, or with files); finishShare removes one once it's saved. */
  takeShares?(): Promise<NativeShare[]>;
  finishShare?(id: string): Promise<void>;
  /** Scans a document with the camera, or reads pages from photos; null when the person cancels. */
  scanDocument?(source: "camera" | "photos"): Promise<NativeScan | null>;
  // Stage 3 (notifications through Apple's push service, the app icon's badge).
  pushStatus?(): Promise<NativePushStatus | null>;
  /** Asks iOS the first time, then gets the device token; resolves with the status (null if the app can't). */
  enablePush?(): Promise<NativePushStatus | null>;
  disablePush?(): Promise<void>;
  /** The number on the app icon: what's unread in the bell. */
  setBadge?(count: number): void;
  /** The colour behind the web view, which shows round the keyboard's corners (0 to 255 each). */
  setBackdrop?(r: number, g: number, b: number): void;
  /**
   * Opens `url` in iOS's sign-in sheet (ASWebAuthenticationSession) and answers with the folevi:// link that
   * ends the sign-in there, or null if it was closed (Google sign-in, components/auth/GoogleSignIn.tsx).
   */
  authenticate?(url: string): Promise<string | null>;
  /** Folevi's page in the iOS Settings app (where notifications turned off in iOS come back on). */
  openNotificationSettings?(): Promise<void>;
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
 * there Plan & billing shows the plan as it is, and nothing in the app links to buying or says where to.
 */
export const canPurchaseHere = (): boolean => !inIosApp();

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
