// The Convex validators in convex/lib/e2ee/validators.ts agree with WP1's wire types in
// packages/local-store/src/crypto/e2ee/wire.ts (docs/E2EE_DESIGN.md §4.6). Values built with the real crypto
// core must pass the validators, the validators must accept no field the wire types lack, and a value with a
// field missing or of the wrong kind must fail. The `satisfies` lines also make `tsc` check assignability.
import { describe, expect, test } from "vitest";
import type { Infer, Validator } from "convex/values";
import type { SealedBlockFields, SealedDocumentCreate, SealedDocumentPatch, SealedField, SealedWireBlock, SignedStatement } from "@folevi/local-store/e2ee";
import {
  vAccountKeyStatement,
  vDeviceStatement,
  vNoteGrantStatement,
  vSealedBlockFields,
  vSealedDocumentCreateFields,
  vSealedDocumentPatch,
  vSealedField,
  vSealedWireBlock,
  vSignedStatement,
  vSpaceGrantStatement,
} from "../../convex/lib/e2ee/validators";
import { vWireBlock } from "../../convex/lib/validators";
import { e2eeLib, ulid, wire } from "./helpers";

type Json = { type: string; value?: unknown };

/** Checks `value` against a Convex validator's JSON form (the subset these validators use). */
function check(json: Json, value: unknown, path = "$"): string[] {
  switch (json.type) {
    case "any":
      return [];
    case "null":
      return value === null ? [] : [`${path}: expected null`];
    case "string":
      return typeof value === "string" ? [] : [`${path}: expected string`];
    case "number":
    case "float64":
      return typeof value === "number" ? [] : [`${path}: expected number`];
    case "boolean":
      return typeof value === "boolean" ? [] : [`${path}: expected boolean`];
    case "bytes":
      return value instanceof ArrayBuffer ? [] : [`${path}: expected ArrayBuffer`];
    case "literal":
      return value === json.value ? [] : [`${path}: expected ${JSON.stringify(json.value)}`];
    case "array":
      return Array.isArray(value) ? value.flatMap((x, i) => check(json.value as Json, x, `${path}[${i}]`)) : [`${path}: expected array`];
    case "union": {
      const options = json.value as Json[];
      return options.some((o) => check(o, value, path).length === 0) ? [] : [`${path}: matches no member of the union`];
    }
    case "object": {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [`${path}: expected object`];
      const fields = json.value as Record<string, { fieldType: Json; optional: boolean }>;
      const errors: string[] = [];
      for (const k of Object.keys(value)) if (!(k in fields) && (value as Record<string, unknown>)[k] !== undefined) errors.push(`${path}.${k}: not in the validator`);
      for (const [k, f] of Object.entries(fields)) {
        const x = (value as Record<string, unknown>)[k];
        if (x === undefined) {
          if (!f.optional) errors.push(`${path}.${k}: missing`);
        } else errors.push(...check(f.fieldType, x, `${path}.${k}`));
      }
      return errors;
    }
    default:
      return [`${path}: unsupported validator ${json.type}`];
  }
}
/** A validator's JSON form (`json` is there at runtime but not in Convex's public types). */
const jsonOf = (validator: Validator<unknown, "required", string>) => (validator as unknown as { json: Json }).json;
const ok = (validator: Validator<unknown, "required", string>, value: unknown) => check(jsonOf(validator), value);
const fieldsOf = (validator: Validator<unknown, "required", string>) => Object.keys(jsonOf(validator).value as Record<string, unknown>).sort();

async function sealedBlock(): Promise<SealedWireBlock> {
  const e2ee = await e2eeLib();
  const nk = await e2ee.deriveNoteKeys(e2ee.randomBytes(32));
  const docId = ulid();
  const blockId = ulid();
  const plain = e2ee.blockPlaintext({ type: "toggle", schemaVersion: 1, text: [{ type: "text", text: "Secret" }], props: { collapsed: true } });
  const context = e2ee.ctx.block(docId, blockId);
  const c = await e2ee.sealRecord(nk.content, 1, context, plain);
  const mac = await e2ee.macOf(nk.mac, context, plain);
  return {
    id: blockId,
    ...e2ee.SEALED_PLACEHOLDERS,
    parentId: null,
    rank: "V",
    revision: 3,
    sealed: { c: wire(c), mac, k: 1, collapsed: true, syncedSource: ulid(), mentions: [ulid()], mentionPreview: { title: "Plan", line: "Ask Sam" } },
  };
}

describe("wire shapes (§4.6) agree with the Convex validators", () => {
  test("SealedWireBlock and SealedBlockFields", async () => {
    const block = await sealedBlock();
    expect(ok(vSealedWireBlock, block)).toEqual([]);
    expect(ok(vSealedBlockFields, block.sealed)).toEqual([]);
    // It is also a valid vWireBlock once WP3 adds `sealed` to it (the placeholders fit today's fields).
    const { sealed: _sealed, ...shell } = block;
    expect(ok(vWireBlock, shell)).toEqual([]);
    // Every validator field exists on the wire type, and the other way round.
    expect(fieldsOf(vSealedBlockFields)).toEqual(Object.keys(block.sealed).sort());
    expect(fieldsOf(vSealedWireBlock)).toEqual(Object.keys(block).sort());
    // Placeholders and kinds are enforced.
    expect(ok(vSealedWireBlock, { ...block, type: "paragraph" })).not.toEqual([]);
    expect(ok(vSealedWireBlock, { ...block, schemaVersion: 1 })).not.toEqual([]);
    expect(ok(vSealedBlockFields, { ...block.sealed, c: new Uint8Array(4) })).not.toEqual([]);
    expect(ok(vSealedBlockFields, { ...block.sealed, collapsed: false })).not.toEqual([]);
    const { mac: _mac, ...noMac } = block.sealed;
    expect(ok(vSealedBlockFields, noMac)).toEqual(["$.mac: missing"]);
    const fields: SealedBlockFields = block.sealed;
    fields satisfies Infer<typeof vSealedBlockFields>;
  });

  test("SealedDocumentCreate, SealedDocumentPatch and SealedField", async () => {
    const e2ee = await e2eeLib();
    const create: SealedDocumentCreate["sealed"] = {
      title: wire(e2ee.randomBytes(40)),
      titleMac: "AAAAAAAAAAAAAAAAAAAAAA",
      appearance: wire(e2ee.randomBytes(40)),
      meta: wire(e2ee.randomBytes(40)),
      noteKey: { v: 1, spaceVersion: 1, wrapped: wire(e2ee.randomBytes(70)) },
      lockedOwn: true,
      fileIds: [ulid()],
    };
    expect(ok(vSealedDocumentCreateFields, create)).toEqual([]);
    expect(fieldsOf(vSealedDocumentCreateFields)).toEqual(Object.keys(create).sort());
    expect(ok(vSealedDocumentCreateFields, { ...create, noteKey: { ...create.noteKey, v: 2 } })).not.toEqual([]);
    const patch: Required<SealedDocumentPatch> = { sealedTitle: { c: wire(e2ee.randomBytes(40)), mac: "AAAAAAAAAAAAAAAAAAAAAA" }, sealedAppearance: wire(e2ee.randomBytes(40)), sealedMeta: wire(e2ee.randomBytes(40)) };
    expect(ok(vSealedDocumentPatch, patch)).toEqual([]);
    expect(ok(vSealedDocumentPatch, {})).toEqual([]);
    expect(fieldsOf(vSealedDocumentPatch)).toEqual(Object.keys(patch).sort());
    const field: SealedField = { c: wire(e2ee.randomBytes(40)), k: 2 };
    expect(ok(vSealedField, field)).toEqual([]);
    expect(fieldsOf(vSealedField)).toEqual(Object.keys(field).sort());
    create satisfies Infer<typeof vSealedDocumentCreateFields>;
    patch satisfies Infer<typeof vSealedDocumentPatch>;
    field satisfies Infer<typeof vSealedField>;
  });

  test("signed statements of every kind", async () => {
    const e2ee = await e2eeLib();
    const ed = await e2ee.generateEd25519();
    const kinds = [
      ["account-key", vAccountKeyStatement],
      ["device", vDeviceStatement],
      ["space-grant", vSpaceGrantStatement],
      ["note-grant", vNoteGrantStatement],
    ] as const;
    for (const [kind, validator] of kinds) {
      const s: SignedStatement = await e2ee.signStatement(ed.privateKey, kind, { any: "body" });
      expect(ok(validator, s)).toEqual([]);
      expect(ok(vSignedStatement, s)).toEqual([]);
      expect(fieldsOf(validator)).toEqual(Object.keys(s).sort());
      // A statement of another kind doesn't pass for this one.
      expect(ok(validator, { ...s, kind: kind === "device" ? "account-key" : "device" })).not.toEqual([]);
    }
  });
});
