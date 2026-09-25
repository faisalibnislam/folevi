import { SCHEMA_VERSION } from "./generated/schema";
import type { WireBlock } from "./types";

/**
 * Schema migrations. Each entry upgrades a wire block from `from` to `from + 1`.
 *
 * Version 0 is the pre-release alpha format used by early prototypes: headings were separate types
 * (`h1`…`h3`), checklists were `checklist` with `done`, bullets were `bullet`, and text was a plain
 * string. It is kept so imported prototype data upgrades cleanly and as the template for future
 * migrations.
 */
const migrations: Record<number, (b: WireBlock) => WireBlock> = {
  0: (b) => {
    const legacyText = (b as unknown as { text: unknown }).text;
    const text = typeof legacyText === "string" ? (legacyText ? [{ type: "text" as const, text: legacyText }] : []) : b.text;
    const base = { ...b, text, schemaVersion: 1 };
    switch (b.type) {
      case "h1":
      case "h2":
      case "h3":
        return { ...base, type: "heading", props: { level: Number(b.type.slice(1)) } };
      case "checklist": {
        const { done, ...rest } = b.props as { done?: boolean };
        return { ...base, type: "todo", props: { ...rest, checked: Boolean(done) } };
      }
      case "bullet":
        return { ...base, type: "bulleted", props: {} };
      case "text":
        return { ...base, type: "paragraph", props: {} };
      default:
        return base;
    }
  },
};

export function migrateWireBlock(block: WireBlock): WireBlock {
  let current = block;
  while (current.schemaVersion < SCHEMA_VERSION) {
    const step = migrations[current.schemaVersion];
    if (!step) throw new Error(`no migration from schema version ${current.schemaVersion}`);
    current = step(current);
  }
  return current;
}
