"use client";
// The Vault's Activity (its log), People (team Vault) and Settings (docs/VAULT_PLAN.md §7, §9).
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { CheckCircle2, Download, ShieldAlert, UserPlus } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/format";
import { vaultSessions } from "@/lib/vault/keys";
import { eventLabel } from "./events";
import { ImportExport } from "./ImportExport";

type Info = { id: string; personal: boolean; role: string; autoLockMinutes: number; custodiansNameCustodians: boolean };

const csvCell = (s: unknown) => {
  const t = s === null || s === undefined ? "" : typeof s === "string" ? s : JSON.stringify(s);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

function save(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function Activity({ info }: { info: Info }) {
  const [event, setEvent] = useState("");
  const [failedOnly, setFailedOnly] = useState(false);
  const data = useQuery(api.vaultLog.list, { vaultId: info.id, ...(event ? { event } : {}), ...(failedOnly ? { failedOnly } : {}) });
  const exportPage = useMutation(api.vaultLog.exportPage);
  const [check, setCheck] = useState(false);
  const verify = useQuery(api.vaultLog.verify, check ? { vaultId: info.id } : "skip");
  const toast = useToast();

  const doExport = async (format: "csv" | "json") => {
    try {
      const all = [];
      let after = 0;
      for (;;) {
        const page = await exportPage({ vaultId: info.id, after, format, client: vaultSessions().info(info.id) });
        all.push({ entries: page.entries, signature: page.signature });
        if (page.next === null) break;
        after = page.next;
      }
      const entries = all.flatMap((p) => p.entries);
      if (format === "json") save(`vault-activity-${Date.now()}.json`, JSON.stringify({ vaultId: info.id, exportedAt: new Date().toISOString(), pages: all }, null, 2), "application/json");
      else {
        const cols = ["seq", "at", "actorName", "actorEmail", "actorRole", "event", "outcome", "reason", "itemKind", "itemId", "detail", "device", "ip", "location", "sessionId", "source", "hash"] as const;
        save(`vault-activity-${Date.now()}.csv`, [cols.join(","), ...entries.map((e) => cols.map((c) => csvCell(c === "at" ? new Date(e.at).toISOString() : e[c])).join(","))].join("\n"), "text/csv");
      }
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    }
  };

  return (
    <section aria-label="Activity">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select aria-label="What" value={event} onChange={(e) => setEvent(e.target.value)} className="h-9 ui-input rounded-chip px-3 text-callout">
          <option value="">Everything</option>
          <option value="vault.">Unlocking and locking</option>
          <option value="item.">Items</option>
          <option value="file.">Files</option>
          <option value="note.">Notes</option>
          <option value="person.">People</option>
          <option value="link.">Links</option>
          <option value="share.">Sharing</option>
        </Select>
        <label className="flex items-center gap-2 text-subheadline text-muted">
          <Switch checked={failedOnly} onChange={setFailedOnly} label="Failures only" /> Failures only
        </label>
        <span className="mr-auto" />
        {data?.everything ? (
          <>
            <Button variant="secondary" onClick={() => setCheck(true)}>
              <CheckCircle2 size={14} aria-hidden /> Check the log
            </Button>
            <Button variant="secondary" onClick={() => void doExport("csv")}>
              <Download size={14} aria-hidden /> CSV
            </Button>
            <Button variant="secondary" onClick={() => void doExport("json")}>
              <Download size={14} aria-hidden /> Signed JSON
            </Button>
          </>
        ) : null}
      </div>
      {verify ? (
        <p className={`mb-3 rounded-chip border p-3 text-subheadline ${verify.ok ? "border-line text-success" : "border-danger/40 text-danger"}`}>
          {verify.ok ? `Log verified: ${verify.checked} entries, nothing changed or missing.` : `The log doesn't check out at entry ${verify.brokenAt} (${verify.why}). Contact support.`}
        </p>
      ) : null}
      {!data?.everything ? <p className="mb-3 text-footnote text-muted">You see your own activity. The owner and custodians see everyone's.</p> : null}
      <ul className="divide-y divide-line overflow-hidden ui-card rounded-control">
        {(data?.entries ?? []).map((e) => (
          <li key={e.seq} className="px-4 py-2.5">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-ink">{e.actorName}</span>
              <span className={e.outcome === "failed" ? "text-danger" : "text-ink"}>
                {eventLabel(e.event)}
                {e.outcome === "failed" ? ` (failed${e.reason ? `: ${e.reason.replace(/_/g, " ")}` : ""})` : ""}
              </span>
              <span className="ml-auto text-footnote text-faint">{formatDateTime(e.at)}</span>
            </div>
            <div className="text-footnote text-muted">{[e.actorRole, e.itemKind, e.device?.label, e.ip, e.source === "device" ? "reported by the device" : null].filter(Boolean).join(" · ")}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function People({ info }: { info: Info }) {
  const { workspace } = useAppState();
  const data = useQuery(api.vaultPeople.list, { vaultId: info.id });
  const members = useQuery(api.workspaces.members, workspace ? { workspaceId: workspace.id } : "skip");
  const add = useMutation(api.vaultPeople.add);
  const remove = useMutation(api.vaultPeople.remove);
  const setRole = useMutation(api.vaultPeople.setRole);
  const reviewed = useMutation(api.vaultPeople.reviewed);
  const toast = useToast();
  const [pick, setPick] = useState("");
  const run = (p: Promise<unknown>, ok: string) => void p.then(() => toast.show(ok), (e) => toast.show(errorMessage(e), { tone: "error" }));
  const inVault = new Set((data?.people ?? []).map((p) => p.profileId));
  const candidates = ((members as { members?: { profileId: string; displayName: string; role: string }[] } | undefined)?.members ?? []).filter((m) => !inVault.has(m.profileId));

  return (
    <section aria-label="People" className="space-y-4">
      {data?.onlyOneCustodian ? (
        <p className="flex items-start gap-2 rounded-chip border border-warning/40 p-3 text-subheadline text-warning">
          <ShieldAlert size={16} aria-hidden className="mt-0.5 flex-none" /> Only one person can manage this Vault. If they lose their recovery key, nobody can open it. Make someone else a custodian too.
        </p>
      ) : null}
      {data?.canAdd ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Workspace member" value={pick} onChange={(e) => setPick(e.target.value)} className="h-9 min-w-[14rem] ui-input rounded-chip px-3 text-callout">
            <option value="">Choose a workspace member</option>
            {candidates.map((m) => (
              <option key={m.profileId} value={m.profileId}>
                {m.displayName}
              </option>
            ))}
          </Select>
          <Button variant="primary" disabled={!pick} onClick={() => (run(add({ vaultId: info.id, profileId: pick, role: "member" }), "Added. Their key arrives when you next open the Vault."), setPick(""))}>
            <UserPlus size={14} aria-hidden /> Add
          </Button>
          <Button variant="secondary" onClick={() => run(reviewed({ vaultId: info.id }), "Access reviewed")}>
            Everyone here should have access
          </Button>
        </div>
      ) : null}
      <ul className="divide-y divide-line overflow-hidden ui-card rounded-control">
        {(data?.people ?? []).map((p) => (
          <li key={p.profileId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-ink">
                {p.name}
                {p.isYou ? <span className="ml-1.5 text-footnote font-normal text-muted">(you)</span> : null}
              </span>
              <span className="block truncate text-footnote text-muted">{[p.email, p.ready ? "Can open it" : p.waiting ? "Waiting for the key" : "Hasn't set a passcode yet"].filter(Boolean).join(" · ")}</span>
            </span>
            {p.role === "owner" ? (
              <span className="text-footnote text-muted">Owner</span>
            ) : data?.canNameCustodians ? (
              <Select aria-label={`Role for ${p.name}`} value={p.role} onChange={(e) => run(setRole({ vaultId: info.id, profileId: p.profileId, role: e.target.value as "custodian" | "member" }), "Role changed")} className="h-8 ui-input rounded-chip px-2.5 text-footnote">
                <option value="custodian">Custodian</option>
                <option value="member">Member</option>
              </Select>
            ) : (
              <span className="text-footnote text-muted">{p.role === "custodian" ? "Custodian" : "Member"}</span>
            )}
            {p.role !== "owner" && (data?.canAdd || p.isYou) ? (
              <Button size="sm" variant="quiet" className="text-danger" onClick={() => run(remove({ vaultId: info.id, profileId: p.profileId }), p.isYou ? "You left the Vault" : "Removed. The Vault's key changes when a custodian next opens it.")}>
                {p.isYou ? "Leave" : "Remove"}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function VaultSettings({ info }: { info: Info }) {
  const update = useMutation(api.vault.updateSettings);
  const toast = useToast();
  const run = (p: Promise<unknown>, ok: string) => void p.then(() => toast.show(ok), (e) => toast.show(errorMessage(e), { tone: "error" }));
  const manage = info.role !== "member";
  return (
    <section aria-label="Vault settings" className="max-w-xl space-y-5 text-subheadline">
      {manage ? (
        <label className="flex items-center justify-between gap-3">
          <span>
            <span className="block font-medium text-ink">Lock after</span>
            <span className="block text-footnote text-muted">Idle minutes before the Vault locks itself on a device.</span>
          </span>
          <Select aria-label="Lock after" value={String(info.autoLockMinutes)} onChange={(e) => run(update({ vaultId: info.id, autoLockMinutes: Number(e.target.value), client: vaultSessions().info(info.id) }), "Saved")} className="h-9 ui-input rounded-chip px-3">
            {[1, 2, 5, 10, 15, 30].map((m) => (
              <option key={m} value={m}>
                {m} {m === 1 ? "minute" : "minutes"}
              </option>
            ))}
          </Select>
        </label>
      ) : null}
      {info.role === "owner" && !info.personal ? (
        <div className="flex items-center justify-between gap-3">
          <span>
            <span className="block font-medium text-ink">Custodians can name custodians</span>
            <span className="block text-footnote text-muted">Otherwise only you do. Custodians always add and remove members.</span>
          </span>
          <Switch checked={info.custodiansNameCustodians} label="Custodians can name custodians" onChange={(on) => run(update({ vaultId: info.id, custodiansNameCustodians: on, client: vaultSessions().info(info.id) }), "Saved")} />
        </div>
      ) : null}
      <ImportExport vaultId={info.id} canExport={info.role !== "member"} />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void vaultSessions().newRecoveryKey(info.id).catch((e) => toast.show(errorMessage(e), { tone: "error" }))}>
          Make a new recovery key
        </Button>
        <Button variant="secondary" onClick={() => void vaultSessions().lock(info.id, "manual")}>
          Lock now
        </Button>
      </div>
    </section>
  );
}
