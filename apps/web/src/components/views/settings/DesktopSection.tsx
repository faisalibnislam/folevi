"use client";
// Settings > Desktop app: what only the desktop apps do (Quick Add from any app, opening at login or sign-in, the
// menu bar or notification area icon, notifications). Kept by the app itself, on this Mac or PC. Folevi for Windows
// (apps/desktop) gets Windows' words: Ctrl+Alt+Space, the notification area, the taskbar button.
import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { acceleratorFrom, defaultQuickAddShortcut, desktop, shortcutLabel, type DesktopPlatform, type DesktopSettings } from "@/lib/desktop";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { Card } from "./Card";
import { TouchIdCard } from "@/components/e2ee/TouchIdCard";

export function DesktopSection() {
  const bridge = desktop();
  const [state, setState] = useState<{ settings: DesktopSettings; error: string | null } | null>(null);
  useEffect(() => {
    void bridge?.getSettings().then(setState);
  }, [bridge]);

  if (!bridge) {
    return (
      <Card title="Folevi for Mac" description="These settings are for the Folevi Mac app: Quick Add from any app, opening at login, the menu bar icon and Mac notifications. Open Settings in the Mac app to change them." >
        <p className="text-subheadline text-muted">You're using Folevi in a browser.</p>
      </Card>
    );
  }
  if (!state) return <p className="text-subheadline text-muted">Loading…</p>;
  const save = (patch: Partial<DesktopSettings>) => void bridge.setSettings(patch).then((next) => next && setState(next));
  const { settings } = state;
  const windows = bridge.platform === "windows";
  const linux = bridge.platform === "linux";
  return (
    <div className="space-y-5">
      <Card title="Quick Add" description="Add a task from any app without switching to Folevi. Write “tomorrow 9am”, “!high” or “#page” as you type; tasks without a page go to your Inbox.">
        <ShortcutField value={settings.quickAddShortcut} error={state.error} platform={bridge.platform} onChange={(quickAddShortcut) => save({ quickAddShortcut })} />
      </Card>
      <Card title={windows ? "On this PC" : linux ? "On this computer" : "On this Mac"}>
        <div className="max-w-xl divide-y divide-line/70">
          {linux ? (
            <>
              <Row label="Open at login" hint="Folevi starts quietly in the tray when you log in, so Quick Add is always ready." checked={settings.openAtLogin} onChange={(openAtLogin) => save({ openAtLogin })} />
              <Row label="Tray icon" hint="Quick Add, a new note, recent notes and the save state from Folevi's icon in your panel. With it on, closing the window keeps Folevi running there." checked={settings.menuBarIcon} onChange={(menuBarIcon) => save({ menuBarIcon })} />
            </>
          ) : windows ? (
            <>
              <Row label="Open when you sign in" hint="Folevi starts quietly in the notification area when you sign in to Windows, so Quick Add is always ready." checked={settings.openAtLogin} onChange={(openAtLogin) => save({ openAtLogin })} />
              <Row label="Notification area icon" hint="Quick Add, a new note, recent notes and the save state from the icon by the clock. With it on, closing the window keeps Folevi running there." checked={settings.menuBarIcon} onChange={(menuBarIcon) => save({ menuBarIcon })} />
            </>
          ) : (
            <>
              <Row label="Open at login" hint="Folevi starts quietly when you log in, so Quick Add is always ready." checked={settings.openAtLogin} onChange={(openAtLogin) => save({ openAtLogin })} />
              <Row label="Menu bar icon" hint="Quick Add, a new note, recent notes and the save state from the menu bar." checked={settings.menuBarIcon} onChange={(menuBarIcon) => save({ menuBarIcon })} />
            </>
          )}
          {settings.spotlight !== undefined ? (
            <Row label="Show notes in Spotlight" hint="Find any note by its words from Spotlight, archived ones too. Locked and encrypted notes are never added." checked={settings.spotlight} onChange={(spotlight) => save({ spotlight })} />
          ) : null}
          <Row
            label={windows ? "Windows notifications" : linux ? "Notifications" : "Mac notifications"}
            hint={
              linux
                ? "Comments, mentions and reminders appear as desktop notifications. Folevi's icon in the dock shows how many are unread where your desktop supports it."
                : windows
                ? "Comments, mentions and reminders appear as Windows notifications. The taskbar button shows how many are unread."
                : "Comments, mentions and reminders appear as Mac notifications while Folevi isn't the app in front. The Dock icon shows how many are unread."
            }
            checked={settings.notifications}
            onChange={(notifications) => save({ notifications })}
          />
        </div>
      </Card>
      {/* End-to-end encryption: Touch ID before the Mac opens its key (only once the account has encryption). */}
      <TouchIdCard />
    </div>
  );
}

function Row({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (on: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-6 py-3 first:pt-0 last:pb-0">
      <span className="min-w-0">
        <span className="block text-subheadline text-ink">{label}</span>
        <span id={id} className="block text-footnote text-muted">
          {hint}
        </span>
      </span>
      <Switch checked={checked} onChange={onChange} label={label} describedBy={id} />
    </div>
  );
}

/** Press the keys you want: the field shows them as the Mac writes shortcuts (⌥Space), or Windows (Ctrl+Alt+Space). */
function ShortcutField({ value, error, platform, onChange }: { value: string; error: string | null; platform: DesktopPlatform; onChange: (accelerator: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => {
    if (!recording) return;
    desktop()?.pauseShortcut(true);
    return () => desktop()?.pauseShortcut(false);
  }, [recording]);
  const hintId = useId();
  const fallback = defaultQuickAddShortcut(platform);
  const label = (a: string) => shortcutLabel(a, platform);
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
      if (!["Meta", "Control", "Alt", "Shift"].includes(e.key)) setHint(platform === "windows" ? "Hold Ctrl, Alt or the Windows key with the key." : platform === "linux" ? "Hold Ctrl, Alt or Super with the key." : "Hold ⌘, ⌥ or ⌃ with the key.");
      return;
    }
    setRecording(false);
    setHint(null);
    onChange(accelerator);
  };
  return (
    <div className="text-subheadline">
      <span className="block text-muted">Shortcut</span>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-describedby={hintId}
          aria-label={recording ? "Press the new shortcut" : `Quick Add shortcut: ${label(value)}. Change`}
          onClick={() => setRecording((r) => !r)}
          onKeyDown={onKeyDown}
          onBlur={() => setRecording(false)}
          className={`ui-input h-9 min-w-36 rounded-chip px-3 text-left font-medium outline-none ${recording ? "ring-2 ring-focus" : ""}`}
        >
          {recording ? <span className="text-muted">Press keys…</span> : label(value)}
        </button>
        {value ? <Button onClick={() => onChange("")}>Turn off</Button> : null}
        {value !== fallback ? <Button onClick={() => onChange(fallback)}>Use {label(fallback)}</Button> : null}
      </div>
      <p id={hintId} role={error || hint ? "alert" : undefined} className={`mt-1.5 text-footnote ${error || hint ? "text-danger" : "text-muted"}`}>
        {hint ?? error ?? (recording ? "Press the keys together. Esc cancels." : "Click, then press the keys you want.")}
      </p>
    </div>
  );
}
