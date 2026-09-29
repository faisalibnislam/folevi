import type { InlineNode, Mark } from "./generated/schema";
import { CODE_LANGUAGES, LIMITS, SCHEMA_VERSION } from "./generated/schema";
import type { WireBlock } from "./types";
import { ulid } from "./ids";
import { rankSequence } from "./rank";
import { flattenTree } from "./tree";
import { normalizeInline, plainText, sanitizeHref } from "./richtext";
import { whiteboardToSvg } from "./whiteboard";
import { parseFlowchart } from "./flowchart";
import { flowchartToMermaid } from "./flowchartMermaid";

// ---------------------------------------------------------------- export

export interface MarkdownExportOptions {
  /** Resolves an uploaded file id to a relative path inside the export (e.g. `assets/photo.png`). */
  resolveFile?: (fileId: string) => string | null;
  /** Resolves a document id to a relative link target (e.g. `Project Atlas.md`). */
  resolveDocument?: (documentId: string) => string | null;
  /** The linked page's current title (page cards and [[links]] otherwise use the title cached when linked). */
  resolveDocumentTitle?: (documentId: string) => string | null;
}

function escapeMd(value: string): string {
  return value.replace(/([\\`*_[\]#<>|])/g, "\\$1");
}

export function inlineToMarkdown(nodes: readonly InlineNode[], opts: MarkdownExportOptions = {}): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "mention":
          return `@${escapeMd(n.label)}`;
        case "date":
          return n.date;
        case "pageLink": {
          const target = opts.resolveDocument?.(n.documentId);
          const label = opts.resolveDocumentTitle?.(n.documentId) || n.label || "Untitled";
          return target ? `[${escapeMd(label)}](${encodeURI(target)})` : `[[${label}]]`;
        }
        case "text": {
          const marks = n.marks ?? [];
          if (marks.some((m) => m.type === "code")) {
            const fence = n.text.includes("`") ? "``" : "`";
            return `${fence}${n.text}${fence}`;
          }
          let s = escapeMd(n.text);
          // Keep surrounding whitespace outside of emphasis markers.
          const lead = /^\s*/.exec(s)?.[0] ?? "";
          const trail = /\s*$/.exec(s)?.[0] ?? "";
          let core = s.slice(lead.length, s.length - trail.length);
          if (!core) return s;
          if (marks.some((m) => m.type === "strike")) core = `~~${core}~~`;
          if (marks.some((m) => m.type === "italic")) core = `_${core}_`;
          if (marks.some((m) => m.type === "bold")) core = `**${core}**`;
          const link = marks.find((m): m is Extract<Mark, { type: "link" }> => m.type === "link");
          if (link) core = `[${core}](${link.href})`;
          s = lead + core + trail;
          return s;
        }
      }
    })
    .join("");
}

export function blocksToMarkdown(
  blocks: readonly WireBlock[],
  opts: MarkdownExportOptions & { title?: string; frontMatter?: Record<string, string> } = {},
): string {
  const lines: string[] = [];
  if (opts.frontMatter && Object.keys(opts.frontMatter).length) {
    lines.push("---");
    for (const [k, v] of Object.entries(opts.frontMatter)) lines.push(`${k}: ${JSON.stringify(v)}`);
    lines.push("---", "");
  }
  if (opts.title) lines.push(`# ${escapeMd(opts.title)}`, "");
  const flat = flattenTree(blocks);
  const counters: number[] = [];
  let prevWasList = false;
  for (const { block, depth } of flat) {
    const indent = "  ".repeat(depth);
    const p = block.props as Record<string, unknown>;
    const t = inlineToMarkdown(block.text, opts);
    const isList = block.type === "bulleted" || block.type === "numbered" || block.type === "todo";
    if (!isList && prevWasList) lines.push("");
    counters.length = depth + 1;
    switch (block.type) {
      case "paragraph":
        lines.push(indent + t, "");
        break;
      case "heading":
        lines.push(`${"#".repeat(Math.min(3, Number(p.level) || 1) + (opts.title ? 1 : 0))} ${t}`, "");
        break;
      case "bulleted":
        lines.push(`${indent}- ${t}`);
        break;
      case "numbered":
        counters[depth] = (counters[depth] ?? 0) + 1;
        lines.push(`${indent}${counters[depth]}. ${t}`);
        break;
      case "todo":
        lines.push(`${indent}- [${p.checked ? "x" : " "}] ${t}${p.dueDate ? ` (due ${p.dueDate}${p.dueTime ? ` ${p.dueTime}` : ""})` : ""}`);
        break;
      case "toggle":
        lines.push(`${indent}<details><summary>${t}</summary></details>`, "");
        break;
      case "quote":
        lines.push(`${indent}> ${t}`, "");
        break;
      case "callout":
        lines.push(`${indent}> [!${String(p.tone ?? "note").toUpperCase()}]`, `${indent}> ${t}`, "");
        break;
      case "divider":
        lines.push("---", "");
        break;
      case "pageBreak":
        lines.push(PAGE_BREAK_HTML, "");
        break;
      case "formula": {
        const latex = String(p.latex ?? "").trim();
        if (latex) lines.push("$$", latex, "$$", "");
        break;
      }
      case "whiteboard": {
        // An inline SVG image, so the drawing survives in any Markdown viewer.
        const svg = whiteboardToSvg(String(p.data ?? ""), Number(p.height));
        const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg).replace(/\(/g, "%28").replace(/\)/g, "%29")}`;
        lines.push(`${indent}![Whiteboard](${uri})`, "");
        break;
      }
      case "flowchart": {
        // A Mermaid diagram, so the chart stays editable and renders in most Markdown viewers.
        const fc = parseFlowchart(String(p.data ?? ""));
        if (fc.nodes.length) lines.push("```mermaid", flowchartToMermaid(fc), "```", "");
        break;
      }
      case "code": {
        const code = String(p.code ?? "");
        const fence = code.includes("```") ? "~~~~" : "```";
        lines.push(`${fence}${p.language === "plaintext" ? "" : String(p.language ?? "")}`, code, fence, "");
        break;
      }
      case "image": {
        const src = p.fileId ? opts.resolveFile?.(String(p.fileId)) : (p.url as string | undefined);
        lines.push(`${indent}![${escapeMd(String(p.alt ?? ""))}](${src ? encodeURI(src) : ""})`);
        if (p.caption) lines.push(`${indent}_${escapeMd(String(p.caption))}_`);
        lines.push("");
        break;
      }
      case "file": {
        const src = opts.resolveFile?.(String(p.fileId));
        lines.push(`${indent}[${escapeMd(String(p.name ?? "file"))}](${src ? encodeURI(src) : ""})`, "");
        break;
      }
      case "table": {
        const rows = (p.rows as InlineNode[][][]) ?? [];
        if (rows.length) {
          const cell = (c: InlineNode[]) => inlineToMarkdown(c, opts).replace(/\n/g, " ") || " ";
          const header = p.headerRow ? rows[0]! : rows[0]!.map(() => [] as InlineNode[]);
          const body = p.headerRow ? rows.slice(1) : rows;
          lines.push(`| ${header.map(cell).join(" | ")} |`);
          lines.push(`| ${header.map(() => "---").join(" | ")} |`);
          for (const r of body) lines.push(`| ${r.map(cell).join(" | ")} |`);
          lines.push("");
        }
        break;
      }
      case "page": {
        const target = opts.resolveDocument?.(String(p.documentId));
        const label = opts.resolveDocumentTitle?.(String(p.documentId)) || String(p.titleCache || "Untitled");
        lines.push(`${indent}${target ? `[${escapeMd(label)}](${encodeURI(target)})` : `[[${label}]]`}`, "");
        break;
      }
      case "bookmark":
        lines.push(`${indent}[${escapeMd(String(p.title ?? p.url))}](${String(p.url)})`, "");
        break;
      case "collection":
        lines.push(`${indent}<!-- folevi:collection ${String(p.collectionId)} -->`, "");
        break;
      default:
        lines.push(`${indent}<!-- folevi:unsupported-block ${escapeMd(block.type)} -->`, "");
    }
    prevWasList = isList;
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** How a page break is written to Markdown (the common convention understood by Markdown→PDF tools). */
export const PAGE_BREAK_HTML = '<div style="page-break-after: always"></div>';

// ---------------------------------------------------------------- import

export interface ImportWarning {
  line: number;
  code: "html_block" | "footnote" | "reference_link" | "unresolved_image" | "nested_quote" | "math" | "front_matter" | "unsupported";
  message: string;
}

export interface MarkdownImportResult {
  title: string | null;
  blocks: WireBlock[];
  frontMatter: Record<string, string>;
  warnings: ImportWarning[];
}

export interface MarkdownImportOptions {
  /** Resolve a relative image path to an uploaded file id; unresolved images keep their URL if absolute. */
  resolveImage?: (src: string) => { fileId: string } | null;
  newId?: () => string;
  /** Use the first H1 as the document title (default true). */
  titleFromHeading?: boolean;
}

/** Parses inline Markdown (emphasis, strong, code, strike, links, autolinks) into inline nodes. */
export function parseInlineMarkdown(src: string): InlineNode[] {
  const out: InlineNode[] = [];
  const push = (text: string, marks: Mark[]) => {
    if (text) out.push(marks.length ? { type: "text", text, marks: [...marks] } : { type: "text", text });
  };
  const walk = (s: string, marks: Mark[]) => {
    let buf = "";
    let i = 0;
    while (i < s.length) {
      const ch = s[i]!;
      if (ch === "\\" && i + 1 < s.length && /[\\`*_[\]#<>|~!()-]/.test(s[i + 1]!)) {
        buf += s[i + 1];
        i += 2;
        continue;
      }
      if (ch === "`") {
        const ticks = /^`+/.exec(s.slice(i))![0];
        const end = s.indexOf(ticks, i + ticks.length);
        if (end !== -1) {
          push(buf, marks);
          buf = "";
          let code = s.slice(i + ticks.length, end);
          if (code.startsWith(" ") && code.endsWith(" ") && code.trim()) code = code.slice(1, -1);
          push(code, [...marks, { type: "code" }]);
          i = end + ticks.length;
          continue;
        }
      }
      const tryDelim = (delim: string, mark: Mark): boolean => {
        if (!s.startsWith(delim, i)) return false;
        const after = s[i + delim.length];
        if (after === undefined || /\s/.test(after)) return false;
        let end = s.indexOf(delim, i + delim.length);
        while (end !== -1 && /\s/.test(s[end - 1] ?? " ")) end = s.indexOf(delim, end + 1);
        if (end === -1 || end === i + delim.length) return false;
        // Intra-word underscores are literal.
        if (delim[0] === "_" && /\w/.test(s[i - 1] ?? "")) return false;
        push(buf, marks);
        buf = "";
        walk(s.slice(i + delim.length, end), [...marks, mark]);
        i = end + delim.length;
        return true;
      };
      if (ch === "*" || ch === "_" || ch === "~") {
        if (
          tryDelim("***", { type: "bold" }) ||
          tryDelim("**", { type: "bold" }) ||
          tryDelim("__", { type: "bold" }) ||
          tryDelim("~~", { type: "strike" }) ||
          tryDelim("*", { type: "italic" }) ||
          tryDelim("_", { type: "italic" })
        ) {
          continue;
        }
      }
      if (ch === "[" && s[i + 1] !== "[") {
        const m = /^\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/.exec(s.slice(i));
        if (m) {
          const href = sanitizeHref(m[2]!);
          push(buf, marks);
          buf = "";
          walk(m[1]!, href ? [...marks, { type: "link", href }] : marks);
          i += m[0].length;
          continue;
        }
      }
      if (ch === "<") {
        const m = /^<(https?:\/\/[^>\s]+)>/.exec(s.slice(i));
        if (m) {
          push(buf, marks);
          buf = "";
          push(m[1]!, [...marks, { type: "link", href: m[1]! }]);
          i += m[0].length;
          continue;
        }
      }
      if (ch === "h" && (s.startsWith("http://", i) || s.startsWith("https://", i)) && !marks.some((m) => m.type === "link")) {
        const m = /^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/.exec(s.slice(i));
        if (m) {
          push(buf, marks);
          buf = "";
          push(m[0], [...marks, { type: "link", href: m[0] }]);
          i += m[0].length;
          continue;
        }
      }
      buf += ch;
      i++;
    }
    push(buf, marks);
  };
  walk(src, []);
  return normalizeInline(out);
}

interface Draft {
  id: string;
  type: string;
  depth: number;
  text: InlineNode[];
  props: Record<string, unknown>;
}

function parseFrontMatter(lines: string[]): { data: Record<string, string>; consumed: number } {
  if (lines[0]?.trim() !== "---") return { data: {}, consumed: 0 };
  const data: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "---" || line.trim() === "...") return { data, consumed: i + 1 };
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (m) {
      let v = m[2]!.trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      data[m[1]!] = v;
    }
  }
  return { data: {}, consumed: 0 };
}

const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  py: "python",
  rb: "ruby",
  yml: "yaml",
  md: "markdown",
  tex: "latex",
  "c++": "cpp",
  cs: "csharp",
  text: "plaintext",
  txt: "plaintext",
  "": "plaintext",
};

function normalizeLanguage(lang: string): string {
  const l = lang.trim().toLowerCase();
  const mapped = LANGUAGE_ALIASES[l] ?? l;
  return (CODE_LANGUAGES as readonly string[]).includes(mapped) ? mapped : "plaintext";
}

function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (s[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

export function markdownToBlocks(markdown: string, opts: MarkdownImportOptions = {}): MarkdownImportResult {
  const newId = opts.newId ?? (() => ulid());
  const warnings: ImportWarning[] = [];
  const src = markdown.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
  const all = src.split("\n");
  const { data: frontMatter, consumed } = parseFrontMatter(all);
  const lines = all.slice(consumed);
  const drafts: Draft[] = [];
  let title: string | null = frontMatter.title ?? null;
  const titleFromHeading = opts.titleFromHeading ?? true;
  let paragraph: string[] = [];
  const lineNo = (i: number) => i + consumed + 1;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    drafts.push({ id: newId(), type: "paragraph", depth: 0, text: parseInlineMarkdown(paragraph.join(" ")), props: {} });
    paragraph = [];
  };

  const listStack: number[] = []; // indentation columns of open list levels

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.replace(/\t/g, "    ");
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    // Page break (the `<div style="page-break-after: always"></div>` convention).
    if (/^\s*<div\s+style=["']\s*(page-break-after|break-after)\s*:\s*(always|page)\s*;?\s*["']\s*>\s*<\/div>\s*$/i.test(line)) {
      flushParagraph();
      drafts.push({ id: newId(), type: "pageBreak", depth: 0, text: [], props: {} });
      continue;
    }
    // Display math ($$ … $$) becomes a formula block.
    const math = /^\s*\$\$(.*)$/.exec(line);
    if (math) {
      flushParagraph();
      const startLine = i;
      const body: string[] = [];
      let rest = math[1]!;
      const closedInline = /^(.*?)\$\$\s*$/.exec(rest);
      if (closedInline && rest.trim()) {
        body.push(closedInline[1]!.trim());
      } else {
        if (rest.trim()) body.push(rest);
        i++;
        while (i < lines.length && !/\$\$\s*$/.test(lines[i]!)) {
          body.push(lines[i]!);
          i++;
        }
        if (i < lines.length) {
          rest = lines[i]!.replace(/\$\$\s*$/, "");
          if (rest.trim()) body.push(rest);
        }
      }
      const latex = body.join("\n").trim();
      if (latex.length > LIMITS.maxFormulaLength) {
        drafts.push({ id: newId(), type: "code", depth: 0, text: [], props: { language: "latex", code: latex } });
        warnings.push({ line: lineNo(startLine), code: "math", message: "A very long formula was kept as a LaTeX code block" });
      } else if (latex) {
        drafts.push({ id: newId(), type: "formula", depth: 0, text: [], props: { latex } });
      }
      continue;
    }
    // Fenced code
    const fence = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/.exec(line);
    if (fence) {
      flushParagraph();
      const marker = fence[1]!;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(marker)) {
        body.push(lines[i]!);
        i++;
      }
      const lang = fence[2] ?? "";
      drafts.push({
        id: newId(),
        type: "code",
        depth: 0,
        text: [],
        props: { language: normalizeLanguage(lang), code: body.join("\n") },
      });
      if (lang && normalizeLanguage(lang) === "plaintext" && !["text", "txt", "plaintext"].includes(lang.toLowerCase())) {
        warnings.push({ line: lineNo(i), code: "unsupported", message: `Code language "${lang}" imported as plain text` });
      }
      continue;
    }
    // Heading
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      flushParagraph();
      const level = h[1]!.length;
      const content = h[2]!;
      if (level === 1 && titleFromHeading && title === null && drafts.length === 0) {
        title = plainText(parseInlineMarkdown(content));
        continue;
      }
      drafts.push({ id: newId(), type: "heading", depth: 0, text: parseInlineMarkdown(content), props: { level: Math.min(3, level) } });
      continue;
    }
    // Divider
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushParagraph();
      drafts.push({ id: newId(), type: "divider", depth: 0, text: [], props: {} });
      continue;
    }
    // Table
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1]!)) {
      flushParagraph();
      const header = splitTableRow(line);
      const rows: InlineNode[][][] = [header.map(parseInlineMarkdown)];
      i += 2;
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim()) {
        const cells = splitTableRow(lines[i]!);
        const row = header.map((_, c) => parseInlineMarkdown(cells[c] ?? ""));
        rows.push(row);
        i++;
      }
      i--;
      drafts.push({ id: newId(), type: "table", depth: 0, text: [], props: { rows, headerRow: true } });
      continue;
    }
    // Quote / callout
    const q = /^\s{0,3}>\s?(.*)$/.exec(line);
    if (q) {
      flushParagraph();
      const body: string[] = [q[1]!];
      while (i + 1 < lines.length && /^\s{0,3}>/.test(lines[i + 1]!)) {
        i++;
        body.push(lines[i]!.replace(/^\s{0,3}>\s?/, ""));
      }
      if (body.some((b) => /^\s*>/.test(b))) {
        warnings.push({ line: lineNo(i), code: "nested_quote", message: "Nested quotes were flattened" });
      }
      const callout = /^\[!(NOTE|TIP|INFO|IMPORTANT|SUCCESS|WARNING|CAUTION|DANGER)\]\s*(.*)$/i.exec(body[0]!);
      if (callout) {
        const toneMap: Record<string, string> = {
          NOTE: "note",
          TIP: "success",
          INFO: "info",
          IMPORTANT: "info",
          SUCCESS: "success",
          WARNING: "warning",
          CAUTION: "warning",
          DANGER: "danger",
        };
        const rest = [callout[2]!, ...body.slice(1)].filter((s) => s.trim()).join(" ");
        drafts.push({
          id: newId(),
          type: "callout",
          depth: 0,
          text: parseInlineMarkdown(rest),
          props: { tone: toneMap[callout[1]!.toUpperCase()] ?? "note" },
        });
      } else {
        drafts.push({ id: newId(), type: "quote", depth: 0, text: parseInlineMarkdown(body.join(" ").replace(/^\s*>\s?/g, "")), props: {} });
      }
      continue;
    }
    // Lists
    const li = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(line);
    if (li) {
      flushParagraph();
      const indent = li[1]!.length;
      while (listStack.length && indent < listStack[listStack.length - 1]!) listStack.pop();
      if (!listStack.length || indent > listStack[listStack.length - 1]!) listStack.push(indent);
      const depth = listStack.length - 1;
      let content = li[3]!;
      const task = /^\[([ xX])\]\s+(.*)$/.exec(content);
      if (task) {
        content = task[2]!;
        const props: Record<string, unknown> = { checked: task[1] !== " " };
        const due = /\s*\(due (\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?\)\s*$/.exec(content);
        if (due) {
          content = content.slice(0, due.index);
          props.dueDate = due[1];
          if (due[2]) props.dueTime = due[2];
        }
        drafts.push({ id: newId(), type: "todo", depth, text: parseInlineMarkdown(content), props });
      } else {
        const ordered = /\d/.test(li[2]!);
        drafts.push({ id: newId(), type: ordered ? "numbered" : "bulleted", depth, text: parseInlineMarkdown(content), props: {} });
      }
      continue;
    }
    // Continuation line of a list item (lazy)
    if (listStack.length && /^\s+\S/.test(line) && drafts.length && paragraph.length === 0) {
      const last = drafts[drafts.length - 1]!;
      if (["bulleted", "numbered", "todo"].includes(last.type)) {
        last.text = normalizeInline([...last.text, { type: "text", text: " " }, ...parseInlineMarkdown(line.trim())]);
        continue;
      }
    }
    listStack.length = 0;
    // Images on their own line
    const img = /^\s*!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"]*)")?\s*\)\s*$/.exec(line);
    if (img) {
      flushParagraph();
      const src = img[2]!;
      const resolved = opts.resolveImage?.(src) ?? null;
      if (resolved) {
        drafts.push({ id: newId(), type: "image", depth: 0, text: [], props: { fileId: resolved.fileId, alt: img[1]!, caption: img[3] ?? "" } });
      } else if (/^https?:\/\//i.test(src)) {
        drafts.push({ id: newId(), type: "image", depth: 0, text: [], props: { url: src, alt: img[1]!, caption: img[3] ?? "" } });
      } else {
        warnings.push({ line: lineNo(i), code: "unresolved_image", message: `Image "${src}" was not found and was kept as a link` });
        drafts.push({ id: newId(), type: "paragraph", depth: 0, text: [{ type: "text", text: img[1] || src, marks: [{ type: "link", href: sanitizeHref(src) ?? "#" }] }], props: {} });
      }
      continue;
    }
    // Wiki links [[Page]] stay as text (resolved later by the importer when possible).
    if (/^\s*<\/?(div|p|span|section|article|table|iframe|script|style|img|br|hr|ul|ol|li|h[1-6]|blockquote|pre|figure|video|audio|a|center|font)\b/i.test(line)) {
      flushParagraph();
      warnings.push({ line: lineNo(i), code: "html_block", message: "Raw HTML was imported as plain text" });
      drafts.push({ id: newId(), type: "paragraph", depth: 0, text: [{ type: "text", text: line.trim() }], props: {} });
      continue;
    }
    const details = /^\s*<details>\s*<summary>(.*?)<\/summary>(.*?)(<\/details>)?\s*$/.exec(line);
    if (details) {
      flushParagraph();
      drafts.push({ id: newId(), type: "toggle", depth: 0, text: parseInlineMarkdown(details[1]!), props: { collapsed: true } });
      continue;
    }
    if (/^\[\^[^\]]+\]:/.test(line)) {
      warnings.push({ line: lineNo(i), code: "footnote", message: "Footnote definition imported as a paragraph" });
    } else if (/^\s{0,3}\[[^\]]+\]:\s+\S+/.test(line)) {
      warnings.push({ line: lineNo(i), code: "reference_link", message: "Reference-style link definition imported as text" });
    }
    if (/\$\$[^$]+\$\$/.test(line)) {
      warnings.push({ line: lineNo(i), code: "math", message: "Inline math ($$…$$) isn’t rendered yet; it was kept as text" });
    }
    paragraph.push(line.trim());
  }
  flushParagraph();

  // Front matter: only `title` becomes part of the document; say which fields were left out.
  const dropped = Object.keys(frontMatter).filter((k) => k !== "title");
  if (dropped.length) {
    warnings.unshift({
      line: 1,
      code: "front_matter",
      message: `Front matter ${dropped.length === 1 ? "field" : "fields"} not imported: ${dropped.join(", ")} (only “title” is used)`,
    });
  }

  // Convert depth annotations into parent/rank assignments.
  const blocks: WireBlock[] = [];
  const stack: Draft[] = [];
  const parentOf = new Map<string, string | null>();
  for (const d of drafts) {
    while (stack.length && stack[stack.length - 1]!.depth >= d.depth) stack.pop();
    const parent = stack[stack.length - 1] ?? null;
    parentOf.set(d.id, parent && d.depth > 0 ? parent.id : null);
    stack.push(d);
  }
  const siblings = new Map<string | null, Draft[]>();
  for (const d of drafts) {
    const p = parentOf.get(d.id) ?? null;
    const list = siblings.get(p);
    if (list) list.push(d);
    else siblings.set(p, [d]);
  }
  const ranks = new Map<string, string>();
  for (const list of siblings.values()) {
    const seq = rankSequence(list.length);
    list.forEach((d, idx) => ranks.set(d.id, seq[idx]!));
  }
  for (const d of drafts) {
    blocks.push({
      id: d.id,
      type: d.type,
      parentId: parentOf.get(d.id) ?? null,
      rank: ranks.get(d.id)!,
      schemaVersion: SCHEMA_VERSION,
      text: d.text,
      props: d.props,
    });
  }
  return { title, blocks, frontMatter, warnings };
}

/** Plain text import: one paragraph per blank-line separated chunk. */
export function plainTextToBlocks(input: string, newId: () => string = () => ulid()): WireBlock[] {
  const chunks = input
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((c) => c.trim())
    .filter(Boolean);
  const ranks = rankSequence(chunks.length);
  return chunks.map((c, i) => ({
    id: newId(),
    type: "paragraph",
    parentId: null,
    rank: ranks[i]!,
    schemaVersion: SCHEMA_VERSION,
    text: [{ type: "text", text: c.replace(/\n/g, " ") }],
    props: {},
  }));
}
