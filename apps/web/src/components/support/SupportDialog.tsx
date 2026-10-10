"use client";

import { useId, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ChevronDown, LifeBuoy } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { formatDateTime, formatRelative } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { errorMessage, useToast } from "@/components/ui/Toast";
import { SUPPORT_LIMITS, SUPPORT_MAILBOX } from "@/lib/support";
import { SupportForm } from "./SupportForm";

/** "Contact support" in the app: the support form, filed under the signed-in account by the server. */
export function SupportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile } = useAppState();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Contact support"
      description={<>A person on the Folevi team replies by email to your account&apos;s address, and the reply also shows in Help. You can also write to {SUPPORT_MAILBOX}.</>}
      size="md"
    >
      {open ? <SupportForm variant="app" account={{ name: profile.displayName, email: profile.email }} onCancel={onClose} /> : null}
    </Dialog>
  );
}

const STATUS_LABEL: Record<string, string> = { open: "Open", pending: "Replied", closed: "Closed" };
const STATUS_TONE: Record<string, string> = {
  open: "bg-[var(--glass-hover)] text-muted",
  pending: "bg-heading text-canvas",
  closed: "text-muted shadow-[inset_0_0_0_1px_var(--color-line-strong)]",
};

/**
 * Help → "Your support requests": the signed-in person's requests (filed from their account), with our
 * replies, and a box to answer. Internal staff notes never reach this list.
 */
export function SupportRequests({ onContact }: { onContact: () => void }) {
  const requests = useQuery(api.support.myRequests, {});
  const [openNumber, setOpenNumber] = useState<number | null>(null);
  if (requests === undefined) {
    return (
      <div aria-busy="true" className="h-16 animate-pulse rounded-[10px] bg-sunken">
        <span className="sr-only">Loading…</span>
      </div>
    );
  }
  if (requests.length === 0) {
    return (
      <div className="ui-card flex flex-wrap items-center gap-3 rounded-[10px] px-4 py-3.5">
        <LifeBuoy size={18} aria-hidden className="flex-none text-muted" />
        <p className="min-w-0 flex-1 text-sm text-muted">No support requests yet. Requests you send from here, and our replies, will show up in this list.</p>
        <Button size="sm" onClick={onContact}>
          Contact support
        </Button>
      </div>
    );
  }
  return (
    <ul className="space-y-2" aria-label="Your support requests">
      {requests.map((r) => {
        const expanded = openNumber === r.number;
        const replies = r.messages.filter((m) => m.from === "support").length;
        return (
          <li key={r.number} className="ui-card overflow-hidden rounded-[10px]">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={`support-${r.number}`}
              onClick={() => setOpenNumber(expanded ? null : r.number)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--glass-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-heading">
                  #{r.number} · {r.subject}
                </span>
                <span className="block truncate text-[12.5px] text-muted">
                  {r.topicLabel} · {replies === 0 ? "No reply yet" : replies === 1 ? "1 reply" : `${replies} replies`} · {formatRelative(r.lastMessageAt)}
                </span>
              </span>
              <span className={`flex-none rounded-[6px] px-2 py-px text-[11.5px] font-semibold leading-[18px] ${STATUS_TONE[r.status] ?? STATUS_TONE.open}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
              <ChevronDown size={15} aria-hidden className={`flex-none text-muted transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>
            {expanded ? (
              <div id={`support-${r.number}`} className="border-t border-line px-4 pb-4 pt-3">
                <ol className="space-y-3" aria-label={`Messages in request ${r.number}`}>
                  {r.messages.map((m) => (
                    <li key={m.id} className={`rounded-[10px] px-3 py-2.5 ${m.from === "support" ? "bg-[var(--glass-hover)]" : "shadow-[inset_0_0_0_1px_var(--color-line)]"}`}>
                      <p className="text-[12px] text-muted">
                        <span className="font-semibold text-heading">{m.from === "support" ? "Folevi support" : "You"}</span> ·{" "}
                        <time dateTime={new Date(m.createdAt).toISOString()} title={formatDateTime(m.createdAt)}>
                          {formatRelative(m.createdAt)}
                        </time>
                      </p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">{m.body}</p>
                    </li>
                  ))}
                </ol>
                <ReplyBox number={r.number} closed={r.status === "closed"} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function ReplyBox({ number, closed }: { number: number; closed: boolean }) {
  const reply = useMutation(api.support.replyToMyRequest);
  const toast = useToast();
  const uid = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        if (text.trim().length < 2) return setError("Write a reply first.");
        setBusy(true);
        setError(null);
        try {
          await reply({ number, message: text });
          setText("");
          toast.show(`Reply added to request #${number}`, { tone: "success" });
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor={`${uid}-reply`} className="mb-1 block text-[12.5px] font-medium text-heading">
        {closed ? "Reply (this reopens the request)" : "Reply"}
      </label>
      <textarea
        id={`${uid}-reply`}
        value={text}
        rows={3}
        maxLength={SUPPORT_LIMITS.message + 200}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${uid}-error` : undefined}
        className="ui-input w-full resize-y rounded-[6px] px-3 py-2 text-sm text-ink"
      />
      {error ? (
        <p id={`${uid}-error`} role="alert" className="mt-1 text-[12.5px] text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex justify-end">
        <Button type="submit" size="sm" variant="primary" aria-busy={busy || undefined} disabled={busy}>
          {busy ? "Sending…" : "Send reply"}
        </Button>
      </div>
    </form>
  );
}
