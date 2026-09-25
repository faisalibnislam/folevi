"use client";

import { useMutation } from "convex/react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { Card } from "./Card";

export function NotificationsSection() {
  const { profile } = useAppState();
  const update = useMutation(api.users.updateProfile);
  const toast = useToast();
  const prefs = profile.notificationPrefs;
  const set = (patch: Partial<typeof prefs>) => update({ notificationPrefs: { ...prefs, ...patch } }).then(() => toast.show("Saved"), (e) => toast.show(errorMessage(e), { tone: "error" }));
  const row = (key: "mentions" | "comments" | "shares" | "invites", label: string) => (
    <label className="flex items-center justify-between gap-4 py-2.5 text-sm">
      <span>{label}</span>
      <input type="checkbox" checked={prefs[key]} onChange={(e) => void set({ [key]: e.target.checked })} className="h-5 w-5 accent-[var(--color-accent)]" />
    </label>
  );
  return (
    <Card title="Email notifications" description="In-app notifications always appear in the bell. Security emails (new sign-ins, account deletion) can't be turned off.">
      <div className="max-w-md divide-y divide-line">
        {row("mentions", "When someone mentions me")}
        {row("comments", "Comments and replies on my pages")}
        {row("shares", "When a page is shared with me")}
        {row("invites", "Workspace invitations")}
        <label className="flex items-center justify-between gap-4 py-2.5 text-sm">
          <span>
            Daily digest of unread comments and mentions
            <span className="block text-xs text-muted">One email a day with page titles only — never comment text.</span>
          </span>
          <input type="checkbox" checked={prefs.digest === "daily"} onChange={(e) => void set({ digest: e.target.checked ? "daily" : "off" })} className="h-5 w-5 accent-[var(--color-accent)]" />
        </label>
      </div>
    </Card>
  );
}
