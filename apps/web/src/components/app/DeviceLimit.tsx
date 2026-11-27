"use client";

import { useMutation } from "convex/react";
import { useQuery } from "@/lib/convex/queries";
import { useState } from "react";
import { Laptop, Monitor, Smartphone } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Button } from "@/components/ui/Button";
import { errorMessage } from "@/components/ui/Toast";
import { SignOutButton } from "@/components/auth/SignOut";
import { FullPageMessage } from "@/lib/app/state";
import { formatRelative } from "@/lib/format";

function DeviceIcon({ label, client }: { label: string; client: string }) {
  if (client === "mac") return <Laptop size={16} aria-hidden />;
  if (/iphone|android|ipad|mobile/i.test(label)) return <Smartphone size={16} aria-hidden />;
  return <Monitor size={16} aria-hidden />;
}

/**
 * Shown on a device that signed in over the account's device limit. No plan has one since 2026-11-27, so this
 * only appears with a custom limit (deviceLimitOverride). Nothing on this device can reach the account until
 * another device is signed out here. The server holds
 * it either way (users.me → "device_limit"; every other call is refused).
 */
export function DeviceLimitScreen({ limit }: { limit: number }) {
  const sessions = useQuery(api.users.listSessions, {});
  const revoke = useMutation(api.users.revokeSession);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const others = sessions?.filter((s) => !s.current) ?? [];
  return (
    <FullPageMessage
      title={`You’re on ${limit} ${limit === 1 ? "device" : "devices"} already`}
      body={`Your account works on ${limit} ${limit === 1 ? "device" : "devices"} at a time. Sign out of one below to use Folevi here.`}
      gate="deviceLimit"
      deviceLimit={{ limit, devices: others.map((s) => ({ id: s.id, label: s.label, lastSeenAt: s.lastSeenAt })) }}
      actions={others.map((s) => ({ id: `signOut:${s.id}`, label: `Sign out ${s.label}`, enabled: busy === null, run: () => run(s.id, () => revoke({ sessionId: s.id })) }))}
    >
      <p className="ui-caps mb-2">Signed in on</p>
      <ul className="divide-y divide-line overflow-hidden rounded-control ui-card" aria-busy={sessions === undefined || undefined}>
        {sessions === undefined ? (
          <li className="px-3 py-3 text-subheadline text-muted">Loading your devices…</li>
        ) : (
          others.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="grid h-8 w-8 flex-none place-items-center rounded-chip bg-[var(--glass-hover)] text-heading">
                <DeviceIcon label={s.label} client={s.client} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-subheadline font-medium text-heading">{s.label}</span>
                <span className="block text-footnote text-muted">Active {formatRelative(s.lastSeenAt)}</span>
              </span>
              <Button onClick={() => void run(s.id, () => revoke({ sessionId: s.id }))} disabled={busy !== null} aria-label={`Sign out ${s.label}`}>
                {busy === s.id ? "Signing out…" : "Sign out"}
              </Button>
            </li>
          ))
        )}
      </ul>
      {error ? (
        <p role="alert" className="mt-3 text-subheadline text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-subheadline text-muted">Not using this device?</p>
        <SignOutButton accountKey={null} label="Sign out here" />
      </div>
    </FullPageMessage>
  );
}
