#!/usr/bin/env node
// Generates TypeScript types and a JSON Schema from spec/folevi-blocks.v1.json.
// `--check` fails when any generated output is stale.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
const repo = resolve(pkg, "../..");
const spec = JSON.parse(readFileSync(resolve(pkg, "spec/folevi-blocks.v1.json"), "utf8"));
const check = process.argv.includes("--check");
const HEADER = "Generated from packages/editor-schema/spec/folevi-blocks.v1.json by scripts/generate.mjs. Do not edit.";

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const propsName = (t) => `${cap(t)}Props`;

/** Parses a field type like "InlineNode[][]?" into { base, arrays, optional }. */
function parseType(t) {
  let optional = false;
  if (t.endsWith("?")) {
    optional = true;
    t = t.slice(0, -1);
  }
  let arrays = 0;
  while (t.endsWith("[]")) {
    arrays++;
    t = t.slice(0, -2);
  }
  return { base: t, arrays, optional };
}

// ---------- TypeScript ----------
function tsBase(base) {
  switch (base) {
    case "string":
      return "string";
    case "int":
    case "number":
      return "number";
    case "bool":
      return "boolean";
    default:
      return base;
  }
}
function tsType(t) {
  const { base, arrays } = parseType(t);
  let s = tsBase(base);
  for (let i = 0; i < arrays; i++) s = `${s}[]`;
  return s;
}
function tsFields(fields, indent = "  ") {
  return Object.entries(fields)
    .map(([k, t]) => `${indent}${k}${parseType(t).optional ? "?" : ""}: ${tsType(t)};`)
    .join("\n");
}

function genTs() {
  const out = [`// ${HEADER}`, "", `export const SCHEMA_VERSION = ${spec.schemaVersion} as const;`, ""];
  for (const [name, e] of Object.entries(spec.enums)) {
    out.push(`export const ${name}Values = ${JSON.stringify(e.values)} as const;`);
    out.push(`export type ${name} = (typeof ${name}Values)[number];`);
  }
  out.push("");
  for (const [name, u] of Object.entries(spec.unions)) {
    const variants = Object.entries(u.variants).map(([tag, fields]) =>
      Object.keys(fields).length
        ? `  | {\n      ${u.discriminator}: ${JSON.stringify(tag)};\n${tsFields(fields, "      ")}\n    }`
        : `  | { ${u.discriminator}: ${JSON.stringify(tag)} }`,
    );
    out.push(`export type ${name} =\n${variants.join("\n")};`);
    out.push(`export const ${name}Types = ${JSON.stringify(Object.keys(u.variants))} as const;`);
    out.push("");
  }
  for (const [name, fields] of Object.entries(spec.structs)) {
    out.push(`export interface ${name} {\n${tsFields(fields)}\n}`);
  }
  out.push("");
  for (const [type, def] of Object.entries(spec.blocks)) {
    const f = def.props;
    out.push(
      Object.keys(f).length
        ? `export interface ${propsName(type)} {\n${tsFields(f)}\n}`
        : `export type ${propsName(type)} = Record<string, never>;`,
    );
  }
  out.push("");
  out.push("export interface BlockPropsMap {");
  for (const type of Object.keys(spec.blocks)) out.push(`  ${type}: ${propsName(type)};`);
  out.push("}");
  out.push(`export const BLOCK_TYPES = ${JSON.stringify(Object.keys(spec.blocks))} as const;`);
  out.push("export type KnownBlockType = (typeof BLOCK_TYPES)[number];");
  out.push(
    `export const TEXT_BLOCK_TYPES = ${JSON.stringify(
      Object.entries(spec.blocks)
        .filter(([, d]) => d.text)
        .map(([t]) => t),
    )} as const;`,
  );
  out.push("export type TextBlockType = (typeof TEXT_BLOCK_TYPES)[number];");
  out.push(`export const LIMITS = ${JSON.stringify(spec.limits, null, 2)} as const;`);
  out.push(`export const CODE_LANGUAGES = ${JSON.stringify(spec.codeLanguages)} as const;`);
  out.push("");
  out.push("/** Raw spec, used by the runtime validator. */");
  out.push(`export const SPEC = ${JSON.stringify({ enums: spec.enums, unions: spec.unions, structs: spec.structs, blocks: spec.blocks })} as const;`);
  out.push("");
  return out.join("\n");
}

// ---------- JSON Schema ----------
function jsBase(base) {
  switch (base) {
    case "string":
      return { type: "string" };
    case "int":
      return { type: "integer" };
    case "number":
      return { type: "number" };
    case "bool":
      return { type: "boolean" };
    default:
      return { $ref: `#/$defs/${base}` };
  }
}
function jsType(t) {
  const { base, arrays } = parseType(t);
  let s = jsBase(base);
  for (let i = 0; i < arrays; i++) s = { type: "array", items: s };
  return s;
}
function jsObject(fields, extra = {}) {
  const entries = Object.entries(fields);
  return {
    type: "object",
    properties: { ...extra.properties, ...Object.fromEntries(entries.map(([k, t]) => [k, jsType(t)])) },
    required: [...(extra.required ?? []), ...entries.filter(([, t]) => !parseType(t).optional).map(([k]) => k)],
    additionalProperties: false,
  };
}
function genJsonSchema() {
  const $defs = {};
  for (const [n, e] of Object.entries(spec.enums)) $defs[n] = { enum: e.values };
  for (const [n, u] of Object.entries(spec.unions)) {
    $defs[n] = {
      oneOf: Object.entries(u.variants).map(([tag, f]) =>
        jsObject(f, { properties: { [u.discriminator]: { const: tag } }, required: [u.discriminator] }),
      ),
    };
  }
  for (const [n, f] of Object.entries(spec.structs)) $defs[n] = jsObject(f);
  for (const [t, d] of Object.entries(spec.blocks)) $defs[propsName(t)] = jsObject(d.props);
  return JSON.stringify(
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://folevi.com/schema/blocks/v1.json",
      title: "Folevi wire block",
      type: "object",
      required: ["id", "type", "parentId", "rank", "schemaVersion", "text", "props"],
      properties: {
        id: { type: "string", minLength: 1, maxLength: 64 },
        type: { type: "string" },
        parentId: { type: ["string", "null"] },
        rank: { type: "string", minLength: 1, maxLength: spec.limits.maxRankLength },
        schemaVersion: { type: "integer", minimum: 1 },
        text: { type: "array", items: { $ref: "#/$defs/InlineNode" } },
        props: { type: "object" },
        revision: { type: "integer", minimum: 0 },
      },
      allOf: Object.keys(spec.blocks).map((t) => ({
        if: { properties: { type: { const: t } } },
        then: { properties: { props: { $ref: `#/$defs/${propsName(t)}` } } },
      })),
      $defs,
    },
    null,
    2,
  ) + "\n";
}

const outputs = [
  [resolve(pkg, "src/generated/schema.ts"), genTs()],
  [resolve(pkg, "generated/folevi-blocks.schema.json"), genJsonSchema()],
];
let stale = false;
for (const [file, content] of outputs) {
  if (check) {
    if (!existsSync(file) || readFileSync(file, "utf8") !== content) {
      console.error(`stale: ${file}`);
      stale = true;
    }
    continue;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  console.log(`wrote ${file.replace(repo + "/", "")}`);
}
if (stale) {
  console.error("Generated schema files are stale. Run `pnpm schema:gen`.");
  process.exit(1);
}
