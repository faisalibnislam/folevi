"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex/api";
import { formatBytes } from "@/lib/format";
import { DataTable, DocTitle, EmptyRow, LoadingRows, Mono, PageHeader, Pager, StatusBadge, Time, td, tdNum, th, thNum } from "./ui";

export function WorkspacesView() {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors.at(-1) ?? null;
  const page = useQuery(api.admin.listWorkspaces, { cursor });
  return (
    <>
      <DocTitle>Workspaces</DocTitle>
      <PageHeader title="Workspaces" description="All workspaces, newest first. Names identify records; opening one shows members, quotas and invites (and is recorded in the audit log). Document contents are never shown." />
      <div className="rounded-[12px] border border-line bg-raised">
        <DataTable caption="Workspaces, newest first" minWidth={820}>
          <thead>
            <tr>
              <th scope="col" className={th}>Name</th>
              <th scope="col" className={th}>ID</th>
              <th scope="col" className={th}>Kind</th>
              <th scope="col" className={th}>Status</th>
              <th scope="col" className={thNum}>Documents</th>
              <th scope="col" className={thNum}>Storage</th>
              <th scope="col" className={th}>Created</th>
            </tr>
          </thead>
          <tbody>
            {page === undefined ? (
              <LoadingRows colSpan={7} />
            ) : page.workspaces.length === 0 ? (
              <EmptyRow colSpan={7}>No workspaces yet.</EmptyRow>
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
                  <td className={td}>{w.kind === "personal" ? "Personal" : "Team"}</td>
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
            busy={page === undefined}
            onPrev={() => setCursors((c) => c.slice(0, -1))}
            onNext={() => page?.continueCursor && setCursors((c) => [...c, page.continueCursor])}
          />
        </div>
      </div>
    </>
  );
}
