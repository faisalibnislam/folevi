"use client";
// Settings > Desktop app: what only the Mac app does (Quick Add from any app, opening at login, the menu bar
// icon, Mac notifications). Kept by the Mac app itself, on this Mac. The Windows app has the same settings
// in Windows' words (the system tray, Windows notifications, Ctrl+Alt+Space).
import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { acceleratorFrom, defaultQuickAddShortcut, desktop, shortcutLabel, type DesktopPlatform, type DesktopSettings } from "@/lib/desktop";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { Card } from "./Card";

export function DesktopSection() {
  const bridge = desktop();
  const [state, setState] = useState<{ settings: DesktopSettings; error: string | null } | null>(null);
  useEffect(() => {
    void bridge?.getSettings().then(setState);
  }, [bridge]);

  if (!bridge) {
    return (
      <Card title="Folevi for Mac" description="These settings are for the Folevi Mac app: Quick Add from any app, opening at login, the menu bar icon and Mac notifications. Open Settings in the Mac app to change them." >
        <p className="text-sm text-muted">You're using Folevi in a browser.</p>
      </Card>
    );
  }
  if (!state) return <p className="text-sm text-muted">Loading…</p>;
  const save = (patch: Partial<DesktopSettings>) => void bridge.setSettings(patch).then((next) => next && setState(next));
  const { settings } = state;
  const copy = COPY[bridge.platform] ?? COPY.mac;
  return (
    <div className="space-y-5">
      <Card title="Quick Add" description="Add a task from any app without switching to Folevi. Tasks without a page go to your Inbox.">
        <ShortcutField platform={bridge.platform} value={settings.quickAddShortcut} error={state.error} onChange={(quickAddShortcut) => save({ quickAddShortcut })} />
      </Card>
      <Card title={copy.card}>
        <div className="max-w-xl divide-y divide-line/70">
          <Row label={copy.login[0]} hint={copy.login[1]} checked={settings.openAtLogin} onChange={(openAtLogin) => save({ openAtLogin })} />
          <Row label={copy.icon[0]} hint={copy.icon[1]} checked={settings.menuBarIcon} onChange={(menuBarIcon) => save({ menuBarIcon })} />
          <Row label={copy.notifications[0]} hint={copy.notifications[1]} checked={settings.notifications} onChange={(notifications) => save({ notifications })} />
        </div>
      </Card>
    </div>
  );
}

/** Each switch's label and hint, in the words of the system the app runs on. */
const COPY: Record<DesktopPlatform, { card: string; login: [string, string]; icon: [string, string]; notifications: [string, string] }> = {
  mac: {
    card: "On this Mac",
    login: ["Open at login", "Folevi starts quietly when you log in, so Quick Add is always ready."],
    icon: ["Menu bar icon", "Quick Add, a new note, recent notes and the save state from the menu bar."],
    notifications: ["Mac notifications", "Comments, mentions and reminders appear as Mac notifications while Folevi isn't the app in front. The Dock icon shows how many are unread."],
  },
  windows: {
    card: "On this PC",
    login: ["Open at sign-in", "Folevi starts quietly when you sign in to Windows, so Quick Add is always ready."],
    icon: ["System tray icon", "Quick Add, a new note, recent notes and the save state from the system tray. With it on, closing the window keeps Folevi running there."],
    notifications: ["Windows notifications", "Comments, mentions and reminders appear as Windows notifications while Folevi isn't the app in front. A red dot on the taskbar button means some are unread."],
  },
};

function Row({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (on: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-6 py-3 first:pt-0 last:pb-0">
      <span className="min-w-0">
        <span className="block text-sm text-ink">{label}</span>
        <span id={id} className="block text-xs text-muted">
          {hint}
        </span>
      </span>
      <Switch checked={checked} onChange={onChange} label={label} describedBy={id} />
    </div>
  );
}

/** Press the keys you want: the field shows them as the Mac writes shortcuts (⌥Space), or Windows (Ctrl+Alt+Space). */
function ShortcutField({ platform, value, error, onChange }: { platform: DesktopPlatform; value: string; error: string | null; onChange: (accelerator: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => {
    if (!recording) return;
    desktop()?.pauseShortcut(true);
    return () => desktop()?.pauseShortcut(false);
  }, [recording]);
  const hintId = useId();
  const fallback = defaultQuickAddShortcut(platform);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      setRecording(false);
      setHint(null);
      return;
    }
    const accelerator = acceleratorFrom(e.nativeEvent, platform);
    if (!accelerator) {
      if (!["Meta", "Control", "Alt", "Shift"].includes(e.key)) setHint(platform === "windows" ? "Hold Ctrl or Alt with the key." : "Hold ⌘, ⌥ or ⌃ with the key.");
      return;
    }
    setRecording(false);
    setHint(null);
    onChange(accelerator);
  };
  return (
    <div className="text-sm">
      <span className="block text-muted">Shortcut</span>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-describedby={hintId}
          aria-label={recording ? "Press the new shortcut" : `Quick Add shortcut: ${shortcutLabel(value, platform)}. Change`}
          onClick={() => setRecording((r) => !r)}
          onKeyDown={onKeyDown}
          onBlur={() => setRecording(false)}
          className={`ui-input h-9 min-w-36 rounded-chip px-3 text-left font-medium outline-none ${recording ? "ring-2 ring-focus" : ""}`}
        >
          {recording ? <span className="text-muted">Press keys…</span> : shortcutLabel(value, platform)}
        </button>
        {value ? <Button onClick={() => onChange("")}>Turn off</Button> : null}
        {value !== fallback ? <Button onClick={() => onChange(fallback)}>Use {shortcutLabel(fallback, platform)}</Button> : null}
      </div>
      <p id={hintId} role={error || hint ? "alert" : undefined} className={`mt-1.5 text-xs ${error || hint ? "text-danger" : "text-muted"}`}>
        {hint ?? error ?? (recording ? "Press the keys together. Esc cancels." : "Click, then press the keys you want.")}
      </p>
    </div>
  );
}
