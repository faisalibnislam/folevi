"use client";

import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { ArrowDownUp, Columns3, Filter, GalleryHorizontalEnd, Plus, Settings2, Table2, Trash2 } from "lucide-react";
import { api } from "@/lib/convex/api";
import { AppLink } from "@/lib/app/router";
import { useAppState } from "@/lib/app/state";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { coverBackground } from "@/lib/cover";

type CollectionData = NonNullable<ReturnType<typeof useCollection>>;
type Property = CollectionData["properties"][number];
type Row = CollectionData["rows"][number];
type View = CollectionData["views"][number];
type ViewConfig = View["config"];

function useCollection(collectionId: string) {
  return useQuery(api.collections.get, { collectionId });
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

function matchesFilter(row: Row, f: ViewConfig["filters"][number], props: Property[]): boolean {
  const prop = props.find((p) => p.id === f.propertyId);
  const v = row.values[f.propertyId];
  const text = Array.isArray(v) ? v.join(" ") : v === undefined || v === null ? "" : String(v);
  switch (f.op) {
    case "isEmpty":
      return text === "";
    case "isNotEmpty":
      return text !== "";
    case "checked":
      return v === true;
    case "unchecked":
      return v !== true;
    case "is":
      return prop?.type === "multiSelect" ? Array.isArray(v) && v.includes(f.value) : text === String(f.value ?? "");
    case "isNot":
      return prop?.type === "multiSelect" ? !(Array.isArray(v) && v.includes(f.value)) : text !== String(f.value ?? "");
    case "contains":
      return text.toLowerCase().includes(String(f.value ?? "").toLowerCase());
    case "gt":
      return Number(v) > Number(f.value);
    case "lt":
      return Number(v) < Number(f.value);
  }
}

function applyView(rows: Row[], config: ViewConfig, props: Property[]): Row[] {
  let out = rows.filter((r) => config.filters.every((f) => matchesFilter(r, f, props)));
  if (config.sorts.length) {
    out = [...out].sort((a, b) => {
      for (const s of config.sorts) {
        const av = s.propertyId === "title" ? a.title : a.values[s.propertyId];
        const bv = s.propertyId === "title" ? b.title : b.values[s.propertyId];
        const cmp = av === bv ? 0 : av === undefined ? 1 : bv === undefined ? -1 : typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
        if (cmp) return s.direction === "asc" ? cmp : -cmp;
      }
      return 0;
    });
  }
  return out;
}

/** A collection embedded in a document: typed properties with table, board and gallery views. */
export function CollectionEmbed({ collectionId, initialViewId, editable }: { collectionId: string; initialViewId: string | null; editable: boolean }) {
  const data = useCollection(collectionId);
  const [viewId, setViewId] = useState<string | null>(initialViewId);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const addRow = useMutation(api.collections.addRow);
  const addView = useMutation(api.collections.addViewToCollection);
  const toast = useToast();

  if (data === undefined) return <div className="h-40 animate-pulse ui-card rounded-[18px] motion-reduce:animate-none" aria-busy />;
  if (data === null) return <p className="rounded-[14px] border border-dashed border-line p-4 text-sm text-muted">This collection is unavailable.</p>;
  const view = data.views.find((v) => v.id === viewId) ?? data.views[0]!;
  const canEdit = editable && data.canEdit;
  const rows = applyView(data.rows, view.config, data.properties);
  const visible = data.properties.filter((p) => view.config.visibleProperties.includes(p.id));

  const add = async (values?: Record<string, unknown>) => {
    try {
      await addRow({ collectionId, title: "", values });
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    }
  };

  return (
    <section className="ui-card rounded-[18px]" aria-label={`Collection ${data.name}`}>
      <header className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2">
        <h3 className="mr-2 text-sm font-semibold">{data.name}</h3>
        <div role="tablist" aria-label="Views" className="flex flex-wrap gap-1">
          {data.views.map((v) => (
            <button
              key={v.id}
              role="tab"
              type="button"
              aria-selected={v.id === view.id}
              onClick={() => setViewId(v.id)}
              className={`inline-flex h-7 items-center gap-1.5 rounded-[9px] px-2 text-xs ${v.id === view.id ? "bg-accent-soft text-accent-soft-ink" : "text-muted hover:bg-surface"}`}
            >
              {v.type === "table" ? <Table2 size={13} aria-hidden /> : v.type === "board" ? <Columns3 size={13} aria-hidden /> : <GalleryHorizontalEnd size={13} aria-hidden />}
              {v.name}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {canEdit ? (
            <>
              <button type="button" onClick={() => setSettingsOpen(true)} className="inline-flex h-7 items-center gap-1 rounded-[9px] px-2 text-xs text-muted hover:bg-surface" aria-label="View settings: filter, sort, group, properties">
                <Settings2 size={13} aria-hidden /> View
              </button>
              <select
                aria-label="Add view"
                value=""
                onChange={(e) => {
                  const type = e.target.value as View["type"];
                  if (!type) return;
                  addView({ collectionId, name: type === "table" ? "Table" : type === "board" ? "Board" : "Gallery", type }).then(
                    (r) => setViewId(r.id),
                    (err) => toast.show(errorMessage(err), { tone: "error" }),
                  );
                }}
                className="h-7 ui-input rounded-full px-1 text-xs text-muted"
              >
                <option value="">+ View</option>
                <option value="table">Table</option>
                <option value="board">Board</option>
                <option value="gallery">Gallery</option>
              </select>
            </>
          ) : null}
        </div>
      </header>
      <p className="sr-only" aria-live="polite">
        {rows.length} of {data.rows.length} rows shown
      </p>
      {view.type === "table" ? (
        <TableCollection data={data} rows={rows} visible={visible} canEdit={canEdit} />
      ) : view.type === "board" ? (
        <BoardCollection data={data} view={view} rows={rows} visible={visible} canEdit={canEdit} onAdd={add} />
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

function CellEditor({ collectionId, row, prop, canEdit }: { collectionId: string; row: Row; prop: Property; canEdit: boolean }) {
  const setValue = useMutation(api.collections.setValue);
  const toast = useToast();
  const value = row.values[prop.id];
  const save = (v: unknown) => setValue({ collectionId, rowId: row.id, propertyId: prop.id, value: v }).catch((e) => toast.show(errorMessage(e), { tone: "error" }));
  const label = `${prop.name} for ${row.title || "Untitled"}`;
  if (!canEdit) return <CellDisplay prop={prop} value={value} />;
  switch (prop.type) {
    case "checkbox":
      return <input type="checkbox" aria-label={label} checked={value === true} onChange={(e) => void save(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />;
    case "number":
      return <input type="number" aria-label={label} defaultValue={typeof value === "number" ? value : ""} onBlur={(e) => void save(e.target.value === "" ? null : Number(e.target.value))} className="w-full bg-transparent outline-none" />;
    case "date":
      return <input type="date" aria-label={label} value={typeof value === "string" ? value : ""} onChange={(e) => void save(e.target.value || null)} className="bg-transparent outline-none" />;
    case "select":
      return (
        <select aria-label={label} value={typeof value === "string" ? value : ""} onChange={(e) => void save(e.target.value || null)} className="w-full bg-transparent outline-none">
          <option value="">—</option>
          {prop.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      );
    case "multiSelect": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
          {prop.options.map((o) => {
            const on = selected.includes(o.id);
            return (
              <button key={o.id} type="button" aria-pressed={on} onClick={() => void save(on ? selected.filter((x) => x !== o.id) : [...selected, o.id])} className={`rounded-[8px] px-1.5 py-0.5 text-[11px] ${on ? "" : "opacity-40"}`} style={optionColor(o.color)}>
                {o.name}
              </button>
            );
          })}
        </div>
      );
    }
    case "person":
      return <PersonEditor label={label} value={typeof value === "string" ? value : null} onChange={(v) => void save(v)} />;
    case "relation":
      return <RelationEditor label={label} value={Array.isArray(value) ? (value as string[]) : []} onChange={(v) => void save(v)} />;
    default:
      return (
        <input
          aria-label={label}
          defaultValue={typeof value === "string" ? value : ""}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== (value ?? "")) void save(v || null);
          }}
          className="w-full bg-transparent outline-none"
          type={prop.type === "url" ? "url" : "text"}
        />
      );
  }
}

function PersonEditor({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  const { workspace } = useAppState();
  const members = useQuery(api.workspaces.members, { workspaceId: workspace.id });
  return (
    <select aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className="w-full bg-transparent outline-none">
      <option value="">—</option>
      {members?.members.map((m) => (
        <option key={m.profileId} value={m.profileId}>
          {m.displayName}
        </option>
      ))}
    </select>
  );
}

function RelationEditor({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  const { workspace } = useAppState();
  const titles = useQuery(api.documents.titles, value.length ? { documentIds: value } : "skip");
  const recent = useQuery(api.documents.recent, { workspaceId: workspace.id, limit: 12 });
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={label}>
      {value.map((id) => (
        <span key={id} className="inline-flex items-center gap-1 rounded-[8px] bg-sunken px-1.5 py-0.5 text-[11px]">
          <AppLink href={`/d/${id}`} className="hover:underline">
            {titles?.[id]?.title || "Untitled"}
          </AppLink>
          <button type="button" aria-label={`Remove ${titles?.[id]?.title || "page"}`} onClick={() => onChange(value.filter((x) => x !== id))} className="text-faint hover:text-ink">
            ×
          </button>
        </span>
      ))}
      <select aria-label={`Add page to ${label}`} value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])} className="max-w-[8rem] bg-transparent text-[11px] text-muted outline-none">
        <option value="">+ Link page</option>
        {recent?.filter((d) => !value.includes(d.id)).map((d) => (
          <option key={d.id} value={d.id}>
            {d.title || "Untitled"}
          </option>
        ))}
      </select>
    </div>
  );
}

function CellDisplay({ prop, value }: { prop: Property; value: unknown }) {
  if (value === undefined || value === null || value === "") return <span className="text-faint">—</span>;
  if (prop.type === "checkbox") return <span>{value ? "✓" : ""}</span>;
  if (prop.type === "select") {
    const o = prop.options.find((x) => x.id === value);
    return o ? <span className="rounded-[8px] px-1.5 py-0.5 text-[11px]" style={optionColor(o.color)}>{o.name}</span> : null;
  }
  if (prop.type === "multiSelect" && Array.isArray(value)) {
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((id) => {
          const o = prop.options.find((x) => x.id === id);
          return o ? (
            <span key={id} className="rounded-[8px] px-1.5 py-0.5 text-[11px]" style={optionColor(o.color)}>
              {o.name}
            </span>
          ) : null;
        })}
      </span>
    );
  }
  if (prop.type === "url" && typeof value === "string") {
    return (
      <a href={value} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline underline-offset-2">
        {value.replace(/^https?:\/\//, "")}
      </a>
    );
  }
  return <span>{String(value)}</span>;
}

function TableCollection({ data, rows, visible, canEdit }: { data: CollectionData; rows: Row[]; visible: Property[]; canEdit: boolean }) {
  const deleteRow = useMutation(api.collections.deleteRow);
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
                <AppLink href={`/d/${row.documentId}`} className="inline-flex items-center gap-1.5 font-medium hover:underline">
                  <span aria-hidden>{row.icon ?? "📄"}</span>
                  {row.title || "Untitled"}
                </AppLink>
              </td>
              {visible.map((p) => (
                <td key={p.id} className="border-b border-l border-line px-3 py-1.5">
                  <CellEditor collectionId={data.id} row={row} prop={p} canEdit={canEdit} />
                </td>
              ))}
              {canEdit ? (
                <td className="border-b border-line text-center">
                  <button type="button" aria-label={`Delete ${row.title || "row"}`} onClick={() => void deleteRow({ collectionId: data.id, rowId: row.id })} className="text-faint opacity-0 hover:text-danger group-hover:opacity-100 focus:opacity-100">
                    <Trash2 size={13} aria-hidden />
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={visible.length + 2} className="px-3 py-6 text-center text-sm text-muted">
                No rows match this view.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function BoardCollection({ data, view, rows, visible, canEdit, onAdd }: { data: CollectionData; view: View; rows: Row[]; visible: Property[]; canEdit: boolean; onAdd: (values?: Record<string, unknown>) => Promise<void> }) {
  const moveRow = useMutation(api.collections.moveRow);
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
            aria-label={`${col.name}, ${items.length} cards`}
            className="flex w-64 flex-none flex-col rounded-[14px] bg-sunken p-2"
            onDragOver={(e) => canEdit && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging) void move(dragging, col.id, items[items.length - 1]?.id ?? null);
              setDragging(null);
            }}
          >
            <h4 className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold">
              <span className="rounded-[8px] px-1.5 py-0.5" style={optionColor(col.color)}>
                {col.name}
              </span>
              <span className="text-faint">{items.length}</span>
            </h4>
            <ul className="space-y-2">
              {items.map((row) => (
                <li key={row.id} draggable={canEdit} onDragStart={() => setDragging(row.id)} className="rounded-[11px] border border-line bg-raised p-2.5 text-sm shadow-[0_1px_0_var(--color-line)]">
                  <AppLink href={`/d/${row.documentId}`} className="font-medium hover:underline">
                    {row.icon ? `${row.icon} ` : ""}
                    {row.title || "Untitled"}
                  </AppLink>
                  <div className="mt-1 space-y-0.5 text-xs text-muted">
                    {visible
                      .filter((p) => p.id !== group.id)
                      .map((p) => (
                        <div key={p.id} className="flex gap-1">
                          <span className="text-faint">{p.name}:</span> <CellDisplay prop={p} value={row.values[p.id]} />
                        </div>
                      ))}
                  </div>
                  {canEdit ? (
                    <label className="mt-1.5 flex items-center gap-1 text-[11px] text-faint">
                      <span className="sr-only">Move {row.title || "card"} to</span>
                      <select value={col.id ?? ""} onChange={(e) => void move(row.id, e.target.value || null, null)} className="bg-transparent">
                        {columns.map((c) => (
                          <option key={c.id ?? "none"} value={c.id ?? ""}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </li>
              ))}
            </ul>
            {canEdit ? (
              <button type="button" onClick={() => void onAdd(col.id ? { [group.id]: col.id } : undefined)} className="mt-2 flex items-center gap-1 rounded-[9px] px-1 py-1 text-xs text-muted hover:bg-raised">
                <Plus size={12} aria-hidden /> New
              </button>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function GalleryCollection({ view, rows, visible }: { data: CollectionData; view: View; rows: Row[]; visible: Property[] }) {
  const size = view.config.cardSize === "small" ? "sm:grid-cols-3 lg:grid-cols-4" : view.config.cardSize === "large" ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3";
  return (
    <ul className={`grid grid-cols-1 gap-3 p-3 ${size}`}>
      {rows.map((row) => (
        <li key={row.id}>
          <AppLink href={`/d/${row.documentId}`} className="block overflow-hidden ui-card rounded-[18px] transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[var(--shadow-pop)]">
            {view.config.cardPreview !== "none" ? (
              <div className="h-24 border-b border-line" style={{ background: coverBackground(row.cover, { font: "sans", width: "default", background: "paper", accent: "plum", card: "folio" }) ?? "var(--color-surface)" }}>
                {view.config.cardPreview === "content" ? <p className="line-clamp-4 p-3 text-xs text-muted">{row.excerpt}</p> : <div className="grid h-full place-items-center text-3xl">{row.icon ?? "📄"}</div>}
              </div>
            ) : null}
            <div className="p-3">
              <p className="font-medium">{row.title || "Untitled"}</p>
              <div className="mt-1 space-y-0.5 text-xs text-muted">
                {visible.map((p) => (
                  <div key={p.id}>
                    <CellDisplay prop={p} value={row.values[p.id]} />
                  </div>
                ))}
              </div>
            </div>
          </AppLink>
        </li>
      ))}
    </ul>
  );
}

function ViewSettings({ open, onClose, data, view }: { open: boolean; onClose: () => void; data: CollectionData; view: View }) {
  const updateView = useMutation(api.collections.updateView);
  const addProperty = useMutation(api.collections.addProperty);
  const updateProperty = useMutation(api.collections.updateProperty);
  const deleteProperty = useMutation(api.collections.deleteProperty);
  const deleteView = useMutation(api.collections.deleteView);
  const toast = useToast();
  const [newProp, setNewProp] = useState<{ name: string; type: Property["type"] }>({ name: "", type: "text" });
  const config = view.config;
  const save = (next: Partial<ViewConfig>) => updateView({ collectionId: data.id, viewId: view.id, config: { ...config, ...next } }).catch((e) => toast.show(errorMessage(e), { tone: "error" }));
  const selectProps = useMemo(() => data.properties.filter((p) => p.type === "select"), [data.properties]);

  return (
    <Dialog open={open} onClose={onClose} title={`${view.name} settings`} description="Filters, sorting, grouping and visible properties are saved with this view." size="lg">
      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <Filter size={14} aria-hidden /> Filters
          </h3>
          {config.filters.map((f, i) => (
            <div key={i} className="mb-2 flex flex-wrap items-center gap-1.5 text-sm">
              <select aria-label="Property" value={f.propertyId} onChange={(e) => void save({ filters: config.filters.map((x, j) => (j === i ? { ...x, propertyId: e.target.value } : x)) })} className="h-8 ui-input rounded-full px-1">
                {data.properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select aria-label="Condition" value={f.op} onChange={(e) => void save({ filters: config.filters.map((x, j) => (j === i ? { ...x, op: e.target.value as typeof f.op } : x)) })} className="h-8 ui-input rounded-full px-1">
                {["is", "isNot", "contains", "isEmpty", "isNotEmpty", "gt", "lt", "checked", "unchecked"].map((op) => (
                  <option key={op} value={op}>
                    {op.replace(/([A-Z])/g, " $1").toLowerCase()}
                  </option>
                ))}
              </select>
              {!["isEmpty", "isNotEmpty", "checked", "unchecked"].includes(f.op) ? (
                <input aria-label="Value" defaultValue={String(f.value ?? "")} onBlur={(e) => void save({ filters: config.filters.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} className="h-8 w-28 ui-input rounded-full px-2" />
              ) : null}
              <button type="button" aria-label="Remove filter" onClick={() => void save({ filters: config.filters.filter((_, j) => j !== i) })} className="text-faint hover:text-danger">
                <Trash2 size={13} aria-hidden />
              </button>
            </div>
          ))}
          <Button size="sm" onClick={() => void save({ filters: [...config.filters, { propertyId: data.properties[0]?.id ?? "", op: "isNotEmpty" }] })} disabled={!data.properties.length}>
            <Plus size={12} aria-hidden /> Add filter
          </Button>

          <h3 className="mb-2 mt-6 flex items-center gap-1.5 text-sm font-semibold">
            <ArrowDownUp size={14} aria-hidden /> Sort
          </h3>
          {config.sorts.map((s, i) => (
            <div key={i} className="mb-2 flex items-center gap-1.5 text-sm">
              <select aria-label="Sort property" value={s.propertyId} onChange={(e) => void save({ sorts: config.sorts.map((x, j) => (j === i ? { ...x, propertyId: e.target.value } : x)) })} className="h-8 ui-input rounded-full px-1">
                <option value="title">Name</option>
                {data.properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select aria-label="Direction" value={s.direction} onChange={(e) => void save({ sorts: config.sorts.map((x, j) => (j === i ? { ...x, direction: e.target.value as "asc" | "desc" } : x)) })} className="h-8 ui-input rounded-full px-1">
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
              <button type="button" aria-label="Remove sort" onClick={() => void save({ sorts: config.sorts.filter((_, j) => j !== i) })} className="text-faint hover:text-danger">
                <Trash2 size={13} aria-hidden />
              </button>
            </div>
          ))}
          <Button size="sm" onClick={() => void save({ sorts: [...config.sorts, { propertyId: "title", direction: "asc" }] })}>
            <Plus size={12} aria-hidden /> Add sort
          </Button>

          {view.type === "board" ? (
            <label className="mt-6 block text-sm">
              <span className="font-semibold">Group by</span>
              <select value={config.groupBy ?? ""} onChange={(e) => void save({ groupBy: e.target.value || undefined })} className="mt-1 block h-8 ui-input rounded-full px-1">
                {selectProps.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {view.type === "gallery" ? (
            <div className="mt-6 flex gap-4 text-sm">
              <label>
                <span className="font-semibold">Card preview</span>
                <select value={config.cardPreview} onChange={(e) => void save({ cardPreview: e.target.value as ViewConfig["cardPreview"] })} className="mt-1 block h-8 ui-input rounded-full px-1">
                  <option value="none">None</option>
                  <option value="cover">Cover</option>
                  <option value="content">Page content</option>
                </select>
              </label>
              <label>
                <span className="font-semibold">Card size</span>
                <select value={config.cardSize} onChange={(e) => void save({ cardSize: e.target.value as ViewConfig["cardSize"] })} className="mt-1 block h-8 ui-input rounded-full px-1">
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </select>
              </label>
            </div>
          ) : null}
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold">Properties</h3>
          <ul className="space-y-1.5">
            {data.properties.map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label={`Show ${p.name}`}
                  checked={config.visibleProperties.includes(p.id)}
                  onChange={(e) => void save({ visibleProperties: e.target.checked ? [...config.visibleProperties, p.id] : config.visibleProperties.filter((x) => x !== p.id) })}
                />
                <input
                  aria-label="Property name"
                  defaultValue={p.name}
                  onBlur={(e) => e.target.value !== p.name && void updateProperty({ collectionId: data.id, propertyId: p.id, name: e.target.value })}
                  className="h-7 flex-1 rounded-[8px] border border-transparent bg-transparent px-1 hover:border-line"
                />
                <span className="text-xs text-faint">{TYPE_LABELS[p.type]}</span>
                <button type="button" aria-label={`Delete property ${p.name}`} onClick={() => void deleteProperty({ collectionId: data.id, propertyId: p.id })} className="text-faint hover:text-danger">
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
                  defaultValue={p.options.map((o) => o.name).join(", ")}
                  onBlur={(e) => {
                    const names = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                    const options = names.map((name) => ({ id: p.options.find((o) => o.name === name)?.id, name, color: p.options.find((o) => o.name === name)?.color }));
                    void updateProperty({ collectionId: data.id, propertyId: p.id, options });
                  }}
                  className="mt-1 block h-8 w-full ui-input rounded-full px-2 text-sm"
                />
              </label>
            ))}
          <form
            className="mt-4 flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newProp.name.trim()) return;
              addProperty({ collectionId: data.id, name: newProp.name, type: newProp.type }).then(
                () => setNewProp({ name: "", type: "text" }),
                (err) => toast.show(errorMessage(err), { tone: "error" }),
              );
            }}
          >
            <label className="flex-1 text-xs">
              New property
              <input value={newProp.name} onChange={(e) => setNewProp({ ...newProp, name: e.target.value })} className="mt-1 block h-8 w-full ui-input rounded-full px-2 text-sm" />
            </label>
            <select aria-label="Property type" value={newProp.type} onChange={(e) => setNewProp({ ...newProp, type: e.target.value as Property["type"] })} className="h-8 ui-input rounded-full px-1 text-sm">
              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <Button size="sm" type="submit">
              Add
            </Button>
          </form>
          {data.views.length > 1 ? (
            <Button size="sm" variant="quiet" className="mt-6 text-danger" onClick={() => deleteView({ collectionId: data.id, viewId: view.id }).then(onClose, (e) => toast.show(errorMessage(e), { tone: "error" }))}>
              <Trash2 size={13} aria-hidden /> Delete this view
            </Button>
          ) : null}
        </section>
      </div>
    </Dialog>
  );
}
