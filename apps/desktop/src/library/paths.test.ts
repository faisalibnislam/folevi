// The restated path rules and note-name parsing agree with packages/local-store's (layout.ts).
import { describe, expect, test } from "vitest";
import * as ref from "../../../../packages/local-store/src/layout";
import { isValidLibraryPath, parseNoteFileName } from "./paths";

const ULID = "01J9ZDOC000000000000000001";
const HMAC = "7k2m9q4r1t8v3w6x0y5z2a7b4c";

const PATHS = [
  "",
  "notes/a.fnote",
  "/abs",
  "../x",
  "notes/../x",
  "notes//x",
  "notes/x/",
  "notes\\x",
  "notes/\u0000",
  "notes/a\u007f",
  ".",
  "..",
  "a/./b",
  ".folevi-tmp/x",
  "files/9f/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "x".repeat(1024),
  "x".repeat(1025),
  "notes/Ünïcode name.fnote",
];

const NAMES = [
  `${ULID}.fnote`,
  `${HMAC}.fnote`,
  `${ULID} (Faisal's conflicted copy 2026-10-20).fnote`,
  `${ULID} (Case Conflict).fnote`,
  `${ULID} 2.fnote`,
  `${ULID}(1).fnote`,
  `${ULID} (1).fnote`,
  `${ULID}-MACBOOK.fnote`,
  `${HMAC}-MACBOOK.fnote`,
  `.${ULID}.fnote.icloud`,
  `.${HMAC} 2.fnote.icloud`,
  "daily-2026-10-20-0123456789abcdef.fnote",
  "inbox-0123456789abcdef.fnote",
  "inbox-0123456789abcdef-PC.fnote",
  "plain-id.fnote",
  `${ULID}.txt`,
  " lead.fnote",
  `${ULID} weird.fnote`,
  ".DS_Store",
];

describe("library paths and note names (same as local-store)", () => {
  test("path validation", () => {
    for (const p of PATHS) expect([p, isValidLibraryPath(p)]).toEqual([p, ref.isValidLibraryPath(p)]);
  });
  test("note file names, copies and placeholders", () => {
    for (const n of NAMES) expect([n, parseNoteFileName(n)]).toEqual([n, ref.parseNoteFileName(n)]);
  });
});
