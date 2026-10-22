"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/lib/convex/api";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { desktop } from "@/lib/desktop";
import { nativeApp } from "@/lib/nativeApp";
import { isShell } from "@/lib/shell";
import { Card } from "./Card";
import { useAppState } from "@/lib/app/state";
import { knownAccounts } from "@/lib/places/registry";
import { NativePushCard } from "./NativePushCard";

/** The VAPID public key as the bytes PushManager wants. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** "Chrome on macOS": enough to tell devices apart in a list, nothing more. */
function deviceLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

/**
 * Push notifications on this device: reminders and mentions reach it even when Folevi isn't open
 * (convex/push.ts). Each browser opts in on its own; the Mac app has its own notifications, and the
 * iPhone and iPad app its own through Apple's push service (NativePushCard).
 */
export function PushCard() {
  return nativeApp() ? <NativePushCard /> : <WebPushCard />;
}

function WebPushCard() {
  const publicKey = useQuery(api.push.publicKey, {});
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const status = useQuery(api.push.status, supported ? { endpoint: endpoint ?? undefined } : "skip");
  const subscribe = useMutation(api.push.subscribe);
  const unsubscribe = useMutation(api.push.unsubscribe);
  const { profile } = useAppState();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // The bundled app shell registers no service worker, so `ready` would never settle there.
    const ok = !isShell() && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(ok);
    if (!ok) return;
    setPermission(Notification.permission);
    void navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((sub) => setEndpoint(sub?.endpoint ?? null));
  }, []);

  if (desktop() !== null || supported === null || publicKey === null) return null;

  const on = Boolean(endpoint && status?.thisDevice);
  const turnOn = async () => {
    if (!publicKey) return;
    setBusy(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") return;
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      const json = sub.toJSON() as { endpoint: string; keys?: { p256dh?: string; auth?: string } };
      // A browser signed in to several accounts (docs/MULTI_ACCOUNT_PLAN.md §5): each keeps its own subscription, and
      // this account's notifications say they're its.
      const several = knownAccounts().length > 1;
      await subscribe({ endpoint: json.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "", label: deviceLabel(), ...(several ? { keepOthers: true, placeLabel: profile.email ?? profile.displayName } : {}) });
      setEndpoint(json.endpoint);
      toast.show("Notifications are on for this device");
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribe({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setEndpoint(null);
      toast.show("Notifications are off for this device");
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Notifications on this device" description="Reminders and mentions show up here even when Folevi isn’t open, following the In app choices above. A reminder shows its to-do line; a mention says only who and where.">
      {!supported ? (
        <p className="text-sm text-muted">This browser can’t show notifications from websites. On iPhone and iPad, add Folevi to your Home Screen first.</p>
      ) : permission === "denied" ? (
        <p className="text-sm text-muted">Notifications are blocked for Folevi in this browser’s settings. Allow them there, then come back.</p>
      ) : (
        <div className="flex max-w-xl items-center justify-between gap-4">
          <p className="text-sm text-ink">
            {on ? "On for this device." : "Off for this device."}
            {status && status.devices > (on ? 1 : 0) ? <span className="text-muted"> {status.devices - (on ? 1 : 0)} other device{status.devices - (on ? 1 : 0) === 1 ? "" : "s"} too.</span> : null}
          </p>
          <Button variant={on ? "secondary" : "primary"} onClick={() => void (on ? turnOff() : turnOn())} aria-busy={busy || undefined} disabled={busy}>
            {on ? "Turn off" : "Turn on"}
          </Button>
        </div>
      )}
    </Card>
  );
}
