// How the built-in interface names the device it runs on, in the local mode and sign-in screens: "this Mac" in
// the Mac app, "this iPhone" or "this iPad" in the iOS app, "this phone" in the Android app. Also where its
// settings and files live ("System Settings" and Finder on the Mac, the Settings and Files apps on iOS).
import { shell } from "./index";

export interface DeviceWords {
  /** "this Mac", "this iPhone", "this iPad", "this phone". */
  here: string;
  /** "This Mac", "This iPhone"… (at the start of a sentence). */
  Here: string;
  /** "Mac", "iPhone", "iPad", "phone". */
  noun: string;
  /** Where the system's settings are: "System Settings" or "the Settings app". */
  settings: string;
  /** Where the person sees files: "Finder" or "the Files app". */
  files: string;
  /** Where sign-in happens: "your browser" (Mac), "the sign-in sheet" (iOS) or "the sign-in page" (Android). */
  signInPlace: string;
  ios: boolean;
  /** The model Foli AI runs on the device: "Apple Intelligence" on Apple's, "Gemini Nano" on Android. */
  onDeviceModel: string;
}

export function deviceWords(): DeviceWords {
  const s = shell();
  if (s?.platform === "ios") {
    const noun = s.deviceFamily === "iPad" ? "iPad" : "iPhone";
    return { here: `this ${noun}`, Here: `This ${noun}`, noun, settings: "the Settings app", files: "the Files app", signInPlace: "the sign-in sheet", ios: true, onDeviceModel: "Apple Intelligence" };
  }
  if (s?.platform === "android") {
    // A tablet says so (deviceFamily from the shell); a foldable is a phone, folded or not.
    const noun = s.deviceFamily === "tablet" ? "tablet" : "phone";
    return { here: `this ${noun}`, Here: `This ${noun}`, noun, settings: "the Settings app", files: "the Files app", signInPlace: "the sign-in page", ios: false, onDeviceModel: "Gemini Nano" };
  }
  // The native Mac app (apps/mac, WebKit) signs in to Dropbox and Google in a sign-in sheet; Electron in the browser.
  const sheet = typeof document !== "undefined" && document.documentElement?.getAttribute("data-mac-engine") === "webkit";
  return { here: "this Mac", Here: "This Mac", noun: "Mac", settings: "System Settings", files: "Finder", signInPlace: sheet ? "the sign-in sheet" : "your browser", ios: false, onDeviceModel: "Apple Intelligence" };
}
