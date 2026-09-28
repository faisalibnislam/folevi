// Read-only collection for public share pages (server-rendered; no hooks, no client code).
import { formatCalendarDate, t } from "@/i18n";
import { applyView, isEmptyValue, type ViewFilter, type ViewProperty, type ViewSort } from "./collectionView";

export interface ReadOnlyCollectionData {
  name: string;
  viewType: "table" | "board" | "gallery";
  config: { filters: ViewFilter[]; sorts: ViewSort[]; visibleProperties: string[]; groupBy?: string };
  properties: ViewProperty[];
  /** Relation values arrive as a count; person values as a display name. */
  rows: { id: string; title: string; icon: string | null; values: Record<string, unknown> }[];
}

function optionStyle(color: string) {
  const c = color === "muted" ? "ink-muted" : color;
  return { background: `var(--color-${c === "accent" ? "accent-soft" : c === "ink-muted" ? "surface-sunken" : `${c}-soft`})`, color: `var(--color-${c === "accent" ? "accent-soft-ink" : c === "ink-muted" ? "ink" : `${c}-ink`})` };
}

function Value({ prop, value }: { prop: ViewProperty; value: unknown }) {
  if (isEmptyValue(value) || (prop.type === "relation" && value === 0)) return <span className="text-faint">—</span>;
  switch (prop.type) {
    case "checkbox":
      return <span>{value ? "✓" : ""}</span>;
    case "select": {
      const o = prop.options.find((x) => x.id === value);
      return o ? <span className="rounded-[6px] px-2 py-0.5 text-[11px]" style={optionStyle(o.color)}>{o.name}</span> : null;
    }
    case "multiSelect":
      return (
        <span className="flex flex-wrap gap-1">
          {(Array.isArray(value) ? value : []).map((id) => {
            const o = prop.options.find((x) => x.id === id);
            return o ? (
              <span key={String(id)} className="rounded-[6px] px-2 py-0.5 text-[11px]" style={optionStyle(o.color)}>
                {o.name}
              </span>
            ) : null;
          })}
        </span>
      );
    case "relation":
      return <span>{t("collection.linkedPages", { count: Number(value) })}</span>;
    case "date": {
      const s = String(value);
      return <time dateTime={s}>{/^\d{4}-\d{2}-\d{2}$/.test(s) ? formatCalendarDate(s) : s}</time>;
    }
    case "url":
      return <span className="break-all">{String(value).replace(/^https?:\/\//, "")}</span>;
    default:
      return <span>{String(value)}</span>;
  }
}

/** A collection as its view shows it: filters and sorts applied, visible properties only. */
export function ReadOnlyCollection({ data }: { data: ReadOnlyCollectionData | undefined }) {
  if (!data) return <p className="fb my-3 rounded-[6px] border border-dashed border-line p-4 text-sm text-muted">This collection isn’t available.</p>;
  const rows = applyView(data.rows, data.config, data.properties);
  const visible = data.properties.filter((p) => data.config.visibleProperties.includes(p.id));
  const group = data.viewType === "board" ? data.properties.find((p) => p.id === data.config.groupBy && p.type === "select") : undefined;
  return (
    <section className="my-4 overflow-hidden ui-card rounded-[8px]" aria-label={`Collection ${data.name}`}>
      <h3 className="border-b border-line px-3 py-2 text-sm font-semibold text-heading">{data.name}</h3>
      {group ? (
        <div className="flex gap-3 overflow-x-auto p-3">
          {[...group.options.map((o) => ({ id: o.id as string | null, name: o.name, color: o.color })), { id: null, name: `No ${group.name.toLowerCase()}`, color: "muted" }].map((col) => {
            const items = rows.filter((r) => ((r.values[group.id] as string | undefined) ?? null) === col.id);
            return (
              <section key={col.id ?? "none"} aria-label={`${col.name}, ${items.length}`} className="flex w-60 flex-none flex-col rounded-[6px] bg-sunken p-2">
                <h4 className="mb-2 px-1 text-xs font-semibold">
                  <span className="rounded-[6px] px-2 py-0.5" style={optionStyle(col.color)}>
                    {col.name}
                  </span>
                </h4>
                <ul className="space-y-2">
                  {items.map((r) => (
                    <li key={r.id} className="rounded-[6px] border border-line bg-raised p-2.5 text-sm">
                      <p className="font-medium">
                        
                        {r.title || "Untitled"}
                      </p>
                      {visible
                        .filter((p) => p.id !== group.id)
                        .map((p) => (
                          <p key={p.id} className="mt-0.5 flex gap-1 text-xs text-muted">
                            <span className="text-faint">{p.name}:</span> <Value prop={p} value={r.values[p.id]} />
                          </p>
                        ))}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      ) : data.viewType === "gallery" ? (
        <ul className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <li key={r.id} className="ui-card rounded-[8px] p-3 text-sm">
              <p className="font-medium">
                
                {r.title || "Untitled"}
              </p>
              {visible.map((p) => (
                <p key={p.id} className="mt-0.5 text-xs text-muted">
                  <Value prop={p} value={r.values[p.id]} />
                </p>
              ))}
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th scope="col" className="border-b border-line px-3 py-2 font-medium">
                  Name
                </th>
                {visible.map((p) => (
                  <th key={p.id} scope="col" className="border-b border-l border-line px-3 py-2 font-medium">
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="border-b border-line px-3 py-1.5 text-left font-medium">
                    
                    {r.title || "Untitled"}
                  </th>
                  {visible.map((p) => (
                    <td key={p.id} className="border-b border-l border-line px-3 py-1.5">
                      <Value prop={p} value={r.values[p.id]} />
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={visible.length + 1} className="px-3 py-6 text-center text-muted">
                    No rows.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
