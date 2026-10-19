import { SPEC, LIMITS, CODE_LANGUAGES, BLOCK_TYPES, SCHEMA_VERSION } from "./generated/schema";
import type { WireBlock } from "./types";
import { isValidId } from "./ids";
import { isValidRank } from "./rank";
import { plainText } from "./richtext";
import { whiteboardDataIssue } from "./whiteboard";
import { flowchartDataIssue } from "./flowchart";
import { embedFor } from "./embeds";

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

function checkValue(
  value: unknown,
  base: string,
  arrays: number,
  path: string,
  issues: ValidationIssue[],
  maxString: number = LIMITS.maxCodeLength,
): void {
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
      if (typeof value !== "string")
        issues.push({ path, code: "type", message: "expected string" });
      else if (value.length > maxString)
        issues.push({ path, code: "too_long", message: "string too long" });
      return;
    case "int":
      if (typeof value !== "number" || !Number.isInteger(value))
        issues.push({ path, code: "type", message: "expected integer" });
      return;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value))
        issues.push({ path, code: "type", message: "expected number" });
      return;
    case "bool":
      if (typeof value !== "boolean")
        issues.push({ path, code: "type", message: "expected boolean" });
      return;
  }
  const enums = SPEC.enums as Record<string, { values: readonly (string | number)[] }>;
  if (enums[base]) {
    if (!enums[base].values.includes(value as string | number)) {
      issues.push({
        path,
        code: "enum",
        message: `expected one of ${enums[base].values.join(", ")}`,
      });
    }
    return;
  }
  const unions = SPEC.unions as Record<
    string,
    { discriminator: string; variants: Record<string, Record<string, string>> }
  >;
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
  if (b.parentId !== null && !isValidId(b.parentId))
    issues.push({ path: "parentId", code: "id", message: "invalid parent id" });
  if (b.parentId !== null && b.parentId === b.id)
    issues.push({ path: "parentId", code: "cycle", message: "block cannot be its own parent" });
  if (
    typeof b.rank !== "string" ||
    !isValidRank(b.rank) ||
    b.rank.length > LIMITS.maxRankLength * 2
  ) {
    issues.push({ path: "rank", code: "rank", message: "invalid rank" });
  }
  if (
    typeof b.schemaVersion !== "number" ||
    !Number.isInteger(b.schemaVersion) ||
    b.schemaVersion < 1
  ) {
    issues.push({ path: "schemaVersion", code: "type", message: "invalid schema version" });
  }
  if (!isPlainObject(b.props))
    issues.push({ path: "props", code: "type", message: "props must be an object" });
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
  const def = (SPEC.blocks as Record<string, { text: boolean; props: Record<string, string> }>)[
    b.type as string
  ]!;
  issues.push(...validateInline(b.text));
  if (!def.text && (b.text as unknown[]).length > 0) {
    issues.push({
      path: "text",
      code: "unexpected",
      message: `${b.type} blocks do not carry text`,
    });
  }
  if (issues.length === 0 && plainText(b.text as never).length > LIMITS.maxTextLength) {
    issues.push({ path: "text", code: "too_long", message: "text too long" });
  }
  // Whiteboard drawings and flowcharts may be larger than other strings (see LIMITS.max*DataLength).
  const stringLimits: Record<string, number> =
    b.type === "whiteboard"
      ? { data: LIMITS.maxWhiteboardDataLength }
      : b.type === "flowchart"
        ? { data: LIMITS.maxFlowchartDataLength }
        : {};
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
      if (rows.length > LIMITS.maxTableRows)
        issues.push({ path: "props.rows", code: "too_long", message: "too many rows" });
      const width = rows[0]?.length ?? 0;
      if (width > LIMITS.maxTableColumns)
        issues.push({ path: "props.rows", code: "too_long", message: "too many columns" });
      if (rows.some((r) => r.length !== width))
        issues.push({ path: "props.rows", code: "shape", message: "rows must have equal length" });
      break;
    }
    case "image":
      if (p.fileId === undefined && p.url === undefined) {
        issues.push({ path: "props", code: "required", message: "image needs fileId or url" });
      }
      if (p.width !== undefined && ((p.width as number) < 0.2 || (p.width as number) > 1)) {
        issues.push({
          path: "props.width",
          code: "range",
          message: "width must be between 0.2 and 1",
        });
      }
      break;
    case "audio": {
      if (!(p.fileId as string))
        issues.push({ path: "props.fileId", code: "required", message: "audio needs a file" });
      if (!/^audio\//.test(p.mimeType as string))
        issues.push({ path: "props.mimeType", code: "format", message: "expected an audio type" });
      const seconds = p.duration as number;
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 24 * 3600) {
        issues.push({
          path: "props.duration",
          code: "range",
          message: "duration must be 0 to 24 hours",
        });
      }
      break;
    }
    case "bookmark":
      if (!/^https?:\/\//i.test(p.url as string))
        issues.push({ path: "props.url", code: "format", message: "http(s) url required" });
      // The page's preview image and icon (from its metadata) are web addresses too.
      for (const key of ["image", "icon"] as const) {
        const value = p[key];
        if (value !== undefined && (typeof value !== "string" || value.length > 2048 || !/^https?:\/\//i.test(value)))
          issues.push({ path: `props.${key}`, code: "format", message: "http(s) url required" });
      }
      break;
    case "embed":
      // Only an address Folevi knows how to frame, from the provider it names.
      if ((p.url as string).length > 2048 || embedFor(p.url as string)?.provider !== p.provider)
        issues.push({ path: "props.url", code: "format", message: "not an embeddable address" });
      break;
    case "formula":
      if ((p.latex as string).length > LIMITS.maxFormulaLength)
        issues.push({ path: "props.latex", code: "too_long", message: "formula too long" });
      break;
    case "whiteboard": {
      const issue = whiteboardDataIssue(p.data as string);
      if (issue)
        issues.push({
          path: "props.data",
          code: issue === "drawing too large" ? "too_long" : "shape",
          message: issue,
        });
      const h = p.height as number;
      if (h < LIMITS.minWhiteboardHeight || h > LIMITS.maxWhiteboardHeight) {
        issues.push({
          path: "props.height",
          code: "range",
          message: `height must be between ${LIMITS.minWhiteboardHeight} and ${LIMITS.maxWhiteboardHeight}`,
        });
      }
      break;
    }
    case "flowchart": {
      const issue = flowchartDataIssue(p.data as string);
      if (issue)
        issues.push({
          path: "props.data",
          code: issue === "flowchart too large" ? "too_long" : "shape",
          message: issue,
        });
      const h = p.height as number;
      if (h < LIMITS.minFlowchartHeight || h > LIMITS.maxFlowchartHeight) {
        issues.push({
          path: "props.height",
          code: "range",
          message: `height must be between ${LIMITS.minFlowchartHeight} and ${LIMITS.maxFlowchartHeight}`,
        });
      }
      break;
    }
    case "page":
      if (!isValidId(p.documentId))
        issues.push({ path: "props.documentId", code: "id", message: "invalid document id" });
      break;
  }
  for (const [i, node] of (
    b.text as { type: string; marks?: { type: string; href?: string }[] }[]
  ).entries()) {
    for (const m of node.marks ?? []) {
      if (m.type === "link" && !/^(https?:|mailto:|folevi:|\/|#)/i.test(m.href ?? "")) {
        issues.push({ path: `text[${i}].marks`, code: "href", message: "unsafe link" });
      }
    }
  }
  return issues;
}

/** Values for required props when the editor's are missing or wrong (repairWireBlock). */
const REQUIRED_DEFAULTS: Record<string, Record<string, unknown>> = {
  heading: { level: 2 },
  todo: { checked: false },
  toggle: { collapsed: false },
  callout: { tone: "note" },
  code: { language: "plaintext", code: "" },
  table: { headerRow: true },
  image: { alt: "", caption: "" },
  formula: { latex: "" },
};

const SAFE_HREF = /^(https?:|mailto:|folevi:|\/|#)/i;

/** A link the server would refuse, made safe: a bare web address gets https://; anything else, null (unlinked). */
export function safeHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  const h = href.trim();
  if (SAFE_HREF.test(h)) return h;
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+([/?#:][^\s]*)?$/i.test(h)) return `https://${h}`;
  return null;
}

/** Inline content made valid: unknown or broken marks dropped (the text stays), links made safe. */
function repairInline(nodes: unknown): InlineLike[] {
  if (!Array.isArray(nodes)) return [];
  const enums = SPEC.enums as Record<string, { values: readonly (string | number)[] }>;
  const out: InlineLike[] = [];
  for (const raw of nodes) {
    if (!isPlainObject(raw)) continue;
    const n = raw as Record<string, unknown>;
    if (n.type === "mention" && typeof n.userId === "string" && typeof n.label === "string") out.push({ type: "mention", userId: n.userId, label: n.label });
    else if (n.type === "date" && typeof n.date === "string") out.push({ type: "date", date: n.date });
    else if (n.type === "pageLink" && typeof n.documentId === "string" && typeof n.label === "string") out.push({ type: "pageLink", documentId: n.documentId, label: n.label });
    else if (n.type === "text" || typeof n.text === "string" || typeof n.label === "string") {
      const text = typeof n.text === "string" ? n.text : typeof n.label === "string" ? n.label : "";
      const marks: Record<string, unknown>[] = [];
      for (const m of Array.isArray(n.marks) ? n.marks : []) {
        if (!isPlainObject(m)) continue;
        const mk = m as Record<string, unknown>;
        if (["bold", "italic", "underline", "strike", "code"].includes(mk.type as string)) marks.push({ type: mk.type });
        else if (mk.type === "link") {
          const href = safeHref(mk.href);
          if (href) marks.push({ type: "link", href });
        } else if (mk.type === "color" && enums.TextColor!.values.includes(mk.value as string)) marks.push({ type: "color", value: mk.value });
        else if (mk.type === "highlight" && enums.HighlightColor!.values.includes(mk.value as string)) marks.push({ type: "highlight", value: mk.value });
      }
      out.push(marks.length ? { type: "text", text, marks } : { type: "text", text });
    }
  }
  return out;
}

type InlineLike = Record<string, unknown> & { type: string };

/**
 * A block the server would refuse, repaired where that keeps what the person wrote: uneven table rows padded
 * with empty cells, broken marks and unsafe links in text and table cells fixed or dropped (the words stay),
 * required props given their defaults and wrong optional or unknown props removed, a heading level or an
 * image width brought into range. Returns the block as is when it was already valid, and the issues still
 * left (for example text over the length limit, which can't be repaired without losing words).
 */
export function repairWireBlock(block: WireBlock): { block: WireBlock; repaired: boolean; issues: ValidationIssue[] } {
  let issues = validateWireBlock(block);
  if (!issues.length) return { block, repaired: false, issues };
  const def = (SPEC.blocks as Record<string, { text: boolean; props: Record<string, string> }>)[block.type];
  // An unknown type (from a newer app) is stored as it is: nothing here may change it.
  if (!def) return { block, repaired: false, issues };
  const props: Record<string, unknown> = { ...(isPlainObject(block.props) ? block.props : {}) };
  let text = def.text ? repairInline(block.text) : [];
  if (def.text && plainText(text as never).length > LIMITS.maxTextLength) text = block.text as never;
  for (const key of Object.keys(props)) if (!(key in def.props)) delete props[key];
  if (block.type === "heading") props.level = Math.min(3, Math.max(1, Math.round(Number(props.level) || 2)));
  if (block.type === "todo" || block.type === "toggle") {
    const key = block.type === "todo" ? "checked" : "collapsed";
    props[key] = props[key] === true;
  }
  if (block.type === "table" && Array.isArray(props.rows)) {
    const rows = (props.rows as unknown[]).filter(Array.isArray).map((r) => (r as unknown[]).map((cell) => repairInline(cell)));
    const width = Math.max(1, ...rows.map((r) => r.length));
    props.rows = (rows.length ? rows : [[[]]]).map((r) => [...r, ...Array.from({ length: width - r.length }, () => [])]);
    props.headerRow = props.headerRow !== false;
  }
  if (block.type === "image" && typeof props.width === "number") props.width = Math.min(1, Math.max(0.2, props.width));
  if (block.type === "todo") {
    if (props.dueDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(props.dueDate))) delete props.dueDate;
    if (props.dueTime !== undefined && (props.dueDate === undefined || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(props.dueTime)))) delete props.dueTime;
  }
  if (block.type === "code" && !(CODE_LANGUAGES as readonly string[]).includes(props.language as string)) props.language = "plaintext";
  let next: WireBlock = { ...block, props, text: text as never };
  // Whatever props are still wrong: an optional one goes, a required one takes its default.
  for (let pass = 0; pass < 2; pass++) {
    const left = validateWireBlock(next);
    const fixes = left.filter((i) => i.path.startsWith("props."));
    if (!fixes.length) break;
    const p = { ...(next.props as Record<string, unknown>) };
    for (const issue of fixes) {
      const key = issue.path.slice("props.".length).split(/[.[]/)[0]!;
      const spec = def.props[key];
      if (!spec) delete p[key];
      else if (spec.endsWith("?")) delete p[key];
      else if (REQUIRED_DEFAULTS[block.type]?.[key] !== undefined) p[key] = REQUIRED_DEFAULTS[block.type]![key];
    }
    next = { ...next, props: p };
  }
  issues = validateWireBlock(next);
  return { block: next, repaired: JSON.stringify(next) !== JSON.stringify(block), issues };
}
