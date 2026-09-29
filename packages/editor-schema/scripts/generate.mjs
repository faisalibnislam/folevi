#!/usr/bin/env node
// Generates TypeScript types, Swift Codable types and a JSON Schema from spec/folevi-blocks.v1.json.
// `--check` fails when any generated output is stale.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
const repo = resolve(pkg, "../..");
const spec = JSON.parse(readFileSync(resolve(pkg, "spec/folevi-blocks.v1.json"), "utf8"));
const check = process.argv.includes("--check");
const HEADER = "Generated from packages/editor-schema/spec/folevi-blocks.v1.json by scripts/generate.mjs — do not edit.";

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

// ---------- Swift ----------
function swiftBase(base) {
  switch (base) {
    case "string":
      return "String";
    case "int":
      return "Int";
    case "number":
      return "Double";
    case "bool":
      return "Bool";
    default:
      return base;
  }
}
function swiftType(t) {
  const { base, arrays, optional } = parseType(t);
  let s = swiftBase(base);
  for (let i = 0; i < arrays; i++) s = `[${s}]`;
  return optional ? `${s}?` : s;
}
const swiftCase = (v) => (typeof v === "number" ? `level${v}` : v);
const swiftReserved = new Set(["default", "none", "plain", "code", "file", "date", "text", "link", "page", "strike"]);
const esc = (n) => (swiftReserved.has(n) ? `\`${n}\`` : n);

function swiftDecodeLine(name, t) {
  const { base, arrays, optional } = parseType(t);
  const isInt = base === "int" && arrays === 0;
  if (isInt) return optional ? `self.${name} = try c.decodeFlexibleIntIfPresent(forKey: .${name})` : `self.${name} = try c.decodeFlexibleInt(forKey: .${name})`;
  const ty = swiftType(t).replace(/\?$/, "");
  return optional
    ? `self.${name} = try c.decodeIfPresent(${ty}.self, forKey: .${name})`
    : `self.${name} = try c.decode(${ty}.self, forKey: .${name})`;
}
function swiftEncodeLine(name, t) {
  return parseType(t).optional
    ? `try c.encodeIfPresent(${name}, forKey: .${name})`
    : `try c.encode(${name}, forKey: .${name})`;
}

function swiftStruct(name, fields) {
  const entries = Object.entries(fields);
  if (!entries.length) {
    return `public struct ${name}: Codable, Sendable, Hashable {
    public init() {}
}`;
  }
  const props = entries.map(([k, t]) => `    public var ${k}: ${swiftType(t)}`).join("\n");
  const initParams = entries
    .map(([k, t]) => `${k}: ${swiftType(t)}${parseType(t).optional ? " = nil" : ""}`)
    .join(", ");
  const initBody = entries.map(([k]) => `        self.${k} = ${k}`).join("\n");
  return `public struct ${name}: Codable, Sendable, Hashable {
${props}

    public init(${initParams}) {
${initBody}
    }

    enum CodingKeys: String, CodingKey { case ${entries.map(([k]) => k).join(", ")} }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
${entries.map(([k, t]) => `        ${swiftDecodeLine(k, t)}`).join("\n")}
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
${entries.map(([k, t]) => `        ${swiftEncodeLine(k, t)}`).join("\n")}
    }
}`;
}

function swiftEnum(name, e) {
  if (e.type === "int") {
    return `public enum ${name}: Int, Codable, Sendable, Hashable, CaseIterable {
${e.values.map((v) => `    case ${swiftCase(v)} = ${v}`).join("\n")}

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decodeFlexibleInt()
        guard let value = ${name}(rawValue: raw) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid ${name} \\(raw)"))
        }
        self = value
    }
}`;
  }
  return `public enum ${name}: String, Codable, Sendable, Hashable, CaseIterable {
${e.values.map((v) => `    case ${esc(v)}`).join("\n")}
}`;
}

function swiftUnion(name, u) {
  const disc = u.discriminator;
  const variants = Object.entries(u.variants);
  const allKeys = new Set([disc]);
  for (const [, f] of variants) Object.keys(f).forEach((k) => allKeys.add(k));
  const cases = variants
    .map(([tag, f]) => {
      const fe = Object.entries(f);
      return fe.length
        ? `    case ${esc(tag)}(${fe.map(([k, t]) => `${k}: ${swiftType(t)}`).join(", ")})`
        : `    case ${esc(tag)}`;
    })
    .join("\n");
  const decodeCases = variants
    .map(([tag, f]) => {
      const fe = Object.entries(f);
      if (!fe.length) return `        case "${tag}": self = .${tag}`;
      const lets = fe.map(([k, t]) => {
        const { optional } = parseType(t);
        const ty = swiftType(t).replace(/\?$/, "");
        return optional
          ? `            let ${k} = try c.decodeIfPresent(${ty}.self, forKey: .${k})`
          : `            let ${k} = try c.decode(${ty}.self, forKey: .${k})`;
      });
      return `        case "${tag}":\n${lets.join("\n")}\n            self = .${tag}(${fe.map(([k]) => `${k}: ${k}`).join(", ")})`;
    })
    .join("\n");
  const encodeCases = variants
    .map(([tag, f]) => {
      const fe = Object.entries(f);
      if (!fe.length) return `        case .${tag}:\n            try c.encode("${tag}", forKey: .${disc})`;
      const binds = fe.map(([k]) => `let ${k}`).join(", ");
      const enc = fe.map(([k, t]) => `            ${swiftEncodeLine(k, t)}`).join("\n");
      return `        case .${tag}(${binds}):\n            try c.encode("${tag}", forKey: .${disc})\n${enc}`;
    })
    .join("\n");
  return `public enum ${name}: Codable, Sendable, Hashable {
${cases}

    enum CodingKeys: String, CodingKey { case ${[...allKeys].join(", ")} }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let tag = try c.decode(String.self, forKey: .${disc})
        switch tag {
${decodeCases}
        default:
            throw DecodingError.dataCorruptedError(forKey: .${disc}, in: c, debugDescription: "Unknown ${name} \\(tag)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
${encodeCases}
        }
    }
}`;
}

// Blocks marked "webOnly" stay out of the Swift schema (the native apps keep them as unknown blocks, verbatim).
const nativeBlocks = () => Object.fromEntries(Object.entries(spec.blocks).filter(([, d]) => !d.webOnly));

function genSwift() {
  const blocks = nativeBlocks();
  const out = [`// ${HEADER}`, "import Foundation", "", `public let foleviSchemaVersion = ${spec.schemaVersion}`, ""];
  for (const [n, e] of Object.entries(spec.enums)) out.push(swiftEnum(n, e), "");
  for (const [n, u] of Object.entries(spec.unions)) out.push(swiftUnion(n, u), "");
  for (const [n, f] of Object.entries(spec.structs)) out.push(swiftStruct(n, f), "");
  for (const [t, d] of Object.entries(blocks)) out.push(swiftStruct(propsName(t), d.props), "");
  const types = Object.keys(blocks);
  out.push(`/// Typed block content. Unknown types (written by a newer client) are preserved verbatim.
public enum BlockContent: Sendable, Hashable {
${types.map((t) => `    case ${esc(t)}(${propsName(t)})`).join("\n")}
    case unknown(type: String, props: JSONValue)

    public static let knownTypes: Set<String> = [${types.map((t) => `"${t}"`).join(", ")}]
    public static let textTypes: Set<String> = [${Object.entries(blocks)
      .filter(([, d]) => d.text)
      .map(([t]) => `"${t}"`)
      .join(", ")}]

    public var typeName: String {
        switch self {
${types.map((t) => `        case .${t}: return "${t}"`).join("\n")}
        case .unknown(let type, _): return type
        }
    }

    public var carriesText: Bool { Self.textTypes.contains(typeName) }

    public static func decode(type: String, props: JSONValue) throws -> BlockContent {
        switch type {
${types.map((t) => `        case "${t}": return .${t}(try props.decode(${propsName(t)}.self))`).join("\n")}
        default: return .unknown(type: type, props: props)
        }
    }

    public func encodedProps() throws -> JSONValue {
        switch self {
${types.map((t) => `        case .${t}(let p): return try JSONValue(encoding: p)`).join("\n")}
        case .unknown(_, let props): return props
        }
    }
}

public enum FoleviLimits {
${Object.entries(spec.limits)
  .map(([k, v]) => `    public static let ${k} = ${v}`)
  .join("\n")}
}

public let foleviCodeLanguages: [String] = [${spec.codeLanguages.map((l) => `"${l}"`).join(", ")}]
`);
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
  [resolve(repo, "apps/macos/Folevi/Domain/Generated/BlockSchema.swift"), genSwift()],
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
