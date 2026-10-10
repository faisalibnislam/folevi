"use client";

import Link from "next/link";
import { Fragment, useId, useState } from "react";
import { useQuery } from "convex/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Button } from "@/components/ui/Button";
import { formatDateTime } from "@/lib/format";
import { useAdmin } from "./AdminApp";
import { ROLE_LABEL, type AdminRole } from "./permissions";
import { Badge, Callout, DataTable, DocTitle, EmptyRow, LoadingRows, Mono, PageHeader, ShortId, Pager, Time, inputCls, selectCls, td, th } from "./ui";
import { Select } from "@/components/ui/Select";

const TARGET_TYPES = ["profile", "workspace", "users", "email_attempts", "email_attempt", "flag", "setting", "rate_limit", "template"];

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/** Flattens nested values into dotted paths so before/after can be compared line by line. */
function flatten(value: unknown, prefix = "", out: Map<string, string> = new Map()): Map<string, string> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0 && prefix) out.set(prefix, "{}");
    for (const [k, v] of entries) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (prefix || value !== null) {
    out.set(prefix || "(value)", JSON.stringify(value as Json));
  }
  return out;
}

function Diff({ before, after }: { before: unknown; after: unknown }) {
  const b = flatten(before ?? null);
  const a = flatten(after ?? null);
  const keys = [...new Set([...b.keys(), ...a.keys()])].sort();
  if (keys.length === 0) return <p className="text-[13px] text-muted">This entry records no before/after state (for example a view or search).</p>;
  return (
    <table className="w-full border-collapse font-mono text-[12px]">
      <caption className="sr-only">Changed fields</caption>
      <thead>
        <tr>
          <th scope="col" className="border-b border-line py-1 pr-4 text-left font-sans font-medium text-muted">
            Field
          </th>
          <th scope="col" className="border-b border-line py-1 pr-4 text-left font-sans font-medium text-muted">
            Before
          </th>
          <th scope="col" className="border-b border-line py-1 text-left font-sans font-medium text-muted">
            After
          </th>
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => {
          const bv = b.get(k);
          const av = a.get(k);
          const changed = bv !== av;
          return (
            <tr key={k}>
              <th scope="row" className="py-1 pr-4 text-left align-top font-normal">
                {k}
                {changed ? <span className="sr-only"> (changed)</span> : null}
              </th>
              <td className={`py-1 pr-4 align-top ${changed ? "text-danger line-through decoration-danger/40" : "text-muted"}`}>{bv ?? "Not set"}</td>
              <td className={`py-1 align-top ${changed ? "font-semibold text-success" : "text-muted"}`}>{av ?? "Not set"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function AuditView() {
  const admin = useAdmin();
  const uid = useId();
  const [draftType, setDraftType] = useState("");
  const [draftId, setDraftId] = useState("");
  const [filter, setFilter] = useState<{ targetType: string; targetId: string } | null>(null);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [filterError, setFilterError] = useState<string | null>(null);
  const cursor = cursors.at(-1) ?? null;
  const page = useQuery(api.admin.auditLog, filter ? { ...filter, cursor } : { cursor });
  const seesAll = admin.can("audit.viewAll");

  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <DocTitle>Audit log</DocTitle>
      <PageHeader
        title="Audit log"
        description="Append-only record of every admin view and change. Entries can't be edited or deleted by anyone, including owners."
      />
      {!seesAll ? (
        <div className="mb-4">
          <Callout>You see your own actions. Filter by a specific target to see everyone&apos;s actions on it. Owners see the full log.</Callout>
        </div>
      ) : null}

      <form
        className="mb-4 flex flex-wrap items-end gap-3 ui-card p-4"
        aria-label="Filter audit log"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (draftType && !draftId.trim()) {
            setFilterError("Enter the target ID to filter by target.");
            document.getElementById(`${uid}-id`)?.focus();
            return;
          }
          setFilterError(null);
          setFilter(draftType && draftId.trim() ? { targetType: draftType, targetId: draftId.trim() } : null);
          setCursors([null]);
          setOpen(new Set());
        }}
      >
        <div className="text-sm">
          <label htmlFor={`${uid}-type`} className="mb-1 block font-medium">
            Target type
          </label>
          <Select id={`${uid}-type`} value={draftType} onChange={(e) => setDraftType(e.target.value)} className={`${selectCls} w-48`}>
            <option value="">Any target</option>
            {TARGET_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-[260px] flex-1 text-sm">
          <label htmlFor={`${uid}-id`} className="mb-1 block font-medium">
            Target ID
          </label>
          <input
            id={`${uid}-id`}
            value={draftId}
            onChange={(e) => setDraftId(e.target.value)}
            placeholder="e.g. a user ID from a user's page"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={filterError ? true : undefined}
            aria-describedby={filterError ? `${uid}-id-error` : undefined}
            className={inputCls}
          />
          {filterError ? (
            <p id={`${uid}-id-error`} className="mt-1 text-xs font-medium text-danger">
              {filterError}
            </p>
          ) : null}
        </div>
        <Button type="submit" variant="primary">
          Apply
        </Button>
        {filter ? (
          <Button
            onClick={() => {
              setFilter(null);
              setDraftType("");
              setDraftId("");
              setCursors([null]);
            }}
          >
            Clear
          </Button>
        ) : null}
      </form>

      <div className="overflow-hidden ui-card">
        <DataTable caption={filter ? `Audit entries for ${filter.targetType} ${filter.targetId}` : "Audit entries, newest first"} minWidth={1100}>
          <thead>
            <tr>
              <th scope="col" className={`${th} w-8`}>
                <span className="sr-only">Details</span>
              </th>
              <th scope="col" className={th}>Time</th>
              <th scope="col" className={th}>Actor</th>
              <th scope="col" className={th}>Action</th>
              <th scope="col" className={th}>Target</th>
              <th scope="col" className={th}>Reason</th>
              <th scope="col" className={th}>Request ID</th>
            </tr>
          </thead>
          <tbody>
            {page === undefined ? (
              <LoadingRows colSpan={7} />
            ) : page.entries.length === 0 ? (
              <EmptyRow colSpan={7}>No audit entries{filter ? " for this target" : ""}.</EmptyRow>
            ) : (
              page.entries.map((e) => {
                const expanded = open.has(e.id);
                const detailId = `${uid}-d-${e.id}`;
                return (
                  <Fragment key={e.id}>
                    <tr className={expanded ? "bg-[var(--glass-hover)]" : "transition-colors hover:bg-[var(--glass-hover)]"}>
                      <td className={td}>
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-controls={detailId}
                          aria-label={`${expanded ? "Hide" : "Show"} details for ${e.action} at ${formatDateTime(e.createdAt)}`}
                          onClick={() => toggle(e.id)}
                          className="grid h-6 w-6 place-items-center rounded-chip text-muted hover:bg-[var(--glass-hover)] hover:text-heading"
                        >
                          {expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                        </button>
                      </td>
                      <td className={td}>
                        <Time ts={e.createdAt} />
                      </td>
                      <td className={td}>
                        <span className="font-medium">{e.actor}</span>
                        <div className="mt-0.5">
                          <Badge tone="outline">{ROLE_LABEL[e.actorRole as AdminRole] ?? e.actorRole}</Badge>
                        </div>
                      </td>
                      <td className={td}>
                        <Mono>{e.action}</Mono>
                      </td>
                      <td className={td}>
                        <span className="text-muted">{e.targetType}</span>{" "}
                        {e.targetType === "profile" && admin.can("users.view") ? (
                          <Link href={`/admin/users/${e.targetId}`} className="text-heading underline decoration-line-strong underline-offset-2 hover:decoration-heading">
                            <ShortId value={e.targetId} />
                          </Link>
                        ) : (
                          <ShortId value={e.targetId} />
                        )}
                      </td>
                      <td className={`${td} max-w-[280px]`}>{e.reason ?? <span className="text-muted">None</span>}</td>
                      <td className={td}>
                        <ShortId value={e.requestId} head={4} tail={6} />
                      </td>
                    </tr>
                    {expanded ? (
                      <tr id={detailId}>
                        <td className={td} />
                        <td colSpan={6} className={`${td} bg-surface`}>
                          <div className="grid gap-3 py-1 lg:grid-cols-[2fr_1fr]">
                            <Diff before={e.before} after={e.after} />
                            <div className="text-[12px] text-muted">
                              <p>Recorded {formatDateTime(e.createdAt)}</p>
                              <p className="mt-1">
                                Request <Mono wrap>{e.requestId}</Mono>
                              </p>
                              <p className="mt-1">
                                Target <Mono wrap>{e.targetId}</Mono>
                              </p>
                              <p className="mt-1">
                                Entry <Mono wrap>{e.id}</Mono>
                              </p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
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
            busy={page === undefined}
            onPrev={() => setCursors((c) => c.slice(0, -1))}
            onNext={() => page?.continueCursor && setCursors((c) => [...c, page.continueCursor])}
          />
        </div>
      </div>
    </>
  );
}
