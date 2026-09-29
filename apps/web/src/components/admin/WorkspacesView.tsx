"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convex/api";
import { formatBytes } from "@/lib/format";
import { useAuditedLoad } from "./useAuditedLoad";
import { DataTable, DocTitle, EmptyRow, ErrorNotice, LoadingRows, Mono, PageHeader, Pager, StatusBadge, Time, td, tdNum, th, thNum } from "./ui";

export function WorkspacesView() {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors.at(-1) ?? null;
  const list = useMutation(api.admin.listWorkspaces);
  // Listing names is an audited read (one audit entry per page view).
  const { data: page, error, loading, refresh } = useAuditedLoad(JSON.stringify([cursor]), (meta) => list({ cursor, ...meta }));
  return (
    <>
      <DocTitle>Workspaces</DocTitle>
      <PageHeader title="Workspaces" description="All workspaces, newest first. Names identify records; listing and opening them is recorded in the audit log. Document contents are never shown." />
      {error ? (
        <div className="mb-4">
          <ErrorNotice error={error} onRetry={() => void refresh()} />
        </div>
      ) : null}
      <div className="overflow-hidden ui-card rounded-[8px]">
        <DataTable caption="Workspaces, newest first" minWidth={820}>
          <thead>
            <tr>
              <th scope="col" className={th}>Name</th>
              <th scope="col" className={th}>ID</th>
              <th scope="col" className={th}>Status</th>
              <th scope="col" className={thNum}>Documents</th>
              <th scope="col" className={thNum}>Storage</th>
              <th scope="col" className={th}>Created</th>
            </tr>
          </thead>
          <tbody>
            {page === undefined ? (
              error ? (
                <EmptyRow colSpan={6}>Workspaces couldn’t be loaded.</EmptyRow>
              ) : (
                <LoadingRows colSpan={6} />
              )
            ) : page.workspaces.length === 0 ? (
              <EmptyRow colSpan={6}>No team workspaces yet.</EmptyRow>
            ) : (
              page.workspaces.map((w) => (
                <tr key={w.id} className="hover:bg-surface">
                  <td className={td}>
                    <Link href={`/admin/workspaces/${w.id}`} className="font-medium underline decoration-line-strong underline-offset-2 hover:decoration-ink">
                      {w.name}
                    </Link>
                  </td>
                  <td className={td}>
                    <Mono>{w.id}</Mono>
                  </td>
                  <td className={td}>
                    <StatusBadge status={w.status} />
                  </td>
                  <td className={tdNum}>{w.documentCount.toLocaleString()}</td>
                  <td className={tdNum}>{formatBytes(w.storageUsedBytes)}</td>
                  <td className={td}>
                    <Time ts={w.createdAt} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
        <div className="border-t border-line">
          <Pager
            page={cursors.length}
            hasPrev={cursors.length > 1}
            hasNext={Boolean(page?.continueCursor)}
            busy={loading}
            onPrev={() => setCursors((c) => c.slice(0, -1))}
            onNext={() => page?.continueCursor && setCursors((c) => [...c, page.continueCursor])}
          />
        </div>
      </div>
    </>
  );
}
