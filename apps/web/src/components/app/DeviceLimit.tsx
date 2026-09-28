"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Laptop, Monitor, Smartphone } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Button } from "@/components/ui/Button";
import { errorMessage } from "@/components/ui/Toast";
import { SignOutButton } from "@/components/auth/SignOut";
import { FullPageMessage } from "@/lib/app/state";
import { formatRelative } from "@/lib/format";
import { PLANS, formatPrice } from "@/lib/plans";

function DeviceIcon({ label, client }: { label: string; client: string }) {
  if (client === "mac") return <Laptop size={16} aria-hidden />;
  if (/iphone|android|ipad|mobile/i.test(label)) return <Smartphone size={16} aria-hidden />;
  return <Monitor size={16} aria-hidden />;
}

/**
 * Shown on a device that signed in over the plan's device limit (Free: 2). Nothing on this device can
 * reach the account until another device is signed out here, or the plan is upgraded — the server holds
 * it either way (users.me → "device_limit"; every other call is refused).
 */
export function DeviceLimitScreen({ limit }: { limit: number }) {
  const sessions = useQuery(api.users.listSessions, {});
  const billing = useQuery(api.billing.mine, {});
  const revoke = useMutation(api.users.revokeSession);
  const testPurchase = useMutation(api.billing.testPurchase);
  const checkout = useAction(api.billing.checkout);
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
  const upgrade = (plan: "basic" | "pro") =>
    run(plan, async () => {
      if (billing?.checkoutAvailable) window.location.assign((await checkout({ plan, interval: "month" })).url);
      else if (billing?.testPurchases) await testPurchase({ plan, interval: "month" });
      else throw new Error("Online payments aren't available yet.");
    });
  const others = sessions?.filter((s) => !s.current) ?? [];
  const canBuy = Boolean(billing?.checkoutAvailable || billing?.testPurchases);

  return (
    <FullPageMessage
      title={`You’re on ${limit} ${limit === 1 ? "device" : "devices"} already`}
      body={`Your plan works on ${limit} ${limit === 1 ? "device" : "devices"} at a time. Sign out of one below to use Folevi here, or upgrade for unlimited devices.`}
    >
      <p className="ui-caps mb-2">Signed in on</p>
      <ul className="divide-y divide-line overflow-hidden rounded-[8px] ui-card" aria-busy={sessions === undefined || undefined}>
        {sessions === undefined ? (
          <li className="px-3 py-3 text-sm text-muted">Loading your devices…</li>
        ) : (
          others.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="grid h-8 w-8 flex-none place-items-center rounded-[8px] bg-[var(--glass-hover)] text-heading">
                <DeviceIcon label={s.label} client={s.client} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-heading">{s.label}</span>
                <span className="block text-xs text-muted">Active {formatRelative(s.lastSeenAt)}</span>
              </span>
              <Button size="sm" onClick={() => void run(s.id, () => revoke({ sessionId: s.id }))} disabled={busy !== null} aria-label={`Sign out ${s.label}`}>
                {busy === s.id ? "Signing out…" : "Sign out"}
              </Button>
            </li>
          ))
        )}
      </ul>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {canBuy ? (
          <>
            <Button variant="primary" onClick={() => void upgrade("basic")} disabled={busy !== null}>
              {busy === "basic" ? "Upgrading…" : `Upgrade to Basic · ${formatPrice(PLANS.basic.monthlyCents)}/mo`}
            </Button>
            <Button onClick={() => void upgrade("pro")} disabled={busy !== null}>
              {busy === "pro" ? "Upgrading…" : `Pro · ${formatPrice(PLANS.pro.monthlyCents)}/mo`}
            </Button>
          </>
        ) : null}
      </div>
      <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-[13px] text-muted">Not using this device?</p>
        <SignOutButton accountKey={null} label="Sign out here" />
      </div>
    </FullPageMessage>
  );
}
