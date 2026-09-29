// Pure collection view logic (filters and sorts), shared by the live embed (client) and the read-only
// copy on public share pages (server). No React, no Convex.

export type PropertyType = "text" | "number" | "checkbox" | "date" | "select" | "multiSelect" | "url" | "person" | "relation";
export type FilterOp = "is" | "isNot" | "contains" | "isEmpty" | "isNotEmpty" | "gt" | "lt" | "checked" | "unchecked";

export interface ViewProperty {
  id: string;
  name: string;
  type: PropertyType;
  options: { id: string; name: string; color: string }[];
}
export interface ViewFilter {
  propertyId: string;
  op: FilterOp;
  value?: unknown;
}
export interface ViewSort {
  propertyId: string;
  direction: "asc" | "desc";
}
export interface ViewRow {
  title: string;
  values: Record<string, unknown>;
}

/** The row title, filterable and sortable like a property. */
export const TITLE_ID = "title";
export type FilterTarget = { id: string; name: string; type: PropertyType | "title"; options: ViewProperty["options"] };

export const OPS: Record<FilterTarget["type"], FilterOp[]> = {
  title: ["contains", "is", "isNot", "isEmpty", "isNotEmpty"],
  text: ["contains", "is", "isNot", "isEmpty", "isNotEmpty"],
  url: ["contains", "is", "isNot", "isEmpty", "isNotEmpty"],
  number: ["is", "isNot", "gt", "lt", "isEmpty", "isNotEmpty"],
  checkbox: ["checked", "unchecked"],
  date: ["is", "lt", "gt", "isEmpty", "isNotEmpty"],
  select: ["is", "isNot", "isEmpty", "isNotEmpty"],
  multiSelect: ["is", "isNot", "isEmpty", "isNotEmpty"],
  person: ["is", "isNot", "isEmpty", "isNotEmpty"],
  relation: ["isNotEmpty", "isEmpty"],
};

export const NO_VALUE_OPS: FilterOp[] = ["isEmpty", "isNotEmpty", "checked", "unchecked"];

export function opLabel(type: FilterTarget["type"], op: FilterOp): string {
  if (type === "date") return ({ is: "is on", isNot: "is not on", lt: "is before", gt: "is after", isEmpty: "is empty", isNotEmpty: "is not empty" } as Record<string, string>)[op] ?? op;
  if (type === "multiSelect") return ({ is: "has", isNot: "doesn’t have", isEmpty: "is empty", isNotEmpty: "is not empty" } as Record<string, string>)[op] ?? op;
  if (type === "number") return ({ is: "=", isNot: "≠", gt: ">", lt: "<", isEmpty: "is empty", isNotEmpty: "is not empty" } as Record<string, string>)[op] ?? op;
  return { is: "is", isNot: "is not", contains: "contains", isEmpty: "is empty", isNotEmpty: "is not empty", checked: "is checked", unchecked: "is unchecked", gt: "is greater than", lt: "is less than" }[op];
}

export function filterTargets(props: ViewProperty[]): FilterTarget[] {
  return [{ id: TITLE_ID, name: "Name", type: "title", options: [] }, ...props.map((p) => ({ id: p.id, name: p.name, type: p.type, options: p.options }))];
}

/** Select filters store an option id; older views stored the typed option name, so map those to the id. */
export function resolveOption(target: FilterTarget, value: unknown): unknown {
  if (target.type !== "select" && target.type !== "multiSelect") return value;
  if (typeof value !== "string") return value;
  if (target.options.some((o) => o.id === value)) return value;
  return target.options.find((o) => o.name.toLowerCase() === value.trim().toLowerCase())?.id ?? value;
}

export function isEmptyValue(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

export function matchesFilter(row: ViewRow, f: ViewFilter, props: ViewProperty[]): boolean {
  const target = filterTargets(props).find((t) => t.id === f.propertyId);
  if (!target) return true; // filter on a deleted property: ignored
  const v = target.type === "title" ? row.title : row.values[f.propertyId];
  const empty = isEmptyValue(v) || (target.type === "relation" && v === 0);
  switch (f.op) {
    case "isEmpty":
      return empty;
    case "isNotEmpty":
      return !empty;
    case "checked":
      return v === true;
    case "unchecked":
      return v !== true;
  }
  const wanted = resolveOption(target, f.value);
  if (isEmptyValue(wanted)) return true; // a filter without a value yet doesn't hide anything
  switch (target.type) {
    case "select":
    case "person":
      return f.op === "isNot" ? v !== wanted : f.op === "is" ? v === wanted : true;
    case "multiSelect": {
      const has = Array.isArray(v) && v.includes(wanted);
      return f.op === "isNot" ? !has : f.op === "is" ? has : true;
    }
    case "number": {
      const n = typeof v === "number" ? v : NaN;
      const t = typeof wanted === "number" ? wanted : Number(wanted);
      if (!Number.isFinite(t)) return true;
      if (f.op === "isNot") return n !== t;
      if (empty) return false;
      return f.op === "is" ? n === t : f.op === "gt" ? n > t : f.op === "lt" ? n < t : true;
    }
    case "date": {
      // ISO dates (YYYY-MM-DD) order correctly as strings; never coerce them to numbers.
      const t = String(wanted);
      if (f.op === "isNot") return v !== t;
      if (empty || typeof v !== "string") return false;
      return f.op === "is" ? v === t : f.op === "gt" ? v > t : f.op === "lt" ? v < t : true;
    }
    case "relation":
      return true;
    default: {
      const s = String(v ?? "").toLowerCase();
      const t = String(wanted).toLowerCase();
      return f.op === "contains" ? s.includes(t) : f.op === "is" ? s === t : f.op === "isNot" ? s !== t : true;
    }
  }
}

export function applyView<R extends ViewRow>(rows: R[], config: { filters: ViewFilter[]; sorts: ViewSort[] }, props: ViewProperty[]): R[] {
  let out = rows.filter((r) => config.filters.every((f) => matchesFilter(r, f, props)));
  if (config.sorts.length) {
    out = [...out].sort((a, b) => {
      for (const s of config.sorts) {
        const av = s.propertyId === TITLE_ID ? a.title : a.values[s.propertyId];
        const bv = s.propertyId === TITLE_ID ? b.title : b.values[s.propertyId];
        const cmp = av === bv ? 0 : av === undefined ? 1 : bv === undefined ? -1 : typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
        if (cmp) return s.direction === "asc" ? cmp : -cmp;
      }
      return 0;
    });
  }
  return out;
}
