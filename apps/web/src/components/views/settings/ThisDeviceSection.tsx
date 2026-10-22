"use client";
// Settings > This device: what only the iPhone and iPad app does. Today the Face ID lock: off until turned
// on, and kept by the app on this device (never on Folevi's servers). Turning it on asks for Face ID once,
// so it's never on for someone who can't get back in.
import { useEffect, useId, useState } from "react";
import { nativeApp, type LockAfter, type NativeSettings } from "@/lib/nativeApp";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { Card } from "./Card";
import { useIphoneApp } from "@/lib/iphone";
import { ChoiceRow, IosSection, SwitchRow } from "@/components/iphone/SettingsKit";
import { RowIcon } from "@/components/iphone/Grouped";
import { KeyRound, LockKeyhole } from "lucide-react";
import { macE2ee, useKeySession } from "@/lib/e2ee/keys";

/** The unlock method as the device names it. */
const METHOD: Record<NativeSettings["method"], string> = { faceID: "Face ID", touchID: "Touch ID", opticID: "Optic ID", passcode: "your passcode", none: "Face ID" };

const AFTER: { value: LockAfter; label: string }[] = [
  { value: 0, label: "Immediately" },
  { value: 60, label: "After 1 minute" },
  { value: 300, label: "After 5 minutes" },
  { value: 900, label: "After 15 minutes" },
];

export function ThisDeviceSection() {
  const bridge = nativeApp();
  const [settings, setSettings] = useState<NativeSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hintId = useId();
  const afterId = useId();
  const iphone = useIphoneApp();
  useEffect(() => {
    void bridge?.getSettings().then(setSettings);
  }, [bridge]);

  if (!bridge) {
    return (
      <Card title="Folevi for iPhone and iPad" description="These settings are for the Folevi app on iPhone and iPad, like locking it with Face ID. Open Settings in the app to change them.">
        <p className="text-sm text-muted">You're using Folevi in a browser.</p>
      </Card>
    );
  }
  if (!settings) return iphone ? null : <p className="text-sm text-muted">Loading…</p>;

  const method = METHOD[settings.method];
  const save = async (patch: Partial<Pick<NativeSettings, "lock" | "lockAfter">>) => {
    setBusy(true);
    setError(null);
    try {
      setSettings(await bridge.setSettings(patch));
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "That didn't work. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  const label = settings.method === "passcode" ? "Lock with passcode" : `Lock with ${method}`;
  if (iphone)
    return (
      <>
        {error ? (
          <div className="px-4">
            <p role="alert" className="rounded-control bg-danger-soft px-4 py-3 text-[15px] text-ink">
              {error}
            </p>
          </div>
        ) : null}
        <IosSection
          header="Lock"
          footer={`Folevi asks for ${method} when it opens, and hides your notes in the app switcher. This is kept on this device only. ${settings.method === "none" ? "Set a passcode for this device in the Settings app first." : `Turning it on asks for ${method} once.`}`}
        >
          <SwitchRow icon={<RowIcon><LockKeyhole /></RowIcon>} label={label} checked={settings.lock} disabled={busy || (settings.method === "none" && !settings.lock)} onChange={(lock) => void save({ lock })} />
          {settings.lock ? <ChoiceRow screen="lock-after" label="Ask again" value={String(settings.lockAfter)} choices={AFTER.map((a) => ({ value: String(a.value), label: a.label }))} footer="When you come back after Folevi has been in the background this long." disabled={busy} onChange={(v) => void save({ lockAfter: Number(v) as LockAfter })} /> : null}
        </IosSection>
        <EncryptedNotesUnlock method={method} iphone />
      </>
    );
  return (
    <Card title="Lock" description={`Folevi asks for ${method} when it opens, and hides your notes in the app switcher. This is kept on this device only.`}>
      <div className="max-w-xl divide-y divide-line/70">
        <div className="flex items-center justify-between gap-6 py-3 first:pt-0">
          <span className="min-w-0">
            <span className="block text-sm text-ink">{label}</span>
            <span id={hintId} className="block text-xs text-muted">
              {settings.method === "none" ? "Set a passcode for this device in the Settings app first." : `Off unless you turn it on. Turning it on asks for ${method} once.`}
            </span>
          </span>
          <Switch checked={settings.lock} onChange={(lock) => void save({ lock })} label={label} describedBy={hintId} disabled={busy || (settings.method === "none" && !settings.lock)} />
        </div>
        {settings.lock ? (
          <div className="flex items-center justify-between gap-6 py-3 last:pb-0">
            <span className="min-w-0">
              <span id={afterId} className="block text-sm text-ink">
                Ask again
              </span>
              <span className="block text-xs text-muted">When you come back after Folevi has been in the background this long.</span>
            </span>
            <Select value={String(settings.lockAfter)} onChange={(e) => void save({ lockAfter: Number(e.target.value) as LockAfter })} aria-labelledby={afterId} className="ui-input h-9 w-44 flex-none rounded-chip px-3 text-sm" disabled={busy}>
              {AFTER.map((a) => (
                <option key={a.value} value={String(a.value)}>
                  {a.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <EncryptedNotesUnlock method={method} />
    </Card>
  );
}

/**
 * End-to-end encryption on this iPhone or iPad (docs/E2EE_DESIGN.md §6.2): this device's keys live in the app
 * (Native/Shell/E2eeKeys.swift). With this on, the app asks for Face ID (or the passcode) before it opens them
 * to unlock encrypted notes. Only in the built-in interface, once the account has encryption.
 */
function EncryptedNotesUnlock({ method, iphone = false }: { method: string; iphone?: boolean }) {
  const { state } = useKeySession();
  const bridge = macE2ee();
  const hint = useId();
  const [value, setValue] = useState<{ touchId: boolean; available: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = Boolean(bridge?.settings && bridge.setTouchId);
  useEffect(() => {
    if (!supported || state === "none") return;
    void bridge!.settings!().then(setValue, () => setValue(null));
  }, [bridge, supported, state]);
  if (!supported || state === "none" || !value) return null;
  const label = `Ask for ${method} to unlock encrypted notes`;
  const footer = value.available ? `Folevi asks for ${method} before it opens your encrypted notes, each time it opens. Turning this on or off asks too.` : "This device has no Face ID or passcode set up, so Folevi can't ask.";
  const change = async (on: boolean) => {
    setBusy(true);
    try {
      setValue(await bridge!.setTouchId!(on));
    } catch {
      // Face ID was cancelled: nothing changes.
    } finally {
      setBusy(false);
    }
  };
  if (iphone)
    return (
      <IosSection header="Encrypted notes" footer={footer}>
        <SwitchRow icon={<RowIcon><KeyRound /></RowIcon>} label={label} checked={value.touchId} disabled={busy || !value.available} onChange={(on) => void change(on)} />
      </IosSection>
    );
  return (
    <div className="mt-5 flex max-w-xl items-center justify-between gap-6 border-t border-line/70 pt-4" data-testid="e2ee-face-id">
      <span className="min-w-0">
        <span className="block text-sm text-ink">{label}</span>
        <span id={hint} className="block text-xs text-muted">
          {footer}
        </span>
      </span>
      <Switch checked={value.touchId} onChange={(on) => void change(on)} label={label} describedBy={hint} disabled={busy || !value.available} />
    </div>
  );
}
