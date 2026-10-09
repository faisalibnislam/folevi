// The JSON schemas tools declare to the model (an OpenAPI subset Gemini accepts), and the check every
// call's arguments go through before a tool runs. The model's arguments are never trusted: anything that
// doesn't fit is refused with a short reason the model can act on, and strings are cleaned and capped.

export type JsonSchema =
  | { type: "string"; description?: string; enum?: readonly string[]; maxLength?: number; minLength?: number }
  | { type: "integer" | "number"; description?: string; minimum?: number; maximum?: number }
  | { type: "boolean"; description?: string }
  | { type: "array"; description?: string; items: JsonSchema; maxItems?: number; minItems?: number }
  | { type: "object"; description?: string; properties: Record<string, JsonSchema>; required?: readonly string[] };

export type ObjectSchema = Extract<JsonSchema, { type: "object" }>;

/** Control characters out (newlines and tabs stay), trimmed, capped. */
export function cleanText(raw: string, max: number): string {
  return raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
}

/** The longest string any argument may be unless its schema says otherwise. */
const DEFAULT_MAX = 2_000;

type Checked = { ok: true; value: unknown } | { ok: false; error: string };

function check(schema: JsonSchema, raw: unknown, path: string): Checked {
  const at = path || "arguments";
  switch (schema.type) {
    case "string": {
      if (typeof raw !== "string") return { ok: false, error: `${at} must be a string.` };
      const value = cleanText(raw, schema.maxLength ?? DEFAULT_MAX);
      if (schema.minLength !== undefined && value.length < schema.minLength) return { ok: false, error: `${at} can't be empty.` };
      if (schema.enum && !schema.enum.includes(value)) return { ok: false, error: `${at} must be one of: ${schema.enum.join(", ")}.` };
      return { ok: true, value };
    }
    case "integer":
    case "number": {
      const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
      if (typeof n !== "number" || !Number.isFinite(n)) return { ok: false, error: `${at} must be a number.` };
      if (schema.type === "integer" && !Number.isInteger(n)) return { ok: false, error: `${at} must be a whole number.` };
      if (schema.minimum !== undefined && n < schema.minimum) return { ok: false, error: `${at} must be at least ${schema.minimum}.` };
      if (schema.maximum !== undefined && n > schema.maximum) return { ok: false, error: `${at} must be at most ${schema.maximum}.` };
      return { ok: true, value: n };
    }
    case "boolean":
      if (typeof raw !== "boolean") return { ok: false, error: `${at} must be true or false.` };
      return { ok: true, value: raw };
    case "array": {
      if (!Array.isArray(raw)) return { ok: false, error: `${at} must be a list.` };
      if (schema.maxItems !== undefined && raw.length > schema.maxItems) return { ok: false, error: `${at} can have at most ${schema.maxItems} items.` };
      if (schema.minItems !== undefined && raw.length < schema.minItems) return { ok: false, error: `${at} needs at least ${schema.minItems} item${schema.minItems === 1 ? "" : "s"}.` };
      const out: unknown[] = [];
      for (const [i, item] of raw.entries()) {
        const r = check(schema.items, item, `${at}[${i}]`);
        if (!r.ok) return r;
        out.push(r.value);
      }
      return { ok: true, value: out };
    }
    case "object": {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: `${at} must be an object.` };
      const input = raw as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of schema.required ?? []) {
        if (input[key] === undefined || input[key] === null) return { ok: false, error: `${path ? `${path}.` : ""}${key} is required.` };
      }
      // Unknown fields are dropped, not refused (models add harmless extras).
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (input[key] === undefined || input[key] === null) continue;
        const r = check(sub, input[key], path ? `${path}.${key}` : key);
        if (!r.ok) return r;
        out[key] = r.value;
      }
      return { ok: true, value: out };
    }
  }
}

/** A tool call's arguments checked against its schema: the cleaned value, or why they don't fit. */
export function checkArgs<T = Record<string, unknown>>(schema: ObjectSchema, raw: unknown): { ok: true; value: T } | { ok: false; error: string } {
  const r = check(schema, raw ?? {}, "");
  return r.ok ? { ok: true, value: r.value as T } : r;
}
