"use client";

import { DateField } from "@/components/ui/DateField";
import { useQuery } from "convex/react";
import type { AnchorHTMLAttributes } from "react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDownUp, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Columns3, Filter, GalleryHorizontalEnd, Plus, Search, Settings2, Table2, Trash2, FileText } from "lucide-react";
import { api } from "@/lib/convex/api";
import { localDate, ulid, type WireScope } from "@folevi/editor-schema";
import { AppLink } from "@/lib/app/router";
import { documentScope } from "@/lib/app/scope";
import { useAppState } from "@/lib/app/state";
import { requireOutbox } from "@/lib/app/folders";
import { useOfflineQuery, useOutboxEntries } from "@/lib/sync/queryCache";
import { OPTION_COLORS, newView, overlayCollection, waitingRowPage, type OverlayCollection } from "@/lib/sync/overlays";
import type { OutboxArgs, OutboxName } from "@/lib/sync/outbox";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { Dialog } from "@/components/ui/Dialog";
import { Button, IconButton } from "@/components/ui/Button";
import { coverBackground } from "@/lib/cover";
import { useCoverImageUrl } from "@/lib/app/coverImage";
import { formatCalendarDate, t } from "@/i18n";
import { NO_VALUE_OPS, OPS, TITLE_ID, applyView, filterTargets, isEmptyValue, opLabel, resolveOption, rowsByDate, type FilterTarget } from "@/components/views/collectionView";
import { monthGrid, shiftMonth } from "@/components/views/calendarLayout";
import { Select } from "@/components/ui/Select";
import { Checkbox } from "@/components/ui/Checkbox";

type CollectionData = NonNullable<ReturnType<typeof useCollection>>;
type Property = CollectionData["properties"][number];
type Row = CollectionData["rows"][number];
type View = CollectionData["views"][number];
type ViewConfig = View["config"];
type ViewFilter = ViewConfig["filters"][number];
type FilterOp = ViewFilter["op"];
type Person = CollectionData["people"][number];

/**
 * A collection: the last answer seen on this device while there's no connection, with the changes still
 * waiting to be sent (values, new rows, deletes, view settings) already in place.
 */
function useCollection(collectionId: string | null) {
  const { outbox } = useAppState();
  const data = useOfflineQuery(api.collections.get, collectionId ? { collectionId } : "skip");
  const entries = useOutboxEntries(outbox);
  return useMemo<OverlayCollection | undefined>(() => (data && collectionId ? overlayCollection(data, entries, collectionId) : undefined), [data, entries, collectionId]);
}

/**
 * Collection changes, through the outbox: shown at once in every view, kept on this device, and sent in
 * order when there's a connection (one queue per collection, so a value set on a row added offline goes
 * after the row, and a view's settings after the property they show). Each resolves once it's queued.
 * Rows, properties and views get their ids here, so they can be used before the server has them.
 */
function useCollectionMutations() {
  const { outbox } = useAppState();
  return useMemo(() => {
    const queue = <N extends OutboxName>(name: N, args: OutboxArgs<N> & { collectionId: string }, label: string, creates?: string[]) => {
      try {
        requireOutbox(outbox).enqueue(name, args, { keys: [`collection:${args.collectionId}`], label, creates });
        return Promise.resolve(null);
      } catch (e) {
        return Promise.reject(e);
      }
    };
    return {
      updateView: (args: OutboxArgs<"collections.updateView">) => queue("collections.updateView", args, "Change a collection view"),
      rename: (args: OutboxArgs<"collections.rename">) => queue("collections.rename", args, `Rename collection to “${args.name}”`),
      renameRow: (args: OutboxArgs<"collections.renameRow">) => queue("collections.renameRow", args, `Rename row to “${args.title || "Untitled"}”`),
      setValue: (args: OutboxArgs<"collections.setValue">) => queue("collections.setValue", args, "Change a value in a collection"),
      moveRow: (args: OutboxArgs<"collections.moveRow">) => queue("collections.moveRow", args, "Move a row"),
      deleteRow: (args: OutboxArgs<"collections.deleteRow">) => queue("collections.deleteRow", args, "Delete a row"),
      /** Adds a row (and its page) with ids made here, so it can be filled in before it's sent. */
      addRow: (args: Omit<OutboxArgs<"collections.addRow">, "id" | "documentId">) => {
        const id = ulid();
        const documentId = ulid();
        return queue("collections.addRow", { ...args, id, documentId }, "New row", [documentId]).then(() => ({ id, documentId }));
      },
      addProperty: (args: Omit<OutboxArgs<"collections.addProperty">, "id">) => {
        const id = ulid();
        return queue("collections.addProperty", { ...args, id }, `New property “${args.name.trim()}”`).then(() => ({ id }));
      },
      updateProperty: (args: OutboxArgs<"collections.updateProperty">) =>
        queue("collections.updateProperty", args, args.options ? "Change a property’s options" : `Rename property to “${args.name ?? ""}”`),
      deleteProperty: (args: OutboxArgs<"collections.deleteProperty">) => queue("collections.deleteProperty", args, "Delete a property"),
      addView: (args: Omit<OutboxArgs<"collections.addViewToCollection">, "id">) => {
        const id = ulid();
        return queue("collections.addViewToCollection", { ...args, id }, `New view “${args.name}”`).then(() => ({ id }));
      },
      deleteView: (args: OutboxArgs<"collections.deleteView">) => queue("collections.deleteView", args, "Delete a view"),
    };
  }, [outbox]);
}

/**
 * A link to a row's page. A row added on this device opens before it's sent (its page is made here, and what's
 * typed in it waits for the row); one the server refused has no page to open, so it isn't a link.
 */
function RowLink({ row, children, ...rest }: { row: Pick<Row, "documentId" | "waiting">; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (row.waiting === "failed") {
    const { className, draggable, onDragStart, onDragEnd } = rest;
    return (
      <span className={className} draggable={draggable} onDragStart={onDragStart as never} onDragEnd={onDragEnd as never} title="This row wasn’t saved">
        {children}
      </span>
    );
  }
  return (
    <AppLink href={`/d/${row.documentId}`} {...rest}>
      {children}
    </AppLink>
  );
}

const TYPE_LABELS: Record<Property["type"], string> = {
  text: "Text",
  number: "Number",
  checkbox: "Checkbox",
  date: "Date",
  select: "Single select",
  multiSelect: "Multi-select",
  url: "URL",
  person: "Person",
  relation: "Relation",
};

function optionColor(color: string) {
  const c = color === "muted" ? "ink-muted" : color;
  return { background: `var(--color-${c === "accent" ? "accent-soft" : c === "ink-muted" ? "surface-sunken" : `${c}-soft`})`, color: `var(--color-${c === "accent" ? "accent-soft-ink" : c === "ink-muted" ? "ink" : `${c}-ink`})` };
}

const VIEW_NAMES: Record<View["type"], string> = { table: "Table", board: "Board", gallery: "Gallery", calendar: "Calendar" };

function ViewIcon({ type }: { type: View["type"] }) {
  if (type === "table") return <Table2 size={13} aria-hidden />;
  if (type === "board") return <Columns3 size={13} aria-hidden />;
  if (type === "calendar") return <CalendarDays size={13} aria-hidden />;
  return <GalleryHorizontalEnd size={13} aria-hidden />;
}

function storedView(collectionId: string): string | null {
  try {
    return localStorage.getItem(`folevi:collection-view:${collectionId}`);
  } catch {
    return null;
  }
}

function rememberView(collectionId: string, viewId: string) {
  try {
    localStorage.setItem(`folevi:collection-view:${collectionId}`, viewId);
  } catch {
    /* storage unavailable: the choice lasts for this visit */
  }
}

/** A text field that edits in place and commits on Enter/blur (Escape cancels). */
function InlineText({ value, onCommit, label, placeholder, className, maxLength = 300 }: { value: string; onCommit: (next: string) => void; label: string; placeholder?: string; className?: string; maxLength?: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  return (
    <input
      aria-label={label}
      value={draft ?? value}
      placeholder={placeholder}
      maxLength={maxLength}
      onFocus={() => {
        cancelled.current = false;
        setDraft(value);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = (draft ?? value).trim();
        if (!cancelled.current && next !== value.trim()) onCommit(next);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.stopPropagation();
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      className={`min-w-0 text-ellipsis rounded-chip border border-transparent bg-transparent px-1 outline-none hover:border-line focus:border-line-strong focus:bg-surface ${className ?? ""}`}
    />
  );
}

function ConfirmDialog({ open, title, body, confirmLabel, onCancel, onConfirm }: { open: boolean; title: string; body: ReactNode; confirmLabel: string; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">{body}</p>
    </Dialog>
  );
}

/** A collection embedded in a document: typed properties with table, board, gallery and calendar views. */
export function CollectionEmbed({ collectionId, initialViewId, editable }: { collectionId: string; initialViewId: string | null; editable: boolean }) {
  const data = useCollection(collectionId);
  const [viewId, setViewIdState] = useState<string | null>(() => storedView(collectionId) ?? initialViewId);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { rename, addRow, addView } = useCollectionMutations();
  const toast = useToast();

  if (data === undefined) return <div className="h-40 animate-pulse ui-card rounded-control motion-reduce:animate-none" aria-busy />;
  if (data === null) return <p className="rounded-chip border border-dashed border-line p-4 text-sm text-muted">This collection is unavailable.</p>;
  const view = data.views.find((v) => v.id === viewId) ?? data.views.find((v) => v.id === initialViewId) ?? data.views[0]!;
  const canEdit = editable && data.canEdit;
  const rows = applyView(data.rows, view.config, data.properties);
  const visible = data.properties.filter((p) => view.config.visibleProperties.includes(p.id));
  const setViewId = (id: string) => {
    setViewIdState(id);
    rememberView(collectionId, id);
  };

  const add = async (values?: Record<string, unknown>) => {
    try {
      await addRow({ collectionId, title: "", values });
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    }
  };

  return (
    <section className="ui-card rounded-control" aria-label={`Collection ${data.name}`}>
      <header className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2">
        {canEdit ? (
          <InlineText
            value={data.name}
            label="Collection name"
            maxLength={80}
            className="mr-2 w-44 text-sm font-semibold text-heading"
            onCommit={(name) => void rename({ collectionId, name: name || "Collection" }).catch((e) => toast.show(errorMessage(e), { tone: "error" }))}
          />
        ) : (
          <h3 className="mr-2 text-sm font-semibold text-heading">{data.name}</h3>
        )}
        <div role="group" aria-label="Views" className="flex flex-wrap gap-1">
          {data.views.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={v.id === view.id}
              onClick={() => setViewId(v.id)}
              className={`inline-flex h-7 items-center gap-1.5 rounded-chip px-2.5 text-xs ${v.id === view.id ? "bg-accent-soft text-accent-soft-ink" : "text-muted hover:bg-surface"}`}
            >
              <ViewIcon type={v.type} />
              {v.name}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {view.config.filters.length ? (
            <span className="ui-chip bg-accent-soft text-accent-soft-ink">
              <Filter size={12} aria-hidden /> {t("collection.filters", { count: view.config.filters.length })}
            </span>
          ) : null}
          {canEdit ? (
            <>
              <button type="button" onClick={() => setSettingsOpen(true)} className="inline-flex h-7 items-center gap-1 rounded-chip px-2.5 text-xs text-muted hover:bg-surface" aria-label="View settings: filter, sort, group, properties">
                <Settings2 size={13} aria-hidden /> View
              </button>
              <Select
                aria-label="Add view"
                value=""
                onChange={(e) => {
                  const type = e.target.value as View["type"];
                  if (!type) return;
                  // What the server would refuse is said now, not once the view is sent.
                  if (data.views.length >= 20) return toast.show("Up to 20 views per collection.", { tone: "error" });
                  if (!newView("", VIEW_NAMES[type], type, data.properties)) {
                    return toast.show(type === "board" ? "Add a single-select property to group a board by." : "Add a date property to show a calendar.", { tone: "error" });
                  }
                  addView({ collectionId, name: VIEW_NAMES[type], type }).then(
                    (r) => setViewId(r.id),
                    (err) => toast.show(errorMessage(err), { tone: "error" }),
                  );
                }}
                className="h-7 ui-input rounded-chip px-3 text-xs text-muted"
              >
                <option value="">+ View</option>
                <option value="table">Table</option>
                <option value="board">Board</option>
                <option value="gallery">Gallery</option>
                <option value="calendar">Calendar</option>
              </Select>
            </>
          ) : null}
        </div>
      </header>
      <p className="sr-only" aria-live="polite">
        {t("collection.rowsShown", { shown: rows.length, total: data.rows.length })}
      </p>
      {view.type === "table" ? (
        <TableCollection data={data} rows={rows} visible={visible} canEdit={canEdit} />
      ) : view.type === "board" ? (
        <BoardCollection data={data} view={view} rows={rows} visible={visible} canEdit={canEdit} onAdd={add} />
      ) : view.type === "calendar" ? (
        <CalendarCollection data={data} view={view} rows={rows} canEdit={canEdit} onAdd={add} />
      ) : (
        <GalleryCollection data={data} view={view} rows={rows} visible={visible} />
      )}
      {canEdit && view.type !== "board" ? (
        <button type="button" onClick={() => void add()} className="flex w-full items-center gap-1.5 border-t border-line px-3 py-2 text-left text-xs text-muted hover:bg-surface">
          <Plus size={13} aria-hidden /> New row
        </button>
      ) : null}
      {canEdit ? <ViewSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} data={data} view={view} /> : null}
    </section>
  );
}

function PropertyEditor({
  collection,
  row,
  prop,
  canEdit,
}: {
  collection: Pick<CollectionData, "id" | "people" | "workspaceId" | "isMember">;
  row: Pick<Row, "id" | "title" | "values">;
  prop: Property;
  canEdit: boolean;
}) {
  const { setValue } = useCollectionMutations();
  const toast = useToast();
  const value = row.values[prop.id];
  const save = (v: unknown) => setValue({ collectionId: collection.id, rowId: row.id, propertyId: prop.id, value: v }).catch((e) => toast.show(errorMessage(e), { tone: "error" }));
  const label = `${prop.name} for ${row.title || "Untitled"}`;
  if (!canEdit) return <CellDisplay prop={prop} value={value} people={collection.people} />;
  switch (prop.type) {
    case "checkbox":
      return (
        <Checkbox checked={value === true} onChange={(next) => void save(next)}>
          <span className="sr-only">{label}</span>
        </Checkbox>
      );
    case "number":
      return (
        <input
          key={String(value ?? "")}
          type="number"
          aria-label={label}
          defaultValue={typeof value === "number" ? value : ""}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          onBlur={(e) => {
            const next = e.target.value === "" ? null : Number(e.target.value);
            if (next !== (typeof value === "number" ? value : null)) void save(next);
          }}
          className="w-full bg-transparent outline-none"
        />
      );
    case "date":
      return <DateField bare aria-label={label} value={typeof value === "string" ? value : ""} onChange={(v) => void save(v || null)} />;
    case "select":
      return (
        <Select aria-label={label} value={typeof value === "string" ? value : ""} onChange={(e) => void save(e.target.value || null)} className="w-full bg-transparent outline-none">
          <option value="">None</option>
          {prop.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      );
    case "multiSelect": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
          {prop.options.map((o) => {
            const on = selected.includes(o.id);
            return (
              <button key={o.id} type="button" aria-pressed={on} onClick={() => void save(on ? selected.filter((x) => x !== o.id) : [...selected, o.id])} className={`rounded-chip px-2 py-0.5 text-[11px] ${on ? "" : "opacity-40"}`} style={optionColor(o.color)}>
                {o.name}
              </button>
            );
          })}
          {prop.options.length === 0 ? <span className="text-xs text-faint">No options yet (View settings)</span> : null}
        </div>
      );
    }
    case "person":
      return (
        <Select aria-label={label} value={typeof value === "string" ? value : ""} onChange={(e) => void save(e.target.value || null)} className="w-full bg-transparent outline-none">
          <option value="">None</option>
          {collection.people.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      );
    case "relation":
      return <RelationEditor label={label} scope={collection.isMember ? documentScope(collection) : null} value={Array.isArray(value) ? (value as string[]) : []} onChange={(v) => void save(v)} />;
    default:
      return (
        <input
          key={String(value ?? "")}
          aria-label={label}
          defaultValue={typeof value === "string" ? value : ""}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== (value ?? "")) void save(v || null);
          }}
          className="w-full text-ellipsis bg-transparent outline-none"
          type={prop.type === "url" ? "url" : "text"}
          placeholder={prop.type === "url" ? "https://" : undefined}
        />
      );
  }
}

/** Linked pages with a searchable picker (search across the collection's scope: your Personal or its workspace). */
function RelationEditor({ label, scope, value, onChange }: { label: string; scope: WireScope | null; value: string[]; onChange: (v: string[]) => void }) {
  const titles = useQuery(api.documents.titles, value.length ? { documentIds: value } : "skip");
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={label}>
      {value.map((id) => (
        <span key={id} className="inline-flex items-center gap-1 rounded-chip bg-sunken px-2 py-0.5 text-[11px]">
          <AppLink href={`/d/${id}`} className="hover:underline">
            {titles?.[id]?.title || "Untitled"}
          </AppLink>
          <button type="button" aria-label={`Remove ${titles?.[id]?.title || "page"}`} onClick={() => onChange(value.filter((x) => x !== id))} className="text-faint hover:text-ink">
            ×
          </button>
        </span>
      ))}
      {scope ? (
        <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} className="rounded-chip px-1.5 py-0.5 text-[11px] text-muted hover:bg-sunken">
          + Link page
        </button>
      ) : null}
      {scope ? (
        <Dialog open={open} onClose={() => setOpen(false)} title="Link a page" description={label} size="sm">
          {open ? <PagePicker scope={scope} exclude={value} onPick={(id) => onChange([...value, id])} /> : null}
        </Dialog>
      ) : null}
    </div>
  );
}

function PagePicker({ scope, exclude, onPick }: { scope: WireScope; exclude: string[]; onPick: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 150);
    return () => clearTimeout(t);
  }, [query]);
  const results = useQuery(api.search.documents, debounced ? { scope, query: debounced, limit: 12 } : "skip");
  const recent = useQuery(api.documents.recent, !debounced ? { scope, limit: 12 } : "skip");
  const loaded = debounced ? results : recent;
  const options = (loaded ?? []).filter((d) => !exclude.includes(d.id));
  const pick = (id: string) => {
    onPick(id);
    setQuery("");
    setActive(0);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(options.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = options[active];
      if (o) pick(o.id);
    }
  };
  return (
    <div>
      <label className="flex items-center gap-2 rounded-chip ui-input px-3">
        <Search size={14} aria-hidden className="text-faint" />
        <input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={options[active] ? `${listId}-${options[active]!.id}` : undefined}
          aria-label="Search pages"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
          placeholder="Search pages…"
          className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </label>
      <p className="ui-caps mt-3 px-1">{debounced ? "Matching pages" : "Recent pages"}</p>
      <ul id={listId} role="listbox" aria-label="Pages" className="mt-1 max-h-64 overflow-y-auto">
        {options.map((d, i) => (
          <li
            key={d.id}
            id={`${listId}-${d.id}`}
            role="option"
            aria-selected={i === active}
            data-highlighted={i === active}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(d.id)}
            className="ui-menu-item flex cursor-pointer items-center gap-2 rounded-chip px-2 py-1.5 text-sm"
          >
            <FileText size={14} aria-hidden className="flex-none text-muted" />
            <span className="truncate">{d.title || "Untitled"}</span>
          </li>
        ))}
        {loaded !== undefined && options.length === 0 ? <li className="px-2 py-2 text-sm text-muted">{debounced ? "No matching pages" : "No recent pages"}</li> : null}
      </ul>
    </div>
  );
}

/** Read-only value. `inLink` renders URLs as text (never an <a> nested inside a card link). */
function CellDisplay({ prop, value, people, inLink }: { prop: Property; value: unknown; people: Person[]; inLink?: boolean }) {
  const titles = useQuery(api.documents.titles, prop.type === "relation" && Array.isArray(value) && value.length ? { documentIds: value as string[] } : "skip");
  if (isEmptyValue(value)) return <span className="text-faint">-</span>;
  if (prop.type === "checkbox") return <span>{value ? "✓" : ""}</span>;
  if (prop.type === "select") {
    const o = prop.options.find((x) => x.id === value);
    return o ? <span className="rounded-chip px-2 py-0.5 text-[11px]" style={optionColor(o.color)}>{o.name}</span> : null;
  }
  if (prop.type === "multiSelect" && Array.isArray(value)) {
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((id) => {
          const o = prop.options.find((x) => x.id === id);
          return o ? (
            <span key={id} className="rounded-chip px-2 py-0.5 text-[11px]" style={optionColor(o.color)}>
              {o.name}
            </span>
          ) : null;
        })}
      </span>
    );
  }
  if (prop.type === "person") return <span>{people.find((p) => p.id === value)?.name ?? "Former member"}</span>;
  if (prop.type === "relation" && Array.isArray(value)) {
    return <span>{value.map((id) => titles?.[id as string]?.title || "Untitled").join(", ")}</span>;
  }
  if (prop.type === "date" && typeof value === "string") {
    return <time dateTime={value}>{/^\d{4}-\d{2}-\d{2}$/.test(value) ? formatCalendarDate(value) : value}</time>;
  }
  if (prop.type === "url" && typeof value === "string") {
    const shown = value.replace(/^https?:\/\//, "");
    if (inLink) return <span className="text-accent">{shown}</span>;
    return (
      <a href={value} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline underline-offset-2">
        {shown}
      </a>
    );
  }
  return <span>{String(value)}</span>;
}

function TableCollection({ data, rows, visible, canEdit }: { data: CollectionData; rows: Row[]; visible: Property[]; canEdit: boolean }) {
  const { renameRow, deleteRow } = useCollectionMutations();
  const toast = useToast();
  const [confirm, setConfirm] = useState<Row | null>(null);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th scope="col" className="border-b border-line px-3 py-2 font-medium">
              Name
            </th>
            {visible.map((p) => (
              <th key={p.id} scope="col" className="border-b border-l border-line px-3 py-2 font-medium" title={TYPE_LABELS[p.type]}>
                {p.name}
              </th>
            ))}
            {canEdit ? <th className="w-8 border-b border-line" aria-label="Row actions" /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="group">
              <td className="border-b border-line px-3 py-1.5">
                <div className="flex items-center gap-1.5">
                  <FileText size={14} aria-hidden className="flex-none text-muted" />
                  {canEdit ? (
                    <InlineText
                      value={row.title}
                      label="Row name"
                      placeholder="Untitled"
                      className="flex-1 font-medium"
                      onCommit={(title) => void renameRow({ collectionId: data.id, rowId: row.id, title }).catch((e) => toast.show(errorMessage(e), { tone: "error" }))}
                    />
                  ) : (
                    <RowLink row={row} className="font-medium hover:underline">
                      {row.title || "Untitled"}
                    </RowLink>
                  )}
                  {canEdit && row.waiting !== "failed" ? (
                    <AppLink href={`/d/${row.documentId}`} aria-label={`Open ${row.title || "Untitled"}`} title="Open page" className="grid h-6 w-6 flex-none place-items-center rounded-chip text-faint hover:bg-sunken hover:text-ink">
                      <ArrowUpRight size={13} aria-hidden />
                    </AppLink>
                  ) : null}
                  {row.waiting ? <span className="flex-none text-[11px] text-faint">{row.waiting === "failed" ? "Not saved" : "Waiting to send"}</span> : null}
                </div>
              </td>
              {visible.map((p) => (
                <td key={p.id} className="border-b border-l border-line px-3 py-1.5">
                  <PropertyEditor collection={data} row={row} prop={p} canEdit={canEdit} />
                </td>
              ))}
              {canEdit ? (
                <td className="border-b border-line text-center">
                  <button type="button" aria-label={`Delete ${row.title || "row"}`} onClick={() => setConfirm(row)} className="text-faint opacity-0 hover:text-danger group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100 pointer-coarse:inline-grid pointer-coarse:h-11 pointer-coarse:w-11 pointer-coarse:place-items-center pointer-coarse:opacity-100">
                    <Trash2 size={13} aria-hidden />
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={visible.length + 2} className="px-3 py-6 text-center text-sm text-muted">
                {data.rows.length ? "No rows match this view." : "No rows yet."}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <ConfirmDialog
        open={confirm !== null}
        title={`Delete “${confirm?.title || "Untitled"}”?`}
        body="The row’s page moves to Trash with its values. You can restore it from Trash for 30 days."
        confirmLabel="Delete row"
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          try {
            await deleteRow({ collectionId: data.id, rowId: confirm.id });
            toast.show("Row moved to Trash.", { tone: "success" });
            setConfirm(null);
          } catch (e) {
            toast.show(errorMessage(e), { tone: "error" });
          }
        }}
      />
    </div>
  );
}

function BoardCollection({ data, view, rows, visible, canEdit, onAdd }: { data: CollectionData; view: View; rows: Row[]; visible: Property[]; canEdit: boolean; onAdd: (values?: Record<string, unknown>) => Promise<void> }) {
  const { moveRow } = useCollectionMutations();
  const toast = useToast();
  const group = data.properties.find((p) => p.id === view.config.groupBy && p.type === "select");
  const [dragging, setDragging] = useState<string | null>(null);
  if (!group) return <p className="p-4 text-sm text-muted">Choose a single-select property to group this board by (View settings).</p>;
  const columns = [...group.options.map((o) => ({ id: o.id as string | null, name: o.name, color: o.color })), { id: null, name: "No " + group.name.toLowerCase(), color: "muted" }];
  const move = (rowId: string, to: string | null, after: string | null) =>
    moveRow({ collectionId: data.id, rowId, afterRowId: after, groupPropertyId: group.id, groupValue: to }).catch((e) => toast.show(errorMessage(e), { tone: "error" }));
  return (
    <div className="flex gap-3 overflow-x-auto p-3">
      {columns.map((col) => {
        const items = rows.filter((r) => ((r.values[group.id] as string | undefined) ?? null) === col.id);
        return (
          <section
            key={col.id ?? "none"}
            aria-label={t("collection.board.column", { name: col.name, count: items.length })}
            className="flex w-64 flex-none flex-col rounded-chip bg-sunken p-2"
            onDragOver={(e) => canEdit && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const rowId = dragging;
              setDragging(null);
              if (!rowId) return;
              // A drop goes to the end of the column. The card itself doesn't count (the server orders it
              // after the row named), and a card that's already last in its own column stays put.
              const last = items[items.length - 1];
              if (last?.id === rowId) return;
              void move(rowId, col.id, last?.id ?? null);
            }}
          >
            <h4 className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold">
              <span className="rounded-chip px-2 py-0.5" style={optionColor(col.color)}>
                {col.name}
              </span>
              <span className="text-faint">{items.length}</span>
            </h4>
            <ul className="space-y-2">
              {items.map((row) => (
                <li
                  key={row.id}
                  draggable={canEdit}
                  onDragStart={(e) => {
                    // Firefox only starts a drag that carries some data. Its own type, so dropping the card on
                    // the note around it doesn't paste anything there.
                    e.dataTransfer.setData("application/x-folevi-row", row.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragging(row.id);
                  }}
                  onDragEnd={() => setDragging(null)}
                  className="rounded-chip border border-line bg-raised p-2.5 text-sm shadow-[0_1px_0_var(--color-line)]">
                  <RowLink row={row} className="font-medium hover:underline">
                    {row.title || "Untitled"}
                  </RowLink>
                  <div className="mt-1 space-y-0.5 text-xs text-muted">
                    {visible
                      .filter((p) => p.id !== group.id)
                      .map((p) => (
                        <div key={p.id} className="flex gap-1">
                          <span className="text-faint">{p.name}:</span> <CellDisplay prop={p} value={row.values[p.id]} people={data.people} />
                        </div>
                      ))}
                  </div>
                  {canEdit ? (
                    <label className="mt-1.5 flex items-center gap-1 text-[11px] text-faint">
                      <span className="sr-only">Move {row.title || "card"} to</span>
                      <Select value={col.id ?? ""} onChange={(e) => void move(row.id, e.target.value || null, null)} className="bg-transparent">
                        {columns.map((c) => (
                          <option key={c.id ?? "none"} value={c.id ?? ""}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    </label>
                  ) : null}
                </li>
              ))}
            </ul>
            {canEdit ? (
              <button type="button" onClick={() => void onAdd(col.id ? { [group.id]: col.id } : undefined)} className="mt-2 flex items-center gap-1 rounded-chip px-2 py-1 text-xs text-muted hover:bg-raised">
                <Plus size={12} aria-hidden /> New
              </button>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

const ROW_TYPE = "application/x-folevi-row";

/**
 * Rows on a month grid by a date property. A row's chip opens its page; drag it to another day to change
 * the date, or to the "No date" tray to clear it. "New" on a day adds a row with that date.
 */
function CalendarCollection({ data, view, rows, canEdit, onAdd }: { data: CollectionData; view: View; rows: Row[]; canEdit: boolean; onAdd: (values?: Record<string, unknown>) => Promise<void> }) {
  const { setValue } = useCollectionMutations();
  const toast = useToast();
  const today = useMemo(() => localDate(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone), []);
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [dragging, setDragging] = useState<string | null>(null);
  const prop = data.properties.find((p) => p.id === view.config.dateBy && p.type === "date");
  if (!prop) return <p className="p-4 text-sm text-muted">Choose a date property to place rows on this calendar (View settings).</p>;
  const { byDate, undated } = rowsByDate(rows, prop.id);
  const days = monthGrid(month);
  const monthLabel = formatCalendarDate(`${month}-01`, { month: "long", year: "numeric" });
  const weekdays = days.slice(0, 7).map((d) => formatCalendarDate(d, { weekday: "short" }));
  const move = (rowId: string, date: string | null) => {
    const row = data.rows.find((r) => r.id === rowId);
    if (!row || (row.values[prop.id] ?? null) === date) return;
    void setValue({ collectionId: data.id, rowId, propertyId: prop.id, value: date }).catch((e) => toast.show(errorMessage(e), { tone: "error" }));
  };
  const dropTarget = (date: string | null) =>
    canEdit
      ? {
          onDragOver: (e: React.DragEvent) => {
            if (e.dataTransfer.types.includes(ROW_TYPE)) e.preventDefault();
          },
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            const id = e.dataTransfer.getData(ROW_TYPE) || dragging;
            setDragging(null);
            if (id) move(id, date);
          },
        }
      : {};
  const chip = (row: Row) => (
    <RowLink
      row={row}
      draggable={canEdit}
      onDragStart={(e) => {
        // Only the row id travels, so a chip dropped on the note around it doesn't paste a link there.
        e.dataTransfer.clearData();
        e.dataTransfer.setData(ROW_TYPE, row.id);
        e.dataTransfer.effectAllowed = "move";
        setDragging(row.id);
      }}
      onDragEnd={() => setDragging(null)}
      title={row.title || "Untitled"}
      className={`block truncate rounded-tiny bg-accent-soft px-1 text-[11.5px] leading-5 text-accent-soft-ink hover:underline ${canEdit ? "cursor-grab" : ""}`}
    >
      {row.title || "Untitled"}
    </RowLink>
  );
  return (
    <div className="p-3">
      <div className="mb-2 flex items-center gap-1">
        <h4 className="text-sm font-semibold">{monthLabel}</h4>
        <div className="ml-auto flex items-center gap-1">
          <IconButton label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronLeft size={15} aria-hidden />
          </IconButton>
          <Button size="sm" onClick={() => setMonth(today.slice(0, 7))}>
            Today
          </Button>
          <IconButton label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRight size={15} aria-hidden />
          </IconButton>
        </div>
      </div>
      <div role="grid" aria-label={`${data.name}, ${monthLabel}`} className="overflow-hidden rounded-chip border border-line">
        <div role="row" className="grid grid-cols-7 border-b border-line bg-surface text-center text-[11px] font-medium text-muted">
          {weekdays.map((w) => (
            <div key={w} role="columnheader" className="py-1.5">
              {w}
            </div>
          ))}
        </div>
        {Array.from({ length: 6 }, (_, week) => (
          <div role="row" key={week} className="grid grid-cols-7">
            {days.slice(week * 7, week * 7 + 7).map((date) => {
              const items = byDate.get(date) ?? [];
              const inMonth = date.startsWith(month);
              const long = formatCalendarDate(date, { weekday: "long", month: "long", day: "numeric" });
              return (
                <div
                  key={date}
                  role="gridcell"
                  data-date={date}
                  aria-label={`${long}, ${items.length === 1 ? "1 row" : `${items.length} rows`}`}
                  {...dropTarget(date)}
                  className={`group/day min-h-[88px] min-w-0 border-b border-r border-line p-1 last:border-r-0 ${inMonth ? "" : "bg-surface/60"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`grid h-5 min-w-5 place-items-center rounded-chip px-1 text-[11px] tabular-nums ${date === today ? "bg-heading font-semibold text-canvas" : inMonth ? "text-ink" : "text-faint"}`}>{Number(date.slice(8))}</span>
                    {canEdit ? (
                      <button
                        type="button"
                        aria-label={`New row on ${long}`}
                        title="New"
                        onClick={() => void onAdd({ [prop.id]: date })}
                        className="grid h-5 w-5 place-items-center rounded-tiny text-faint opacity-0 hover:bg-sunken hover:text-ink focus-visible:opacity-100 group-hover/day:opacity-100 pointer-coarse:opacity-100"
                      >
                        <Plus size={12} aria-hidden />
                      </button>
                    ) : null}
                  </div>
                  <ul className="mt-0.5 space-y-0.5">
                    {items.slice(0, 4).map((row) => (
                      <li key={row.id}>{chip(row)}</li>
                    ))}
                    {items.length > 4 ? <li className="px-1 text-[11px] text-muted">+{items.length - 4} more</li> : null}
                  </ul>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {undated.length || canEdit ? (
        <section aria-label="No date" {...dropTarget(null)} className="mt-3 rounded-chip bg-sunken p-2">
          <h4 className="mb-1.5 flex items-center gap-2 px-1 text-xs font-semibold">
            No date <span className="font-normal text-faint">{undated.length}</span>
          </h4>
          {undated.length ? (
            <ul className="flex flex-wrap gap-1">
              {undated.map((row) => (
                <li key={row.id} className="max-w-48">
                  {chip(row)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-1 text-xs text-muted">Every row has a date. Drag one here to clear it.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}

/** A gallery card's cover: the row's note theme (built-in artwork or the person's own image). */
function GalleryCover({ cover, children }: { cover: Row["cover"]; children: React.ReactNode }) {
  const imageUrl = useCoverImageUrl(cover);
  const bg = coverBackground(cover, { font: "sans", width: "default", background: "paper", accent: "plum", card: "folio" }, imageUrl);
  return (
    <div className="h-24 border-b border-line" style={{ background: bg ?? "var(--color-surface)" }}>
      {children}
    </div>
  );
}

function GalleryCollection({ data, view, rows, visible }: { data: CollectionData; view: View; rows: Row[]; visible: Property[] }) {
  const size = view.config.cardSize === "small" ? "sm:grid-cols-3 lg:grid-cols-4" : view.config.cardSize === "large" ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3";
  return (
    <ul className={`grid grid-cols-1 gap-3 p-3 ${size}`}>
      {rows.map((row) => (
        <li key={row.id}>
          <RowLink row={row} className="block overflow-hidden ui-card rounded-control transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[var(--shadow-pop)]">
            {view.config.cardPreview !== "none" ? (
              <GalleryCover cover={row.cover}>
                {view.config.cardPreview === "content" ? <p className="line-clamp-4 p-3 text-xs text-muted">{row.excerpt}</p> : <div className="grid h-full place-items-center text-faint"><FileText size={28} aria-hidden /></div>}
              </GalleryCover>
            ) : null}
            <div className="p-3">
              <p className="font-medium">{row.title || "Untitled"}</p>
              <div className="mt-1 space-y-0.5 text-xs text-muted">
                {visible.map((p) => (
                  <div key={p.id}>
                    <CellDisplay prop={p} value={row.values[p.id]} people={data.people} inLink />
                  </div>
                ))}
              </div>
            </div>
          </RowLink>
        </li>
      ))}
    </ul>
  );
}

function FilterValueEditor({ target, filter, people, onChange }: { target: FilterTarget; filter: ViewFilter; people: Person[]; onChange: (value: unknown) => void }) {
  const value = resolveOption(target, filter.value);
  const cls = "h-8 w-36 ui-input rounded-chip px-2";
  switch (target.type) {
    case "select":
    case "multiSelect":
      return (
        <Select aria-label="Value" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || undefined)} className={`${cls} px-1`}>
          <option value="">Choose…</option>
          {target.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      );
    case "person":
      return (
        <Select aria-label="Value" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || undefined)} className={`${cls} px-1`}>
          <option value="">Choose…</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      );
    case "date":
      return <DateField aria-label="Value" value={typeof value === "string" ? value : ""} onChange={(v) => onChange(v || undefined)} />;
    case "number":
      return (
        <input
          key={String(value ?? "")}
          type="number"
          aria-label="Value"
          defaultValue={typeof value === "number" || typeof value === "string" ? String(value) : ""}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          onBlur={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          className={cls}
        />
      );
    default:
      return (
        <input
          key={String(value ?? "")}
          aria-label="Value"
          defaultValue={String(value ?? "")}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          onBlur={(e) => onChange(e.target.value || undefined)}
          className={cls}
        />
      );
  }
}

function ViewSettings({ open, onClose, data, view }: { open: boolean; onClose: () => void; data: CollectionData; view: View }) {
  const { updateView, addProperty, updateProperty, deleteProperty, deleteView } = useCollectionMutations();
  const toast = useToast();
  const [newProp, setNewProp] = useState<{ name: string; type: Property["type"] }>({ name: "", type: "text" });
  const [confirmProp, setConfirmProp] = useState<Property | null>(null);
  const [confirmView, setConfirmView] = useState(false);
  // Edits made before the server echoes the previous one build on the latest local config, never on a stale prop.
  const latest = useRef<{ viewId: string; config: ViewConfig } | null>(null);
  const config = view.config;
  const save = (next: Partial<ViewConfig>) => {
    const base = latest.current?.viewId === view.id ? latest.current.config : config;
    const merged = { ...base, ...next };
    const entry = { viewId: view.id, config: merged };
    latest.current = entry;
    return updateView({ collectionId: data.id, viewId: view.id, config: merged })
      .catch((e) => toast.show(errorMessage(e), { tone: "error" }))
      .finally(() => {
        if (latest.current === entry) latest.current = null;
      });
  };
  const current = () => (latest.current?.viewId === view.id ? latest.current.config : config);
  const selectProps = useMemo(() => data.properties.filter((p) => p.type === "select"), [data.properties]);
  const dateProps = useMemo(() => data.properties.filter((p) => p.type === "date"), [data.properties]);
  const targets = useMemo(() => filterTargets(data.properties), [data.properties]);
  const setFilter = (i: number, patch: Partial<ViewFilter>) => void save({ filters: current().filters.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  return (
    <Dialog open={open} onClose={onClose} title={`${view.name} settings`} description="Filters, sorting, grouping and visible properties are saved with this view for everyone." size="lg">
      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <label className="mb-4 block text-sm">
            <span className="font-semibold">View name</span>
            <InlineText
              value={view.name}
              label="View name"
              maxLength={40}
              className="mt-1 block h-8 w-full ui-input rounded-chip px-3"
              onCommit={(name) => void updateView({ collectionId: data.id, viewId: view.id, name: name || view.name }).catch((e) => toast.show(errorMessage(e), { tone: "error" }))}
            />
          </label>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <Filter size={14} aria-hidden /> Filters
          </h3>
          {config.filters.map((f, i) => {
            const target = targets.find((t) => t.id === f.propertyId);
            const ops = target ? OPS[target.type] : [f.op];
            return (
              <div key={i} className="mb-2 flex flex-wrap items-center gap-1.5 text-sm" role="group" aria-label={`Filter ${i + 1}`}>
                <Select
                  aria-label="Property"
                  value={f.propertyId}
                  onChange={(e) => {
                    const t = targets.find((x) => x.id === e.target.value);
                    const valid = t ? OPS[t.type] : [];
                    setFilter(i, { propertyId: e.target.value, op: valid.includes(f.op) ? f.op : (valid[0] ?? "isNotEmpty"), value: undefined });
                  }}
                  className="h-8 ui-input rounded-chip px-3"
                >
                  {!target ? <option value={f.propertyId}>Deleted property</option> : null}
                  {targets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <Select aria-label="Condition" value={f.op} onChange={(e) => setFilter(i, { op: e.target.value as FilterOp })} className="h-8 ui-input rounded-chip px-3">
                  {ops.map((op) => (
                    <option key={op} value={op}>
                      {target ? opLabel(target.type, op) : op}
                    </option>
                  ))}
                </Select>
                {target && !NO_VALUE_OPS.includes(f.op) ? <FilterValueEditor target={target} filter={f} people={data.people} onChange={(value) => setFilter(i, { value })} /> : null}
                <button type="button" aria-label="Remove filter" onClick={() => void save({ filters: current().filters.filter((_, j) => j !== i) })} className="grid h-7 w-7 place-items-center rounded-chip text-faint hover:bg-sunken hover:text-danger">
                  <Trash2 size={13} aria-hidden />
                </button>
              </div>
            );
          })}
          <Button size="sm" onClick={() => void save({ filters: [...current().filters, { propertyId: data.properties[0]?.id ?? TITLE_ID, op: data.properties[0] ? OPS[data.properties[0].type][0]! : "contains" }] })}>
            <Plus size={12} aria-hidden /> Add filter
          </Button>

          <h3 className="mb-2 mt-6 flex items-center gap-1.5 text-sm font-semibold">
            <ArrowDownUp size={14} aria-hidden /> Sort
          </h3>
          {config.sorts.map((s, i) => (
            <div key={i} className="mb-2 flex items-center gap-1.5 text-sm">
              <Select aria-label="Sort property" value={s.propertyId} onChange={(e) => void save({ sorts: current().sorts.map((x, j) => (j === i ? { ...x, propertyId: e.target.value } : x)) })} className="h-8 ui-input rounded-chip px-3">
                <option value={TITLE_ID}>Name</option>
                {data.properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <Select aria-label="Direction" value={s.direction} onChange={(e) => void save({ sorts: current().sorts.map((x, j) => (j === i ? { ...x, direction: e.target.value as "asc" | "desc" } : x)) })} className="h-8 ui-input rounded-chip px-3">
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </Select>
              <button type="button" aria-label="Remove sort" onClick={() => void save({ sorts: current().sorts.filter((_, j) => j !== i) })} className="grid h-7 w-7 place-items-center rounded-chip text-faint hover:bg-sunken hover:text-danger">
                <Trash2 size={13} aria-hidden />
              </button>
            </div>
          ))}
          <Button size="sm" onClick={() => void save({ sorts: [...current().sorts, { propertyId: TITLE_ID, direction: "asc" }] })}>
            <Plus size={12} aria-hidden /> Add sort
          </Button>

          {view.type === "board" ? (
            <label className="mt-6 block text-sm">
              <span className="font-semibold">Group by</span>
              <Select value={config.groupBy ?? ""} onChange={(e) => void save({ groupBy: e.target.value || undefined })} className="mt-1 flex h-8 ui-input rounded-chip px-3">
                {selectProps.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
          {view.type === "calendar" ? (
            <label className="mt-6 block text-sm">
              <span className="font-semibold">Show rows by</span>
              <Select value={config.dateBy ?? ""} onChange={(e) => void save({ dateBy: e.target.value || undefined })} className="mt-1 flex h-8 ui-input rounded-chip px-3">
                {config.dateBy && !dateProps.some((p) => p.id === config.dateBy) ? <option value={config.dateBy}>Deleted property</option> : null}
                {dateProps.length === 0 ? <option value="">Add a date property first</option> : null}
                {dateProps.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
          {view.type === "gallery" ? (
            <div className="mt-6 flex gap-4 text-sm">
              <label>
                <span className="font-semibold">Card preview</span>
                <Select value={config.cardPreview} onChange={(e) => void save({ cardPreview: e.target.value as ViewConfig["cardPreview"] })} className="mt-1 flex h-8 ui-input rounded-chip px-3">
                  <option value="none">None</option>
                  <option value="cover">Cover</option>
                  <option value="content">Page content</option>
                </Select>
              </label>
              <label>
                <span className="font-semibold">Card size</span>
                <Select value={config.cardSize} onChange={(e) => void save({ cardSize: e.target.value as ViewConfig["cardSize"] })} className="mt-1 flex h-8 ui-input rounded-chip px-3">
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </Select>
              </label>
            </div>
          ) : null}
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold">Properties</h3>
          <ul className="space-y-1.5">
            {data.properties.map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={config.visibleProperties.includes(p.id)}
                  onChange={(next) => {
                    const vis = current().visibleProperties;
                    void save({ visibleProperties: next ? [...vis.filter((x) => x !== p.id), p.id] : vis.filter((x) => x !== p.id) });
                  }}
                >
                  <span className="sr-only">{`Show ${p.name}`}</span>
                </Checkbox>
                <InlineText
                  value={p.name}
                  label={`Name of property ${p.name}`}
                  maxLength={60}
                  className="h-7 flex-1"
                  onCommit={(name) => name && void updateProperty({ collectionId: data.id, propertyId: p.id, name }).catch((e) => toast.show(errorMessage(e), { tone: "error" }))}
                />
                <span className="text-xs text-faint">{TYPE_LABELS[p.type]}</span>
                <button type="button" aria-label={`Delete property ${p.name}`} onClick={() => setConfirmProp(p)} className="grid h-7 w-7 place-items-center rounded-chip text-faint hover:bg-sunken hover:text-danger">
                  <Trash2 size={13} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          {data.properties
            .filter((p) => p.type === "select" || p.type === "multiSelect")
            .map((p) => (
              <label key={p.id} className="mt-3 block text-xs">
                Options for {p.name} (comma-separated)
                <input
                  key={p.options.map((o) => o.name).join(",")}
                  defaultValue={p.options.map((o) => o.name).join(", ")}
                  onBlur={(e) => {
                    const names = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                    if (names.join(",") === p.options.map((o) => o.name).join(",")) return;
                    // A new option gets its id and colour here, so sending the list again changes nothing.
                    const options = names.map((name, i) => {
                      const kept = p.options.find((o) => o.name === name);
                      return kept ? { id: kept.id, name, color: kept.color } : { id: ulid(), name, color: OPTION_COLORS[i % OPTION_COLORS.length] };
                    });
                    void updateProperty({ collectionId: data.id, propertyId: p.id, options }).catch((err) => toast.show(errorMessage(err), { tone: "error" }));
                  }}
                  className="mt-1 block h-8 w-full ui-input rounded-chip px-3 text-sm"
                />
              </label>
            ))}
          <form
            className="mt-4 flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newProp.name.trim()) return;
              if (data.properties.length >= 40) return toast.show("A collection can have up to 40 properties.", { tone: "error" });
              addProperty({ collectionId: data.id, name: newProp.name, type: newProp.type }).then(
                () => setNewProp({ name: "", type: "text" }),
                (err) => toast.show(errorMessage(err), { tone: "error" }),
              );
            }}
          >
            <label className="flex-1 text-xs">
              New property
              <input value={newProp.name} onChange={(e) => setNewProp({ ...newProp, name: e.target.value })} className="mt-1 block h-8 w-full ui-input rounded-chip px-3 text-sm" />
            </label>
            <Select aria-label="Property type" value={newProp.type} onChange={(e) => setNewProp({ ...newProp, type: e.target.value as Property["type"] })} className="h-8 ui-input rounded-chip px-3 text-sm">
              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
            <Button size="sm" type="submit" disabled={!newProp.name.trim()}>
              Add
            </Button>
          </form>
          {data.views.length > 1 ? (
            <Button size="sm" variant="quiet" className="mt-6 text-danger" onClick={() => setConfirmView(true)}>
              <Trash2 size={13} aria-hidden /> Delete this view
            </Button>
          ) : null}
        </section>
      </div>
      <ConfirmDialog
        open={confirmProp !== null}
        title={`Delete “${confirmProp?.name ?? ""}”?`}
        body="Its values disappear from every row and view of this collection."
        confirmLabel="Delete property"
        onCancel={() => setConfirmProp(null)}
        onConfirm={async () => {
          if (!confirmProp) return;
          try {
            await deleteProperty({ collectionId: data.id, propertyId: confirmProp.id });
            toast.show(`Deleted “${confirmProp.name}”.`, { tone: "success" });
            setConfirmProp(null);
          } catch (e) {
            toast.show(errorMessage(e), { tone: "error" });
          }
        }}
      />
      <ConfirmDialog
        open={confirmView}
        title={`Delete the “${view.name}” view?`}
        body="Rows and properties stay; only this view’s filters, sorting and layout are removed."
        confirmLabel="Delete view"
        onCancel={() => setConfirmView(false)}
        onConfirm={async () => {
          try {
            await deleteView({ collectionId: data.id, viewId: view.id });
            setConfirmView(false);
            onClose();
          } catch (e) {
            toast.show(errorMessage(e), { tone: "error" });
          }
        }}
      />
    </Dialog>
  );
}

/**
 * The properties of a collection row, shown at the top of the row's own page (editable with write
 * access). Renders nothing for ordinary pages.
 */
export function CollectionRowProperties({ documentId, editable }: { documentId: string; editable: boolean }) {
  const { outbox } = useAppState();
  const info = useOfflineQuery(api.collections.rowForDocument, { documentId });
  // A row added on this device and not sent yet: the server doesn't know its page, the collection on this device does.
  const entries = useOutboxEntries(outbox);
  const waiting = useMemo(() => (info ? undefined : waitingRowPage(entries, documentId)), [info, entries, documentId]);
  const data = useCollection(info ? info.collection.id : (waiting?.collectionId ?? null));
  if (!data || (!info && !waiting)) return null;
  const row = data.rows.find((r) => r.documentId === documentId) ?? (info ? { id: info.row.id, title: info.row.title, values: info.row.values } : null);
  if (!row) return null;
  const canEdit = editable && (info ? info.canEdit : data.canEdit);
  const name = info?.collection.name ?? data.name;
  const hostDocumentId = info ? info.collection.hostDocumentId : data.hostDocumentId;
  return (
    <section aria-label={`Properties in ${name}`} className="mb-6 rounded-chip ui-well px-3 py-2 text-sm">
      <p className="ui-caps mb-1.5">
        {hostDocumentId ? (
          <AppLink href={`/d/${hostDocumentId}`} className="hover:underline">
            {name}
          </AppLink>
        ) : (
          name
        )}
      </p>
      <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] items-center gap-x-4 gap-y-1.5">
        {data.properties.map((p) => (
          <div key={p.id} className="contents">
            <dt className="truncate text-muted" title={TYPE_LABELS[p.type]}>
              {p.name}
            </dt>
            <dd className="min-w-0">
              <PropertyEditor collection={data} row={row} prop={p} canEdit={canEdit} />
            </dd>
          </div>
        ))}
        {data.properties.length === 0 ? <dd className="col-span-2 text-muted">This collection has no properties yet.</dd> : null}
      </dl>
    </section>
  );
}
