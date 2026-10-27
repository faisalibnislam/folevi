"use client";
// The Vault's Trash (docs/VAULT_PLAN.md §5): deleted items for 30 days, then gone for good (a daily job, logged).
// Anyone who could change an item restores it; custodians empty the Trash now. Both are logged.
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatRelative } from "@/lib/format";
import { vaultSessions } from "@/lib/vault/keys";
import { ITEM_KINDS, openSummaryAs, type ItemKind } from "@/lib/vault/items";

const DAY = 86_400_000;

export function Trash({ vaultId, role }: { vaultId: string; role: string }) {
  const data = useQuery(api.vaultItems.list, { vaultId, section: "trash" });
  const restore = useMutation(api.vaultItems.restore);
  const empty = useMutation(api.vaultFiles.emptyTrash);
  const toast = useToast();
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!data) return;
    const keysOf = (v: number) => vaultSessions().keys(vaultId, v);
    void Promise.all(data.items.map(async (row) => [row.id, (await openSummaryAs<{ title: string }>(vaultId, row, keysOf).catch(() => null))?.title ?? "Can't open this item"] as const)).then((r) => setTitles(Object.fromEntries(r)));
  }, [data, vaultId]);

  const kindLabel = (k: string) => (k === "note" ? "Note" : k === "file" ? "File" : (ITEM_KINDS[k as ItemKind]?.label ?? k));
  const items = data?.items ?? [];

  return (
    <section aria-label="Trash" className="max-w-3xl space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-subheadline text-muted">Deleted items stay here for 30 days, then go for good.</p>
        {role !== "member" && items.length ? (
          <Button variant="secondary" className="text-danger" onClick={() => setConfirming(true)}>
            <Trash2 size={14} aria-hidden /> Empty Trash
          </Button>
        ) : null}
      </div>
      {data === undefined ? (
        <div className="h-24 animate-pulse rounded-chip bg-surface motion-reduce:animate-none" aria-busy />
      ) : !items.length ? (
        <EmptyState icon={Trash2} title="The Trash is empty" />
      ) : (
        <ul className="divide-y divide-line overflow-hidden ui-card rounded-control">
          {items.map((row) => {
            const left = Math.max(0, Math.ceil(((row.deletedAt ?? 0) + 30 * DAY - Date.now()) / DAY));
            return (
              <li key={row.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{titles[row.id] ?? "…"}</span>
                  <span className="block truncate text-footnote text-muted">{[kindLabel(row.kind), `deleted ${formatRelative(row.deletedAt ?? row.updatedAt)}`, `${left} ${left === 1 ? "day" : "days"} left`].join(" · ")}</span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    void restore({ vaultId, itemId: row.id, client: vaultSessions().info(vaultId) }).then(
                      () => toast.show("Restored"),
                      (e) => toast.show(errorMessage(e), { tone: "error" }),
                    )
                  }
                >
                  <RotateCcw size={13} aria-hidden /> Restore
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {confirming ? (
        <Dialog
          open
          onClose={() => setConfirming(false)}
          title="Empty the Trash?"
          size="sm"
          footer={
            <>
              <Button onClick={() => setConfirming(false)}>Cancel</Button>
              <Button
                variant="primary"
                className="bg-danger"
                onClick={() =>
                  void empty({ vaultId, client: vaultSessions().info(vaultId) }).then(
                    (r) => (setConfirming(false), toast.show(`Deleted ${r.removed} for good`)),
                    (e) => toast.show(errorMessage(e), { tone: "error" }),
                  )
                }
              >
                Delete for good
              </Button>
            </>
          }
        >
          <p className="pb-2 text-subheadline text-muted">Everything in the Trash goes for good, for everyone in the Vault. The log keeps a record that it happened.</p>
        </Dialog>
      ) : null}
    </section>
  );
}
