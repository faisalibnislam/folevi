"use client";
// Settings > Notifications in the iPhone and iPad app: notifications on this device, through Apple's push
// service (lib/nativePush.ts). Shown only once Folevi can send them (push.apnsAvailable). Turning it on
// asks iOS the first time; if notifications are off for Folevi in iOS Settings, it says so and opens them.
// What arrives follows the In app choices above.
import { useQuery } from "convex/react";
import { useCallback, useEffect, useId, useState } from "react";
import { api } from "@/lib/convex/api";
import { nativeApp, type NativePushStatus } from "@/lib/nativeApp";
import { useNativeDevice } from "@/lib/nativeDevice";
import { turnOffPush, turnOnPush } from "@/lib/nativePush";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { Card } from "./Card";
import { useIphoneLook } from "@/lib/iphone";
import { ActionRow, IosRow, IosSection, SwitchRow } from "@/components/iphone/SettingsKit";
import { RowIcon } from "@/components/iphone/Grouped";
import { Bell } from "lucide-react";

export function NativePushCard() {
  const bridge = nativeApp();
  // The Android app goes through Firebase Cloud Messaging (push.fcm*), the iOS app through Apple's (push.apns*).
  const android = bridge?.platform === "android";
  const apnsAvailable = useQuery(api.push.apnsAvailable, android ? "skip" : {});
  const fcmAvailable = useQuery(api.push.fcmAvailable, android ? {} : "skip");
  const available = android ? fcmAvailable : apnsAvailable;
  const here = useNativeDevice();
  const apnsServer = useQuery(api.push.apnsStatus, here && !android ? { deviceId: here.id } : "skip");
  const fcmServer = useQuery(api.push.fcmStatus, here && android ? { deviceId: here.id } : "skip");
  const server = android ? fcmServer : apnsServer;
  const [status, setStatus] = useState<NativePushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const hintId = useId();
  const iphone = useIphoneLook();

  const read = useCallback(() => void bridge?.pushStatus?.().then(setStatus), [bridge]);
  useEffect(() => {
    read();
    // Back from iOS Settings: what was changed there shows at once.
    window.addEventListener("folevi:app-active", read);
    return () => window.removeEventListener("folevi:app-active", read);
  }, [read]);

  if (!bridge?.pushStatus || available !== true || !status) return null;

  const device = android ? "phone" : (here?.family ?? "iPhone");
  // Where notifications are allowed or blocked for Folevi, and what each kind shows, on this system.
  const os = android ? "Android settings" : "iOS Settings";
  const asks = android ? "Off. Turning them on asks Android once." : "Off. Turning them on asks iOS once.";
  const actions = android ? "A reminder shows its to-do line and note, with Done and Snooze 1 hour; a mention says only who and where, with Reply and Open." : "A reminder shows its to-do line and note, with Done and Snooze 1 hour; a mention says only who and where.";
  const denied = status.permission === "denied";
  const on = status.enabled && status.permission === "granted";
  const others = Math.max(0, (server?.devices ?? 0) - (server?.thisDevice ? 1 : 0));
  const change = async (next: boolean) => {
    setBusy(true);
    try {
      if (next) {
        const after = await turnOnPush();
        if (after) setStatus(after);
        if (after?.enabled && after.permission === "granted") toast.show(`Notifications are on for this ${device}`);
      } else {
        await turnOffPush();
        read();
        toast.show(`Notifications are off for this ${device}`);
      }
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  if (iphone) {
    const explain = `Reminders and mentions show up on this ${device} even when Folevi isn't open, following the In app choices below. ${actions}`;
    return denied ? (
      <IosSection footer={`Notifications are turned off for Folevi in ${os}. Allow them there, then come back. ${explain}`}>
        <IosRow icon={<RowIcon><Bell /></RowIcon>} label={`Notifications on this ${device}`} value="Off" />
        <ActionRow label={`Open ${os}`} onClick={() => void bridge.openNotificationSettings?.()} />
      </IosSection>
    ) : (
      <IosSection footer={`${on ? "On." : status.asked ? "Off." : asks}${others ? ` ${others} other device${others === 1 ? "" : "s"} too.` : ""} ${explain}`}>
        <SwitchRow icon={<RowIcon><Bell /></RowIcon>} label={`Notifications on this ${device}`} checked={on} disabled={busy} onChange={(next) => void change(next)} />
      </IosSection>
    );
  }
  return (
    <Card
      title={`Notifications on this ${device}`}
      description={`Reminders and mentions show up on this ${device} even when Folevi isn’t open, following the In app choices above. ${actions}`}
    >
      {denied ? (
        <div className="flex max-w-xl items-center justify-between gap-4">
          <p className="text-sm text-muted">Notifications are turned off for Folevi in {os}. Allow them there, then come back.</p>
          <Button variant="secondary" onClick={() => void bridge.openNotificationSettings?.()}>
            Open {os}
          </Button>
        </div>
      ) : (
        <div className="flex max-w-xl items-center justify-between gap-6">
          <span className="min-w-0">
            <span className="block text-sm text-ink">Notifications on this {device}</span>
            <span id={hintId} className="block text-xs text-muted">
              {on ? "On." : status.asked ? "Off." : asks}
              {others ? ` ${others} other device${others === 1 ? "" : "s"} too.` : ""}
            </span>
          </span>
          <Switch checked={on} onChange={(next) => void change(next)} label={`Notifications on this ${device}`} describedBy={hintId} disabled={busy} />
        </div>
      )}
    </Card>
  );
}
