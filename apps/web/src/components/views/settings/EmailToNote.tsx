"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Copy, Mail } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatRelative } from "@/lib/format";
import { Card } from "./Card";

/** What `emailNotes.status` returns for someone with an address. */
export type EmailNoteStatus = {
  address: string;
  place: { kind: "personal" } | { kind: "workspace"; workspaceId: string; name: string };
  ownAddress: string;
  extraSenders: string[];
  count: number;
  lastReceivedAt: number | null;
  rejectedCount: number;
  lastRejectedAt: number | null;
};

const MAX_EXTRA_SENDERS = 5;

type Handlers = {
  onCreate: () => Promise<unknown>;
  onRotate: () => Promise<unknown>;
  onRemove: () => Promise<unknown>;
  /** "personal" or a workspace id. */
  onSetPlace: (place: string) => Promise<unknown>;
  onAddSender: (email: string) => Promise<unknown>;
  onRemoveSender: (email: string) => Promise<unknown>;
  onCopy: (address: string) => void;
};

/**
 * Settings > Import & export: the person's private email-to-note address (convex/emailNotes.ts). The view
 * is separate from the data so it can be tested; EmailToNoteCard wires it up.
 */
export function EmailToNoteView({ status, places, ...on }: { status: EmailNoteStatus | null | undefined; places: { id: string; name: string }[] } & Handlers) {
  const [confirming, setConfirming] = useState<"rotate" | "remove" | null>(null);
  const [sender, setSender] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (p: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await p();
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Email to Folevi" description="Send or forward email to this address and it becomes a note in your Inbox.">
      {status === undefined ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : status === null ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">Only email from your own address is saved. Mail from anyone else is ignored.</p>
          <Button variant="primary" disabled={busy} onClick={() => void run(on.onCreate)}>
            <Mail size={14} aria-hidden /> Create my address
          </Button>
        </div>
      ) : (
        <div className="space-y-5 text-sm">
          <div>
            <span className="block font-medium text-heading" id="email-note-address">
              Your address
            </span>
            <div className="mt-1 flex max-w-xl gap-2">
              <input readOnly value={status.address} aria-labelledby="email-note-address" className="h-9 min-w-0 flex-1 ui-well rounded-chip px-3 font-mono text-[13px]" onFocus={(e) => e.target.select()} />
              <Button onClick={() => on.onCopy(status.address)}>
                <Copy size={13} aria-hidden /> Copy
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-muted">
              {status.lastReceivedAt ? `${status.count === 1 ? "1 note" : `${status.count} notes`} so far, the last ${formatRelative(status.lastReceivedAt)}.` : "No email has arrived yet."}
              {status.rejectedCount ? ` ${status.rejectedCount === 1 ? "1 email" : `${status.rejectedCount} emails`} from other senders ignored.` : ""}
            </p>
          </div>

          <label className="block max-w-xs space-y-1">
            <span className="block font-medium text-heading">Notes go to</span>
            <Select value={status.place.kind === "workspace" ? status.place.workspaceId : "personal"} onChange={(e) => void run(() => on.onSetPlace(e.target.value))} aria-label="Notes go to" className="ui-input h-9 rounded-chip px-3 text-sm w-full">
              <option value="personal">Personal</option>
              {places.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </label>

          <div>
            <span className="block font-medium text-heading">Who can send</span>
            <ul className="mt-1 max-w-xl divide-y divide-line/70" aria-label="Who can send">
              <li className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate">{status.ownAddress}</span>
                <span className="flex-none text-xs text-muted">Your account’s address</span>
              </li>
              {status.extraSenders.map((s) => (
                <li key={s} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate">{s}</span>
                  <Button size="sm" variant="quiet" className="flex-none text-danger" aria-label={`Remove ${s}`} disabled={busy} onClick={() => void run(() => on.onRemoveSender(s))}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            {status.extraSenders.length < MAX_EXTRA_SENDERS ? (
              <form
                className="mt-2 flex max-w-xl gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const email = sender.trim();
                  if (!email) return;
                  void run(() => on.onAddSender(email)).then((ok) => ok && setSender(""));
                }}
              >
                <input type="email" value={sender} onChange={(e) => setSender(e.target.value)} placeholder="Another address of yours" aria-label="Another address that can send" maxLength={254} className="ui-input h-9 min-w-0 flex-1 rounded-chip px-3" />
                <Button size="sm" type="submit" disabled={busy || !sender.trim()}>
                  Add
                </Button>
              </form>
            ) : (
              <p className="mt-2 text-xs text-muted">You can add up to {MAX_EXTRA_SENDERS} other addresses.</p>
            )}
            <p className="mt-1.5 text-xs text-muted">Email must come from one of these addresses, and your email provider must sign it (Gmail, Outlook and iCloud do).</p>
          </div>

          {confirming ? (
            <div className="max-w-xl rounded-chip border border-line p-3" role="group" aria-label={confirming === "rotate" ? "Get a new address" : "Turn off"}>
              <p>{confirming === "rotate" ? "Your current address stops working at once. Anything sent to it later is ignored." : "Your address stops working at once. Notes you already saved stay."}</p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={() => setConfirming(null)}>
                  Keep
                </Button>
                <Button
                  size="sm"
                  variant={confirming === "remove" ? "danger" : "primary"}
                  disabled={busy}
                  onClick={() => void run(confirming === "rotate" ? on.onRotate : on.onRemove).then((ok) => ok && setConfirming(null))}
                >
                  {confirming === "rotate" ? "Get a new address" : "Turn off"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setConfirming("rotate")}>
                Get a new address…
              </Button>
              <Button size="sm" variant="quiet" className="text-danger" onClick={() => setConfirming("remove")}>
                Turn off…
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function EmailToNoteCard() {
  const { workspaces } = useAppState();
  const status = useQuery(api.emailNotes.status, {});
  const create = useMutation(api.emailNotes.create);
  const rotate = useMutation(api.emailNotes.rotate);
  const remove = useMutation(api.emailNotes.remove);
  const setPlace = useMutation(api.emailNotes.setPlace);
  const addSender = useMutation(api.emailNotes.addSender);
  const removeSender = useMutation(api.emailNotes.removeSender);
  const toast = useToast();
  const places = workspaces.filter((w) => w.canEdit !== false).map((w) => ({ id: w.id, name: w.name }));
  const withToast = (done: string) => async (p: Promise<unknown>) => {
    try {
      await p;
      toast.show(done);
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
      throw e;
    }
  };
  return (
    <EmailToNoteView
      status={status}
      places={places}
      onCreate={() => withToast("Your address is ready")(create({}))}
      onRotate={() => withToast("You have a new address")(rotate({}))}
      onRemove={() => withToast("Email to Folevi is off")(remove({}))}
      onSetPlace={(place) => withToast("Saved")(setPlace({ scope: place === "personal" ? { kind: "personal" } : { kind: "workspace", workspaceId: place } }))}
      onAddSender={(email) => withToast("Address added")(addSender({ email }))}
      onRemoveSender={(email) => withToast("Address removed")(removeSender({ email }))}
      onCopy={(address) => void navigator.clipboard.writeText(address).then(() => toast.show("Address copied"))}
    />
  );
}
