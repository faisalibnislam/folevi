// The native pieces local mode's handlers use (docs/LOCAL_MODE_PLAN.md §4.1): fetching a subscribed calendar
// (`shell().http.calendar`) and OS notifications for reminders (`shell().notify`). The host's bridge by default;
// tests put their own in with setLocalNative. Without either, there's no network and no notifications.
import { shell, type CalendarDownload, type ShellNotify } from "@/lib/shell";

export interface LocalNative {
  calendar?: (url: string, previous: { etag?: string | null; lastModified?: string | null }) => Promise<CalendarDownload>;
  notify?: ShellNotify;
}

let override: LocalNative | null = null;

/** What this device offers now. */
export function localNative(): LocalNative {
  if (override) return override;
  const bridge = shell();
  if (!bridge) return {};
  return {
    calendar: bridge.http?.calendar ? (url, previous) => bridge.http.calendar(url, previous) : undefined,
    notify: bridge.notify,
  };
}

/** Replaces the bridge (tests); null goes back to the host's. */
export function setLocalNative(next: LocalNative | null): void {
  override = next;
}
