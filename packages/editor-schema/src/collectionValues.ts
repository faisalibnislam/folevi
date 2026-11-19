// The checks a collection's writes go through, shared by the server (convex/collections.ts) and local mode
// (apps/web/src/lib/local/functions/collections.ts), so both refuse and normalize the same way:
//
//   normalizeCollectionValue(property, value)   a cell value as stored for its property's type, or why not
//   normalizeCollectionNumberFormat(format)     a number format as stored
//   cleanCollectionFormula(text)                a formula's text as stored (then collectionFormulaProblem)
//   normalizeCollectionOptions(options)         a select property's options as stored
//   renamedCollectionOptions(existing, names)   the options after their names were edited: a rename keeps its id
//   clampCollectionViewConfig(config)           a view's config as stored (at most 20 filters, 5 sorts...)
import { ulid } from "./ids";
import { TABLE_CURRENCIES } from "./tableFormulas";
import type { CollectionNumberFormat } from "./collectionFormulas";

export type CollectionPropertyType = "text" | "number" | "checkbox" | "date" | "select" | "multiSelect" | "url" | "person" | "relation" | "formula";

export interface CollectionOption {
  id: string;
  name: string;
  color: string;
}

/** The colours a select option can have (the first ones go round when none is given). */
export const COLLECTION_OPTION_COLORS = ["accent", "moss", "marigold", "plum", "coral", "muted"] as const;

/** A view's layout, and the name a new one gets. */
export const COLLECTION_VIEW_NAMES = { table: "Table", board: "Board", gallery: "Gallery", calendar: "Calendar" } as const;

/** At most this many properties, rows and views in a collection. */
export const COLLECTION_LIMITS = { properties: 40, rows: 2000, views: 20 } as const;

/**
 * A cell value as stored for its property's type: `{ value }` (null clears the cell), or `{ problem }` in plain
 * words when it can't be set (the server refuses it as invalid_argument).
 */
export function normalizeCollectionValue(property: { type: CollectionPropertyType; options: readonly { id: string }[] }, value: unknown): { value: unknown } | { problem: string } {
  if (value === null || value === undefined || value === "") return { value: null };
  const no = (problem: string) => ({ problem });
  switch (property.type) {
    case "text":
      if (typeof value !== "string") return no("Expected text.");
      return { value: value.slice(0, 2000) };
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) return no("Expected a number.");
      return { value: n };
    }
    case "checkbox":
      if (typeof value !== "boolean") return no("Expected true or false.");
      return { value };
    case "date":
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return no("Expected a date (YYYY-MM-DD).");
      return { value };
    case "select":
      if (typeof value !== "string" || !property.options.some((o) => o.id === value)) return no("Unknown option.");
      return { value };
    case "multiSelect": {
      if (!Array.isArray(value)) return no("Expected a list of options.");
      const ids = [...new Set(value.filter((x): x is string => typeof x === "string"))];
      if (ids.some((id) => !property.options.some((o) => o.id === id))) return no("Unknown option.");
      return { value: ids };
    }
    case "url":
      if (typeof value !== "string" || !/^https?:\/\/\S+$/i.test(value) || value.length > 2048) return no("Expected a web address.");
      return { value };
    case "person":
      if (typeof value !== "string") return no("Expected a person.");
      return { value };
    case "relation": {
      if (!Array.isArray(value)) return no("Expected a list of documents.");
      return { value: [...new Set(value.filter((x): x is string => typeof x === "string"))].slice(0, 50) };
    }
    case "formula":
      // Worked out from the row wherever it's shown; never stored.
      return no("A formula's values come from its formula and can't be set.");
  }
}

/** A number format as stored: a known style, a known currency, 0 to 6 decimals. */
export function normalizeCollectionNumberFormat(f: CollectionNumberFormat): CollectionNumberFormat {
  const out: CollectionNumberFormat = { format: f.format };
  if (f.format === "currency") out.currency = f.currency && (TABLE_CURRENCIES as readonly string[]).includes(f.currency) ? f.currency : "USD";
  if (typeof f.decimals === "number" && Number.isFinite(f.decimals)) out.decimals = Math.min(6, Math.max(0, Math.round(f.decimals)));
  return out;
}

/** A formula's text as stored: control characters become spaces, then it's trimmed. */
export function cleanCollectionFormula(formula: string): string {
  return formula.replace(/[\u0000-\u0008\u000B-\u001F\u007F]+/g, " ").trim();
}

/**
 * A select property's options as stored (the whole list): at most 100, an option keeps its id (a new one gets
 * one), a name of up to 60 characters, and a known colour (or the next one round).
 */
export function normalizeCollectionOptions(options: readonly { id?: string; name: string; color?: string }[]): CollectionOption[] {
  const colors: readonly string[] = COLLECTION_OPTION_COLORS;
  return options.slice(0, 100).map((o, i) => ({
    id: o.id ?? ulid(),
    name: o.name.trim().slice(0, 60) || "Option",
    color: o.color && colors.includes(o.color) ? o.color : colors[i % colors.length]!,
  }));
}

/**
 * A select property's options after its names were edited as one list ("To do, Doing, Done"): each name with
 * the id and colour of the option it was, so a rename keeps every row's value. Names used to be matched by
 * their exact text only: changing "Todo" to "To do" made a new option with a new id, and every row that held
 * "Todo" lost its value (and its card left the board).
 *
 * An option keeps its id when its name is in the new list as it was, or as it was but for capitals and
 * spaces. Then the names still unmatched are renames of the options still unmatched when they stand in the
 * same places: between the same kept neighbours, and as many of the one as of the other. Otherwise it can't
 * be told which was renamed to which (or whether one was deleted and another added), and they are new options.
 */
export function renamedCollectionOptions(existing: readonly CollectionOption[], names: readonly string[], newId: () => string = ulid): CollectionOption[] {
  const colors: readonly string[] = COLLECTION_OPTION_COLORS;
  const loose = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  // For each name, the option it is (an index into `existing`), or -1.
  const is: number[] = names.map(() => -1);
  const used = new Set<number>();
  const match = (same: (o: CollectionOption, name: string) => boolean) => {
    names.forEach((name, i) => {
      if (is[i]! >= 0) return;
      const k = existing.findIndex((o, at) => !used.has(at) && same(o, name));
      if (k < 0) return;
      is[i] = k;
      used.add(k);
    });
  };
  match((o, name) => o.name === name);
  match((o, name) => loose(o.name) === loose(name));
  // Runs of unmatched names, each between two matched ones (or an end of the list).
  for (let i = 0; i < names.length; i++) {
    if (is[i]! >= 0) continue;
    let end = i;
    while (end + 1 < names.length && is[end + 1]! < 0) end++;
    const before = i > 0 ? is[i - 1]! : -1;
    const after = end + 1 < names.length ? is[end + 1]! : existing.length;
    const free: number[] = [];
    for (let k = before + 1; k < after; k++) if (!used.has(k)) free.push(k);
    if (free.length === end - i + 1) {
      free.forEach((k, n) => {
        is[i + n] = k;
        used.add(k);
      });
    }
    i = end;
  }
  return names.map((name, i) => {
    const kept = is[i]! >= 0 ? existing[is[i]!]! : null;
    return kept ? { id: kept.id, name, color: kept.color } : { id: newId(), name, color: colors[i % colors.length]! };
  });
}

/**
 * A view's config as stored: at most 20 filters and 5 sorts, one summary per column (the last one sent wins)
 * and at most 41 (every property and the title). Without summaries, the field is left out.
 */
export function clampCollectionViewConfig<C extends { filters: unknown[]; sorts: unknown[]; summaries?: { propertyId: string }[] }>(config: C): C {
  const summaries = config.summaries ? [...new Map(config.summaries.map((x) => [x.propertyId, x])).values()].slice(0, 41) : undefined;
  const out = { ...config, filters: config.filters.slice(0, 20), sorts: config.sorts.slice(0, 5), summaries };
  if (!summaries) delete out.summaries;
  return out;
}
