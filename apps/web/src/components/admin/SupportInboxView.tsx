"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { RotateCw, Search } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { useAuditedLoad } from "./useAuditedLoad";
import { Badge, DataTable, DocTitle, EmptyRow, ErrorNotice, LoadingRows, PageHeader, Pager, Time, inputCls, recordLink, selectCls, tableCard, td, th, trHover, type Tone } from "./ui";

export const SUPPORT_STATUSES = ["open", "pending", "closed"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const SUPPORT_STATUS_LABEL: Record<SupportStatus, string> = { open: "Open", pending: "Pending", closed: "Closed" };
const STATUS_TONE: Record<SupportStatus, Tone> = { open: "strong", pending: "outline", closed: "neutral" };
export const SOURCE_LABEL: Record<string, string> = { web_form: "Support page", in_app: "In the app", email: "Email" };

export function SupportStatusBadge({ status }: { status: string }) {
  const s = (SUPPORT_STATUSES as readonly string[]).includes(status) ? (status as SupportStatus) : "open";
  return <Badge tone={STATUS_TONE[s]}>{SUPPORT_STATUS_LABEL[s]}</Badge>;
}

const asStatus = (s: string | null): SupportStatus | undefined => ((SUPPORT_STATUSES as readonly string[]).includes(s ?? "") ? (s as SupportStatus) : undefined);

/**
 * The Support inbox: tickets by latest activity, filtered by status, or one ticket by number / all from an
 * exact address. Opening the list is an audited read (it shows who wrote in).
 */
export function SupportInboxView() {
  const params = useSearchParams();
  const router = useRouter();
  const uid = useId();
  const q = params.get("q") ?? "";
  const status = asStatus(params.get("status"));
  const [draftQ, setDraftQ] = useState(q);
  const [draftStatus, setDraftStatus] = useState<string>(status ?? "");
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [nonce, setNonce] = useState(0);
  const cursor = cursors.at(-1) ?? null;
  const list = useMutation(api.support.listTickets);
  const unread = useQuery(api.support.unreadCount, {});
  const key = JSON.stringify([q, status ?? "", cursor, nonce]);
  const { data, error, loading, refresh } = useAuditedLoad(key, (meta) => list({ search: q || undefined, status, cursor, ...meta }));

  const apply = (nextQ: string, nextStatus: string) => {
    const sp = new URLSearchParams();
    if (nextQ.trim()) sp.set("q", nextQ.trim());
    if (nextStatus) sp.set("status", nextStatus);
    router.replace(`/admin/support${sp.size ? `?${sp.toString()}` : ""}`);
    setCursors([null]);
    setNonce((x) => x + 1);
  };

  return (
    <>
      <DocTitle>Support</DocTitle>
      <PageHeader
        title="Support"
        description={
          <>
            Requests from the support page, the app and email to support@folevi.com, newest activity first. Opening this list or a ticket is recorded in the audit log.
            {unread ? ` ${unread} ${unread === 1 ? "ticket has" : "tickets have"} a message nobody has opened yet.` : ""}
          </>
        }
        actions={
          <Button size="sm" variant="quiet" onClick={() => void refresh()} disabled={loading} aria-label="Reload tickets (writes an audit entry)">
            <RotateCw size={14} aria-hidden className={loading ? "animate-spin" : ""} /> Reload
          </Button>
        }
      />

      <form
        role="search"
        aria-label="Search support tickets"
        className="mb-5 flex flex-wrap items-end gap-3 ui-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          apply(draftQ, draftStatus);
        }}
      >
        <div className="min-w-[240px] flex-[2] text-sm">
          <label htmlFor={`${uid}-q`} className="mb-1 block font-medium">
            Ticket number or email
          </label>
          <input id={`${uid}-q`} type="search" value={draftQ} onChange={(e) => setDraftQ(e.target.value)} placeholder="1042 or person@example.com" autoComplete="off" className={inputCls} />
        </div>
        <div className="text-sm">
          <label id={`${uid}-status-label`} htmlFor={`${uid}-status`} className="mb-1 block font-medium">
            Status
          </label>
          <Select id={`${uid}-status`} aria-labelledby={`${uid}-status-label`} value={draftStatus} onChange={(e) => setDraftStatus(e.target.value)} className={`${selectCls} w-44`}>
            <option value="">All statuses</option>
            {SUPPORT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {SUPPORT_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="primary">
          <Search size={14} aria-hidden /> Search
        </Button>
        {q || status ? (
          <Button
            variant="ghost"
            onClick={() => {
              setDraftQ("");
              setDraftStatus("");
              apply("", "");
            }}
          >
            Clear
          </Button>
        ) : null}
      </form>

      {error ? (
        <div className="mb-4">
          <ErrorNotice error={error} onRetry={() => void refresh()} />
        </div>
      ) : null}

      <div className={tableCard}>
        <DataTable caption={q ? `Support tickets matching ${q}` : status ? `${SUPPORT_STATUS_LABEL[status]} support tickets` : "Support tickets, newest activity first"} minWidth={920}>
          <thead>
            <tr>
              <th scope="col" className={th}>Ticket</th>
              <th scope="col" className={th}>Requester</th>
              <th scope="col" className={th}>Subject</th>
              <th scope="col" className={th}>Status</th>
              <th scope="col" className={th}>Came from</th>
              <th scope="col" className={th}>Assignee</th>
              <th scope="col" className={th}>Last activity</th>
            </tr>
          </thead>
          <tbody aria-busy={loading || undefined}>
            {!data ? (
              <LoadingRows colSpan={7} />
            ) : data.tickets.length === 0 ? (
              <EmptyRow colSpan={7}>{q ? "No tickets match that number or address." : status ? `No ${SUPPORT_STATUS_LABEL[status].toLowerCase()} tickets.` : "No support requests yet."}</EmptyRow>
            ) : (
              data.tickets.map((t) => (
                <tr key={t.number} className={trHover}>
                  <td className={td}>
                    <Link href={`/admin/support/${t.number}`} className={recordLink}>
                      #{t.number}
                    </Link>
                    {t.unread ? (
                      <div className="mt-1">
                        <Badge tone="strong">New</Badge>
                      </div>
                    ) : null}
                  </td>
                  <td className={td}>
                    <div className={t.unread ? "font-semibold text-heading" : "text-heading"}>{t.name}</div>
                    <div className="break-all text-xs text-muted">{t.email}</div>
                  </td>
                  <td className={`${td} max-w-[340px]`}>
                    <div className={`truncate ${t.unread ? "font-semibold text-heading" : ""}`} title={t.subject}>
                      {t.subject}
                    </div>
                    <div className="text-xs text-muted">{t.topicLabel}</div>
                  </td>
                  <td className={td}>
                    <SupportStatusBadge status={t.status} />
                  </td>
                  <td className={td}>
                    {SOURCE_LABEL[t.source] ?? t.source}
                    {t.signedIn ? <div className="text-xs text-muted">Signed in</div> : null}
                  </td>
                  <td className={td}>{t.assignee ? (t.assignedToMe ? "You" : t.assignee) : <span className="text-muted">Nobody</span>}</td>
                  <td className={td}>
                    <Time ts={t.lastMessageAt} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
        {!q ? (
          <Pager
            page={cursors.length}
            hasPrev={cursors.length > 1}
            hasNext={Boolean(data?.continueCursor)}
            busy={loading}
            onPrev={() => setCursors((c) => c.slice(0, -1))}
            onNext={() => data?.continueCursor && setCursors((c) => [...c, data.continueCursor])}
          />
        ) : null}
      </div>
    </>
  );
}
