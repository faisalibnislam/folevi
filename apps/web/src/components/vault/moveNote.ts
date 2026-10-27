// Moving a note into the Vault and back out (docs/VAULT_PLAN.md §5). In: the note's blocks become a sealed vault note,
// then the original is deleted for good (Trash, then permanent delete), so no readable copy stays outside the Vault.
// Out (custodians): the vault note is written as a regular note through the app's sync engine (sealed as usual in an
// end-to-end encrypted space), then the vault item goes. Only what a vault note can hold moves: text blocks, to-dos,
// quotes, code and dividers. A note with images, files, sub-pages, mentions or other blocks stays where it is.
import { getSchema } from "@tiptap/core";
import type { JSONContent } from "@tiptap/react";
import { DEFAULT_COVER, DEFAULT_DOCUMENT_STYLE, ulid, type WireBlock } from "@folevi/editor-schema";
import { blocksToDoc, docToBlocks } from "@/components/editor/convert";
import type { SyncEngine } from "@/lib/sync/engine";
import { NOTE_EXTENSIONS, noteDoc } from "./NoteEditor";

/** The blocks a vault note keeps. */
export const VAULT_NOTE_BLOCKS = new Set(["paragraph", "heading", "bulleted", "numbered", "todo", "quote", "code", "divider"]);

/** Why a note can't move into the Vault as it is, or null. */
export function whyNotMovable(blocks: readonly WireBlock[]): string | null {
  const other = blocks.find((b) => !VAULT_NOTE_BLOCKS.has(b.type));
  if (other) return "This note has images, files, sub-pages, tables or other blocks a Vault note can't hold. Move those out first.";
  const inline = blocks.flatMap((b) => b.text as { type?: string }[]).find((n) => n.type && n.type !== "text" && n.type !== "hardBreak");
  if (inline) return "This note mentions people, pages or dates. Turn those into plain text first.";
  return null;
}

/** A note's blocks as a vault note's document: links become plain text (a vault note never fetches anything). */
export function vaultDocFromBlocks(blocks: readonly WireBlock[]): JSONContent {
  const strip = (n: JSONContent): JSONContent => ({
    ...n,
    ...(n.marks ? { marks: n.marks.filter((m) => m.type !== "link") } : {}),
    ...(n.content ? { content: n.content.map(strip) } : {}),
  });
  const doc = strip(blocksToDoc(blocks));
  return doc.content?.length ? doc : { type: "doc", content: [{ type: "paragraph", attrs: { id: ulid() } }] };
}

/** A vault note's document as blocks for a regular note (every block with an id). */
export function blocksFromVaultDoc(doc: unknown): WireBlock[] {
  const json = noteDoc(doc);
  const withIds: JSONContent = { ...json, content: (json.content ?? []).map((n) => ({ ...n, attrs: { ...(n.attrs ?? {}), id: (n.attrs?.id as string | undefined) || ulid() } })) };
  const node = getSchema(NOTE_EXTENSIONS).nodeFromJSON(withIds);
  return docToBlocks(node, new Map());
}

/** Writes a vault note out as a new regular note in the engine's scope; resolves once the server has it. */
export async function writeRegularNote(engine: SyncEngine, title: string, blocks: WireBlock[]): Promise<string> {
  const id = ulid();
  engine.createDocument({ id, parentDocumentId: null, folderId: null, kind: "document", title, icon: null, style: DEFAULT_DOCUMENT_STYLE, cover: DEFAULT_COVER, templateId: null });
  engine.batch(() => {
    for (const b of blocks) engine.upsertBlock(id, b, ["content", "position"], null);
  });
  await engine.persisted();
  await engine.whenDocumentOnServer(id);
  return id;
}
