"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";
import { Select } from "@/components/ui/Select";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { Card } from "./Card";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Monday first, as most calendars here show it. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** "08:00" in the person's way of writing times. */
export function hourLabel(hour: number, locale?: string): string {
  try {
    return new Date(Date.UTC(2026, 0, 1, hour)).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  } catch {
    return `${String(hour).padStart(2, "0")}:00`;
  }
}

/** When the next digest comes, in the person's time zone: "Monday 12 October, 08:00". */
export function nextLabel(at: number, timeZone: string, locale?: string): string {
  try {
    return new Date(at).toLocaleString(locale, { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", timeZone });
  } catch {
    return new Date(at).toUTCString();
  }
}

/**
 * Settings > AI: the digest's schedule (shown while digests are on). Each change saves at once; the server
 * works out when the next one is due in the person's time zone.
 */
export function AiDigestCard() {
  const { workspaces, profile } = useAppState();
  const digest = useQuery(api.aiDigest.settings, {});
  const save = useMutation(api.aiDigest.save);
  const toast = useToast();
  if (!digest || !digest.enabled) return null;
  const locale = (profile as { locale?: string }).locale;
  const places = workspaces.filter((w) => w.canEdit !== false);
  const where = digest.context.kind === "workspace" ? digest.context.workspaceId : "personal";
  const change = (patch: Parameters<typeof save>[0]) =>
    void save(patch).then(
      () => toast.show("Digest saved"),
      (e) => toast.show(errorMessage(e), { tone: "error" }),
    );
  return (
    <Card title="Digest" description="A short summary of what changed, saved as a note in your Inbox. Each one uses a few AI credits. It's skipped when nothing changed.">
      <div className="grid max-w-xl gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="block font-medium text-heading">How often</span>
          <Select value={digest.frequency} onChange={(e) => change({ frequency: e.target.value as "daily" | "weekly" })} aria-label="How often" className="w-full">
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
          </Select>
        </label>
        {digest.frequency === "weekly" ? (
          <label className="space-y-1 text-sm">
            <span className="block font-medium text-heading">Day</span>
            <Select value={String(digest.weekday)} onChange={(e) => change({ weekday: Number(e.target.value) })} aria-label="Day" className="w-full">
              {DAY_ORDER.map((d) => (
                <option key={d} value={String(d)}>
                  {DAYS[d]}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        <label className="space-y-1 text-sm">
          <span className="block font-medium text-heading">Time</span>
          <Select value={String(digest.hour)} onChange={(e) => change({ hour: Number(e.target.value) })} aria-label="Time" className="w-full">
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={String(h)}>
                {hourLabel(h, locale)}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium text-heading">About</span>
          <Select value={where} onChange={(e) => change({ scope: e.target.value === "personal" ? { kind: "personal" } : { kind: "workspace", workspaceId: e.target.value } })} aria-label="About" className="w-full">
            <option value="personal">Personal</option>
            {places.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <p className="mt-3 text-sm text-muted">
        {digest.nextAt ? `Next one: ${nextLabel(digest.nextAt, digest.timeZone, locale)} (${digest.timeZone}).` : "Not scheduled yet."}
        {digest.lastNoteId ? (
          <>
            {" "}
            <AppLink href={`/d/${digest.lastNoteId}`} className="font-medium text-heading underline underline-offset-2">
              Open the last one
            </AppLink>
          </>
        ) : null}
      </p>
    </Card>
  );
}
