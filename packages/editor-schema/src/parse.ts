import { BLOCK_TYPES, SCHEMA_VERSION } from "./generated/schema";
import type { Block, KnownBlock, UnknownBlock, WireBlock } from "./types";
import { migrateWireBlock } from "./migrations";
import { validateWireBlock } from "./validate";

const known = new Set<string>(BLOCK_TYPES);

/**
 * Converts a wire block into a typed block. Blocks from newer schema versions or with unknown types
 * become `unknown` blocks carrying the original payload so they can be written back untouched.
 */
export function parseBlock(input: WireBlock): Block {
  const wire = input.schemaVersion < SCHEMA_VERSION ? migrateWireBlock(input) : input;
  if (!known.has(wire.type) || wire.schemaVersion > SCHEMA_VERSION || validateWireBlock(wire).length > 0) {
    const unknown: UnknownBlock = {
      id: wire.id,
      type: "unknown",
      parentId: wire.parentId,
      rank: wire.rank,
      text: Array.isArray(wire.text) ? wire.text : [],
      props: {
        originalType: wire.type,
        originalSchemaVersion: wire.schemaVersion,
        raw: { text: wire.text, props: wire.props },
      },
    };
    if (wire.revision !== undefined) unknown.revision = wire.revision;
    return unknown;
  }
  const block = {
    id: wire.id,
    type: wire.type,
    parentId: wire.parentId,
    rank: wire.rank,
    text: wire.text,
    props: wire.props,
  } as KnownBlock;
  if (wire.revision !== undefined) block.revision = wire.revision;
  return block;
}

export function serializeBlock(block: Block): WireBlock {
  if (block.type === "unknown") {
    const raw = block.props.raw as { text?: unknown; props?: unknown };
    const wire: WireBlock = {
      id: block.id,
      type: block.props.originalType,
      parentId: block.parentId,
      rank: block.rank,
      schemaVersion: block.props.originalSchemaVersion,
      text: (Array.isArray(raw.text) ? raw.text : []) as WireBlock["text"],
      props: (raw.props && typeof raw.props === "object" ? raw.props : {}) as Record<string, unknown>,
    };
    if (block.revision !== undefined) wire.revision = block.revision;
    return wire;
  }
  const wire: WireBlock = {
    id: block.id,
    type: block.type,
    parentId: block.parentId,
    rank: block.rank,
    schemaVersion: SCHEMA_VERSION,
    text: block.text,
    props: stripUndefined(block.props as Record<string, unknown>),
  };
  if (block.revision !== undefined) wire.revision = block.revision;
  return wire;
}

export function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

/** Stable JSON with sorted keys, used by contract tests and content equality checks. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/** Content equality ignoring position and revision. */
export function sameContent(a: Pick<WireBlock, "type" | "text" | "props">, b: Pick<WireBlock, "type" | "text" | "props">): boolean {
  return a.type === b.type && canonicalJson(a.text) === canonicalJson(b.text) && canonicalJson(a.props) === canonicalJson(b.props);
}
