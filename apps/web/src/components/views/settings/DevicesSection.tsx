"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Laptop, Monitor, MonitorSmartphone, Smartphone, Tablet } from "lucide-react";
import { api } from "@/lib/convex/api";
import { AppLink } from "@/lib/app/router";
import { useAppState } from "@/lib/app/state";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatDateTime, formatRelative } from "@/lib/format";
import { TIER_NAMES, TRIAL_TIER } from "@/lib/plans";
import { Card } from "./Card";

function DeviceIcon({ client, label }: { client: string; label: string }) {
  const Icon = client === "mac" ? Laptop : /iPad/.test(label) ? Tablet : /iPhone|iOS|Android/.test(label) ? Smartphone : Monitor;
  return (
    <span aria-hidden className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-[var(--glass-hover)] text-heading">
      <Icon size={17} />
    </span>
  );
}

/**
 * Settings → Devices: every browser and app signed in to the account, on every plan, with the plan's
 * device limit (Free: 2; Core, Pro, Pro AI and the trial: unlimited). Signing a device out ends its session at once.
 */
export function DevicesSection() {
  const sessions = useQuery(api.users.listSessions, {});
  const revoke = useMutation(api.users.revokeSession);
  const revokeOthers = useMutation(api.users.revokeOtherSessions);
  const toast = useToast();
  const [confirmAll, setConfirmAll] = useState(false);
  const { profile } = useAppState();
  const entitlements = (profile as { entitlements?: { devices: number | null; trialing: boolean } }).entitlements;
  // null = unlimited. The server enforces the limit either way.
  const limit = entitlements?.devices ?? null;
  const count = sessions?.length;
  const others = sessions?.filter((s) => !s.current).length ?? 0;
  const pct = limit && count !== undefined ? Math.min(100, (count / limit) * 100) : 0;
  const plural = (n: number) => (n === 1 ? "device" : "devices");

  return (
    <>
      <Card title="Connected devices">
        <div className="flex flex-wrap items-center gap-4 rounded-[10px] bg-[var(--glass-hover)] p-4">
          <span aria-hidden className="grid h-11 w-11 flex-none place-items-center rounded-[10px] bg-[var(--glass-active)] text-heading shadow-[var(--glass-edge),0_1px_3px_rgb(0_0_0/0.06)]">
            <MonitorSmartphone size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-heading">
              {count === undefined ? "…" : limit === null ? `${count} ${plural(count)} connected` : `${count} of ${limit} ${plural(limit)} connected`}
            </p>
            <p className="mt-0.5 text-[13px] text-muted">
              {limit === null
                ? entitlements?.trialing
                  ? `Unlimited devices during your ${TIER_NAMES[TRIAL_TIER]} trial.`
                  : "Your personal plan includes unlimited devices."
                : `Your personal plan works on ${limit} ${plural(limit)} at a time, in Personal and every workspace. A new device beyond that asks you to sign one out first.`}
            </p>
            {limit !== null ? (
              <div className="mt-2.5 h-1.5 max-w-sm overflow-hidden rounded-[4px] bg-[color-mix(in_oklab,var(--color-ink)_12%,transparent)]" role="meter" aria-label="Devices connected" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={count ?? 0}>
                <div className={`h-full rounded-[6px] ${limit && (count ?? 0) > limit ? "bg-danger" : "bg-heading"}`} style={{ width: `${Math.max(pct, 4)}%` }} />
              </div>
            ) : null}
          </div>
          {limit !== null ? (
            <AppLink href="/settings/billing" className="ui-btn ui-btn-secondary h-9 px-4 text-sm">
              Get unlimited devices
            </AppLink>
          ) : null}
        </div>
      </Card>

      <Card title="Signed in" description="Browsers and apps signed in to your account. Signing a device out ends its session right away; it asks for your password and code to sign in again.">
        <ul className="ui-card divide-y divide-line overflow-hidden rounded-[10px]" aria-busy={sessions === undefined || undefined}>
          {sessions === undefined ? <li className="px-4 py-3 text-sm text-muted">Loading…</li> : null}
          {sessions?.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <DeviceIcon client={s.client} label={s.label} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-heading">{s.label}</span>
                <span className="block text-xs text-muted">
                  Signed in {formatDateTime(s.createdAt)} · active {formatRelative(s.lastSeenAt)}
                </span>
              </span>
              {s.current ? (
                <span className="ui-chip h-6 flex-none self-center bg-moss-soft text-[11.5px] text-moss-ink">This device</span>
              ) : (
                <Button size="sm" aria-label={`Sign out ${s.label}`} onClick={() => void revoke({ sessionId: s.id }).then(() => toast.show("Device signed out"), (e) => toast.show(errorMessage(e), { tone: "error" }))}>
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
        <Button className="mt-3" disabled={others === 0} onClick={() => setConfirmAll(true)}>
          Sign out of all other devices
        </Button>
        <Dialog
          open={confirmAll}
          onClose={() => setConfirmAll(false)}
          title="Sign out everywhere else?"
          description={`${others} other ${plural(others)} will be signed out right away. This device stays signed in.`}
          size="sm"
          footer={
            <>
              <Button onClick={() => setConfirmAll(false)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => {
                  setConfirmAll(false);
                  void revokeOthers({}).then(
                    (r) => toast.show(r.ended === 1 ? "Signed out 1 other device" : `Signed out ${r.ended} other devices`),
                    (e) => toast.show(errorMessage(e), { tone: "error" }),
                  );
                }}
              >
                Sign out others
              </Button>
            </>
          }
        />
      </Card>
    </>
  );
}
