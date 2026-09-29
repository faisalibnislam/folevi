"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { useMutation } from "convex/react";
import { Lock, Mail, RotateCw, UserCheck, UserMinus } from "lucide-react";
import { api } from "@/lib/convex/api";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { errorMessage, useToast } from "@/components/ui/Toast";
import { useAdmin } from "./AdminApp";
import { rolesFor } from "./permissions";
import { requestMeta } from "./request";
import { SOURCE_LABEL, SUPPORT_STATUSES, SUPPORT_STATUS_LABEL, SupportStatusBadge, type SupportStatus } from "./SupportInboxView";
import { useAuditedLoad } from "./useAuditedLoad";
import { Badge, Callout, DocTitle, ErrorNotice, KeyValues, PageHeader, Panel, Time, humanize, recordLink, selectCls } from "./ui";

const REPLY_MAX = 10000;

/** One support ticket: the thread (notes included), reply or note, status and assignment. Opening it is audited. */
export function SupportTicketView({ number }: { number: number }) {
  const admin = useAdmin();
  const toast = useToast();
  const uid = useId();
  const view = useMutation(api.support.viewTicket);
  const reply = useMutation(api.support.reply);
  const addNote = useMutation(api.support.addNote);
  const setStatus = useMutation(api.support.setStatus);
  const assign = useMutation(api.support.assign);
  const valid = Number.isSafeInteger(number) && number > 0;
  const { data: ticket, error, loading, refresh } = useAuditedLoad(valid ? String(number) : null, (meta) => view({ number, ...meta }));
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
  const [textError, setTextError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canReply = admin.can("support.reply");

  const run = async (what: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await what();
      toast.show(done, { tone: "success" });
      await refresh();
      return true;
    } catch (err) {
      toast.show(errorMessage(err), { tone: "error" });
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!valid) {
    return (
      <>
        <DocTitle>Ticket</DocTitle>
        <PageHeader title="Ticket not found" />
      </>
    );
  }
  if (error && !ticket) {
    return (
      <>
        <DocTitle>{`#${number}`}</DocTitle>
        <PageHeader title={`#${number}`} />
        <ErrorNotice error={error} onRetry={() => void refresh()} />
      </>
    );
  }
  if (!ticket) {
    return (
      <div aria-busy="true">
        <DocTitle>{`#${number}`}</DocTitle>
        <PageHeader title={<span className="text-muted">Loading ticket…</span>} />
      </div>
    );
  }

  const submit = async () => {
    const body = text.trim();
    if (body.length < 2) return setTextError(mode === "reply" ? "Write the reply first." : "Write the note first.");
    if (body.length > REPLY_MAX) return setTextError(`Keep it under ${REPLY_MAX} characters.`);
    setTextError(null);
    const meta = await requestMeta();
    const ok = await run(
      () => (mode === "reply" ? reply({ number, body, ...meta }) : addNote({ number, body, ...meta })),
      mode === "reply" ? `Reply sent to ${ticket.email}` : "Note added",
    );
    if (ok) setText("");
  };

  return (
    <>
      <DocTitle>{`#${ticket.number}`}</DocTitle>
      <PageHeader
        eyebrow={
          <>
            <SupportStatusBadge status={ticket.status} />
            <Badge>{ticket.topicLabel}</Badge>
            <Badge tone="outline">{ticket.sourceLabel}</Badge>
            {ticket.assignee ? <Badge>{ticket.assignedToMe ? "Assigned to you" : `Assigned to ${ticket.assignee.name}`}</Badge> : null}
          </>
        }
        title={
          <>
            <span className="text-muted">#{ticket.number}</span> {ticket.subject}
          </>
        }
        description={
          <>
            From {ticket.name} (<span className="break-all">{ticket.email}</span>), opened <Time ts={ticket.createdAt} />.
          </>
        }
        actions={
          <>
            <Button size="sm" variant="quiet" onClick={() => void refresh()} disabled={loading} aria-label="Reload ticket (writes an audit entry)">
              <RotateCw size={14} aria-hidden className={loading ? "animate-spin" : ""} /> Reload
            </Button>
            {ticket.assignedToMe ? (
              <Button size="sm" disabled={busy || !canReply} onClick={async () => void run(async () => assign({ number, to: "nobody", ...(await requestMeta()) }), "Unassigned")}>
                <UserMinus size={14} aria-hidden /> Unassign
              </Button>
            ) : (
              <Button size="sm" disabled={busy || !canReply} onClick={async () => void run(async () => assign({ number, to: "me", ...(await requestMeta()) }), "Assigned to you")}>
                <UserCheck size={14} aria-hidden /> Assign to me
              </Button>
            )}
            <div className="flex items-center gap-2 text-sm">
              <label id={`${uid}-status-label`} htmlFor={`${uid}-status`} className="font-medium">
                Status
              </label>
              <Select
                id={`${uid}-status`}
                aria-labelledby={`${uid}-status-label`}
                value={ticket.status}
                disabled={busy || !canReply}
                onChange={async (e) => {
                  const next = e.target.value as SupportStatus;
                  void run(async () => setStatus({ number, status: next, ...(await requestMeta()) }), `Marked ${SUPPORT_STATUS_LABEL[next].toLowerCase()}`);
                }}
                className={`${selectCls} h-8 w-32`}
              >
                {SUPPORT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {SUPPORT_STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </div>
          </>
        }
      />
      {error ? (
        <div className="mb-4">
          <ErrorNotice error={error} onRetry={() => void refresh()} />
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-4">
          <Panel title="Conversation" description="Replies are emailed to the requester (they answer to support@folevi.com) and appear in their app. Internal notes are for staff only.">
            <ol className="space-y-3" aria-label={`Messages in ticket ${ticket.number}`}>
              {ticket.messages.map((m) => (
                <li
                  key={m.id}
                  className={`rounded-[10px] px-4 py-3 ${
                    m.kind === "note" ? "bg-warning-soft" : m.kind === "staff" ? "bg-[var(--glass-hover)]" : "shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
                  }`}
                >
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
                    <span className="font-semibold text-heading">{m.author}</span>
                    {m.kind === "note" ? (
                      <Badge tone="warning">
                        <Lock size={11} aria-hidden /> Internal note
                      </Badge>
                    ) : m.kind === "staff" ? (
                      <Badge>Reply</Badge>
                    ) : (
                      <Badge tone="outline">Requester</Badge>
                    )}
                    {m.viaEmail ? (
                      <span className="inline-flex items-center gap-1">
                        <Mail size={12} aria-hidden /> by email
                      </span>
                    ) : null}
                    <time dateTime={new Date(m.createdAt).toISOString()}>{formatDateTime(m.createdAt)}</time>
                  </p>
                  <p className="mt-1.5 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-ink">{m.body}</p>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title={mode === "reply" ? "Reply" : "Internal note"}>
            {canReply ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!busy) void submit();
                }}
              >
                <div role="radiogroup" aria-label="Kind of message" className="ui-seg mb-3 w-fit bg-[var(--glass-hover)]">
                  {(["reply", "note"] as const).map((k) => (
                    <button key={k} type="button" role="radio" aria-checked={mode === k} data-active={mode === k} onClick={() => setMode(k)} className="whitespace-nowrap">
                      {k === "reply" ? "Reply to requester" : "Internal note"}
                    </button>
                  ))}
                </div>
                <label htmlFor={`${uid}-text`} className="sr-only">
                  {mode === "reply" ? "Reply" : "Internal note"}
                </label>
                <textarea
                  id={`${uid}-text`}
                  value={text}
                  rows={6}
                  maxLength={REPLY_MAX + 200}
                  onChange={(e) => {
                    setText(e.target.value);
                    setTextError(null);
                  }}
                  aria-invalid={textError ? true : undefined}
                  aria-describedby={`${uid}-hint${textError ? ` ${uid}-error` : ""}`}
                  placeholder={mode === "reply" ? `Write to ${ticket.name}…` : "Only staff can see notes."}
                  className="ui-input w-full resize-y rounded-[6px] px-3 py-2.5 text-[13.5px] leading-relaxed text-ink placeholder:text-faint aria-[invalid=true]:shadow-[0_0_0_1.5px_var(--color-destructive)]"
                />
                <p id={`${uid}-hint`} className="mt-1 text-[12.5px] text-muted">
                  {mode === "reply"
                    ? `Emailed to ${ticket.email} with “[Folevi #${ticket.number}]” in the subject, so their answer comes back here. The ticket becomes Pending.`
                    : "Never emailed and never shown to the requester."}
                </p>
                {textError ? (
                  <p id={`${uid}-error`} role="alert" className="mt-1 text-[12.5px] text-danger">
                    {textError}
                  </p>
                ) : null}
                <div className="mt-3 flex justify-end">
                  <Button type="submit" variant="primary" disabled={busy} aria-busy={busy || undefined}>
                    {busy ? "Saving…" : mode === "reply" ? "Send reply" : "Add note"}
                  </Button>
                </div>
              </form>
            ) : (
              <p className="text-sm text-muted">Replying: {rolesFor("support.reply")}</p>
            )}
          </Panel>
        </div>

        <div className="min-w-0 space-y-4">
          <Panel title="Requester">
            <KeyValues
              items={[
                { label: "Name", value: ticket.name },
                { label: "Email", value: <span className="break-all">{ticket.email}</span> },
                {
                  label: "Account",
                  value: ticket.account ? (
                    <>
                      <Link href={`/admin/users/${encodeURIComponent(ticket.account.id)}`} className={recordLink}>
                        {ticket.account.name || "Open account"}
                      </Link>
                      <div className="mt-0.5 text-xs text-muted">
                        {ticket.account.filedSignedIn ? "Sent while signed in to this account." : "An account uses this address. The request wasn't sent signed in, so the address isn't proven."}
                      </div>
                    </>
                  ) : (
                    <span className="text-muted">No account uses this address</span>
                  ),
                },
                { label: "Came from", value: SOURCE_LABEL[ticket.source] ?? ticket.sourceLabel },
                { label: "Opened", value: formatDateTime(ticket.createdAt) },
                { label: "Last activity", value: <Time ts={ticket.lastMessageAt} /> },
              ]}
            />
          </Panel>
          {ticket.source === "email" ? (
            <Callout title="From an email">
              The sender address of an email can be forged. Before changing anything on an account because of an email, confirm the request from the account&apos;s own address or while
              they&apos;re signed in.
            </Callout>
          ) : null}
          <Panel title="History" description="Audit entries for this ticket, newest first.">
            {ticket.history.length === 0 ? (
              <p className="text-sm text-muted">No entries yet.</p>
            ) : (
              <ul className="space-y-2 text-[13px]">
                {ticket.history.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-heading">{humanize(h.action.replace(/^support\./, ""))}</span>
                    <span className="text-muted">by {h.actor}</span>
                    <span className="text-muted">
                      <Time ts={h.createdAt} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
