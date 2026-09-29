"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation } from "convex/react";
import { ArrowUpCircle } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Button } from "@/components/ui/Button";
import { formatBytes } from "@/lib/format";
import { PLAN_CATALOG, planName, type WorkspacePlanId } from "@/lib/plans";
import { useAdmin } from "./AdminApp";
import { rolesFor } from "./permissions";
import { WorkspacePlanDialog, shortDate, type WorkspacePlanTarget } from "./PlanDialog";
import { useAuditedLoad } from "./useAuditedLoad";
import { Badge, DataTable, DocTitle, EmptyRow, ErrorNotice, LoadingRows, Mono, PageHeader, Pager, StatusBadge, Time, recordLink, tableCard, td, tdMid, tdNum, th, thNum, trHover } from "./ui";

export function WorkspacesView() {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors.at(-1) ?? null;
  const list = useMutation(api.admin.listWorkspaces);
  // Listing names is an audited read (one audit entry per page view).
  const { data: page, error, loading, refresh } = useAuditedLoad(JSON.stringify([cursor]), (meta) => list({ cursor, ...meta }));
  const admin = useAdmin();
  const canSetPlans = admin.can("billing.manage");
  const [planFor, setPlanFor] = useState<WorkspacePlanTarget | null>(null);
  const cols = canSetPlans ? 8 : 7;
  return (
    <>
      <DocTitle>Workspaces</DocTitle>
      <PageHeader
        title="Workspaces"
        description={
          <>
            All workspaces, newest first. Names identify records; listing and opening them is recorded in the audit log. Document contents are never shown.
            {canSetPlans ? " Use Upgrade or Change plan on a row to set a workspace's plan by hand." : ` Setting plans: ${rolesFor("billing.manage")}`}
          </>
        }
      />
      {error ? (
        <div className="mb-4">
          <ErrorNotice error={error} onRetry={() => void refresh()} />
        </div>
      ) : null}
      <div className={tableCard}>
        <DataTable caption="Workspaces, newest first" minWidth={canSetPlans ? 1000 : 900}>
          <thead>
            <tr>
              <th scope="col" className={th}>Name</th>
              <th scope="col" className={th}>ID</th>
              <th scope="col" className={th}>Status</th>
              <th scope="col" className={th}>Plan</th>
              <th scope="col" className={thNum}>Documents</th>
              <th scope="col" className={thNum}>Storage</th>
              <th scope="col" className={th}>Created</th>
              {canSetPlans ? (
                <th scope="col" className={th}>
                  <span className="sr-only">Plan actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {page === undefined ? (
              error ? (
                <EmptyRow colSpan={cols}>Workspaces couldn’t be loaded.</EmptyRow>
              ) : (
                <LoadingRows colSpan={cols} />
              )
            ) : page.workspaces.length === 0 ? (
              <EmptyRow colSpan={cols}>No team workspaces yet.</EmptyRow>
            ) : (
              page.workspaces.map((w) => {
                const planId = w.planId as WorkspacePlanId;
                const onFree = planId === "workspace_free";
                const interval = PLAN_CATALOG[planId].interval;
                return (
                  <tr key={w.id} className={trHover}>
                    <td className={td}>
                      <Link href={`/admin/workspaces/${w.id}`} className={recordLink}>
                        {w.name}
                      </Link>
                    </td>
                    <td className={td}>
                      <Mono>{w.id}</Mono>
                    </td>
                    <td className={td}>
                      <StatusBadge status={w.status} />
                    </td>
                    <td className={td}>
                      <span className="flex flex-wrap items-center gap-1">
                        <Badge tone={onFree ? "neutral" : "strong"}>{planName(planId)}</Badge>
                        {w.stripeBilled ? <Badge tone="outline" title="Billed through Stripe">Stripe</Badge> : null}
                      </span>
                      {interval || w.planEndsAt ? (
                        <span className="mt-0.5 block text-[12px] text-muted">
                          {interval === "year" ? "Yearly" : interval === "month" ? "Monthly" : ""}
                          {w.planEndsAt ? `${interval ? " · " : ""}ends ${shortDate(w.planEndsAt)}` : ""}
                        </span>
                      ) : null}
                    </td>
                    <td className={tdNum}>{w.documentCount.toLocaleString()}</td>
                    <td className={tdNum}>{formatBytes(w.storageUsedBytes)}</td>
                    <td className={td}>
                      <Time ts={w.createdAt} />
                    </td>
                    {canSetPlans ? (
                      <td className={`${tdMid} text-right`}>
                        {w.status === "deleting" ? null : (
                          <Button
                            size="sm"
                            disabled={w.stripeBilled}
                            title={w.stripeBilled ? "Billed through Stripe. Change it in Stripe." : undefined}
                            onClick={() => setPlanFor({ workspaceId: w.id, name: w.name, planId, endsAt: w.planEndsAt })}
                          >
                            {onFree ? <ArrowUpCircle size={14} aria-hidden /> : null}
                            {onFree ? "Upgrade" : "Change plan"}
                            <span className="sr-only"> for {w.name}</span>
                          </Button>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })
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
      <WorkspacePlanDialog target={planFor} onClose={() => setPlanFor(null)} onDone={() => void refresh()} />
    </>
  );
}
