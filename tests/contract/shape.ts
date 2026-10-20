// Shapes of Convex functions' arguments and results, and whether one shape can stand in for another
// (tests/contract/api-snapshot.test.ts). Arguments come from the functions' validators (`exportArgs()`); results
// from TypeScript (`FunctionReturnType`), since most functions don't declare a `returns` validator.
import ts from "typescript";

export type Shape =
  | { t: "any" | "unknown" | "string" | "number" | "boolean" | "null" | "undefined" | "bigint" | "bytes" | "never" }
  | { t: "literal"; v: string | number | boolean }
  | { t: "id"; table: string }
  | { t: "array"; of: Shape }
  | { t: "tuple"; of: Shape[] }
  | { t: "record"; value: Shape }
  | { t: "object"; props: Record<string, { type: Shape; optional?: true }>; index?: Shape }
  | { t: "union"; of: Shape[] }
  /** A recursive type, cut where it repeats. */
  | { t: "ref"; name: string };

const key = (s: Shape) => JSON.stringify(s);

/** A union, flattened, deduplicated and sorted, with `true | false` as boolean. */
export function union(members: Shape[]): Shape {
  const flat: Shape[] = [];
  for (const m of members) {
    if (m.t === "union") flat.push(...m.of);
    else flat.push(m);
  }
  if (flat.some((m) => m.t === "any")) return { t: "any" };
  const seen = new Map<string, Shape>();
  for (const m of flat) if (m.t !== "never") seen.set(key(m), m);
  const hasTrue = seen.has(key({ t: "literal", v: true }));
  const hasFalse = seen.has(key({ t: "literal", v: false }));
  if (hasTrue && hasFalse) {
    seen.delete(key({ t: "literal", v: true }));
    seen.delete(key({ t: "literal", v: false }));
    seen.set(key({ t: "boolean" }), { t: "boolean" });
  }
  const out = [...seen.values()].sort((a, b) => (key(a) < key(b) ? -1 : 1));
  if (out.length === 0) return { t: "never" };
  return out.length === 1 ? out[0]! : { t: "union", of: out };
}

// ---------------------------------------------------------------- validators (exportArgs JSON)

type ValidatorJson = { type: string; value?: unknown; tableName?: string; keys?: ValidatorJson; values?: { fieldType: ValidatorJson } };

export function fromValidator(v: ValidatorJson): Shape {
  switch (v.type) {
    case "any":
    case "string":
    case "number":
    case "boolean":
    case "null":
    case "bigint":
    case "bytes":
      return { t: v.type } as Shape;
    case "id":
      return { t: "id", table: String(v.tableName) };
    case "literal":
      return { t: "literal", v: v.value as string | number | boolean };
    case "array":
      return { t: "array", of: fromValidator(v.value as ValidatorJson) };
    case "record":
      return { t: "record", value: fromValidator(v.values!.fieldType) };
    case "union":
      return union((v.value as ValidatorJson[]).map(fromValidator));
    case "object": {
      const props: Record<string, { type: Shape; optional?: true }> = {};
      for (const [name, field] of Object.entries(v.value as Record<string, { fieldType: ValidatorJson; optional: boolean }>).sort(([a], [b]) => (a < b ? -1 : 1))) {
        props[name] = field.optional ? { type: fromValidator(field.fieldType), optional: true } : { type: fromValidator(field.fieldType) };
      }
      return { t: "object", props };
    }
    default:
      return { t: "unknown" };
  }
}

// ---------------------------------------------------------------- TypeScript types

export function fromType(checker: ts.TypeChecker, type: ts.Type, stack: ts.Type[] = []): Shape {
  if (stack.length > 40) return { t: "ref", name: checker.typeToString(type) };
  const f = type.flags;
  if (f & ts.TypeFlags.Any) return { t: "any" };
  if (f & ts.TypeFlags.Unknown) return { t: "unknown" };
  if (f & ts.TypeFlags.Never) return { t: "never" };
  if (f & ts.TypeFlags.Null) return { t: "null" };
  if (f & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) return { t: "undefined" };
  if (f & ts.TypeFlags.StringLiteral) return { t: "literal", v: (type as ts.StringLiteralType).value };
  if (f & ts.TypeFlags.NumberLiteral) return { t: "literal", v: (type as ts.NumberLiteralType).value };
  if (f & ts.TypeFlags.BooleanLiteral) return { t: "literal", v: checker.typeToString(type) === "true" };
  if (f & ts.TypeFlags.String || f & ts.TypeFlags.TemplateLiteral) return { t: "string" };
  if (f & ts.TypeFlags.Number) return { t: "number" };
  if (f & ts.TypeFlags.Boolean) return { t: "boolean" };
  if (f & (ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral)) return { t: "bigint" };
  if (stack.includes(type)) return { t: "ref", name: checker.typeToString(type) };
  const inner = [...stack, type];

  if (type.isUnion()) return union(type.types.map((m) => fromType(checker, m, inner)));
  if (type.isIntersection()) {
    // Convex ids: string & { __tableName: "documents" }.
    const table = type.types.map((m) => m.getProperty("__tableName")).find(Boolean);
    if (table && type.types.some((m) => m.flags & ts.TypeFlags.String)) {
      const tt = checker.getTypeOfSymbol(table);
      return { t: "id", table: tt.isStringLiteral() ? tt.value : checker.typeToString(tt) };
    }
    if (type.types.some((m) => m.flags & ts.TypeFlags.String)) return { t: "string" };
  }
  if (checker.isTupleType(type)) return { t: "tuple", of: checker.getTypeArguments(type as ts.TypeReference).map((m) => fromType(checker, m, inner)) };
  if (checker.isArrayType(type)) return { t: "array", of: fromType(checker, checker.getTypeArguments(type as ts.TypeReference)[0]!, inner) };
  const name = type.getSymbol()?.getName();
  if (name === "ArrayBuffer" || name === "Uint8Array") return { t: "bytes" };
  if (type.getCallSignatures().length) return { t: "unknown" };

  const props: Record<string, { type: Shape; optional?: true }> = {};
  for (const p of checker.getPropertiesOfType(type).sort((a, b) => (a.getName() < b.getName() ? -1 : 1))) {
    const optional = (p.getFlags() & ts.SymbolFlags.Optional) !== 0;
    let shape = fromType(checker, checker.getTypeOfSymbol(p), inner);
    if (optional && shape.t === "union") shape = union(shape.of.filter((m) => m.t !== "undefined"));
    props[p.getName()] = optional ? { type: shape, optional: true } : { type: shape };
  }
  const index = checker.getIndexInfoOfType(type, ts.IndexKind.String);
  if (index && Object.keys(props).length === 0) return { t: "record", value: fromType(checker, index.type, inner) };
  return index ? { t: "object", props, index: fromType(checker, index.type, inner) } : { t: "object", props };
}

// ---------------------------------------------------------------- compatibility

/**
 * Where `a` holds a value `b` doesn't accept (empty when every `a` is a `b`). `closed`: an object property `b`
 * doesn't know is a problem (Convex refuses unknown arguments); open: extra fields are fine (clients ignore
 * fields they don't know).
 */
export function notSubset(a: Shape, b: Shape, closed: boolean, path = "$"): string[] {
  if (b.t === "any" || b.t === "unknown") return [];
  if (a.t === "never") return [];
  if (a.t === "union") return a.of.flatMap((m) => notSubset(m, b, closed, path));
  if (b.t === "union") {
    // The member of the same kind decides (so the message points inside it), else any member that accepts it.
    if (b.of.some((m) => notSubset(a, m, closed, path).length === 0)) return [];
    const same = b.of.filter((m) => m.t === a.t);
    if (same.length === 1) return notSubset(a, same[0]!, closed, path);
    return [`${path}: ${describe(a)} isn't one of ${describe(b)}`];
  }
  if (a.t === "ref" || b.t === "ref") return a.t === "ref" && b.t === "ref" && a.name === b.name ? [] : [`${path}: ${describe(a)} isn't ${describe(b)}`];
  switch (b.t) {
    case "string":
      return a.t === "string" || a.t === "id" || (a.t === "literal" && typeof a.v === "string") ? [] : [`${path}: ${describe(a)} isn't a string`];
    case "number":
      return a.t === "number" || (a.t === "literal" && typeof a.v === "number") ? [] : [`${path}: ${describe(a)} isn't a number`];
    case "boolean":
      return a.t === "boolean" || (a.t === "literal" && typeof a.v === "boolean") ? [] : [`${path}: ${describe(a)} isn't a boolean`];
    case "literal":
      return a.t === "literal" && a.v === b.v ? [] : [`${path}: ${describe(a)} isn't ${JSON.stringify(b.v)}`];
    case "id":
      return a.t === "id" && a.table === b.table ? [] : [`${path}: ${describe(a)} isn't an id of ${b.table}`];
    case "array":
      if (a.t === "array") return notSubset(a.of, b.of, closed, `${path}[]`);
      if (a.t === "tuple") return a.of.flatMap((m, i) => notSubset(m, b.of, closed, `${path}[${i}]`));
      return [`${path}: ${describe(a)} isn't an array`];
    case "tuple":
      if (a.t !== "tuple" || a.of.length !== b.of.length) return [`${path}: ${describe(a)} isn't a tuple of ${b.of.length}`];
      return a.of.flatMap((m, i) => notSubset(m, b.of[i]!, closed, `${path}[${i}]`));
    case "record":
      if (a.t === "record") return notSubset(a.value, b.value, closed, `${path}{}`);
      if (a.t === "object") return Object.entries(a.props).flatMap(([k, p]) => notSubset(p.type, b.value, closed, `${path}.${k}`));
      return [`${path}: ${describe(a)} isn't a record`];
    case "object": {
      if (a.t !== "object") return [`${path}: ${describe(a)} isn't an object`];
      const out: string[] = [];
      for (const [k, bp] of Object.entries(b.props)) {
        const ap = a.props[k];
        if (!ap) {
          if (!bp.optional) out.push(`${path}.${k}: required, and missing`);
          continue;
        }
        if (ap.optional && !bp.optional) out.push(`${path}.${k}: required, but may be missing`);
        out.push(...notSubset(ap.type, bp.type, closed, `${path}.${k}`));
      }
      for (const k of Object.keys(a.props)) {
        if (b.props[k]) continue;
        if (b.index) out.push(...notSubset(a.props[k]!.type, b.index, closed, `${path}.${k}`));
        else if (closed) out.push(`${path}.${k}: no longer accepted`);
      }
      return out;
    }
    default:
      return a.t === b.t ? [] : [`${path}: ${describe(a)} isn't ${describe(b)}`];
  }
}

function describe(s: Shape): string {
  switch (s.t) {
    case "literal":
      return JSON.stringify(s.v);
    case "id":
      return `id<${s.table}>`;
    case "array":
      return `${describe(s.of)}[]`;
    case "union":
      return s.of.map(describe).join(" | ");
    case "ref":
      return s.name;
    case "object":
      return `{ ${Object.keys(s.props).join(", ")} }`;
    default:
      return s.t;
  }
}
