"use client";
// The iPhone and iPad app's own access to Folevi, for the parts that run outside this page: its widgets,
// share extension, Shortcuts and Spotlight call the REST API (/api/v1) with a token made for this device
// (convex/apiTokens.ts ensureDevice). The page asks for it on each launch while signed in and hands it to the
// app, which keeps it in the Keychain; signing out revokes it and has the app forget it. The token never
// comes back to the page.
import { useEffect, useState } from "react";
import { api } from "@/lib/convex/api";
import { getConvexClient } from "@/lib/convex/provider";
import { nativeApp, type NativeDevice, type NativeFile } from "./nativeApp";
import { forgetPush } from "./nativePush";

let device: Promise<NativeDevice | null> | null = null;

/** This iPhone or iPad as the app describes it (asked once per page load), or null outside the app. */
export function nativeDevice(): Promise<NativeDevice | null> {
  const bridge = nativeApp();
  if (!bridge?.device) return Promise.resolve(null);
  device ??= bridge.device().catch(() => null);
  return device;
}

export function useNativeDevice(): NativeDevice | null {
  const [value, setValue] = useState<NativeDevice | null>(null);
  useEffect(() => {
    let live = true;
    void nativeDevice().then((d) => live && setValue(d));
    return () => {
      live = false;
    };
  }, []);
  return value;
}

/**
 * Makes sure the app holds a working token for this account: the server keeps the one the app says it
 * holds, or makes a new one (first launch, another account, revoked in Settings), which goes to the app.
 */
export async function linkThisDevice(accountId: string): Promise<void> {
  const bridge = nativeApp();
  const d = await nativeDevice();
  if (!bridge?.setCredential || !d) return;
  const held = d.accountId === accountId && d.tokenId ? d.tokenId : undefined;
  const r = await getConvexClient().mutation(api.apiTokens.ensureDevice, { deviceId: d.id, family: d.family, model: d.model, ...(held ? { tokenId: held } : {}) });
  if (r.token) {
    await bridge.setCredential({ token: r.token, tokenId: r.tokenId, accountId });
    device = Promise.resolve({ ...d, accountId, tokenId: r.tokenId });
  }
}

/**
 * Signing out (or the session ending): the device's token is revoked while the session can still do it,
 * Folevi stops sending notifications here, and the app forgets the token, with the widgets' copy of tasks and notes and Spotlight's entries. Never holds up
 * signing out for long.
 */
export async function forgetThisDevice(): Promise<void> {
  const bridge = nativeApp();
  const d = await nativeDevice();
  if (!bridge || !d) return;
  const within = <T,>(p: Promise<T>) => Promise.race([p.catch(() => undefined), new Promise<undefined>((r) => setTimeout(() => r(undefined), 3000))]);
  if (d.tokenId) await within(getConvexClient().mutation(api.apiTokens.revokeDevice, { deviceId: d.id }));
  // No more notifications for this account here (the app turns them off as it forgets the token).
  await within(forgetPush(d.id));
  await within(bridge.clearCredential?.() ?? Promise.resolve());
  device = Promise.resolve({ ...d, accountId: null, tokenId: null });
}

/** A file the app handed over (base64), as a File for the upload queue. */
export function fileFromNative(f: NativeFile): File {
  const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
  return new File([bytes], f.name || "file", { type: f.type || "application/octet-stream" });
}
