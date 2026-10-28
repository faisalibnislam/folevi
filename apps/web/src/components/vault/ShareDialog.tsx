"use client";
// Sharing one password item (docs/VAULT_PLAN.md §6): with a person (their account key, checked against their signed
// statement, gets the item key; someone outside the workspace gets an end date), or by a one-time link (its key only
// in the link's fragment). Ending a share gives the item a new key, so what they may have kept stops opening it.
import { useMutation, useQuery } from "convex/react";
import { useId, useState } from "react";
import { Copy, Link2, UserPlus, X } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/format";
import { vaultSessions } from "@/lib/vault/keys";
import { newItemId } from "@/lib/vault/items";
import { checkedRecipient, makeLink, sealItemTo } from "@/lib/vault/shares";
import { useBackendMode } from "@/lib/mode";
import { SignInToCollaborate } from "@/components/app/SignInToCollaborate";

/** Sharing needs an account: a library's Vault (no account) shows the one "Sign in to share" note instead. */
export function ShareDialog(props: Parameters<typeof AccountShareDialog>[0]) {
  const local = useBackendMode() === "local";
  if (!local) return <AccountShareDialog {...props} />;
  return (
    <Dialog open onClose={props.onClose} title={`Share ${props.title}`} size="md" footer={<Button onClick={props.onClose}>Done</Button>}>
      <SignInToCollaborate variant="panel" className="pb-2" />
    </Dialog>
  );
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
type Row = { id: string; keyVersion: number; wrappedKey: ArrayBuffer };

/**
 * `rekey` saves the item again under a new item key (after a share ends). `allowEdit`: a note, which can be shared to
 * edit.
 */
function AccountShareDialog({ vaultId, row, title, allowEdit = false, rekey, onClose }: { vaultId: string; row: Row; title: string; allowEdit?: boolean; rekey: () => Promise<void>; onClose: () => void }) {
  const shares = useQuery(api.vaultShares.ofItem, { vaultId, itemId: row.id });
  const findPerson = useMutation(api.vaultShares.findPerson);
  const share = useMutation(api.vaultShares.share);
  const unshare = useMutation(api.vaultShares.unshare);
  const createLink = useMutation(api.vaultShares.createLink);
  const revokeLink = useMutation(api.vaultShares.revokeLink);
  const toast = useToast();
  const uid = useId();
  const [email, setEmail] = useState("");
  const [days, setDays] = useState("30");
  const [canEdit, setCanEdit] = useState(false);
  const [views, setViews] = useState("1");
  const [lasts, setLasts] = useState(String(DAY));
  const [linkPassword, setLinkPassword] = useState("");
  const [made, setMade] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const s = vaultSessions();

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const shareWith = () =>
    run(async () => {
      const found = await findPerson({ vaultId, itemId: row.id, email });
      if (!found) return void toast.show("Nobody with that email can receive it yet. They need a Folevi account with encryption set up.", { tone: "error" });
      if (found.inVault) return void toast.show(`${found.name} is in the Vault already.`);
      const to = await checkedRecipient(found);
      if (!to) return void toast.show(`${found.name}'s encryption key couldn't be checked, so nothing was shared.`, { tone: "error" });
      const wrappedKey = await sealItemTo(vaultId, row, s.keys(vaultId, row.keyVersion), to);
      const r = await share({ vaultId, itemId: row.id, shareId: newItemId(), profileId: to.profileId, canEdit: allowEdit && canEdit, wrappedKey, epoch: to.epoch, ...(found.outside ? { expiresAt: Date.now() + Number(days) * DAY } : {}), client: s.info(vaultId) });
      setEmail("");
      toast.show(r.expiresAt ? `Shared with ${found.name} until ${formatDateTime(r.expiresAt)}` : `Shared with ${found.name}`, { tone: "success" });
    });

  const stop = (shareId: string, name: string) =>
    run(async () => {
      await unshare({ vaultId, shareId, client: s.info(vaultId) });
      // A new item key, so whatever they kept of the old one opens nothing saved from now on. Only when nobody else
      // holds the old one (another share, a live link): they'd be cut off too. The server stops serving it to them either way.
      const others = (shares?.people ?? []).filter((p) => p.id !== shareId && !p.expired).length + (shares?.links ?? []).filter((l) => !l.endedHow).length;
      if (!others) await rekey();
      toast.show(`Stopped sharing with ${name}`);
    });

  const makeOne = () =>
    run(async () => {
      const link = await makeLink(vaultId, row, s.keys(vaultId, row.keyVersion), window.location.origin);
      await createLink({ vaultId, itemId: row.id, linkId: link.linkId, wrappedKey: link.wrappedKey, maxViews: Number(views), expiresInMs: Number(lasts), ...(linkPassword ? { password: linkPassword } : {}), client: s.info(vaultId) });
      setMade(link.url);
      setLinkPassword("");
    });

  const people = shares?.people ?? [];
  const links = (shares?.links ?? []).filter((l) => !l.endedHow);

  return (
    <Dialog open onClose={onClose} title={`Share ${title}`} size="md" footer={<Button onClick={onClose}>Done</Button>}>
      <div className="space-y-6 pb-2 text-subheadline">
        <section aria-label="Share with a person" className="space-y-2">
          <h3 className="font-semibold text-heading">With a person</h3>
          <p className="text-footnote text-muted">They open just this item, from Shared with Me. Someone outside the workspace has it until the end date.</p>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (email.trim()) void shareWith();
            }}
          >
            <label htmlFor={`${uid}-email`} className="min-w-0 flex-1">
              <span className="mb-1 block text-footnote font-medium text-ink">Email</span>
              <input id={`${uid}-email`} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className="h-9 w-full ui-input rounded-chip px-3" />
            </label>
            <Select aria-label="If outside the workspace, for" value={days} onChange={(e) => setDays(e.target.value)} className="h-9 ui-input rounded-chip px-3">
              {[1, 7, 30, 90, 365].map((d) => (
                <option key={d} value={d}>
                  {d === 1 ? "1 day" : d === 365 ? "1 year" : `${d} days`} if outside
                </option>
              ))}
            </Select>
            {allowEdit ? (
              <Select aria-label="They can" value={canEdit ? "edit" : "view"} onChange={(e) => setCanEdit(e.target.value === "edit")} className="h-9 ui-input rounded-chip px-3">
                <option value="view">Can view</option>
                <option value="edit">Can edit</option>
              </Select>
            ) : null}
            <Button type="submit" variant="primary" disabled={busy || !email.trim()}>
              <UserPlus size={14} aria-hidden /> Share
            </Button>
          </form>
          {people.length ? (
            <ul className="divide-y divide-line overflow-hidden ui-card rounded-control">
              {people.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-subheadline font-medium text-ink">{p.name}</span>
                    <span className="block truncate text-footnote text-muted">{[p.email, p.canEdit ? "can edit" : null, p.expired ? "ended" : p.expiresAt ? `until ${formatDateTime(p.expiresAt)}` : "no end date"].filter(Boolean).join(" · ")}</span>
                  </span>
                  <Button size="sm" variant="quiet" className="text-danger" disabled={busy} onClick={() => void stop(p.id, p.name)}>
                    <X size={13} aria-hidden /> Stop
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section aria-label="One-time link" className="space-y-2">
          <h3 className="font-semibold text-heading">One-time link</h3>
          <p className="text-footnote text-muted">For someone without Folevi. The key is in the link itself, never on Folevi's servers. Each opening is logged, and it stops working once used up or expired.</p>
          <div className="flex flex-wrap items-end gap-2">
            <Select aria-label="Works" value={views} onChange={(e) => setViews(e.target.value)} className="h-9 ui-input rounded-chip px-3">
              {[1, 2, 3, 5, 10].map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? "Works once" : `Works ${n} times`}
                </option>
              ))}
            </Select>
            <Select aria-label="Lasts" value={lasts} onChange={(e) => setLasts(e.target.value)} className="h-9 ui-input rounded-chip px-3">
              {[
                [HOUR, "for 1 hour"],
                [DAY, "for 1 day"],
                [7 * DAY, "for 7 days"],
                [30 * DAY, "for 30 days"],
              ].map(([ms, label]) => (
                <option key={ms} value={ms}>
                  {label}
                </option>
              ))}
            </Select>
            <label htmlFor={`${uid}-linkpw`} className="min-w-0 flex-1">
              <span className="mb-1 block text-footnote font-medium text-ink">Password (optional)</span>
              <input id={`${uid}-linkpw`} type="text" autoComplete="off" spellCheck={false} value={linkPassword} onChange={(e) => setLinkPassword(e.target.value)} className="h-9 w-full ui-input rounded-chip px-3" />
            </label>
            <Button variant="secondary" disabled={busy || (linkPassword.length > 0 && linkPassword.length < 5)} onClick={() => void makeOne()}>
              <Link2 size={14} aria-hidden /> Make link
            </Button>
          </div>
          {made ? (
            <div className="flex items-center gap-2 rounded-chip border border-line p-2">
              <input aria-label="Link to send" readOnly value={made} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 bg-transparent font-mono text-footnote text-ink outline-none" />
              <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard.writeText(made).then(() => toast.show("Link copied. It's shown only now."))}>
                <Copy size={13} aria-hidden /> Copy
              </Button>
            </div>
          ) : null}
          {links.length ? (
            <ul className="divide-y divide-line overflow-hidden ui-card rounded-control">
              {links.map((l) => (
                <li key={l.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 text-footnote text-muted">
                    Opened {l.views} of {l.maxViews} · until {formatDateTime(l.expiresAt)}
                    {l.hasPassword ? " · password" : ""}
                  </span>
                  <Button size="sm" variant="quiet" className="text-danger" disabled={busy} onClick={() => void run(async () => (await revokeLink({ vaultId, linkId: l.id, client: s.info(vaultId) }), toast.show("Link ended")))}>
                    End
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </Dialog>
  );
}
