"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { GripVertical, Plus } from "lucide-react";
import { api } from "@/lib/convex/api";
import { errorMessage, useToast } from "@/components/ui/Toast";
import { THEME_PLANS, themesFrom, type NoteTheme, type ThemeRow } from "@/lib/themes";
import { useAdmin } from "./AdminApp";
import { rolesFor } from "./permissions";
import { requestMeta } from "./request";
import { Badge, Callout, DocTitle, PageHeader } from "./ui";

type Filter = "all" | "published" | "draft" | "retired";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "published", label: "Published" },
  { id: "draft", label: "Drafts" },
  { id: "retired", label: "Retired" },
];

export const STATUS_LABEL: Record<NoteTheme["status"], string> = { published: "Published", draft: "Draft", retired: "Retired" };
export const STATUS_TONE = { published: "success", draft: "outline", retired: "neutral" } as const;

/** A theme's tile image: its uploaded thumbnail, or the shipped one. */
export const thumbOf = (t: NoteTheme) => (t.image ? t.image.thumb : `/covers/${t.id}-thumb.webp`);

/**
 * The Theme manager's list: every note theme (built-in and added) in the picker's order. Drag a theme, or
 * focus its handle and use the arrow keys, to reorder. Open one to change it.
 */
export function ThemesView() {
  const admin = useAdmin();
  const toast = useToast();
  const canEdit = admin.can("themes.edit");
  const rows = useQuery(api.adminThemes.list, {});
  const reorder = useMutation(api.adminThemes.reorder);
  const [filter, setFilter] = useState<Filter>("all");
  // The order while a drag or a save is in flight (the server's comes back once it's saved).
  const [local, setLocal] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const themes = useMemo(() => (rows ? themesFrom(rows as ThemeRow[]) : null), [rows]);
  const ordered = useMemo(() => {
    if (!themes) return null;
    if (!local) return themes;
    const byId = new Map(themes.map((t) => [t.id, t]));
    return local.map((id) => byId.get(id)).filter((t): t is NoteTheme => Boolean(t));
  }, [themes, local]);
  const shown = ordered?.filter((t) => filter === "all" || t.status === filter) ?? null;
  const counts = Object.fromEntries(FILTERS.map((f) => [f.id, themes?.filter((t) => f.id === "all" || t.status === f.id).length ?? 0]));

  const move = (id: string, to: number) => {
    if (!ordered) return null;
    const ids = ordered.map((t) => t.id).filter((x) => x !== id);
    ids.splice(Math.max(0, Math.min(to, ids.length)), 0, id);
    return ids;
  };
  const save = async (ids: string[] | null) => {
    if (!ids || !ordered || ids.join() === ordered.map((t) => t.id).join()) return;
    setLocal(ids);
    try {
      await reorder({ keys: ids, ...(await requestMeta()) });
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    } finally {
      setLocal(null);
    }
  };

  return (
    <>
      <DocTitle>Note themes</DocTitle>
      <PageHeader
        title="Note themes"
        description="The themes people pick for their notes: an image, the colours it gives, and the separator, font type and typefaces a note starts with. Drag to set the order in the picker."
        actions={
          canEdit ? (
            <Link href="/admin/themes/new" className="ui-btn ui-btn-primary h-9 gap-1.5 px-4 text-sm">
              <Plus size={15} aria-hidden /> New theme
            </Link>
          ) : null
        }
      />
      {!canEdit ? (
        <div className="mb-4">
          <Callout>Read-only for your role. {rolesFor("themes.edit")}</Callout>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="ui-seg ui-well" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label} <span className="tabular-nums text-faint">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        {filter !== "all" ? <p className="text-[12.5px] text-muted">Reorder from All.</p> : null}
      </div>

      {shown === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted">No themes here.</p>
      ) : (
        <ol className="grid grid-cols-[repeat(auto-fill,minmax(184px,1fr))] gap-3" aria-label="Note themes, in picker order">
          {shown.map((t) => {
            const index = ordered!.findIndex((x) => x.id === t.id);
            const reorderable = canEdit && filter === "all";
            return (
              <li
                key={t.id}
                draggable={reorderable}
                onDragStart={(e) => {
                  setDragging(t.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  if (!dragging || dragging === t.id) return;
                  e.preventDefault();
                  setLocal(move(dragging, index));
                }}
                onDragEnd={() => {
                  const ids = local;
                  setDragging(null);
                  void save(ids);
                }}
                className={`group relative overflow-hidden rounded-control bg-surface shadow-[var(--shadow-card)] transition-opacity ${dragging === t.id ? "opacity-50" : ""}`}
              >
                <Link href={`/admin/themes/${t.id}`} className="block outline-none focus-visible:ring-2 focus-visible:ring-focus" aria-label={`${t.name}: ${STATUS_LABEL[t.status]}${t.plan !== "free" ? `, ${THEME_PLANS.find((p) => p.id === t.plan)?.name}` : ""}`}>
                  <span aria-hidden className="block aspect-[16/10] bg-sunken" style={{ background: `url(${thumbOf(t)}) center / cover no-repeat` }} />
                  <span className="flex items-start gap-2 px-3 pb-3 pt-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold text-heading">{t.name}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                        {t.plan !== "free" ? <Badge tone="strong">{THEME_PLANS.find((p) => p.id === t.plan)?.name}</Badge> : null}
                        {!t.builtIn ? <Badge>Added</Badge> : null}
                      </span>
                    </span>
                    <span className="pt-0.5 text-[11.5px] tabular-nums text-faint">{index + 1}</span>
                  </span>
                </Link>
                {reorderable ? (
                  <button
                    type="button"
                    aria-label={`Move ${t.name} (position ${index + 1} of ${ordered!.length}). Use the arrow keys.`}
                    title="Drag, or use the arrow keys, to move"
                    onKeyDown={(e) => {
                      const step = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0;
                      if (!step) return;
                      e.preventDefault();
                      void save(move(t.id, index + step));
                    }}
                    className="absolute left-1 top-1 grid size-7 cursor-grab place-items-center rounded-chip bg-[rgb(0_0_0/0.5)] text-white opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white group-hover:opacity-100"
                  >
                    <GripVertical size={14} aria-hidden />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
