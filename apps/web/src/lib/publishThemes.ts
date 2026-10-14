// Publishing themes: how a public link's page looks (app/s/[token]). "Note" is the note's own style, as in
// the app; the others are curated looks for reading on the web. Chosen per link in the Share dialog and
// stored on the link (convex/sharing.ts, lib/validators.ts vPublishTheme).
import { flattenTree, plainText, type DocumentStyle, type WireBlock } from "@folevi/editor-schema";

export type PublishTheme = "note" | "article" | "docs" | "minimal";

export const PUBLISH_THEMES: readonly { id: PublishTheme; name: string; hint: string }[] = [
  { id: "note", name: "Note", hint: "The note’s own style" },
  { id: "article", name: "Article", hint: "Serif and narrow, for reading" },
  { id: "docs", name: "Docs", hint: "Wide, with contents beside it" },
  { id: "minimal", name: "Minimal", hint: "Plain paper, no cover" },
];

/** A theme name from the server, or "note" for anything else (an older or newer value). */
export function publishTheme(value: unknown): PublishTheme {
  return PUBLISH_THEMES.some((t) => t.id === value) ? (value as PublishTheme) : "note";
}

/** What a theme does to the page: its type and width, and which of the note's own looks it keeps. */
export interface PublishLook {
  font: DocumentStyle["font"];
  width: DocumentStyle["width"];
  /** The note's cover band at the top of the page. */
  cover: boolean;
  /** The backdrop the page floats on. */
  backdrop: boolean;
  /** The note's paper and text colours (its theme). Off: the plain page, light or dark. */
  colors: boolean;
  /** A table of contents from the headings, beside the page on wide screens. */
  toc: boolean;
}

export function publishLook(theme: PublishTheme, style: Pick<DocumentStyle, "font" | "width">): PublishLook {
  switch (theme) {
    case "article":
      return { font: "serif", width: "narrow", cover: true, backdrop: true, colors: true, toc: false };
    case "docs":
      return { font: "sans", width: "wide", cover: true, backdrop: false, colors: true, toc: true };
    case "minimal":
      return { font: style.font, width: style.width, cover: false, backdrop: false, colors: false, toc: false };
    default:
      return { font: style.font, width: style.width, cover: true, backdrop: true, colors: true, toc: false };
  }
}

/** The page's headings, in order, for the Docs table of contents (anchors are ReadOnlyBlocks' `block-<id>`). */
export function tableOfContents(blocks: readonly WireBlock[]): { id: string; text: string; level: number }[] {
  return flattenTree(blocks)
    .map((e) => e.block)
    .filter((b) => b.type === "heading")
    .map((b) => ({ id: b.id, text: plainText(b.text).trim(), level: Math.min(3, Math.max(1, Number((b.props as { level?: unknown }).level) || 1)) }))
    .filter((h) => h.text);
}
