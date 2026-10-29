"use client";
// Shared with Me, "From Vaults" (docs/VAULT_PLAN.md §6): items someone shared from their Vault with this person, each
// opened with this person's own account key (never the Vault's). Opening is logged in that Vault's log; a note shared
// to edit is saved back under the same item key, and that's logged too.
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { Copy, KeyRound } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatDateTime, formatRelative } from "@/lib/format";
import { sessionImpl } from "@/lib/e2ee/keys/session";
import { useKeySession } from "@/lib/e2ee/keys/useKeys";
import { useCapabilities } from "@/lib/mode";
import { ITEM_KINDS, type ItemKind, type ItemSecrets, type ItemSummary } from "@/lib/vault/items";
import { openShared, sealShared } from "@/lib/vault/shares";
import { copySecret } from "./useVault";
import { NoteEditor } from "./NoteEditor";

type Row = NonNullable<ReturnType<typeof useMine>>[number];
type Summary = (ItemSummary & { kind: ItemKind }) | { kind: "note"; title: string; excerpt: string };

/** How many Vault items are shared with this person (for Shared with Me's counts). */
export function useSharedVaultCount(): number | undefined {
  return useMine()?.length;
}

function useMine() {
  const caps = useCapabilities();
  return useQuery(api.vaultShares.mine, caps.sharing ? {} : "skip");
}

function me() {
  const { profileId, account } = sessionImpl().unlocked();
  return { profileId, account: account.x25519 };
}

export function SharedVaultItems() {
  const rows = useMine();
  const { state } = useKeySession();
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!rows?.length || state !== "unlocked") return;
    const who = me();
    void Promise.all(rows.map(async (r) => [r.shareId, (await openShared<Summary, never>({ vaultId: r.vaultId, id: r.itemId, wrappedKey: r.wrappedKey, sealedSummary: r.sealedSummary }, who).catch(() => null))?.summary.title ?? "Can't open"] as const)).then((t) => setTitles(Object.fromEntries(t)));
  }, [rows, state]);

  if (!rows?.length) return null;
  const current = rows.find((r) => r.shareId === openId) ?? null;
  return (
    <section aria-label="From Vaults" className="mt-6">
      <h2 className="mb-2 text-footnote font-semibold text-muted">From Vaults</h2>
      {state !== "unlocked" ? <p className="mb-2 text-footnote text-muted">Unlock encryption on this browser to open these.</p> : null}
      <ul className="divide-y divide-line overflow-hidden ui-card rounded-control">
        {rows.map((r) => (
          <li key={r.shareId}>
            <button type="button" disabled={state !== "unlocked"} onClick={() => setOpenId(r.shareId)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface disabled:opacity-60">
              <KeyRound size={16} aria-hidden className="mt-0.5 flex-none text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{titles[r.shareId] ?? (state === "unlocked" ? "…" : "Encrypted")}</span>
                <span className="block text-footnote text-faint">
                  Shared by {r.sharedBy} · {r.kind === "note" ? "Note" : (ITEM_KINDS[r.kind as ItemKind]?.label ?? r.kind)} · {r.canEdit ? "Can edit" : "Can view"}
                  {r.expiresAt ? ` · until ${formatDateTime(r.expiresAt)}` : ""} · updated {formatRelative(r.updatedAt)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {current ? <SharedItemDialog row={current} onClose={() => setOpenId(null)} /> : null}
    </section>
  );
}

function SharedItemDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const open = useMutation(api.vaultShares.openShared);
  const saveShared = useMutation(api.vaultShares.saveShared);
  const toast = useToast();
  const { profile } = useAppState();
  const [item, setItem] = useState<{ summary: Summary; secrets: unknown; revision: number; wrappedKey: ArrayBuffer } | null>(null);
  const [edited, setEdited] = useState<{ doc: unknown; text: string } | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  useEffect(() => {
    void open({ shareId: row.shareId })
      .then(async (r) => {
        const o = await openShared<Summary, unknown>({ vaultId: r.vaultId, id: r.id, wrappedKey: r.wrappedKey, sealedSummary: r.sealedSummary, sealed: r.sealed }, me());
        setItem({ summary: o.summary, secrets: o.secrets, revision: r.revision, wrappedKey: r.wrappedKey });
      })
      .catch((e) => toast.show(errorMessage(e), { tone: "error" }));
  }, [open, row.shareId, toast]);

  const saveNote = async () => {
    if (!item || !edited || item.summary.kind !== "note") return;
    try {
      const summary = { ...item.summary, excerpt: edited.text.replace(/\s+/g, " ").trim().slice(0, 160) };
      const sealed = await sealShared({ vaultId: row.vaultId, id: row.itemId, wrappedKey: item.wrappedKey }, me(), summary, { doc: edited.doc });
      const r = await saveShared({ shareId: row.shareId, baseRevision: item.revision, ...sealed });
      setItem({ ...item, summary, secrets: { doc: edited.doc }, revision: r.revision });
      setEdited(null);
      toast.show("Saved");
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    }
  };

  const s = item?.summary;
  return (
    <Dialog
      open
      onClose={onClose}
      title={s?.title ?? "Opening…"}
      size={s?.kind === "note" ? "lg" : "md"}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          {s?.kind === "note" && row.canEdit ? (
            <Button variant="primary" disabled={!edited} onClick={() => void saveNote()}>
              Save
            </Button>
          ) : null}
        </>
      }
    >
      <div className="pb-2 text-subheadline">
        <p className="mb-3 text-footnote text-muted">Shared from a Vault by {row.sharedBy}. Opening it and any change is recorded in that Vault&apos;s log, with your name ({profile.displayName}).</p>
        {!item || !s ? (
          <div className="h-24 animate-pulse rounded-chip bg-surface motion-reduce:animate-none" aria-busy />
        ) : s.kind === "note" ? (
          <NoteEditor initial={(item.secrets as { doc?: unknown } | null)?.doc ?? null} editable={row.canEdit} onChange={(doc, text) => setEdited({ doc, text })} />
        ) : (
          <dl className="divide-y divide-line">
            {(ITEM_KINDS[s.kind]?.fields ?? []).map((f) => {
              const v = s.fields[f.key] ?? (item.secrets as ItemSecrets | null)?.fields[f.key];
              if (!v) return null;
              const hidden = f.type === "secret" && !revealed.has(f.key);
              return (
                <div key={f.key} className="flex items-center gap-3 py-2">
                  <dt className="w-32 flex-none text-footnote text-muted">{f.label}</dt>
                  <dd className={`min-w-0 flex-1 break-words text-ink ${f.type === "secret" || f.type === "totp" ? "font-mono" : ""}`}>{hidden ? "••••••••" : v}</dd>
                  {f.type === "secret" ? (
                    <Button size="sm" variant="quiet" onClick={() => setRevealed(new Set([...revealed, f.key]))} disabled={!hidden}>
                      Show
                    </Button>
                  ) : null}
                  <Button size="sm" variant="quiet" aria-label={`Copy ${f.label}`} title="Copy" onClick={() => void copySecret(v).then(() => toast.show(`${f.label} copied. The clipboard clears in 30 seconds.`))}>
                    <Copy size={13} aria-hidden />
                  </Button>
                </div>
              );
            })}
          </dl>
        )}
      </div>
    </Dialog>
  );
}
