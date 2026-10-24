// The iPhone and iPad app (apps/ios) shows this site in Capacitor's web view and adds `window.foleviNative`
// (apps/ios/ios/App/App/bridge.js): haptics, the status bar's colour, links that open in an in-app Safari
// view, folevi:// links, and the Face ID lock's settings. It also marks the page `data-native="ios"` before
// the first paint (safe areas in globals.css). In a browser and in the Mac app it's absent: nativeApp() is null.
//
// App Store rule 3.1.1: inside the iOS app nothing may sell or point at buying (plans, prices, checkout,
// credit packs). Every purchase surface asks canPurchaseHere() first; text written by the server that says
// where to buy goes through withoutPurchaseHints().

import { currentBackendMode } from "./backendMode";
import { MARKER_GLOBAL, type NativeChromeMarker } from "./engine/protocol";

/** The Face ID lock, kept on the device (never on Folevi's servers). */
export interface NativeSettings {
  lock: boolean;
  /** Seconds in the background before the app asks to unlock again. */
  lockAfter: LockAfter;
  /** What unlocks this device; "none" when it has no passcode (the lock can't be turned on). */
  /** "biometric" and "screenLock": the Android app (a fingerprint or face, else the phone's PIN, pattern or password). */
  method: "faceID" | "touchID" | "opticID" | "passcode" | "biometric" | "screenLock" | "none";
}

export type LockAfter = 0 | 60 | 300 | 900;

export type NativeCommand = { type: "link"; url: string };

/**
 * Impacts ("light" to "heavy", and iOS's "rigid" and "soft"), a "selection" tick (a choice moved), and the
 * notices ("success", "warning", "error"). Screens say what happened with lib/native/ui.ts `feel()` instead.
 * (An older app plays "rigid", "soft" and "selection" as "light".)
 */
export type Haptic = "light" | "medium" | "heavy" | "rigid" | "soft" | "selection" | "success" | "warning" | "error";

/** A rectangle on screen, in CSS pixels from the top left of what's visible (the visual viewport). */
export interface NativeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A button in an action sheet or an alert. "cancel" is the one the app adds when the person taps away. */
export interface NativeAction {
  id: string;
  title: string;
  style?: "default" | "cancel" | "destructive";
}

/** The keyboard as the app sees it: how much of the screen it covers and how it's moving there. */
export interface NativeKeyboardFrame {
  /** From the bottom of the screen to the keyboard's top, in CSS pixels; 0 when it's away (or undocked). */
  height: number;
  /** How long the move takes, in milliseconds (0 while it follows a finger dragging it down). */
  duration: number;
  /** "keyboard": iOS's own keyboard curve (lib/native/ui.ts KEYBOARD_EASE); "linear" while it follows a finger. */
  curve: "keyboard" | "linear";
  /** Whether it's on its way up (or there), as opposed to going away. */
  visible: boolean;
  /** How long ago the keyboard set off on this move, in milliseconds (its news takes a moment to reach the page). */
  late?: number;
}

/**
 * This iPhone or iPad, and the REST API token its widgets, share extension, Shortcuts and Spotlight use
 * (lib/nativeDevice.ts). The token itself never comes back to the page; only which one the app holds.
 */
export interface NativeDevice {
  /** The app's install id on this device. */
  id: string;
  family: "iPhone" | "iPad" | "Android";
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

/** A task as the widgets show it (the REST API's shape, GET /api/v1/tasks): its id is the to-do block's. */
export interface NativeWidgetTask {
  id: string;
  text: string;
  status: "open";
  dueDate: string | null;
  dueTime: string | null;
  priority: "low" | "medium" | "high" | null;
  note: { id: string; title: string };
}

/** A note as the widgets and Shortcuts show it (GET /api/v1/notes's shape). */
export interface NativeWidgetNote {
  id: string;
  title: string;
  place: { id: string | null; name: string };
  /** ISO 8601. */
  updatedAt: string;
}

/** Local mode: the widgets' copy, from the page that holds the library. */
export interface NativeWidgetSnapshot {
  /** Today, YYYY-MM-DD on this device. */
  day: string;
  /** Open tasks due tomorrow or earlier. */
  tasks: NativeWidgetTask[];
  /** The most recently edited notes (the widgets show up to 10). */
  notes: NativeWidgetNote[];
  /** The notes Shortcuts can pick from (Open note, Add a task to a note), most recently edited first. */
  catalog: NativeWidgetNote[];
}

/** Local mode: something a widget, Siri or Shortcuts did while the page wasn't there to do it. */
export type NativeLocalAction =
  | { id: string; kind: "toggleTask"; taskId: string; completed: boolean }
  | { id: string; kind: "addTask"; text: string; dueDate: string | null; noteId: string | null }
  | { id: string; kind: "newNote"; title: string; markdown: string };

/** Local mode: a note as Spotlight shows it. */
export interface NativeSpotlightItem {
  id: string;
  title: string;
  excerpt: string;
  /** Its folder, or where the library is. */
  location: string;
  starred: boolean;
  /** Milliseconds since 1970. */
  updatedAt: number;
}

export interface NativeBridge {
  /** "android": Folevi for Android (apps/android) adds the same extras with its own bridge (folevi-bridge.js). */
  platform: "ios" | "android";
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
   * ends the sign-in there, or null if it was closed (Google and Apple sign-in, components/auth/SocialSignIn.tsx).
   */
  authenticate?(url: string): Promise<string | null>;
  /** Folevi's page in the iOS Settings app (where notifications turned off in iOS come back on). */
  openNotificationSettings?(): Promise<void>;
  /**
   * The text in an image (base64 bytes), read on the device with Vision, for search (lib/fileText). Null when
   * it couldn't be read. Missing in apps built before it.
   */
  recognizeText?(image: { data: string; type: string; handwriting?: boolean }): Promise<{ text: string } | null>;
  /**
   * Sign in with Apple in Apple's own sheet (Native/AppleSignIn.swift): the credential's id token and one-time
   * authorization code, and the person's name the first time they use Apple with Folevi; null when it was
   * closed. `nonce` is the page's random string (the request carries its SHA-256). Missing in older builds.
   */
  signInWithApple?(o: { nonce: string }): Promise<{ idToken: string; authorizationCode: string; firstName: string | null; lastName: string | null } | null>;
  // Local mode (no account, so no REST API for the widgets, Shortcuts and Spotlight): the page that holds the
  // library feeds them and takes what they did (components/app/NativeBridge.tsx). Missing in older builds.
  setWidgetSnapshot?(snapshot: NativeWidgetSnapshot): Promise<void>;
  takeLocalActions?(): Promise<NativeLocalAction[]>;
  finishLocalAction?(id: string): Promise<void>;
  /** Spotlight holds exactly these notes afterwards. */
  indexSpotlight?(items: NativeSpotlightItem[]): Promise<void>;
  // The native UI layer (docs/IOS_POLISH_PLAN.md §4; the page calls lib/native/ui.ts and lib/native/lift.ts,
  // never these). Missing in older builds and wherever the app has no such piece: the page draws its own then.
  /** Readies the generator for `kind` (a control that's about to fire one was touched), so it plays on time. */
  hapticPrepare?(kind: Haptic): void;
  /**
   * The lifted preview of a long press, step 1: the app takes a picture of `rect` now, while it's still drawn
   * as it is at rest. `radius` rounds its corners. A later arm replaces it; one not lifted within 2 s is dropped.
   */
  liftArm?(o: { id: string; rect: NativeRect; radius: number }): void;
  /**
   * Step 2, the menu opened: the picture floats over the page where `rect` is, lifting from `from` (the scale
   * the page had pressed it in to) with a shadow. Resolves false when there's no picture for `id` (nothing shows).
   */
  lift?(o: { id: string; from?: number }): Promise<boolean>;
  /** Step 3, the menu closed: it settles back into place ("back") or fades where it is ("fade"), then goes. */
  liftDrop?(o: { id: string; to?: "back" | "fade" }): Promise<void>;
  /** While lifted: the picture moves up by `dy` from where it lifted (0: back), so its menu fits under it. */
  liftMove?(o: { id: string; dy: number }): void;
  /** An action sheet (on iPad a popover from `anchor`): the chosen action's id, or null when dismissed. */
  actionSheet?(o: { title?: string; message?: string; actions: NativeAction[]; anchor?: NativeRect }): Promise<string | null>;
  /** An alert, with one text field when `field` is given: the chosen action and the field's text, or null. */
  alert?(o: {
    title: string;
    message?: string;
    actions: NativeAction[];
    field?: { value?: string; placeholder?: string; capitalize?: "none" | "words" | "sentences" };
  }): Promise<{ id: string; text?: string } | null>;
  /**
   * The system's date and time picker in a sheet. `value`, `min`, `max`: YYYY-MM-DD, HH:MM or
   * YYYY-MM-DDTHH:MM (local time) for the mode. Resolves { value } (null when "Clear" was tapped, only
   * offered with `clearable`), or null when the sheet was dismissed.
   */
  pickDate?(o: { value?: string | null; mode: "date" | "time" | "dateAndTime"; min?: string; max?: string; title?: string; clearable?: boolean }): Promise<{ value: string | null } | null>;
  /** The system's colour picker: "#rrggbb", or null when it was closed without a choice. */
  pickColor?(o: { value?: string; title?: string }): Promise<string | null>;
  /** The share sheet (on iPad from `anchor`): true when something was shared, false when it was closed. */
  share?(o: { title?: string; text?: string; url?: string; anchor?: NativeRect }): Promise<boolean>;
  /** How the keyboard behaves: dragging a view that scrolls down past the keyboard takes it away with the finger. */
  keyboard?(o: { interactiveDismiss?: boolean }): void;
  /** Every move of the keyboard (shown, hidden, resized, dragged by a finger); returns the function that stops. */
  onKeyboard?(listener: (frame: NativeKeyboardFrame) => void): () => void;
  /** Text onto the pasteboard; true once it's there. (The app also stands in for navigator.clipboard.writeText when WebKit refuses it.) */
  copyText?(text: string): Promise<boolean>;
}

declare global {
  interface Window {
    foleviNative?: NativeBridge;
    /** Set by the native apps' host before the first paint: native chrome mode (docs/NATIVE_APP_PLAN.md section 8). */
    __foleviNativeChrome?: NativeChromeMarker;
  }
}

/**
 * Native chrome mode (docs/NATIVE_APP_PLAN.md section 8): the native iPhone, iPad and Mac apps draw everything
 * outside the note page themselves, and this page is their engine (lib/engine) and their note page, with no web
 * frame. The host marks the page before its first paint (`window.__foleviNativeChrome`, `<html
 * data-native-chrome>`). Null everywhere else: the website and today's apps never see any of it.
 */
export function nativeChrome(): NativeChromeMarker | null {
  if (typeof window === "undefined") return null;
  const marker = window[MARKER_GLOBAL];
  // (A host on another protocol still gets native chrome mode: its hello is refused loudly, protocol_mismatch,
  // rather than the page quietly drawing the whole web app behind the native frame.)
  if (!marker || typeof marker !== "object" || typeof marker.platform !== "string") return null;
  return marker;
}

/** The iPhone and iPad app's bridge (or the Android app's, the same extras), or null in a browser and the Mac app. */
export function nativeApp(): NativeBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.foleviNative;
  return bridge && (bridge.platform === "ios" || bridge.platform === "android") ? bridge : null;
}

/** Whether the page is inside the Android app (apps/android): its bridge, or the mark it leaves on the page. */
export function inAndroidApp(): boolean {
  if (typeof document === "undefined") return false;
  return window.foleviNative?.platform === "android" || document.documentElement.dataset.native === "android";
}

/**
 * Whether the page is inside an app sold through a store (the iPhone and iPad app, the Android app), where
 * nothing may sell or point at buying: plans are bought on folevi.com and the app unlocks.
 */
export function isNativeStoreApp(): boolean {
  return inIosApp() || inAndroidApp();
}

/** Whether the page is inside the iOS app: the bridge, or the mark it leaves on the page. */
export function inIosApp(): boolean {
  if (typeof document === "undefined") return false;
  return window.foleviNative?.platform === "ios" || document.documentElement.dataset.native === "ios";
}

/**
 * Whether this page may offer plans, prices and purchases. Not inside the iOS app (App Store rule 3.1.1):
 * there Plan & billing shows the plan as it is, and nothing in the app links to buying or says where to.
 * Never in local mode either, on any platform: a library on the person's devices has no plan to buy.
 */
export const canPurchaseHere = (): boolean => !isNativeStoreApp() && currentBackendMode() !== "local";

/**
 * Server messages end with where to buy ("Buy more in Settings → Plan & billing.", "Upgrade to use it.").
 * In the iOS app those sentences go; the rest (what happened, when credits reset) stays.
 */
export function withoutPurchaseHints(text: string, iosApp: boolean = isNativeStoreApp()): string {
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

/** A light tap in the hand inside the iOS and Android apps; nothing elsewhere. */
export function haptic(kind: Haptic = "light"): void {
  nativeApp()?.haptic(kind);
}
