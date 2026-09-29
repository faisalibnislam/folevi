"use client";

import { useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Info, RotateCw, Send } from "lucide-react";
import { api } from "@/lib/convex/api";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { ActionDialog } from "./ActionDialog";
import { useAdmin } from "./AdminApp";
import { rolesFor } from "./permissions";
import { useAuditedLoad } from "./useAuditedLoad";
import { Badge, Callout, DataTable, DocTitle, EmptyRow, ErrorNotice, LoadingRows, Mono, PageHeader, ShortId, StatusBadge, Time, humanize, selectCls, td, tdNum, th, thNum } from "./ui";
import { Select } from "@/components/ui/Select";

const STATUSES = ["queued", "accepted", "failed", "skipped"] as const;
type EmailStatus = (typeof STATUSES)[number];
type Attempt = FunctionReturnType<typeof api.admin.listEmails>["attempts"][number];

/** `loops` only labels historical rows sent before the move to Mailtrap; nothing sends through it any more. */
const PROVIDER_LABELS: Record<string, string> = { mailtrap: "Mailtrap", mailtrap_sandbox: "Mailtrap sandbox", loops: "Loops (legacy)" };
const DELIVERY_LABELS: Record<string, string> = {
  delivered: "Delivered",
  soft_bounced: "Soft bounce",
  bounced: "Bounced",
  spam_complaint: "Spam complaint",
  rejected: "Rejected",
  suspended: "Suspended",
};

function deliveryTone(status: string): "success" | "danger" | "neutral" {
  if (status === "delivered") return "success";
  if (/bounce|complain|spam|reject|suspend|fail/i.test(status)) return status === "soft_bounced" ? "neutral" : "danger";
  return "neutral";
}

export function EmailsView() {
  const admin = useAdmin();
  const uid = useId();
  const params = useSearchParams();
  const [status, setStatus] = useState<EmailStatus | "">(() => {
    const s = params.get("status");
    return (STATUSES as readonly string[]).includes(s ?? "") ? (s as EmailStatus) : "";
  });
  const list = useMutation(api.admin.listEmails);
  const resend = useMutation(api.admin.resendEmail);
  const { data, error, loading, refresh } = useAuditedLoad(status || "all", (meta) => list({ status: status || undefined, ...meta }));
  const [target, setTarget] = useState<Attempt | null>(null);
  const canResend = admin.can("emails.resend");

  return (
    <>
      <DocTitle>Emails</DocTitle>
      <PageHeader
        title="Emails"
        description="The 100 most recent transactional send attempts. Opening this log is recorded in the audit log. Recipient addresses are shown only as hints."
        actions={
          <Button size="sm" variant="quiet" onClick={() => void refresh()} disabled={loading}>
            <RotateCw size={14} aria-hidden className={loading ? "animate-spin" : ""} /> Reload
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 xl:grid-cols-[3fr_2fr]">
        <Callout icon={<Info size={16} aria-hidden className="mt-0.5 flex-none text-muted" />} title="What “accepted” means">
          <p>
            <strong>Accepted</strong> means the email provider accepted the message for sending; it does <strong>not</strong> mean delivered. Delivery, bounce and complaint states appear only
            when the signed provider webhook is configured, and only for events whose signature was verified.
          </p>
          <p className="mt-1.5">
            Addresses that hard-bounce, complain or unsubscribe stop getting product email (<Mono>recipient_suppressed</Mono>); security and sign-in email still goes. To look deeper, open
            Mailtrap → <strong>Email Logs</strong> and search by message id.
          </p>
        </Callout>
        {data ? (
          data.activeProvider === "none" ? (
            <Callout tone="warning" title="No email provider configured">
              Nothing can be sent from this environment. Set <Mono>MAILTRAP_API_TOKEN</Mono> (or the sandbox pair outside production) on the Convex deployment. See docs/EMAIL_OPERATIONS.md.
            </Callout>
          ) : data.webhooksConfigured ? (
            <Callout title={`Sending through ${PROVIDER_LABELS[data.activeProvider] ?? data.activeProvider}; webhook configured`}>
              Delivery events from signature-verified webhooks are shown per attempt below. Each event is matched to one send: by the provider message id, otherwise by the attempt id the email
              carries.
            </Callout>
          ) : (
            <Callout tone="warning" title="Delivery webhook not configured">
              Sending through {PROVIDER_LABELS[data.activeProvider] ?? data.activeProvider}, but no delivery, bounce or complaint information is available. Set{" "}
              <Mono>MAILTRAP_WEBHOOK_SECRET</Mono> and create the webhook in Mailtrap (see docs/EMAIL_OPERATIONS.md).
            </Callout>
          )
        ) : null}
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="text-sm">
          <label htmlFor={`${uid}-status`} className="mb-1 block font-medium">
            Status
          </label>
          <Select id={`${uid}-status`} value={status} onChange={(e) => setStatus(e.target.value as EmailStatus | "")} className={`${selectCls} w-48`}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
        </div>
        {!canResend ? <p className="pb-2 text-xs text-muted">Resending: {rolesFor("emails.resend")}</p> : null}
      </div>

      {error ? (
        <div className="mb-4">
          <ErrorNotice error={error} onRetry={() => void refresh()} />
        </div>
      ) : null}

      <div className="overflow-hidden ui-card">
        <DataTable caption={`Email send attempts${status ? `, status ${status}` : ""}`} minWidth={1040}>
          <thead>
            <tr>
              <th scope="col" className={th}>Template</th>
              <th scope="col" className={th}>Recipient</th>
              <th scope="col" className={th}>Status</th>
              <th scope="col" className={thNum}>Attempts</th>
              <th scope="col" className={th}>Error</th>
              <th scope="col" className={th}>Delivery</th>
              <th scope="col" className={th}>Request · env</th>
              <th scope="col" className={th}>Time</th>
              <th scope="col" className={th}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody aria-busy={loading || undefined}>
            {!data ? (
              <LoadingRows colSpan={9} />
            ) : data.attempts.length === 0 ? (
              <EmptyRow colSpan={9}>No send attempts{status ? ` with status “${status}”` : ""}.</EmptyRow>
            ) : (
              data.attempts.map((a) => {
                const identity = a.category === "identity";
                return (
                  <tr key={a.id}>
                    <td className={td}>
                      <Mono>{a.templateKey}</Mono>
                      <div className="mt-0.5 text-xs text-muted">{humanize(a.category)}</div>
                    </td>
                    <td className={td}>
                      <Mono>{a.recipientHint}</Mono>
                    </td>
                    <td className={td}>
                      <StatusBadge status={a.status} />
                      {a.provider ? <div className="mt-0.5 text-xs text-muted">{PROVIDER_LABELS[a.provider] ?? a.provider}</div> : null}
                    </td>
                    <td className={tdNum}>{a.attempts}</td>
                    <td className={td}>
                      {a.errorCode ? <Mono>{a.errorCode}</Mono> : <span className="text-muted">None</span>}
                      {a.httpStatus ? <div className="mt-0.5 text-xs text-muted">HTTP {a.httpStatus}</div> : null}
                      {a.providerError ? <div className="mt-0.5 max-w-[280px] text-xs text-muted">{a.providerError}</div> : null}
                    </td>
                    <td className={td}>
                      {a.deliveryStatus ? (
                        <div className="mb-1">
                          <Badge tone={deliveryTone(a.deliveryStatus)}>{DELIVERY_LABELS[a.deliveryStatus] ?? humanize(a.deliveryStatus)}</Badge>
                        </div>
                      ) : null}
                      {a.providerEvents.length ? (
                        <span className="flex flex-wrap gap-1">
                          {a.providerEvents.map((e) => (
                            <Badge
                              key={`${e.eventName}-${e.eventTime}`}
                              title={formatDateTime(e.eventTime)}
                              tone={deliveryTone(e.eventName.replace(/^email\./, ""))}
                            >
                              {humanize(e.eventName.replace(/^email\./, ""))}
                            </Badge>
                          ))}
                        </span>
                      ) : (
                        <span className="text-muted" title={data.webhooksConfigured ? "No verified provider events" : "Webhook not configured"}>
                          None
                        </span>
                      )}
                    </td>
                    <td className={td}>
                      <ShortId value={a.requestId} head={4} tail={6} />
                      <div className="mt-0.5 text-xs text-muted">
                        {a.environment}
                        {a.hasProviderId ? " · provider id" : ""}
                      </div>
                    </td>
                    <td className={td}>
                      <Time ts={a.createdAt} />
                    </td>
                    <td className={`${td} text-right`}>
                      {a.status === "failed" && canResend ? (
                        identity ? (
                          <span className="text-xs text-muted" title="Identity emails carry one-time links. Use “Resend verification” or a user-requested password reset on the user's page.">
                            Use user page
                          </span>
                        ) : (
                          <Button size="sm" onClick={() => setTarget(a)} aria-label={`Resend ${a.templateKey} to ${a.recipientHint}`}>
                            <Send size={13} aria-hidden /> Resend
                          </Button>
                        )
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </DataTable>
      </div>

      <ActionDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        title="Resend this email?"
        description={
          target ? (
            <>
              Replays <Mono>{target.templateKey}</Mono> to <Mono>{target.recipientHint}</Mono> with its original variables. Only notices without one-time links or user content can be
              replayed; the server explains if this one can't.
            </>
          ) : null
        }
        confirmLabel="Resend"
        onSubmit={async ({ reason, meta }) => {
          if (!target) return "Nothing to resend";
          await resend({ attemptId: target.id, reason, ...meta });
          void refresh();
          return "Resend queued. Check the log for the new attempt.";
        }}
      />
    </>
  );
}
