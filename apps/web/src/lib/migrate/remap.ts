// The ids a note's content names that change on the way (docs/LOCAL_MODE_PLAN.md §6.1 step 5, §6.2 step 3):
// attachments get the other side's file ids, the Inbox is the other side's Inbox, and the person is the other
// side's profile. Every other id (notes, blocks, synced content, collections, folders) stays as it is, so links
// between notes keep working. Pure.
import { SCHEMA_VERSION, type InlineNode, type WireBlock } from "@folevi/editor-schema";
import type { FileProblem, SourceCollection, SourceFile } from "./types";

export interface IdMaps {
  /** Notes whose id changes (the Inbox). */
  documents: ReadonlyMap<string, string>;
  /** Attachments copied: source file id → the id there. */
  files: ReadonlyMap<string, string>;
  /** Attachments that didn't come along, and why (their blocks become a line saying so). */
  missingFiles: ReadonlyMap<string, { problem: FileProblem; name: string }>;
  /** The person: their profile id on the source → on the target. */
  profiles: ReadonlyMap<string, string>;
}

/** The block types that show one of the note's files, and what kind of file it is to the uploader. */
const FILE_BLOCKS: Record<string, SourceFile["kind"]> = { image: "image", file: "file", audio: "audio" };

/** The attachments a block shows, with their kind. */
export function blockFile(block: WireBlock): { fileId: string; kind: SourceFile["kind"]; name: string } | null {
  const kind = FILE_BLOCKS[block.type];
  const fileId = (block.props as { fileId?: unknown }).fileId;
  if (!kind || typeof fileId !== "string" || !fileId) return null;
  const name = (block.props as { name?: unknown; alt?: unknown }).name;
  return { fileId, kind, name: typeof name === "string" && name ? name : kind === "image" ? "Image" : "File" };
}

/** The note theme image a note's cover shows, if any. */
export function coverFile(cover: { kind: string; value?: string } | undefined | null): string | null {
  return cover?.kind === "image" && cover.value ? cover.value : null;
}

const mapId = (map: ReadonlyMap<string, string>, id: string) => map.get(id) ?? id;

function remapNode(node: InlineNode, maps: IdMaps): InlineNode {
  if (node.type === "mention") return maps.profiles.has(node.userId) ? { ...node, userId: maps.profiles.get(node.userId)! } : node;
  if (node.type === "pageLink") return maps.documents.has(node.documentId) ? { ...node, documentId: maps.documents.get(node.documentId)! } : node;
  return node;
}

const remapNodes = (nodes: InlineNode[], maps: IdMaps) => nodes.map((n) => remapNode(n, maps));

function words(n: number): string {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;
}

/** What a block whose file didn't come along says instead (the file is still where it was). */
export function missingFileLine(name: string, problem: FileProblem): string {
  switch (problem) {
    case "space":
      return `“${name}” didn’t fit in the storage there. It’s still where it was before the move.`;
    case "size":
      return `“${name}” is larger than one file can be there. It’s still where it was before the move.`;
    case "missing":
      return `“${name}” couldn’t be found when the notes were moved.`;
    default:
      return `“${name}” couldn’t be moved. It’s still where it was before the move.`;
  }
}

/** A short size for people to read. */
export const fileSize = words;

/** The block as the target should get it: its file, Inbox and person ids the target's. Same id, same place. */
export function remapBlock(block: WireBlock, maps: IdMaps): WireBlock {
  const { revision: _revision, ...rest } = block;
  let out: WireBlock = { ...rest, props: { ...block.props }, text: remapNodes(block.text ?? [], maps) };
  const file = blockFile(block);
  if (file) {
    const missing = maps.missingFiles.get(file.fileId);
    if (missing) {
      // The note keeps the line, saying where the file is; nothing points at a file the target doesn't have.
      return { id: block.id, type: "paragraph", parentId: block.parentId, rank: block.rank, schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text: missingFileLine(missing.name, missing.problem) }], props: {} };
    }
    out.props.fileId = mapId(maps.files, file.fileId);
  }
  const p = out.props as Record<string, unknown>;
  if (block.type === "page" && typeof p.documentId === "string") p.documentId = mapId(maps.documents, p.documentId);
  if (typeof p.assigneeId === "string" && maps.profiles.has(p.assigneeId)) p.assigneeId = maps.profiles.get(p.assigneeId);
  if (block.type === "table" && Array.isArray(p.rows)) {
    p.rows = (p.rows as InlineNode[][][]).map((row) => (Array.isArray(row) ? row.map((cell) => (Array.isArray(cell) ? remapNodes(cell, maps) : cell)) : row));
  }
  out = { ...out, props: p };
  return out;
}

/** A row's values as the target should get them: people and linked notes the target's. */
export function remapRowValues(values: Record<string, unknown>, properties: SourceCollection["properties"], maps: IdMaps): Record<string, unknown> {
  const types = new Map(properties.map((p) => [p.id, p.type]));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const type = types.get(key);
    if (type === "formula" || type === undefined) continue;
    const map = type === "person" ? maps.profiles : type === "relation" ? maps.documents : null;
    if (map && typeof value === "string") out[key] = mapId(map, value);
    else if (map && Array.isArray(value)) out[key] = value.map((v) => (typeof v === "string" ? mapId(map, v) : v));
    else out[key] = value;
  }
  return out;
}

/** A note's blocks in an order the backend takes them in: every parent before its children, siblings by rank. */
export function parentsFirst(blocks: readonly WireBlock[]): WireBlock[] {
  const ids = new Set(blocks.map((b) => b.id));
  const children = new Map<string | null, WireBlock[]>();
  for (const b of blocks) {
    // A block whose parent isn't there sits at the top (the backend would refuse it under a missing parent).
    const parent = b.parentId && ids.has(b.parentId) ? b.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), parent === b.parentId ? b : { ...b, parentId: null }]);
  }
  const out: WireBlock[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    const kids = (children.get(parent) ?? []).sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : 1));
    for (const b of kids) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      out.push(b);
      if (depth < 64) walk(b.id, depth + 1);
    }
  };
  walk(null, 0);
  // Anything left (a cycle) goes last, at the top.
  for (const b of blocks) if (!seen.has(b.id)) out.push({ ...b, parentId: null });
  return out;
}
