"use client";

import { useQuery } from "convex/react";
import { FileText, Folder, Layers, Plus, X } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { useAppRouter } from "@/lib/app/router";
import { MenuButton, type MenuEntry } from "@/components/ui/Menu";
import { WHOLE_SCOPE, withNote, without, type ChatContext } from "./chatText";

const CHIP = "inline-flex h-7 max-w-full items-center gap-1.5 rounded-chip bg-[var(--glass-hover)] pl-2.5 text-[12.5px] text-ink shadow-[inset_0_0_0_1px_var(--glass-border)]";

/**
 * What the next question is about, as chips above the box: the notes it reads, the folder it searches,
 * or everything here ("All notes" in Personal, "Workspace" in a workspace). Chips come off with their ×;
 * "Add" offers the note or folder you're on and recent notes.
 */
export function ContextChips({ context, names, onChange, disabled }: { context: ChatContext; names: Record<string, string>; onChange: (next: ChatContext) => void; disabled?: boolean }) {
  const { scope, context: place } = useAppState();
  const { route } = useAppRouter();
  const recent = useQuery(api.documents.list, { scope, view: "all", paginationOpts: { numItems: 6, cursor: null } });
  const org = useQuery(api.organization.sidebar, route.name === "folder" ? { scope } : "skip");
  const currentNoteId = route.name === "doc" ? route.id : null;
  const currentNote = useQuery(api.documents.titles, currentNoteId ? { documentIds: [currentNoteId] } : "skip");
  const folder = route.name === "folder" ? org?.folders.find((f) => f.id === route.id) : undefined;
  const whole = place.kind === "workspace" ? "Workspace" : "All notes";
  const notes = context.kind === "note" || context.kind === "notes" ? context.ids : [];
  const label = (id: string) => names[id] ?? recent?.page.find((d) => d.id === id)?.title ?? (currentNoteId === id ? currentNote?.[id]?.title : undefined) ?? "Untitled";

  const add: MenuEntry[] = [];
  if (currentNoteId && currentNote?.[currentNoteId] && !notes.includes(currentNoteId)) {
    add.push({ label: "Current note", description: currentNote[currentNoteId]!.title || "Untitled", icon: <FileText size={14} />, onSelect: () => onChange(withNote(context, currentNoteId)) });
  }
  if (folder && !(context.kind === "folder" && context.ids[0] === folder.id)) {
    add.push({ label: "Current folder", description: folder.name, icon: <Folder size={14} />, onSelect: () => onChange({ kind: "folder", ids: [folder.id] }) });
  }
  const recentNotes = (recent?.page ?? []).filter((d) => !notes.includes(d.id) && d.id !== currentNoteId).slice(0, 5);
  if (recentNotes.length) {
    if (add.length) add.push("separator");
    add.push({ heading: "Recent notes" });
    for (const d of recentNotes) add.push({ label: d.title || "Untitled", icon: <FileText size={14} />, onSelect: () => onChange(withNote(context, d.id)) });
  }
  if (context.kind !== "workspace") {
    add.push("separator", { label: whole, description: "Search everything here", icon: <Layers size={14} />, onSelect: () => onChange(WHOLE_SCOPE) });
  }

  const remove = (id: string, name: string) => (
    <button type="button" disabled={disabled} aria-label={`Remove ${name}`} onClick={() => onChange(without(context, id))} className="mr-0.5 grid h-6 w-6 flex-none place-items-center rounded-chip text-muted hover:bg-[var(--glass-active)] hover:text-heading disabled:opacity-50">
      <X size={12} aria-hidden />
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="What Foli reads" role="group">
      {context.kind === "folder" && context.ids[0] ? (
        <span className={CHIP}>
          <Folder size={12} aria-hidden className="flex-none text-muted" />
          <span className="min-w-0 truncate">
            In folder <strong className="font-semibold text-heading">{names[context.ids[0]] ?? folder?.name ?? "Folder"}</strong>
          </span>
          {remove(context.ids[0], names[context.ids[0]] ?? "folder")}
        </span>
      ) : notes.length ? (
        notes.map((id) => (
          <span key={id} className={CHIP}>
            <FileText size={12} aria-hidden className="flex-none text-muted" />
            <span className="min-w-0 max-w-[14rem] truncate">{label(id)}</span>
            {remove(id, label(id))}
          </span>
        ))
      ) : (
        <span className={`${CHIP} pr-2.5`} title={place.kind === "workspace" ? place.name : undefined}>
          <Layers size={12} aria-hidden className="flex-none text-muted" />
          {whole}
        </span>
      )}
      {add.length && !disabled ? (
        <MenuButton
          label="Add to what Foli reads"
          align="start"
          side="top"
          triggerClassName="inline-flex h-7 items-center gap-1 rounded-chip px-2 text-[12.5px] text-muted transition-colors hover:bg-[var(--glass-hover)] hover:text-heading"
          trigger={
            <>
              <Plus size={13} aria-hidden /> Add
            </>
          }
          items={add}
        />
      ) : null}
    </div>
  );
}
