"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/lib/convex/api";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { CREDIT_PACKS, CREDIT_PACK_ORDER, PACK_VALID_MONTHS, formatPrice, type CreditPackId } from "@/lib/plans";

/** Where bought credits go: your Personal, or your own seat in a paid workspace (its public id). */
export type CreditTarget = { kind: "personal" } | { kind: "workspace"; workspaceId: string };

/**
 * Buying an AI credit pack (Pro and Pro AI): 500 or 1,000 credits, one-time, valid 12 months, used after
 * the monthly credits. Opens Polar Checkout; in development without payments, adds a test pack instead.
 */
export function BuyCreditsDialog({ open, onClose, target, name }: { open: boolean; onClose: () => void; target: CreditTarget; name: string }) {
  const status = useQuery(api.billing.creditAccounts, open ? {} : "skip");
  const buy = useAction(api.billing.buyCredits);
  const testBuy = useMutation(api.billing.testBuyCredits);
  const toast = useToast();
  const [busy, setBusy] = useState<CreditPackId | null>(null);
  const test = Boolean(status && !status.checkoutAvailable && status.testPurchases);
  const canBuy = Boolean(status && (status.checkoutAvailable || status.testPurchases));

  const purchase = async (pack: CreditPackId) => {
    setBusy(pack);
    try {
      if (status?.checkoutAvailable) {
        const { url } = await buy({ pack, scope: target });
        window.location.assign(url);
        return;
      }
      await testBuy({ pack, scope: target });
      toast.show(`Added ${CREDIT_PACKS[pack].credits.toLocaleString()} AI credits to ${name} (test purchase).`, { tone: "success" });
      onClose();
    } catch (err) {
      toast.show(errorMessage(err), { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="Buy AI credits"
      description={`For ${name}. Bought credits last ${PACK_VALID_MONTHS} months and are used after your monthly credits run out.`}
    >
      <ul className="space-y-2">
        {CREDIT_PACK_ORDER.map((id) => {
          const pack = CREDIT_PACKS[id];
          return (
            <li key={id} className="flex items-center gap-3 rounded-control bg-[var(--glass-hover)] px-4 py-3 shadow-[inset_0_0_0_1px_var(--glass-border)]">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-heading">{pack.credits.toLocaleString()} AI credits</p>
                <p className="text-[12.5px] text-muted">{formatPrice(pack.priceCents)}, one time</p>
              </div>
              <Button variant={id === "credits_1000" ? "primary" : "secondary"} size="sm" disabled={!canBuy || busy !== null} aria-busy={busy === id || undefined} aria-label={`Buy ${pack.credits.toLocaleString()} AI credits for ${formatPrice(pack.priceCents)}${test ? " (test)" : ""}`} onClick={() => void purchase(id)}>
                {busy === id ? (test ? "Adding…" : "Opening checkout…") : `Buy${test ? " (test)" : ""}`}
              </Button>
            </li>
          );
        })}
      </ul>
      {status && !canBuy ? <p className="mt-3 text-[12.5px] text-faint">Buying credits isn&apos;t available yet.</p> : null}
      {test ? <p className="mt-3 text-[12.5px] text-faint">Payments aren&apos;t connected, so this adds a test pack (development only). Nothing is charged.</p> : null}
      {status?.checkoutAvailable ? <p className="mt-3 text-[12.5px] text-faint">Any tax is added at checkout.</p> : null}
    </Dialog>
  );
}
