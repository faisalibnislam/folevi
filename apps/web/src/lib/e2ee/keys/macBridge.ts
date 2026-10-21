// The Mac app's device keys (docs/E2EE_DESIGN.md §6.2, §6.11): held by the app's main process
// (apps/desktop/src/e2ee.ts), reached through `foleviShell.e2ee` in the built-in interface or
// `foleviDesktop.e2ee` on the website the app shows. The page never holds the Mac's private keys.
import type { ShellE2ee } from "@/lib/shell/types";
import { bytes } from "./util";
import type { DeviceIdentity } from "./keystore";

/** The bridge, or null outside the Mac app (or in a Mac app that predates it). */
export function macE2ee(): ShellE2ee | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { foleviShell?: { e2ee?: ShellE2ee }; foleviDesktop?: { e2ee?: ShellE2ee } };
  const bridge = w.foleviShell?.e2ee ?? w.foleviDesktop?.e2ee ?? null;
  return bridge && typeof bridge.deviceKeys === "function" && typeof bridge.open === "function" ? bridge : null;
}

/** Whether this page runs in the Mac app (passkeys aren't offered there, §6.11). */
export function inMacApp(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { foleviShell?: { platform?: string }; foleviDesktop?: { platform?: string } };
  return w.foleviShell?.platform === "mac" || w.foleviDesktop?.platform === "mac" || location.protocol === "app:";
}

/** This Mac as a device: kind "app", keys made by the app on the first ask. */
export async function macIdentity(bridge: ShellE2ee): Promise<DeviceIdentity> {
  const k = await bridge.deviceKeys();
  return {
    kind: "app",
    deviceId: k.deviceId,
    x25519Pub: bytes(k.x25519Pub),
    ed25519Pub: bytes(k.ed25519Pub),
    open: async (box, context) => bytes(await bridge.open(box, context)),
  };
}

/** "Folevi for Mac on <this Mac's name>". */
export function macLabel(): string {
  const name = typeof window !== "undefined" ? (window as unknown as { foleviShell?: { deviceName?: string } }).foleviShell?.deviceName : undefined;
  return name ? `Folevi for Mac on ${name}` : "Folevi for Mac";
}
