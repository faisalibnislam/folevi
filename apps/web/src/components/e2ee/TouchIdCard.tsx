"use client";

import { useEffect, useId, useState } from "react";
import { Card } from "@/components/views/settings/Card";
import { Switch } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";
import { copy } from "@/lib/e2ee/copy";
import { macE2ee, useKeySession } from "@/lib/e2ee/keys";

/**
 * Settings > Desktop app: "Ask for Touch ID to unlock encrypted notes" (docs/E2EE_DESIGN.md §6.2). The Mac app
 * keeps the choice and asks for Touch ID before it opens the device's key. Only in a Mac app with the bridge,
 * once the account has encryption.
 */
export function TouchIdCard() {
  const { state } = useKeySession();
  const bridge = macE2ee();
  const toast = useToast();
  const id = useId();
  const [value, setValue] = useState<{ touchId: boolean; available: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = Boolean(bridge?.settings && bridge.setTouchId);
  useEffect(() => {
    if (!supported || state === "none") return;
    void bridge!.settings!().then(setValue, () => setValue(null));
  }, [bridge, supported, state]);
  if (!supported || state === "none" || !value) return null;
  const d = copy.desktop;
  return (
    <Card title="Encrypted notes">
      <div className="flex max-w-xl items-center justify-between gap-6">
        <span className="min-w-0">
          <span className="block text-sm text-ink">{d.touchId}</span>
          <span id={id} className="block text-xs text-muted">
            {value.available ? d.touchIdBody : d.touchIdUnavailable}
          </span>
        </span>
        <Switch
          checked={value.touchId}
          disabled={busy || !value.available}
          label={d.touchId}
          describedBy={id}
          onChange={async (on) => {
            setBusy(true);
            try {
              const next = await bridge!.setTouchId!(on);
              setValue(next);
              toast.show(next.touchId ? d.on : d.off);
            } catch {
              // Touch ID was cancelled: nothing changes.
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
    </Card>
  );
}
