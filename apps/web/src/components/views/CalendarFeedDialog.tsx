"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Copy } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatRelative } from "@/lib/format";

/**
 * "Show your tasks in your calendar": a private iCalendar link for Google Calendar, Apple Calendar or
 * Outlook (convex/calendarFeeds.ts). The link is shown once when made; making a new one ends the old one.
 */
export function CalendarFeedDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const status = useQuery(api.calendarFeeds.status, open ? {} : "skip");
  const create = useMutation(api.calendarFeeds.create);
  const remove = useMutation(api.calendarFeeds.remove);
  const setInclude = useMutation(api.calendarFeeds.setIncludeWorkspaces);
  const toast = useToast();
  const [link, setLink] = useState<string | null>(null);
  const [includeWorkspaces, setIncludeWorkspaces] = useState(true);
  const include = status ? status.includeWorkspaces : includeWorkspaces;

  const make = async () => {
    try {
      const { token } = await create({ includeWorkspaces: include });
      setLink(`${window.location.origin}/api/calendar/${token}.ics`);
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Your tasks in your calendar" description="Subscribe to this link in Google Calendar, Apple Calendar or Outlook to see tasks with a due date there. It's read-only and updates about every hour.">
      <div className="space-y-4 text-subheadline">
        <label className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-ink">Workspace tasks assigned to you</span>
            <span id="feed-ws-hint" className="block text-footnote text-muted">
              Your Personal tasks are always in it.
            </span>
          </span>
          <Switch
            checked={include}
            label="Workspace tasks assigned to you"
            describedBy="feed-ws-hint"
            onChange={(on) => (status ? void setInclude({ includeWorkspaces: on }) : setIncludeWorkspaces(on))}
          />
        </label>
        {link ? (
          <div className="rounded-chip border border-success/40 bg-success-soft p-3">
            <p className="text-footnote font-medium">Copy this link now. For your privacy, it isn’t shown again.</p>
            <div className="mt-2 flex gap-2">
              <input readOnly value={link} aria-label="Calendar link" className="h-9 min-w-0 flex-1 ui-well rounded-chip px-2 font-mono text-footnote" onFocus={(e) => e.target.select()} />
              <Button size="sm" onClick={() => void navigator.clipboard.writeText(link).then(() => toast.show("Link copied"))}>
                <Copy size={13} aria-hidden /> Copy
              </Button>
            </div>
            <p className="mt-2 text-footnote text-muted">Google Calendar: Other calendars → From URL. Apple Calendar: File → New Calendar Subscription. Outlook: Add calendar → Subscribe from web.</p>
          </div>
        ) : status ? (
          <p className="text-muted">
            You have a link{status.lastFetchedAt ? `, last read by a calendar ${formatRelative(status.lastFetchedAt)}` : ", not used by a calendar yet"}. Make a new one if you lost it; the old one stops working.
          </p>
        ) : null}
        <div className="flex justify-between gap-2">
          {status ? (
            <Button variant="quiet" className="text-danger" onClick={() => void remove({}).then(() => { setLink(null); toast.show("Calendar link turned off"); })}>
              Turn off the link
            </Button>
          ) : (
            <span />
          )}
          <Button variant="primary" onClick={() => void make()}>
            {status ? "Make a new link" : "Make a link"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
