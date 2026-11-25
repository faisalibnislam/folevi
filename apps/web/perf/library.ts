// The generated test library (docs/perf/PERF_PASS_2026-11-25.md): 5,000 notes in 200 folders, 2,000 open tasks
// with dates, notes linking to each other, and some long notes with images. Never the owner's real library.
import { strToU8, zipSync } from "fflate";

export const NOTES = Number(process.env.PERF_NOTES ?? 5000);
export const FOLDERS = Number(process.env.PERF_FOLDERS ?? 200);
export const TASKS = Number(process.env.PERF_TASKS ?? 2000);
export const LONG = 20;

const WORDS = "the quiet garden by the river holds old stones and new seeds while the morning light moves slowly across the field near a small house where letters wait".split(" ");
const sentence = (i: number, n: number) => Array.from({ length: n }, (_, k) => WORDS[(i * 7 + k * 3) % WORDS.length]).join(" ");

/** A tiny valid PNG (a 2 x 2 colour), so long notes carry real images. */
function png(seed: number): Uint8Array {
  // Pre-encoded 2x2 RGB PNGs differ only in colour; one is enough for size, the seed varies the name.
  void seed;
  return Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
}

export const folderName = (f: number) => `Folder ${String(f + 1).padStart(3, "0")}`;
export const noteTitle = (i: number) => (i < LONG ? `Long note ${i + 1}` : `Note ${i + 1}`);

/** The importer takes up to 400 pages at a time (lib/import/run.ts MAX_DOCS): the library in batches of 400. */
export const BATCH = 400;
export const batches = () => Math.ceil(NOTES / BATCH);

/** Batch `b` of the library as a ZIP: notes b*400 to b*400+399, in their folders (consecutive notes share one). */
export function libraryZip(b: number): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const perFolder = Math.ceil(NOTES / FOLDERS);
  const day = (i: number) => new Date(Date.UTC(2026, 10, 1) + ((i % 60) - 10) * 86_400_000).toISOString().slice(0, 10);
  for (let i = b * BATCH; i < Math.min(NOTES, (b + 1) * BATCH); i++) {
    const folder = folderName(Math.floor(i / perFolder));
    const lines = [`# ${noteTitle(i)}`, "", sentence(i, 30) + ".", "", `See [[${noteTitle((i * 7) % NOTES)}]] and [[${noteTitle((i * 13) % NOTES)}]].`, ""];
    if (i < TASKS) lines.push(`- [ ] Task ${i + 1} due ${day(i)}`, "");
    lines.push(sentence(i + 1, 50) + ".");
    if (i < LONG) {
      files[`${folder}/img-${i}.png`] = png(i);
      for (let s = 0; s < 70; s++) {
        lines.push("", `## Section ${s + 1}`, "");
        for (let p = 0; p < 3; p++) lines.push(sentence(s + p + i, 40) + ".", "");
        lines.push(...[0, 1, 2].map((k) => `- ${sentence(s + k, 8)}`), "");
        if (s % 10 === 0) lines.push(`![Picture ${s}](img-${i}.png)`, "");
      }
    }
    files[`${folder}/${noteTitle(i)}.md`] = strToU8(lines.join("\n"));
  }
  return zipSync(files, { level: 1 });
}
