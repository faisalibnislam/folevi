import { SPEC, LIMITS, CODE_LANGUAGES, BLOCK_TYPES, SCHEMA_VERSION } from "./generated/schema";
import type { WireBlock } from "./types";
import { isValidId } from "./ids";
import { isValidRank } from "./rank";
import { plainText } from "./richtext";
import { whiteboardDataIssue } from "./whiteboard";
import { flowchartDataIssue } from "./flowchart";

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

type FieldSpec = string;
const knownTypes = new Set<string>(BLOCK_TYPES);

function parseType(t: string): { base: string; arrays: number; optional: boolean } {
  let optional = false;
  if (t.endsWith("?")) {
    optional = true;
    t = t.slice(0, -1);
  }
  let arrays = 0;
  while (t.endsWith("[]")) {
    arrays++;
    t = t.slice(0, -2);
  }
  return { base: t, arrays, optional };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function checkValue(value: unknown, base: string, arrays: number, path: string, issues: ValidationIssue[], maxString: number = LIMITS.maxCodeLength): void {
  if (arrays > 0) {
    if (!Array.isArray(value)) {
      issues.push({ path, code: "type", message: "expected array" });
      return;
    }
    value.forEach((v, i) => checkValue(v, base, arrays - 1, `${path}[${i}]`, issues, maxString));
    return;
  }
  switch (base) {
    case "string":
      if (typeof value !== "string") issues.push({ path, code: "type", message: "expected string" });
      else if (value.length > maxString) issues.push({ path, code: "too_long", message: "string too long" });
      return;
    case "int":
      if (typeof value !== "number" || !Number.isInteger(value)) issues.push({ path, code: "type", message: "expected integer" });
      return;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) issues.push({ path, code: "type", message: "expected number" });
      return;
    case "bool":
      if (typeof value !== "boolean") issues.push({ path, code: "type", message: "expected boolean" });
      return;
  }
  const enums = SPEC.enums as Record<string, { values: readonly (string | number)[] }>;
  if (enums[base]) {
    if (!enums[base].values.includes(value as string | number)) {
      issues.push({ path, code: "enum", message: `expected one of ${enums[base].values.join(", ")}` });
    }
    return;
  }
  const unions = SPEC.unions as Record<string, { discriminator: string; variants: Record<string, Record<string, string>> }>;
  if (unions[base]) {
    const u = unions[base];
    if (!isPlainObject(value)) {
      issues.push({ path, code: "type", message: "expected object" });
      return;
    }
    const tag = value[u.discriminator];
    const variant = typeof tag === "string" ? u.variants[tag] : undefined;
    if (!variant) {
      issues.push({ path, code: "variant", message: `unknown ${base} ${String(tag)}` });
      return;
    }
    checkFields(value, variant, path, issues, [u.discriminator]);
    return;
  }
  const structs = SPEC.structs as Record<string, Record<string, string>>;
  if (structs[base]) {
    if (!isPlainObject(value)) {
      issues.push({ path, code: "type", message: "expected object" });
      return;
    }
    checkFields(value, structs[base], path, issues);
    return;
  }
  issues.push({ path, code: "schema", message: `unknown type ${base}` });
}

function checkFields(
  obj: Record<string, unknown>,
  fields: Record<string, FieldSpec>,
  path: string,
  issues: ValidationIssue[],
  allowExtra: string[] = [],
  stringLimits: Record<string, number> = {},
): void {
  for (const [key, t] of Object.entries(fields)) {
    const { base, arrays, optional } = parseType(t);
    const v = obj[key];
    if (v === undefined || v === null) {
      if (!optional) issues.push({ path: `${path}.${key}`, code: "required", message: "required" });
      continue;
    }
    checkValue(v, base, arrays, `${path}.${key}`, issues, stringLimits[key]);
  }
  for (const key of Object.keys(obj)) {
    if (!(key in fields) && !allowExtra.includes(key)) {
      issues.push({ path: `${path}.${key}`, code: "unexpected", message: "unexpected field" });
    }
  }
}

export function validateInline(nodes: unknown, path = "text"): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  checkValue(nodes, "InlineNode", 1, path, issues);
  return issues;
}

/**
 * Validates a wire block. Known types are fully checked; unknown types (from newer clients) only get
 * structural checks so they can be stored and round-tripped without loss.
 */
export function validateWireBlock(block: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(block)) return [{ path: "", code: "type", message: "expected object" }];
  const b = block as Partial<WireBlock> & Record<string, unknown>;
  if (!isValidId(b.id)) issues.push({ path: "id", code: "id", message: "invalid id" });
  if (typeof b.type !== "string" || !/^[a-zA-Z][a-zA-Z0-9_.-]{0,40}$/.test(b.type)) {
    issues.push({ path: "type", code: "type", message: "invalid block type" });
  }
  if (b.parentId !== null && !isValidId(b.parentId)) issues.push({ path: "parentId", code: "id", message: "invalid parent id" });
  if (b.parentId !== null && b.parentId === b.id) issues.push({ path: "parentId", code: "cycle", message: "block cannot be its own parent" });
  if (typeof b.rank !== "string" || !isValidRank(b.rank) || b.rank.length > LIMITS.maxRankLength * 2) {
    issues.push({ path: "rank", code: "rank", message: "invalid rank" });
  }
  if (typeof b.schemaVersion !== "number" || !Number.isInteger(b.schemaVersion) || b.schemaVersion < 1) {
    issues.push({ path: "schemaVersion", code: "type", message: "invalid schema version" });
  }
  if (!isPlainObject(b.props)) issues.push({ path: "props", code: "type", message: "props must be an object" });
  if (!Array.isArray(b.text)) {
    issues.push({ path: "text", code: "type", message: "text must be an array" });
  }
  if (issues.length) return issues;

  if (!knownTypes.has(b.type as string)) {
    if ((b.schemaVersion as number) <= SCHEMA_VERSION) {
      issues.push({ path: "type", code: "unknown_type", message: `unknown block type ${b.type}` });
    }
    return issues;
  }
  const def = (SPEC.blocks as Record<string, { text: boolean; props: Record<string, string> }>)[b.type as string]!;
  issues.push(...validateInline(b.text));
  if (!def.text && (b.text as unknown[]).length > 0) {
    issues.push({ path: "text", code: "unexpected", message: `${b.type} blocks do not carry text` });
  }
  if (issues.length === 0 && plainText(b.text as never).length > LIMITS.maxTextLength) {
    issues.push({ path: "text", code: "too_long", message: "text too long" });
  }
  // Whiteboard drawings and flowcharts may be larger than other strings (see LIMITS.max*DataLength).
  const stringLimits: Record<string, number> =
    b.type === "whiteboard" ? { data: LIMITS.maxWhiteboardDataLength } : b.type === "flowchart" ? { data: LIMITS.maxFlowchartDataLength } : {};
  checkFields(b.props as Record<string, unknown>, def.props, "props", issues, [], stringLimits);
  if (issues.length) return issues;

  const p = b.props as Record<string, unknown>;
  switch (b.type) {
    case "code":
      if (!(CODE_LANGUAGES as readonly string[]).includes(p.language as string)) {
        issues.push({ path: "props.language", code: "enum", message: "unsupported language" });
      }
      break;
    case "todo":
      if (p.dueDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(p.dueDate as string)) {
        issues.push({ path: "props.dueDate", code: "format", message: "expected YYYY-MM-DD" });
      }
      if (p.dueTime !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.dueTime as string)) {
        issues.push({ path: "props.dueTime", code: "format", message: "expected HH:mm" });
      }
      if (p.dueTime !== undefined && p.dueDate === undefined) {
        issues.push({ path: "props.dueTime", code: "format", message: "dueTime requires dueDate" });
      }
      break;
    case "table": {
      const rows = p.rows as unknown[][];
      if (rows.length > LIMITS.maxTableRows) issues.push({ path: "props.rows", code: "too_long", message: "too many rows" });
      const width = rows[0]?.length ?? 0;
      if (width > LIMITS.maxTableColumns) issues.push({ path: "props.rows", code: "too_long", message: "too many columns" });
      if (rows.some((r) => r.length !== width)) issues.push({ path: "props.rows", code: "shape", message: "rows must have equal length" });
      break;
    }
    case "image":
      if (p.fileId === undefined && p.url === undefined) {
        issues.push({ path: "props", code: "required", message: "image needs fileId or url" });
      }
      if (p.width !== undefined && ((p.width as number) < 0.2 || (p.width as number) > 1)) {
        issues.push({ path: "props.width", code: "range", message: "width must be between 0.2 and 1" });
      }
      break;
    case "bookmark":
      if (!/^https?:\/\//i.test(p.url as string)) issues.push({ path: "props.url", code: "format", message: "http(s) url required" });
      break;
    case "formula":
      if ((p.latex as string).length > LIMITS.maxFormulaLength) issues.push({ path: "props.latex", code: "too_long", message: "formula too long" });
      break;
    case "whiteboard": {
      const issue = whiteboardDataIssue(p.data as string);
      if (issue) issues.push({ path: "props.data", code: issue === "drawing too large" ? "too_long" : "shape", message: issue });
      const h = p.height as number;
      if (h < LIMITS.minWhiteboardHeight || h > LIMITS.maxWhiteboardHeight) {
        issues.push({ path: "props.height", code: "range", message: `height must be between ${LIMITS.minWhiteboardHeight} and ${LIMITS.maxWhiteboardHeight}` });
      }
      break;
    }
    case "flowchart": {
      const issue = flowchartDataIssue(p.data as string);
      if (issue) issues.push({ path: "props.data", code: issue === "flowchart too large" ? "too_long" : "shape", message: issue });
      const h = p.height as number;
      if (h < LIMITS.minFlowchartHeight || h > LIMITS.maxFlowchartHeight) {
        issues.push({ path: "props.height", code: "range", message: `height must be between ${LIMITS.minFlowchartHeight} and ${LIMITS.maxFlowchartHeight}` });
      }
      break;
    }
    case "page":
      if (!isValidId(p.documentId)) issues.push({ path: "props.documentId", code: "id", message: "invalid document id" });
      break;
  }
  for (const [i, node] of (b.text as { type: string; marks?: { type: string; href?: string }[] }[]).entries()) {
    for (const m of node.marks ?? []) {
      if (m.type === "link" && !/^(https?:|mailto:|folevi:|\/|#)/i.test(m.href ?? "")) {
        issues.push({ path: `text[${i}].marks`, code: "href", message: "unsafe link" });
      }
    }
  }
  return issues;
}

export function assertValidWireBlock(block: unknown): asserts block is WireBlock {
  const issues = validateWireBlock(block);
  if (issues.length) {
    const first = issues[0]!;
    throw new Error(`invalid block: ${first.path} ${first.message}`);
  }
}
