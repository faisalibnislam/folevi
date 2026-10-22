// The native apps' device keys (docs/E2EE_DESIGN.md §6.2, §6.11): the Mac (apps/desktop/src/e2ee.ts, in the
// main process), the iPhone and iPad app (apps/ios, Native/Shell/E2eeKeys.swift) and the Android app hold the
// device's private keys themselves, behind the same bridge, `foleviShell.e2ee` (and `foleviDesktop.e2ee` on
// the website the Mac app shows). The page never holds a native device's private keys.
//
// Passkeys aren't offered in any native app (§6.11, §14 Q2): the app's own origin can't use app.folevi.com
// passkeys and the web views have no dependable PRF. Approving from another device, the passphrase and the
// recovery key work everywhere.
import type { ShellE2ee } from "@/lib/shell/types";
import { bytes } from "./util";
import type { DeviceIdentity } from "./keystore";

export type NativePlatform = "mac" | "ios" | "android";

type Globals = {
  foleviShell?: { platform?: string; e2ee?: ShellE2ee; deviceName?: string; deviceFamily?: string; model?: string };
  foleviDesktop?: { platform?: string; e2ee?: ShellE2ee };
  foleviNative?: { platform?: string };
};
const globals = (): Globals => (typeof window === "undefined" ? {} : (window as unknown as Globals));

const asPlatform = (p: unknown): NativePlatform | null => (p === "mac" || p === "ios" || p === "android" ? p : null);

/** Which native app this page runs in, or null in a browser. */
export function nativePlatform(): NativePlatform | null {
  if (typeof window === "undefined") return null;
  const w = globals();
  const p = asPlatform(w.foleviShell?.platform) ?? asPlatform(w.foleviDesktop?.platform) ?? asPlatform(w.foleviNative?.platform);
  if (p) return p;
  return typeof location !== "undefined" && location.protocol === "app:" ? "mac" : null;
}

/** Whether this page runs in one of Folevi's native apps (passkeys aren't offered there). */
export function inNativeApp(): boolean {
  return nativePlatform() !== null;
}

/** Whether this page runs in the Mac app. */
export function inMacApp(): boolean {
  return nativePlatform() === "mac";
}

/** The native app's device-key bridge, or null in a browser (or in an app that predates it). */
export function nativeE2ee(): ShellE2ee | null {
  const w = globals();
  const bridge = w.foleviShell?.e2ee ?? w.foleviDesktop?.e2ee ?? null;
  return bridge && typeof bridge.deviceKeys === "function" && typeof bridge.open === "function" ? bridge : null;
}

/** The Mac's bridge (any native app's, in fact; the name predates iOS and Android). */
export const macE2ee = nativeE2ee;

/** This app as a device: kind "app", keys made by the app on the first ask. */
export async function nativeIdentity(bridge: ShellE2ee): Promise<DeviceIdentity> {
  const k = await bridge.deviceKeys();
  return {
    kind: "app",
    deviceId: k.deviceId,
    x25519Pub: bytes(k.x25519Pub),
    ed25519Pub: bytes(k.ed25519Pub),
    open: async (box, context) => bytes(await bridge.open(box, context)),
  };
}
export const macIdentity = nativeIdentity;

/** iPhone or iPad: the shell says (deviceFamily), else the system does. */
function appleFamily(): "iPhone" | "iPad" {
  const fam = globals().foleviShell?.deviceFamily;
  if (fam === "iPad" || fam === "iPhone") return fam;
  if (typeof navigator !== "undefined") {
    const ua = navigator.userAgent ?? "";
    // iPadOS reports itself as a Mac; a touch screen gives it away.
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1)) return "iPad";
  }
  return "iPhone";
}

/** What the app is called on this device: "Mac", "iPhone", "iPad" or "Android". */
export function nativeProduct(p: NativePlatform | null = nativePlatform()): "Mac" | "iPhone" | "iPad" | "Android" {
  return p === "ios" ? appleFamily() : p === "android" ? "Android" : "Mac";
}

/**
 * The device's name for Settings > Devices and the approval dialog: "Folevi for Mac", "Folevi for iPhone",
 * "Folevi for iPad", "Folevi for Android", with the name the device was given (or its model) when the app
 * says it ("Folevi for iPad on Faisal's iPad").
 */
export function nativeLabel(p: NativePlatform | null = nativePlatform()): string {
  const product = nativeProduct(p);
  const s = globals().foleviShell;
  const raw = (s?.deviceName ?? (p === "android" ? s?.model : undefined) ?? "").trim();
  // A bare default ("iPhone", "Mac") adds nothing.
  const name = raw && raw !== product && raw.toLowerCase() !== `folevi for ${product.toLowerCase()}` ? raw.slice(0, 60) : "";
  return name ? `Folevi for ${product} on ${name}` : `Folevi for ${product}`;
}

/** "Folevi for Mac on <this Mac's name>" (kept for the Mac's callers). */
export function macLabel(): string {
  return nativeLabel("mac");
}

/** This device in a sentence: "this Mac", "this iPhone", "this iPad", "this phone" (Android). */
export function thisDevice(p: NativePlatform | null = nativePlatform()): string {
  return p === "android" ? "this phone" : `this ${nativeProduct(p)}`;
}

/** The platform a device registers with: "mac", "ios", "android", or "web" for a browser. */
export function devicePlatform(): NativePlatform | "web" {
  return nativePlatform() ?? "web";
}
