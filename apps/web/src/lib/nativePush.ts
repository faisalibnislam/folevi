"use client";
// Notifications on this iPhone or iPad: the iOS app gets a device token from Apple (lib/nativeApp.ts
// enablePush) and the page registers it with Folevi (convex/push.ts registerApns), which sends reminders
// and mentions there through Apple's push service. iOS asks for permission only when the person turns
// notifications on (Settings > Notifications) or sets their first reminder in the app, never at launch.
// Signing out removes the device (forgetPush, from lib/nativeDevice.ts). Outside the app: nothing.
import { api } from "@/lib/convex/api";
import { getConvexClient } from "@/lib/convex/provider";
import { nativeApp, type NativePushStatus } from "./nativeApp";
import { nativeDevice } from "./nativeDevice";

/** The token registered in this page's life (registering it again on every launch is enough). */
let registered: string | null = null;

async function register(status: NativePushStatus): Promise<void> {
  const d = await nativeDevice();
  if (!status.token || !d) return;
  await getConvexClient().mutation(api.push.registerApns, { token: status.token, environment: status.environment, bundleId: status.bundleId, deviceId: d.id, deviceName: d.model || d.family });
  registered = status.token;
}

/** Whether this deployment sends to the iOS app at all (its APNs key is set). */
async function available(): Promise<boolean> {
  try {
    return await getConvexClient().query(api.push.apnsAvailable, {});
  } catch {
    return false;
  }
}

/** Turning notifications on: iOS asks (the first time), then Folevi learns where to send. */
export async function turnOnPush(): Promise<NativePushStatus | null> {
  const bridge = nativeApp();
  if (!bridge?.enablePush) return null;
  const status = await bridge.enablePush();
  if (status?.enabled && status.permission === "granted") await register(status);
  return status;
}

/** Turning them off: Folevi stops sending here first, then the app stops showing them. */
export async function turnOffPush(): Promise<void> {
  const bridge = nativeApp();
  if (!bridge?.disablePush) return;
  const [status, d] = await Promise.all([bridge.pushStatus?.() ?? null, nativeDevice()]);
  await getConvexClient().mutation(api.push.unregisterApns, { ...(status?.token ? { token: status.token } : {}), ...(d ? { deviceId: d.id } : {}) });
  registered = null;
  await bridge.disablePush();
}

/**
 * On each launch, signed in and online: a device that has notifications on is registered with its current
 * token (iOS can change it); one whose notifications were turned off in iOS Settings stops being sent to.
 */
export async function syncPushRegistration(): Promise<void> {
  const status = await nativeApp()?.pushStatus?.();
  if (!status?.enabled) return;
  if (status.permission === "denied") {
    const d = await nativeDevice();
    if (d && registered !== "") await getConvexClient().mutation(api.push.unregisterApns, { deviceId: d.id });
    registered = "";
    return;
  }
  if (status.permission === "granted" && status.token && status.token !== registered) await register(status);
}

/** After someone sets a reminder in the app: the moment to ask, once, if they never turned notifications on. */
export async function offerPushAfterReminder(): Promise<void> {
  const bridge = nativeApp();
  if (!bridge?.pushStatus || !bridge.enablePush) return;
  const status = await bridge.pushStatus();
  if (!status || status.asked || status.enabled || status.permission !== "notDetermined") return;
  if (!(await available())) return;
  await turnOnPush();
}

/** Signing out: Folevi stops sending to this device (the app turns notifications off with the rest). */
export async function forgetPush(deviceId: string): Promise<void> {
  if (!nativeApp()?.pushStatus) return;
  registered = null;
  await getConvexClient().mutation(api.push.unregisterApns, { deviceId });
}
