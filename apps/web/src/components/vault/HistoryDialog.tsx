"use client";
// An item's earlier versions (docs/VAULT_PLAN.md §4): who changed it and when, each version opened here with the key
// it was sealed under, and brought back as a new change (so nothing is lost). Looking is logged, and so is bringing
// one back.
import { useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { History, RotateCcw } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/format";
import { vaultSessions } from "@/lib/vault/keys";
import { ITEM_KINDS, openSecrets, openSummary, type ItemKind, type ItemSecrets, type ItemSummary } from "@/lib/vault/items";

type Version = { revision: number; editedBy: string; editedAt: number; summary: (ItemSummary & { kind: ItemKind }) | null; secrets: ItemSecrets | null };

export function HistoryDialog({ vaultId, itemId, canChange, onClose }: { vaultId: string; itemId: string; canChange: boolean; onClose: () => void }) {
  const history = useMutation(api.vaultItems.history);
  const restore = useMutation(api.vaultItems.restoreVersion);
  const toast = useToast();
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [shown, setShown] = useState<number | null>(null);

  useEffect(() => {
    const s = vaultSessions();
    const keysOf = (v: number) => s.keys(vaultId, v);
    void history({ vaultId, itemId, client: s.info(vaultId) })
      .then((rows) =>
        Promise.all(
          rows.map(async (r) => {
            const row = { id: itemId, keyVersion: r.keyVersion, wrappedKey: r.wrappedKey, sealedSummary: r.sealedSummary, sealed: r.sealed };
            return { revision: r.revision, editedBy: r.editedBy, editedAt: r.editedAt, summary: await openSummary(vaultId, row, keysOf).catch(() => null), secrets: await openSecrets(vaultId, row, keysOf).catch(() => null) };
          }),
        ),
      )
      .then(setVersions, (e) => toast.show(errorMessage(e), { tone: "error" }));
  }, [history, vaultId, itemId, toast]);

  const current = versions?.find((v) => v.revision === shown) ?? null;
  return (
    <Dialog open onClose={onClose} title="Earlier versions" size="md" footer={<Button onClick={onClose}>Close</Button>}>
      <div className="pb-2 text-subheadline">
        {versions === null ? (
          <div className="h-24 animate-pulse rounded-chip bg-surface motion-reduce:animate-none" aria-busy />
        ) : !versions.length ? (
          <EmptyState icon={History} title="No earlier versions" body="Each time the item is changed, the version before is kept here." />
        ) : (
          <ul className="divide-y divide-line overflow-hidden ui-card rounded-control">
            {versions.map((v) => (
              <li key={v.revision} className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-subheadline font-medium text-ink">{v.summary?.title ?? "Can't open this version"}</span>
                    <span className="block text-footnote text-muted">
                      Version {v.revision} · {v.editedBy} · {formatDateTime(v.editedAt)}
                    </span>
                  </span>
                  <Button size="sm" variant="quiet" onClick={() => setShown(shown === v.revision ? null : v.revision)} disabled={!v.secrets}>
                    {shown === v.revision ? "Hide" : "Show"}
                  </Button>
                  {canChange ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void restore({ vaultId, itemId, revision: v.revision, client: vaultSessions().info(vaultId) }).then(
                          () => (toast.show(`Brought back version ${v.revision}`), onClose()),
                          (e) => toast.show(errorMessage(e), { tone: "error" }),
                        )
                      }
                    >
                      <RotateCcw size={13} aria-hidden /> Bring back
                    </Button>
                  ) : null}
                </div>
                {current && current.revision === v.revision && v.summary && v.secrets ? (
                  <dl className="mt-2 space-y-1 rounded-chip bg-surface p-2 text-footnote">
                    {(ITEM_KINDS[v.summary.kind]?.fields ?? []).map((f) => {
                      const val = v.summary!.fields[f.key] ?? v.secrets!.fields[f.key];
                      return val ? (
                        <div key={f.key} className="flex gap-2">
                          <dt className="w-28 flex-none text-muted">{f.label}</dt>
                          <dd className={`min-w-0 break-words text-ink ${f.type === "secret" ? "font-mono" : ""}`}>{val}</dd>
                        </div>
                      ) : null;
                    })}
                  </dl>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
