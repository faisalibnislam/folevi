// The checks a collection's writes go through, shared by the server (convex/collections.ts) and local mode
// (apps/web/src/lib/local/functions/collections.ts), so both refuse and normalize the same way:
//
//   normalizeCollectionValue(property, value)   a cell value as stored for its property's type, or why not
//   normalizeCollectionNumberFormat(format)     a number format as stored
//   cleanCollectionFormula(text)                a formula's text as stored (then collectionFormulaProblem)
//   normalizeCollectionOptions(options)         a select property's options as stored
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
 * A view's config as stored: at most 20 filters and 5 sorts, one summary per column (the last one sent wins)
 * and at most 41 (every property and the title). Without summaries, the field is left out.
 */
export function clampCollectionViewConfig<C extends { filters: unknown[]; sorts: unknown[]; summaries?: { propertyId: string }[] }>(config: C): C {
  const summaries = config.summaries ? [...new Map(config.summaries.map((x) => [x.propertyId, x])).values()].slice(0, 41) : undefined;
  const out = { ...config, filters: config.filters.slice(0, 20), sorts: config.sorts.slice(0, 5), summaries };
  if (!summaries) delete out.summaries;
  return out;
}
