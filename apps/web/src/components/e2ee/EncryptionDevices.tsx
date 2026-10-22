"use client";

import { useMutation, useQuery } from "convex/react";
import { useId, useState } from "react";
import { Laptop, Monitor, MoreHorizontal, Smartphone, Tablet } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Card } from "@/components/views/settings/Card";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { MenuButton } from "@/components/ui/Menu";
import { Switch } from "@/components/ui/Switch";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { useAppState } from "@/lib/app/state";
import { formatRelative } from "@/lib/format";
import { copy, e2eeErrorMessage } from "@/lib/e2ee/copy";
import { getKeySession, setup, useKeySession } from "@/lib/e2ee/keys";
import { RecoveryKeyPanel } from "./RecoveryKeyPanel";

type Row = { deviceId: string; kind: "app" | "browser" | "session"; label: string; status: "pending" | "trusted" | "revoked"; hasWrap: boolean; lastSeenAt: number };

function Icon({ row }: { row: Row }) {
  const I = row.kind === "app" ? Laptop : /iPad/.test(row.label) ? Tablet : /iPhone|iOS|Android/.test(row.label) ? Smartphone : Monitor;
  return (
    <span aria-hidden className="grid h-9 w-9 flex-none place-items-center rounded-control bg-[var(--glass-hover)] text-heading">
      <I size={17} />
    </span>
  );
}

const line = (r: Row) => (r.kind === "session" ? copy.devices.publicSession : r.status === "trusted" && r.hasWrap ? copy.devices.canUnlock : copy.devices.cannotUnlock);

/**
 * Settings > Devices, once the account has encryption (§10.7): the devices and browsers that hold the key
 * (`e2ee.devices.list`), and "Remove from encryption" with the choice to change the encryption key. Nothing
 * renders for a Standard account (and its query doesn't run).
 */
export function EncryptionDevices() {
  const { state } = useKeySession();
  const rows = useQuery(api.e2ee.devices.list, state === "none" ? "skip" : {}) as Row[] | undefined;
  const [removing, setRemoving] = useState<Row | null>(null);
  if (state === "none") return null;
  const here = state === "unlocked" || state === "locked" ? safeDeviceId() : null;
  const shown = (rows ?? []).filter((r) => r.status !== "revoked");
  return (
    <Card title={copy.devices.title} description={copy.devices.body}>
      <ul className="ui-card divide-y divide-line overflow-hidden rounded-control" aria-busy={rows === undefined || undefined}>
        {rows === undefined ? <li className="px-4 py-3 text-sm text-muted">Loading…</li> : null}
        {shown.map((r) => (
          <li key={r.deviceId} className="flex items-center gap-3 px-4 py-3">
            <Icon row={r} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-heading">{r.label}</span>
              <span className="block text-xs text-muted">
                {line(r)} · {copy.devices.seen(formatRelative(r.lastSeenAt))}
              </span>
            </span>
            {r.deviceId === here ? (
              <span className="ui-chip h-6 flex-none self-center bg-moss-soft text-[11.5px] text-moss-ink">{copy.devices.thisDevice}</span>
            ) : state === "unlocked" ? (
              <MenuButton label={copy.devices.menuLabel(r.label)} trigger={<MoreHorizontal size={15} aria-hidden />} items={[{ label: copy.devices.removeFromEncryption, danger: true, onSelect: () => setRemoving(r) }]} />
            ) : null}
          </li>
        ))}
      </ul>
      {removing ? <RemoveFromEncryption device={removing} onClose={() => setRemoving(null)} /> : null}
    </Card>
  );
}

function safeDeviceId(): string | null {
  try {
    return getKeySession().deviceId();
  } catch {
    return null;
  }
}

/**
 * "Remove <device>?" (§10.7, §4.8): its key wraps go and its session is signed out. Changing the encryption key
 * (on for a device not seen in 14 days) makes a new account key: the passphrase is kept when typed here,
 * passkeys ask once, and a new recovery key is shown to save.
 */
function RemoveFromEncryption({ device, onClose }: { device: Row; onClose: () => void }) {
  const d = copy.devices;
  const toast = useToast();
  const uid = useId();
  const { profile } = useAppState();
  const { methods } = useKeySession();
  const revoke = useMutation(api.e2ee.devices.revoke);
  const [rotate, setRotate] = useState(() => Date.now() - device.lastSeenAt > 14 * 86_400_000);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const hasPassphrase = methods.some((m) => m.kind === "passphrase");
  const hasPasskeys = methods.some((m) => m.kind === "passkey");
  if (newKey)
    return (
      <Dialog open onClose={onClose} title={d.newKeyTitle} description={d.newKeyBody} size="md">
        <RecoveryKeyPanel text={newKey} email={profile.email ?? ""} onDone={onClose} />
      </Dialog>
    );
  return (
    <Dialog
      open
      onClose={onClose}
      title={d.removeTitle(device.label)}
      description={d.removeBody}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{copy.wizard.cancel}</Button>
          <Button
            variant="danger"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={async () => {
              setBusy(true);
              try {
                await revoke({ deviceId: device.deviceId });
                if (rotate) {
                  const r = await setup.rotateAccount({ passphrase: hasPassphrase && passphrase ? passphrase.normalize("NFC") : undefined, passkeys: hasPasskeys });
                  toast.show(d.removed(device.label), { tone: "success" });
                  if (r.recoveryKey) return setNewKey(r.recoveryKey);
                } else toast.show(d.removed(device.label), { tone: "success" });
                onClose();
              } catch (e) {
                toast.show(e2eeErrorMessage(e) ?? errorMessage(e), { tone: "error" });
              } finally {
                setBusy(false);
              }
            }}
          >
            {d.removeButton}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="flex items-start justify-between gap-4">
          <span className="min-w-0">
            <span className="block font-medium text-heading">{d.rotate.label}</span>
            <span id={`${uid}-rotate`} className="mt-0.5 block text-[13px] text-muted">
              {d.rotate.body}
            </span>
          </span>
          <Switch checked={rotate} onChange={setRotate} label={d.rotate.label} describedBy={`${uid}-rotate`} />
        </div>
        {rotate && hasPassphrase ? (
          <label className="block font-medium text-heading">
            {d.keepPassphrase}
            <input
              type="password"
              autoComplete="current-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              aria-describedby={`${uid}-pp`}
              className="ui-input mt-1 block h-10 w-full rounded-control px-3 text-sm font-normal pointer-coarse:h-11"
            />
            <span id={`${uid}-pp`} className="mt-1 block text-[12.5px] font-normal text-muted">
              {d.keepPassphraseHint}
            </span>
          </label>
        ) : null}
      </div>
    </Dialog>
  );
}
