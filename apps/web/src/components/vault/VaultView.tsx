"use client";
// /vault (docs/VAULT_PLAN.md §9): the place's Vault. Its front door (VaultGate) until it's open on this device; then
// Passwords & Credentials, Files & Notes, Activity, People (team Vault) and Settings. When a custodian opens it, their
// device does the custodian's chores: sharing the key with anyone waiting, and a new key version after someone left.
import { useEffect, useRef, useState } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { ViewChrome } from "@/components/app/Shell";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { vaultSessions } from "@/lib/vault/keys";
import { Passwords } from "./Passwords";
import { Files } from "./Files";
import { Activity, People, VaultSettings } from "./Sections";
import { VaultGate } from "./VaultGate";
import { useRecordEvent, useRecoveryToSave, useVaultBinding, useVaultInfo, useVaultOpen } from "./useVault";
import { RecoveryKeyPanel } from "@/components/e2ee/RecoveryKeyPanel";
import { useAppState } from "@/lib/app/state";

type Tab = "passwords" | "files" | "activity" | "people" | "settings";

export function VaultView() {
  const info = useVaultInfo();
  useVaultBinding();
  const vaultId = info?.exists ? info.id : null;
  const open = useVaultOpen(vaultId);
  const recoveryToSave = useRecoveryToSave(vaultId);
  const { profile } = useAppState();
  const [tab, setTab] = useState<Tab>("passwords");
  const toast = useToast();
  const record = useRecordEvent(vaultId ?? "");
  const chores = useRef<string | null>(null);

  // Once per open: the custodian's chores, and the open itself for the log.
  useEffect(() => {
    if (!open || !vaultId || !info?.exists || chores.current === vaultId) return;
    chores.current = vaultId;
    record("vault.open");
    if (info.role === "member") return;
    void (async () => {
      if (info.rotationNeeded && (await vaultSessions().rotate(vaultId))) toast.show("The Vault's key changed, so whoever left can't read anything new.");
      const n = await vaultSessions().grantWaiting(vaultId);
      if (n) toast.show(n === 1 ? "Shared the Vault's key with someone who was waiting." : `Shared the Vault's key with ${n} people who were waiting.`);
    })().catch(() => undefined);
  }, [open, vaultId, info, record, toast]);
  useEffect(() => {
    if (!open) chores.current = null;
  }, [open]);

  const title = "Vault";
  if (info === undefined) return <ViewChrome title={title}>{null}</ViewChrome>;
  if (info === null)
    return (
      <ViewChrome title={title}>
        <EmptyState icon={Lock} title="No Vault here" body="This workspace's Vault is only for the people its owner or custodians add." />
      </ViewChrome>
    );

  const tabs: [Tab, string][] = [
    ["passwords", "Passwords & Credentials"],
    ["files", "Files & Notes"],
    ["activity", "Activity"],
    ...(info.personal ? [] : ([["people", "People"]] as [Tab, string][])),
    ["settings", "Settings"],
  ];
  const ready = open && info.exists;

  return (
    <ViewChrome
      title={
        <h1 className="flex items-center gap-2 text-subheadline font-semibold">
          <ShieldCheck size={15} aria-hidden /> {title}
        </h1>
      }
      tabTitle={title}
      subtitle={ready ? `Open on this device · locks after ${info.autoLockMinutes} idle ${info.autoLockMinutes === 1 ? "minute" : "minutes"}` : "Locked"}
      actions={
        ready ? (
          <Button size="sm" variant="secondary" onClick={() => void vaultSessions().lock(info.id, "manual")}>
            <Lock size={13} aria-hidden /> Lock
          </Button>
        ) : null
      }
    >
      <div className="mx-auto max-w-[1180px] px-4 pb-24 pt-4 sm:px-8">
        {recoveryToSave && vaultId ? (
          // The recovery key, once, right after setting up (or making a new one): until it's confirmed as saved.
          <div className="mx-auto mt-10 max-w-md rounded-panel ui-card px-6 py-7">
            <h2 className="text-title-3 font-semibold text-heading">Save your Vault recovery key</h2>
            <p className="mb-4 mt-2 text-subheadline text-muted">If you forget your passcode, this key opens the Vault. Folevi can't. Keep it somewhere safe, away from this device.</p>
            <RecoveryKeyPanel text={recoveryToSave} email={profile.email} onDone={() => vaultSessions().recoverySaved(vaultId)} />
          </div>
        ) : !ready ? (
          <VaultGate info={info} onOpen={() => undefined} />
        ) : (
          <>
            {info.recoveryOutdated ? <p className="mb-3 rounded-chip border border-warning/40 p-3 text-subheadline text-warning">The Vault's key changed since you saved your recovery key. Make a new one in Settings.</p> : null}
            {info.accessReviewDue ? <p className="mb-3 rounded-chip border border-line p-3 text-subheadline text-muted">It's been 90 days since anyone checked who has access to this Vault. Have a look in People.</p> : null}
            <div role="tablist" aria-label="Vault sections" className="mb-5 flex flex-wrap gap-1 border-b border-line">
              {tabs.map(([key, label]) => (
                <button
                  key={key}
                  role="tab"
                  type="button"
                  aria-selected={tab === key}
                  onClick={() => (setTab(key), record("section.open", undefined, { section: key }))}
                  className={`-mb-px border-b-2 px-3 py-2 text-subheadline font-medium transition-colors ${tab === key ? "border-heading text-heading" : "border-transparent text-muted hover:text-heading"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div role="tabpanel">
              {tab === "passwords" ? <Passwords vaultId={info.id} /> : null}
              {tab === "files" ? <Files vaultId={info.id} /> : null}
              {tab === "activity" ? <Activity info={info} /> : null}
              {tab === "people" && !info.personal ? <People info={info} /> : null}
              {tab === "settings" ? <VaultSettings info={info} /> : null}
            </div>
          </>
        )}
      </div>
    </ViewChrome>
  );
}
