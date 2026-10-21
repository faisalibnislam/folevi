"use client";

import { Check, Eye, LockKeyhole, Minus, ToggleRight } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { copy } from "@/lib/e2ee/copy";

type Cell = "canRead" | "encrypted" | "ifOn" | "off";
const ICON: Record<Cell, React.ReactNode> = {
  canRead: <Eye size={13} aria-hidden />,
  encrypted: <LockKeyhole size={13} aria-hidden />,
  ifOn: <ToggleRight size={13} aria-hidden />,
  off: <Minus size={13} aria-hidden />,
};

function CellText({ cell }: { cell: Cell }) {
  return (
    <span className={`inline-flex items-start gap-1.5 ${cell === "canRead" ? "text-ink" : cell === "encrypted" ? "font-medium text-heading" : "text-muted"}`}>
      <span className="mt-0.5 flex-none">{ICON[cell]}</span>
      {copy.meaning[cell]}
    </span>
  );
}

/** "What each choice means" (§10.3): what Folevi's servers can read at each level, from §3.2. */
export function WhatEachChoiceMeans({ open, onClose }: { open: boolean; onClose: () => void }) {
  const m = copy.meaning;
  return (
    <Dialog open={open} onClose={onClose} title={m.title} size="lg" footer={<Button onClick={onClose}>{m.close}</Button>}>
      <div className="space-y-6 text-sm">
        {/* Wide screens: one table. Phones: each row as its own short list. */}
        <table className="hidden w-full border-separate border-spacing-0 text-left sm:table">
          <thead>
            <tr>
              <th scope="col" className="w-[34%] pb-2 pr-3 align-bottom text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
                <span className="sr-only">What</span>
              </th>
              {m.columns.map((c) => (
                <th key={c} scope="col" className="pb-2 pr-3 align-bottom text-[12.5px] font-semibold text-heading">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.rows.map((r) => (
              <tr key={r.label}>
                <th scope="row" className="border-t border-line py-2.5 pr-3 align-top font-medium text-ink">
                  {r.label}
                </th>
                {r.cells.map((cell, i) => (
                  <td key={i} className="border-t border-line py-2.5 pr-3 align-top">
                    <CellText cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="space-y-3 sm:hidden">
          {m.rows.map((r) => (
            <li key={r.label} className="rounded-control border border-line p-3">
              <p className="font-medium text-heading">{r.label}</p>
              <dl className="mt-2 space-y-1.5">
                {r.cells.map((cell, i) => (
                  <div key={i} className="flex items-start justify-between gap-3">
                    <dt className="min-w-0 text-[12.5px] text-muted">{m.columns[i]}</dt>
                    <dd className="flex-none text-right text-[12.5px]">
                      <CellText cell={cell} />
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>

        <section aria-labelledby="e2ee-always">
          <h3 id="e2ee-always" className="font-semibold text-heading">
            {m.alwaysTitle}
          </h3>
          <p className="mt-1 text-muted">{m.always}</p>
        </section>
        <section aria-labelledby="e2ee-things">
          <h3 id="e2ee-things" className="font-semibold text-heading">
            {m.thingsTitle}
          </h3>
          <ul className="mt-2 space-y-2">
            {m.things(m.backupDays).map((line) => (
              <li key={line} className="flex items-start gap-2 text-muted">
                <Check size={14} aria-hidden className="mt-0.5 flex-none text-heading" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Dialog>
  );
}
