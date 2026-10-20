// What scenarios build with: client-side ids with names, notes created and changed the way the editor does
// it (sync.push ops), and blocks. Everything goes through the backend's public functions.
import { NOTE_EMOJI, SCHEMA_VERSION, ulid, type SyncOp, type WireBlock, type WireDocumentPatch } from "@folevi/editor-schema";
import { api } from "../../convex/_generated/api";
import type { ParityBackend } from "./types";

type OpResult = Awaited<ReturnType<ParityBackend["mutation"]>> & { status: string };

export class Kit {
  constructor(private readonly b: ParityBackend) {}

  /** A new client id (a ULID, as the editor makes them), shown as `<name>` in normalized results. */
  id(name: string): string {
    const id = ulid();
    this.name(id, name);
    return id;
  }

  /** Shows a value the backend generated (a folder id, a tag id) as `<name>`. */
  name<V extends string>(value: V, name: string): V {
    if ([...this.b.known.values()].includes(`<${name}>`)) throw new Error(`the name <${name}> is used twice in this scenario`);
    this.b.known.set(value, `<${name}>`);
    return value;
  }

  /** Pushes ops the way the sync engine does and returns each op's result. */
  async push(ops: SyncOp[]): Promise<OpResult[]> {
    const results = (await this.b.mutation(api.sync.push, { scope: this.b.scope, deviceId: this.b.deviceId, ops: ops as never })) as OpResult[];
    return results;
  }

  /** Pushes ops and fails the scenario unless every one was applied. */
  async apply(ops: SyncOp[]): Promise<OpResult[]> {
    const results = await this.push(ops);
    const refused = results.filter((r) => r.status !== "applied");
    if (refused.length) throw new Error(`${this.b.kind}: ops not applied: ${JSON.stringify(refused)}`);
    return results;
  }

  /**
   * Creates a note (document.create), named `<name>`. It's given an icon: the server picks a random one for a
   * note made without (randomNoteEmoji), which no comparison could match.
   */
  async newNote(name: string, o: { title?: string; parent?: string | null; folder?: string | null; icon?: string | null } = {}): Promise<string> {
    const id = this.id(name);
    await this.apply([
      {
        opId: ulid(),
        kind: "document.create",
        document: { id, parentDocumentId: o.parent ?? null, folderId: o.folder ?? null, kind: "document", title: o.title ?? "", icon: o.icon === undefined ? NOTE_EMOJI[0]! : o.icon },
      },
    ]);
    return id;
  }

  /** Changes a note's title, icon, folder or parent (document.update, as the editor and sidebar send it). */
  async update(documentId: string, patch: WireDocumentPatch, baseRevision: number | null = null) {
    return await this.apply([{ opId: ulid(), kind: "document.update", documentId, patch, baseRevision }]);
  }

  /** Adds or changes blocks (block.upsert, content and position), one op per block, in one batch. */
  async upsert(documentId: string, blocks: WireBlock[], baseRevision: number | null = null) {
    return await this.apply(blocks.map((block) => ({ opId: ulid(), kind: "block.upsert" as const, documentId, block, baseRevision, fields: ["content", "position"] as ("content" | "position")[] })));
  }

  async deleteBlock(documentId: string, blockId: string, baseRevision: number | null = null) {
    return await this.apply([{ opId: ulid(), kind: "block.delete", documentId, blockId, baseRevision }]);
  }
}

/** A paragraph block, as the editor sends it. */
export function para(id: string, text: string, rank: string, parentId: string | null = null): WireBlock {
  return { id, type: "paragraph", parentId, rank, schemaVersion: SCHEMA_VERSION, text: text ? [{ type: "text", text }] : [], props: {} };
}

/** A heading block. */
export function heading(id: string, text: string, rank: string, level: 1 | 2 | 3 = 1): WireBlock {
  return { id, type: "heading", parentId: null, rank, schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text }], props: { level } };
}

/** A to-do block. */
export function todo(id: string, text: string, rank: string, checked = false): WireBlock {
  return { id, type: "todo", parentId: null, rank, schemaVersion: SCHEMA_VERSION, text: [{ type: "text", text }], props: { checked } };
}
