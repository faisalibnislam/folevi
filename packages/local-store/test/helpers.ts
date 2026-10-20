import type { ChangedField, WireBlock } from "@folevi/editor-schema";
import {
  HybridClock,
  addTag,
  createNote,
  deleteBlock,
  dismissNotice,
  isStub,
  makeStub,
  removeTag,
  restoreBlock,
  setDocField,
  setFile,
  setFileText,
  setRowValue,
  setVersionName,
  upsertBlock,
  type NoteFile,
  type NoteLike,
} from "../src";

export const DOC = "01J9ZDOC000000000000000001";

export function para(
  id: string,
  text: string,
  opts: {
    parentId?: string | null;
    rank?: string;
    type?: string;
    props?: Record<string, unknown>;
  } = {},
): WireBlock {
  return {
    id,
    type: opts.type ?? "paragraph",
    parentId: opts.parentId ?? null,
    rank: opts.rank ?? "V",
    schemaVersion: 1,
    text: text ? [{ type: "text", text }] : [],
    props: opts.props ?? {},
  };
}

export function textOf(note: NoteFile, id: string): string | null {
  const b = note.blocks[id];
  if (!b || b.deleted) return null;
  return (b.text as { text?: string }[]).map((t) => t.text ?? "").join("");
}

/** A simulated device with a controllable wall clock. */
export class Device {
  now = 0;
  readonly clock: HybridClock;
  state: NoteLike | null = null;
  constructor(readonly name: string) {
    this.clock = new HybridClock(name, { now: () => this.now });
  }
  get note(): NoteFile {
    if (!this.state || isStub(this.state)) throw new Error(`${this.name} has no live note`);
    return this.state;
  }
}

export type Op = Record<string, unknown> & { op: string };

/** Applies one scenario op to a device's note. */
export function applyOp(d: Device, step: Op): void {
  const c = d.clock;
  const block = (id: string) => {
    const b = d.note.blocks[id];
    if (!b) throw new Error(`no block ${id} on ${d.name}`);
    return b;
  };
  const wireOf = (id: string): WireBlock => {
    const b = block(id);
    const props: Record<string, unknown> = { ...b.props };
    if (b.collapsed !== undefined) props.collapsed = b.collapsed;
    return {
      id,
      type: b.type,
      parentId: b.parentId,
      rank: b.rank,
      schemaVersion: b.schemaVersion,
      text: b.text as WireBlock["text"],
      props,
    };
  };
  switch (step.op) {
    case "create": {
      const doc = (step.doc ?? {}) as { title?: string; kind?: string };
      d.state = createNote(
        (step.id as string) ?? DOC,
        { createdAt: d.now, title: doc.title, kind: doc.kind },
        c,
      );
      return;
    }
    case "upsert": {
      const b = step.block as {
        id: string;
        text?: string;
        parentId?: string | null;
        rank?: string;
        type?: string;
        props?: Record<string, unknown>;
      };
      d.state = upsertBlock(
        d.note,
        para(b.id, b.text ?? "", b),
        (step.fields as ChangedField[]) ?? ["content", "position"],
        c,
      );
      return;
    }
    case "text": {
      const id = step.block as string;
      const w = wireOf(id);
      w.text = (step.text as string) ? [{ type: "text", text: step.text as string }] : [];
      d.state = upsertBlock(d.note, w, ["content"], c);
      return;
    }
    case "props": {
      const id = step.block as string;
      const w = wireOf(id);
      w.props = { ...w.props, ...(step.props as Record<string, unknown>) };
      d.state = upsertBlock(d.note, w, ["content"], c);
      return;
    }
    case "move": {
      const id = step.block as string;
      const w = wireOf(id);
      w.parentId = (step.parentId as string | null) ?? null;
      w.rank = (step.rank as string) ?? w.rank;
      d.state = upsertBlock(d.note, w, ["position"], c);
      return;
    }
    case "collapse": {
      const id = step.block as string;
      const w = wireOf(id);
      w.props = { ...w.props, collapsed: step.value as boolean };
      d.state = upsertBlock(d.note, w, ["collapsed"], c);
      return;
    }
    case "delete":
      d.state = deleteBlock(d.note, step.block as string, c);
      return;
    case "restore":
      d.state = restoreBlock(d.note, step.block as string, c);
      return;
    case "field":
      d.state = setDocField(d.note, step.name as never, step.value as never, c);
      return;
    case "tag":
      d.state = addTag(d.note, step.id as string, c);
      return;
    case "untag":
      d.state = removeTag(d.note, step.id as string, c);
      return;
    case "file":
      d.state = setFile(
        d.note,
        step.id as string,
        {
          sha256: (step.sha256 as string) ?? "a".repeat(64),
          name: (step.name as string) ?? "f.png",
          mime: "image/png",
          size: 1,
          kind: "image",
          palette: step.palette,
        },
        c,
      );
      return;
    case "fileText":
      d.state = setFileText(
        d.note,
        step.id as string,
        { source: "pdf", reader: "pdfjs", text: step.text as string, fingerprint: "fp" },
        c,
      );
      return;
    case "versionName":
      d.state = setVersionName(d.note, step.file as string, step.name as string | null, c);
      return;
    case "rowValue":
      d.state = setRowValue(
        d.note,
        (step.collection as string) ?? "01J9ZCOL000000000000000001",
        step.property as string,
        step.value,
        c,
      );
      return;
    case "dismiss": {
      const target = step.target as string;
      const id = Object.keys(d.note.notices).find((k) => {
        const n = d.note.notices[k]!;
        return (n.blockId ?? `doc.${n.field}`) === target;
      });
      if (!id) throw new Error(`${d.name} has no notice on ${target}`);
      d.state = dismissNotice(d.note, id, c);
      return;
    }
    case "permanentDelete":
      d.state = makeStub(d.state!, c.tick());
      return;
    default:
      throw new Error(`unknown op ${step.op}`);
  }
}
