"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { useMutation } from "convex/react";
import { Search } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Button } from "@/components/ui/Button";
import { useAuditedLoad } from "./useAuditedLoad";
import { ROLE_LABEL } from "./permissions";
import { PlanBadge } from "./UserBillingPanel";
import type { PlanId } from "@/lib/plans";
import { Badge, DataTable, DocTitle, EmptyRow, ErrorNotice, LoadingRows, PageHeader, Pager, StatusBadge, Time, inputCls, selectCls, td, th } from "./ui";
import { Select } from "@/components/ui/Select";

const STATUSES = ["active", "suspended", "pending_deletion", "deleted"] as const;
type ProfileStatus = (typeof STATUSES)[number];
const asStatus = (s: string | null): ProfileStatus | undefined => (STATUSES as readonly string[]).includes(s ?? "") ? (s as ProfileStatus) : undefined;

export function VerificationBadges({ emailVerified, mfaVerified }: { emailVerified: boolean; mfaVerified: boolean }) {
  return (
    <>
      <Badge tone={emailVerified ? "success" : "warning"}>{emailVerified ? "Email verified" : "Email unverified"}</Badge>
      <Badge tone={mfaVerified ? "success" : "warning"}>{mfaVerified ? "TOTP on" : "No TOTP"}</Badge>
    </>
  );
}

export function UsersView() {
  const params = useSearchParams();
  const router = useRouter();
  const uid = useId();
  const searched = params.has("q");
  const q = params.get("q") ?? "";
  const status = asStatus(params.get("status"));
  const [draftQ, setDraftQ] = useState(q);
  const [draftStatus, setDraftStatus] = useState<string>(status ?? "");
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [nonce, setNonce] = useState(0);
  const cursor = cursors.at(-1) ?? null;
  const search = useMutation(api.admin.searchUsers);
  const key = searched ? JSON.stringify([q, status ?? "", cursor, nonce]) : null;
  const { data, error, loading, refresh } = useAuditedLoad(key, (meta) => search({ query: q, status, cursor, ...meta }));
  const emailMode = q.includes("@");

  return (
    <>
      <DocTitle>Users</DocTitle>
      <PageHeader title="Users" description="Find an account by exact email address, or browse newest first with an optional name filter. Every search is recorded in the audit log (the query itself is stored hashed)." />

      <form
        role="search"
        aria-label="Search users"
        className="mb-5 flex flex-wrap items-end gap-3 ui-card rounded-[8px] p-4"
        onSubmit={(e) => {
          e.preventDefault();
          const sp = new URLSearchParams();
          sp.set("q", draftQ.trim());
          if (draftStatus) sp.set("status", draftStatus);
          router.replace(`/admin/users?${sp.toString()}`);
          setCursors([null]);
          setNonce((x) => x + 1);
        }}
      >
        <div className="min-w-[260px] flex-[2] text-sm">
          <label htmlFor={`${uid}-q`} className="mb-1 block font-medium">
            Email or name
          </label>
          <input
            id={`${uid}-q`}
            type="search"
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
            placeholder="person@example.com or part of a name"
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${uid}-q-hint`}
            className={inputCls}
          />
        </div>
        <div className="min-w-[180px] flex-1 text-sm">
          <label htmlFor={`${uid}-status`} className="mb-1 block font-medium">
            Status
          </label>
          <Select id={`${uid}-status`} value={draftStatus} onChange={(e) => setDraftStatus(e.target.value)} className={selectCls}>
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === "pending_deletion" ? "Pending deletion" : s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="primary">
          <Search size={15} aria-hidden /> Search
        </Button>
        <p id={`${uid}-q-hint`} className="basis-full text-xs text-muted">
          An address containing “@” is matched exactly (status is ignored). Otherwise results are 50 accounts per page, newest first, filtered by name on each page — use Next to keep looking. Leave empty to browse.
        </p>
      </form>

      {error ? (
        <div className="mb-4">
          <ErrorNotice error={error} onRetry={() => void refresh()} />
        </div>
      ) : null}

      <div className="overflow-hidden ui-card rounded-[8px]">
        <DataTable caption={searched ? `Users matching “${q || "all"}”${status ? `, status ${status}` : ""}` : "Users"} minWidth={980}>
          <thead>
            <tr>
              <th scope="col" className={th}>Name</th>
              <th scope="col" className={th}>Email</th>
              <th scope="col" className={th}>Status</th>
              <th scope="col" className={th}>Verification</th>
              <th scope="col" className={th}>Plan</th>
              <th scope="col" className={th}>Platform role</th>
              <th scope="col" className={th}>Created</th>
              <th scope="col" className={th}>Last active</th>
            </tr>
          </thead>
          <tbody aria-busy={loading || undefined}>
            {!searched ? (
              <EmptyRow colSpan={8}>Search to see accounts. Nothing is loaded until you ask.</EmptyRow>
            ) : loading && !data ? (
              <LoadingRows colSpan={8} />
            ) : data && data.users.length === 0 ? (
              <EmptyRow colSpan={8}>{emailMode ? "No account uses that exact email address." : "No matching accounts on this page."}</EmptyRow>
            ) : (
              data?.users.map((u) => (
                <tr key={u.id} className="hover:bg-surface">
                  <td className={td}>
                    <Link href={`/admin/users/${u.id}`} className="font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink">
                      {u.displayName || "(no name)"}
                    </Link>
                  </td>
                  <td className={`${td} break-all`}>{u.email}</td>
                  <td className={td}>
                    <StatusBadge status={u.status} />
                  </td>
                  <td className={td}>
                    <span className="flex flex-wrap gap-1">
                      <VerificationBadges emailVerified={u.emailVerified} mfaVerified={u.mfaVerified} />
                    </span>
                  </td>
                  <td className={td}>
                    <span className="flex flex-wrap gap-1">
                      <PlanBadge plan={u.plan as PlanId} trialing={u.trialing} />
                      {u.ai && u.plan !== "pro" && !u.trialing ? <Badge tone="plum">AI</Badge> : null}
                    </span>
                  </td>
                  <td className={td}>{u.platformRole ? <Badge tone="plum">{ROLE_LABEL[u.platformRole]}</Badge> : <span className="text-muted">—</span>}</td>
                  <td className={td}>
                    <Time ts={u.createdAt} />
                  </td>
                  <td className={td}>
                    <Time ts={u.lastActiveAt} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
        {searched && !emailMode ? (
          <div className="border-t border-line">
            <Pager
              page={cursors.length}
              hasPrev={cursors.length > 1}
              hasNext={Boolean(data?.continueCursor)}
              busy={loading}
              onPrev={() => setCursors((c) => c.slice(0, -1))}
              onNext={() => data?.continueCursor && setCursors((c) => [...c, data.continueCursor])}
            />
          </div>
        ) : null}
      </div>
    </>
  );
}
