"use client";
// Settings > Sync: "Keep all notes on this device" (docs/NATIVE_APP_PLAN.md §11.8). On by default: every note of
// this account (Personal and each workspace) is kept here, so notes open at once and work offline. Shows how far
// the download is, the storage it takes, and removes the downloaded copy on request (never changes waiting to
// sync: those are the engine's and the outbox's).
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { useAppState } from "@/lib/app/state";
import { useBackendMode } from "@/lib/mode";
import { deviceCopyOf, keepAllNotes, onDeviceCopies, onKeepAllNotes, setKeepAllNotes } from "@/lib/sync/deviceCopyHost";
import { measureDeviceUsage, usageIncomplete, type DeviceUsage } from "@/lib/sync/deviceUsage";
import type { ScopeCopyStatus } from "@/lib/sync/deviceCopy";
import { Switch } from "@/components/ui/Switch";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { ActionRow, DestructiveRow, IosRow, IosSection, SwitchRow } from "@/components/iphone/SettingsKit";
import { Card } from "./Card";

const NONE: readonly ScopeCopyStatus[] = [];

function bytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(0, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const count = (n: number) => n.toLocaleString("en-US");

/** One place's progress in words: "Downloading notes, 412 of 1,530" or "All 1,530 notes on this device". */
export function copyProgress(s: ScopeCopyStatus | undefined, on: boolean): string {
  if (!on) return "Notes you open are kept";
  if (!s || s.phase === "listing" || s.total === null) return "Getting ready to download";
  if (s.have < s.total) return `Downloading notes, ${count(s.have)} of ${count(s.total)}`;
  return s.total === 1 ? "The note is on this device" : `All ${count(s.total)} notes on this device`;
}

function useCopyStatus(accountKey: string) {
  const handle = useSyncExternalStore(
    (cb) => onDeviceCopies(cb),
    () => deviceCopyOf(accountKey),
    () => null,
  );
  const status = useSyncExternalStore(
    (cb) => (handle ? handle.copy.subscribe(cb) : () => undefined),
    () => handle?.copy.status() ?? NONE,
    () => NONE,
  );
  return { handle, status };
}

function useKeepAll(accountKey: string): boolean {
  return useSyncExternalStore(
    (cb) => onKeepAllNotes(cb),
    () => keepAllNotes(accountKey),
    () => true,
  );
}

/**
 * What the copy takes on this device: notes kept whole, attachments, and the browser's own estimate. Each reading
 * finishes within a few seconds (lib/sync/deviceUsage.ts, QA F19); null while the first measure runs.
 */
function useStorage(accountKey: string, tick: unknown) {
  const [usage, setUsage] = useState<DeviceUsage | null>(null);
  useEffect(() => {
    let live = true;
    void measureDeviceUsage(accountKey).then((u) => {
      if (live) setUsage(u);
    });
    return () => {
      live = false;
    };
  }, [accountKey, tick]);
  return usage;
}

/**
 * The storage line under the copy's progress: what's kept and what Folevi takes, "Measuring storage…" at first,
 * and an explicit unavailable state (with Retry beside it) for a reading this device wouldn't give.
 */
export function storageSummary(usage: DeviceUsage | null): { text: string; unavailable: boolean } {
  if (!usage) return { text: "Measuring storage…", unavailable: false };
  const parts: string[] = [];
  if (usage.notes !== null) {
    const files = usage.files ? ` and ${count(usage.files.count)} ${usage.files.count === 1 ? "attachment" : "attachments"} (${bytes(usage.files.bytes)})` : "";
    parts.push(`${count(usage.notes)} ${usage.notes === 1 ? "note" : "notes"}${files} kept here.`);
  } else parts.push("Notes kept: unavailable.");
  if (usage.used !== null) parts.push(`Folevi uses ${bytes(usage.used)} on this device${usage.free !== null ? `, ${bytes(usage.free)} free` : ""}.`);
  else parts.push("Space used: unavailable.");
  return { text: parts.join(" "), unavailable: usageIncomplete(usage) };
}

export function DeviceCopySettings({ iphone }: { iphone: boolean }) {
  const { profile, workspaces } = useAppState();
  const local = useBackendMode() === "local";
  const on = useKeepAll(profile.id);
  const { handle, status } = useCopyStatus(profile.id);
  const [cleared, setCleared] = useState(0);
  // Retry measures again (a reading this device didn't give, QA F19).
  const [retries, setRetries] = useState(0);
  const usage = useStorage(profile.id, `${status.map((s) => `${s.have}/${s.total}`).join(",")}:${cleared}:${retries}`);
  const toast = useToast();
  const hint = useId();
  // A local library is on this device already; a public computer keeps nothing (no copy runs there).
  if (local) return null;
  const places = status.map((s) => ({ ...s, name: s.scopeKey === "personal" ? "Personal" : (workspaces.find((w) => w.id === s.scopeKey)?.name ?? "Workspace") }));
  const summary = storageSummary(usage);
  const storage = summary.text;
  const retry = () => setRetries((n) => n + 1);
  const clear = async () => {
    if (!handle) return;
    await handle.copy.clear();
    await handle.files.clear();
    setCleared((n) => n + 1);
    toast.show("Downloaded copy removed");
  };
  const download = () => {
    if (!on) setKeepAllNotes(profile.id, true);
    handle?.copy.foreground();
  };
  const footer = "Notes open instantly and work offline. Attachments up to 1 MB always come too; larger ones only on Wi-Fi, up to 2 GB or a tenth of the free space. Nothing waiting to sync is ever removed.";
  if (iphone)
    return (
      <>
        <IosSection header="Notes on this device" footer={`${footer} ${storage}`}>
          <SwitchRow label="Keep all notes on this device" checked={on} onChange={(next) => setKeepAllNotes(profile.id, next)} />
          {places.map((p) => (
            <IosRow key={p.scopeKey} label={p.name} value={copyProgress(p, on)} />
          ))}
        </IosSection>
        <IosSection>
          {summary.unavailable ? <ActionRow label="Measure storage again" onClick={retry} /> : null}
          <ActionRow label="Download now" onClick={download} disabled={!handle} />
          <DestructiveRow label="Remove downloaded copy" confirm="Remove downloaded copy" message="Your notes stay in your account and anything waiting to sync stays. Notes you open are kept again." onConfirm={() => void clear()} disabled={!handle} />
        </IosSection>
      </>
    );
  return (
    <Card title="Notes on this device" description="Folevi keeps a copy of every note in this browser, so notes open instantly and work offline. It downloads in the background and stays up to date while Folevi is open.">
      <div className="max-w-xl divide-y divide-line/70" data-testid="device-copy-settings">
        <div className="flex items-center justify-between gap-6 py-3 first:pt-0">
          <span className="min-w-0">
            <span className="block text-subheadline text-ink">Keep all notes on this device</span>
            <span id={hint} className="block text-footnote text-muted">
              {footer}
            </span>
          </span>
          <Switch checked={on} onChange={(next) => setKeepAllNotes(profile.id, next)} label="Keep all notes on this device" describedBy={hint} />
        </div>
        {places.map((p) => (
          <div key={p.scopeKey} className="flex items-center justify-between gap-6 py-2 text-subheadline" data-copy-scope={p.scopeKey} data-copy-phase={p.phase}>
            <span className="text-ink">{p.name}</span>
            <span className="tabular-nums text-muted">{copyProgress(p, on)}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 max-w-xl text-footnote text-muted" aria-live="polite" data-storage-state={usage ? (summary.unavailable ? "unavailable" : "measured") : "measuring"}>
        {storage}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {summary.unavailable ? <Button onClick={retry}>Retry</Button> : null}
        <Button onClick={download} disabled={!handle}>
          Download now
        </Button>
        <Button variant="quiet" className="text-danger" onClick={() => void clear()} disabled={!handle}>
          Remove downloaded copy
        </Button>
      </div>
    </Card>
  );
}
