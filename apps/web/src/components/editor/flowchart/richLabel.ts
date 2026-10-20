// A shape label as a small ProseMirror document, for the label editor (interactions/shapeText.tsx): one
// paragraph per line, each optionally a bullet or numbered item (as the model stores it), with the note
// editor's own marks (bold, italic, underline, strike, code, links, text colours, highlights). The
// conversions reuse the note editor's (convert.ts), so a label's formatting means exactly what a note's does.
import { Node, type JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { ALL_MARKS } from "../extensions";
import { inlineToPM, pmInline } from "../convert";
import { plainToRich, richPlainText, type FlowNode, type FlowParagraph, type FlowRun } from "./schema";

export type LabelList = "bullet" | "ordered";

const LabelDoc = Node.create({ name: "doc", topNode: true, content: "paragraph+" });

const LabelParagraph = Node.create({
  name: "paragraph",
  group: "block",
  content: "text*",
  addAttributes: () => ({
    list: {
      default: null,
      keepOnSplit: true,
      parseHTML: (el: HTMLElement) => {
        const v = el.getAttribute("data-list");
        return v === "bullet" || v === "ordered" ? v : null;
      },
      renderHTML: (a: Record<string, unknown>) => (a.list ? { "data-list": String(a.list) } : {}),
    },
  }),
  parseHTML: () => [{ tag: "p" }],
  renderHTML: ({ HTMLAttributes }) => ["p", HTMLAttributes, 0],
});

const LabelText = Node.create({ name: "text", group: "inline" });

/** The label editor's schema: paragraphs (maybe list items) of marked text. */
export const LABEL_EXTENSIONS = [LabelDoc, LabelParagraph, LabelText, ...ALL_MARKS];

/** A node's label as the label editor's document. */
export function labelDoc(n: Pick<FlowNode, "text" | "rich">): JSONContent {
  const paragraphs = n.rich && richPlainText(n.rich) === n.text ? n.rich : plainToRich(n.text);
  return {
    type: "doc",
    content: (paragraphs.length ? paragraphs : [{ text: [] }]).map((p) => {
      const content = inlineToPM(p.text);
      return { type: "paragraph", attrs: { list: p.list ?? null }, ...(content.length ? { content } : {}) };
    }),
  };
}

/** The label editor's document as the model's paragraphs. */
export function labelParagraphs(doc: PMNode): FlowParagraph[] {
  const out: FlowParagraph[] = [];
  doc.forEach((p) => {
    const text = pmInline(p).filter((r): r is FlowRun => r.type === "text" && !r.text.includes("\n"));
    const list = p.attrs.list as LabelList | null;
    out.push(list ? { text, list } : { text });
  });
  return out;
}

/** Plain text pasted into a label: one paragraph per line, no formatting, no control characters. */
export function pastedLines(text: string): string[] {
  return (
    text
      .replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
      .replace(/\t/g, " ")
      .split("\n")
  );
}
