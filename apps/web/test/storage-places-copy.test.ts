// Dropbox and Google Drive libraries need an app key and client ID that the Windows, Linux and Android builds don't
// have yet, so those places are hidden there (apps/mobile/android/README.md, docs/DESKTOP_PARITY.md). The website may
// name them, but never as something every app or the Windows, Linux or Android apps do today (PR manager, 2026-11-27).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

const SRC = join(__dirname, "../src");
function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}
const WEBSITE = [...files(join(SRC, "app/(marketing)")), ...files(join(SRC, "components/marketing"))];

describe("Dropbox and Google Drive on the website", () => {
  test("no line pairs them with the Windows, Linux or Android apps", () => {
    const hits: string[] = [];
    for (const file of WEBSITE) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (!/Dropbox|Google Drive/.test(line)) return;
          // Competitor facts and the Mac's own pages are fine; "for now" marks the Apple-only note.
          if (/for now|Obsidian|Notion|them:/.test(line)) return;
          if (/\b(Windows|Linux|Android)\b/.test(line)) hits.push(`${relative(SRC, file)}:${i + 1}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
