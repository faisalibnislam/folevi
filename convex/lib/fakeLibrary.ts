// A generated library for performance work (docs/perf/backend-results.md): 5,000 notes, 200 folders, 2,000
// tasks and some long notes with images. Deterministic (same index, same note), so measurements repeat.
// Only devSeed.ts and the backend performance tests use it; it never touches anyone's real notes.
import { SCHEMA_VERSION, rankSequence, ulid, type WireBlock } from "@folevi/editor-schema";

export const FAKE_LIBRARY = {
  notes: 5_000,
  folders: 200,
  /** Notes holding 4 to-dos each: 500 × 4 = 2,000 tasks. */
  taskNotes: 500,
  tasksPerNote: 4,
  /** Long notes (about 30,000 characters, five images each). */
  longNotes: 50,
  /** Notes in no folder (Drafts). */
  drafts: 600,
  tags: 30,
  stars: 60,
} as const;

const WORDS =
  "plan meeting notes design launch budget review travel recipe garden reading list idea draft summary project team weekly sprint customer research outline chapter lecture homework workout journal market report invoice contract roadmap feedback interview story photo album sketch".split(
    " ",
  );

/** A small deterministic generator (mulberry32) so the same index always gives the same note. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sentence(r: () => number, words: number): string {
  const out: string[] = [];
  for (let i = 0; i < words; i++) out.push(WORDS[Math.floor(r() * WORDS.length)]!);
  const s = out.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}

const text = (s: string) => (s ? [{ type: "text" as const, text: s }] : []);

export interface FakeNote {
  title: string;
  /** Index into the folder list, or null for Drafts. */
  folder: number | null;
  blocks: WireBlock[];
  /** How long ago it was last edited, in ms (spread over two years). */
  ageMs: number;
  long: boolean;
  tasks: number;
}

/** Folder `i`: its name and parent folder index (every fifth folder after the first 40 is nested). */
export function fakeFolder(i: number): { name: string; parent: number | null } {
  const r = rng(10_000 + i);
  const parent = i >= 40 && i % 5 === 0 ? Math.floor(r() * 40) : null;
  return { name: `${sentence(r, 2).slice(0, -1)} ${i + 1}`, parent };
}

/** Note `i` of the library. */
export function fakeNote(i: number): FakeNote {
  const r = rng(i + 1);
  const long = i % Math.floor(FAKE_LIBRARY.notes / FAKE_LIBRARY.longNotes) === 7;
  const tasks = i % Math.floor(FAKE_LIBRARY.notes / FAKE_LIBRARY.taskNotes) === 3 ? FAKE_LIBRARY.tasksPerNote : 0;
  // Drafts: every few notes; otherwise a folder, skewed so a few folders are big (hundreds of notes).
  const draft = i % Math.floor(FAKE_LIBRARY.notes / FAKE_LIBRARY.drafts) === 1;
  const folder = draft ? null : Math.floor(Math.pow(r(), 2) * FAKE_LIBRARY.folders);
  const paragraphs = long ? 160 : 3 + Math.floor(r() * 6);
  const count = paragraphs + tasks + (long ? 5 : 0);
  const ranks = rankSequence(count + 1);
  const blocks: WireBlock[] = [];
  let k = 0;
  const push = (type: string, t: ReturnType<typeof text>, props: Record<string, unknown>) =>
    blocks.push({ id: ulid(), type, parentId: null, rank: ranks[k++]!, schemaVersion: SCHEMA_VERSION, text: t, props } as WireBlock);
  for (let p = 0; p < paragraphs; p++) {
    if (long && p % 32 === 0) push("image", [], { url: `https://example.com/fake/${i}-${p}.jpg`, alt: "", caption: sentence(r, 4) });
    push("paragraph", text(sentence(r, long ? 30 : 12 + Math.floor(r() * 20))), {});
  }
  for (let tIdx = 0; tIdx < tasks; tIdx++) {
    const due = r() < 0.6 ? `2026-${String(1 + Math.floor(r() * 12)).padStart(2, "0")}-${String(1 + Math.floor(r() * 28)).padStart(2, "0")}` : undefined;
    push("todo", text(sentence(r, 5)), { checked: r() < 0.3, ...(due ? { dueDate: due } : {}) });
  }
  return { title: `${sentence(r, 3).slice(0, -1)} #${i}`, folder, blocks, ageMs: Math.floor(r() * 730 * 86_400_000), long, tasks };
}
