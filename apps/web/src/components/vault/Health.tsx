"use client";
// Health (docs/VAULT_PLAN.md §4): weak, reused and breached passwords, and API keys or licences near their expiry.
// Worked out from what lists already carry: each summary's sealed health (strength and the breach check, made on the
// device when the item was saved) and the server's count of matching blind indexes. No item is opened for it.
import { useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { HeartPulse } from "lucide-react";
import { api } from "@/lib/convex/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { vaultSessions } from "@/lib/vault/keys";
import { ITEM_KINDS, openSummary, type ItemKind, type ItemSummary } from "@/lib/vault/items";

type Opened = { id: string; passwordMac: string | null; summary: ItemSummary & { kind: ItemKind } };
type Issue = "breached" | "reused" | "weak" | "expired" | "expiring" | "unchecked";

const DAY = 86_400_000;
const TEXT: Record<Issue, { title: string; body: string; tone: string }> = {
  breached: { title: "Found in a data breach", body: "This password is in Pwned Passwords. Change it wherever it's used.", tone: "text-danger" },
  reused: { title: "Used more than once", body: "The same password is on other items. If one leaks, the others go too.", tone: "text-warning" },
  weak: { title: "Weak", body: "Short or easy to guess. Generate a new one.", tone: "text-warning" },
  expired: { title: "Expired", body: "Its expiry date has passed.", tone: "text-danger" },
  expiring: { title: "Expires within 30 days", body: "Renew or replace it soon.", tone: "text-warning" },
  unchecked: { title: "Not checked yet", body: "Saved before Health existed, or the breach check couldn't reach the service. Edit and save it to check.", tone: "text-muted" },
};
const ORDER: Issue[] = ["breached", "expired", "reused", "weak", "expiring", "unchecked"];

/** An item's issues, from its summary and how many items share its password. */
export function issuesOf(o: Opened, reuse: Record<string, number>, now: number): Issue[] {
  const out: Issue[] = [];
  const h = o.summary.health;
  if (h?.breached === "breached") out.push("breached");
  if (o.passwordMac && (reuse[o.passwordMac] ?? 0) > 1) out.push("reused");
  if (h && h.strength <= 1) out.push("weak");
  const expires = o.summary.fields.expires ? Date.parse(o.summary.fields.expires) : NaN;
  if (!Number.isNaN(expires)) {
    if (expires < now) out.push("expired");
    else if (expires < now + 30 * DAY) out.push("expiring");
  }
  if (o.passwordMac && (!h || h.breached === "unknown")) out.push("unchecked");
  return out;
}

export function Health({ vaultId, onOpenItem }: { vaultId: string; onOpenItem: (id: string) => void }) {
  const data = useQuery(api.vaultItems.list, { vaultId, section: "passwords" });
  const reuse = useQuery(api.vaultItems.reuse, { vaultId });
  const [opened, setOpened] = useState<Opened[] | undefined>(undefined);
  useEffect(() => {
    if (!data) return;
    let gone = false;
    const keysOf = (v: number) => vaultSessions().keys(vaultId, v);
    void Promise.all(data.items.map(async (row) => ({ id: row.id, passwordMac: row.passwordMac, summary: await openSummary(vaultId, row, keysOf).catch(() => null) }))).then((r) => {
      if (!gone) setOpened(r.filter((o): o is Opened => o.summary !== null));
    });
    return () => {
      gone = true;
    };
  }, [data, vaultId]);

  const groups = useMemo(() => {
    if (!opened || !reuse) return undefined;
    const now = Date.now();
    const by = new Map<Issue, Opened[]>();
    for (const o of opened) for (const i of issuesOf(o, reuse, now)) by.set(i, [...(by.get(i) ?? []), o]);
    return ORDER.filter((i) => by.has(i)).map((i) => [i, by.get(i)!] as const);
  }, [opened, reuse]);

  if (!groups) return <div className="h-24 animate-pulse rounded-chip bg-surface motion-reduce:animate-none" aria-busy />;
  const serious = new Set(groups.filter(([i]) => i !== "unchecked").flatMap(([, items]) => items.map((o) => o.id))).size;
  return (
    <section aria-label="Health" className="max-w-3xl space-y-5">
      <p className="text-subheadline text-muted">
        {serious ? `${serious} ${serious === 1 ? "item needs" : "items need"} a look.` : "Nothing needs a look."} Checked on this device: only the first 5 characters of a password's SHA-1 ever leave it.
      </p>
      {!groups.length ? <EmptyState icon={HeartPulse} title="All healthy" body="No weak, reused or breached passwords, and nothing about to expire." /> : null}
      {groups.map(([issue, items]) => (
        <div key={issue}>
          <h3 className={`text-callout font-semibold ${TEXT[issue].tone}`}>
            {TEXT[issue].title} <span className="font-normal text-muted">({items.length})</span>
          </h3>
          <p className="mb-2 text-footnote text-muted">{TEXT[issue].body}</p>
          <ul className="divide-y divide-line overflow-hidden ui-card rounded-control">
            {items.map((o) => (
              <li key={o.id}>
                <button type="button" onClick={() => onOpenItem(o.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{o.summary.title}</span>
                    <span className="block truncate text-footnote text-muted">{[ITEM_KINDS[o.summary.kind]?.label, o.summary.fields.username || o.summary.fields.service || o.summary.fields.website, issue === "expired" || issue === "expiring" ? `expires ${o.summary.fields.expires}` : null].filter(Boolean).join(" · ")}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
