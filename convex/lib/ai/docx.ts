// A Word (.docx) file's text, for the AI to read (lib/ai/attachments.ts). A .docx is a ZIP; its body is
// word/document.xml. Only that part is unzipped (refused past MAX_XML_BYTES, so a ZIP bomb can't blow up
// memory), and its runs of text are read in order: headings and list items keep a Markdown marker, tables
// become pipe rows, tabs and breaks stay. Deleted text (tracked changes), field codes and drawings are
// left out. Pure: no DOM, no Node.
import { unzipSync } from "fflate";

/** The largest document.xml read (its unzipped size). */
const MAX_XML_BYTES = 40 * 1024 * 1024;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** The body XML of a .docx, or null when the bytes aren't one (or it's too large unzipped). */
function documentXml(bytes: Uint8Array): string | null {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" && f.originalSize <= MAX_XML_BYTES });
  } catch {
    return null;
  }
  const xml = files["word/document.xml"];
  return xml ? new TextDecoder("utf-8", { fatal: false }).decode(xml) : null;
}

/** The text of a document.xml body: one line per paragraph, "#" for headings, "-" for list items. */
export function documentXmlToText(xml: string): string {
  const lines: string[] = [];
  let para: string[] | null = null;
  let prefix = "";
  let inText = false;
  let tableDepth = 0;
  let row: string[] | null = null;
  let cell: string[] | null = null;
  const tag = /<(\/?)(w:[A-Za-z]+)\b([^>]*?)(\/?)>|([^<]+)/g;
  for (let m = tag.exec(xml); m; m = tag.exec(xml)) {
    const [, close, name, attrs = "", selfClose, text] = m;
    if (text !== undefined) {
      if (inText && para) para.push(decode(text));
      continue;
    }
    if (close) {
      if (name === "w:t") inText = false;
      else if (name === "w:p" && para) {
        const line = para.join("").replace(/[  ]+$/g, "");
        if (cell) {
          if (line.trim()) cell.push(line.trim());
        } else lines.push(line.trim() ? `${prefix}${line}` : "");
        para = null;
      } else if (name === "w:tc" && tableDepth === 1 && row && cell) {
        row.push(cell.join(" ").replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|"));
        cell = null;
      } else if (name === "w:tr" && tableDepth === 1 && row) {
        if (row.some((c) => c.trim())) lines.push(`| ${row.join(" | ")} |`);
        row = null;
      } else if (name === "w:tbl") {
        tableDepth = Math.max(0, tableDepth - 1);
        if (tableDepth === 0) lines.push("");
      }
      continue;
    }
    switch (name) {
      case "w:p":
        if (!selfClose) {
          para = [];
          prefix = "";
        } else if (!cell) lines.push("");
        break;
      case "w:pStyle": {
        const style = /w:val="([^"]*)"/.exec(attrs)?.[1] ?? "";
        const level = /^heading\s*([1-9])$/i.exec(style)?.[1];
        if (level) prefix = `${"#".repeat(Math.min(3, Number(level)))} `;
        else if (/^title$/i.test(style)) prefix = "# ";
        else if (/^list/i.test(style) && !prefix) prefix = "- ";
        break;
      }
      case "w:numPr":
        if (!prefix) prefix = "- ";
        break;
      case "w:t":
        inText = !selfClose;
        break;
      case "w:tab":
        if (para && !/w:val=/.test(attrs)) para.push("\t");
        break;
      case "w:br":
      case "w:cr":
        para?.push("\n");
        break;
      case "w:noBreakHyphen":
        para?.push("-");
        break;
      case "w:tbl":
        if (tableDepth === 0) lines.push("");
        tableDepth++;
        break;
      case "w:tr":
        if (tableDepth === 1) row = [];
        break;
      case "w:tc":
        if (tableDepth === 1) cell = [];
        break;
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** A .docx file's text, or null when the bytes aren't a Word document. */
export function docxToText(bytes: Uint8Array): string | null {
  const xml = documentXml(bytes);
  return xml === null ? null : documentXmlToText(xml);
}
