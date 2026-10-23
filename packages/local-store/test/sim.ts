// Property tests: N devices make random concurrent edits and exchange files through a faulty cloud folder
// (late, duplicated, stale and partial deliveries, conflict copies, conflict versions, lost updates). After the
// faults stop and every device has synced, all replicas and the folder must be identical (convergence), and
// every content edit must be live, in history, or knowingly superseded by a later edit (no loss).
import { canonicalJson } from "@folevi/editor-schema";
import { expect } from "vitest";
import {
  EncryptedFs,
  FaultyCloud,
  HybridClock,
  NoteReplica,
  addTag,
  createNote,
  decodeNoteFile,
  decodeVersionFile,
  deleteBlock,
  dominates,
  isStub,
  hlcDevice,
  makeStub,
  noteSum,
  normalizeBlocks,
  parseVersionFileName,
  removeTag,
  restoreBlock,
  seededRandom,
  setDocField,
  upsertBlock,
  type CopyStyle,
  type FaultRates,
  type LocalFs,
  type NoteFile,
  type VersionVector,
} from "../src";
import { para } from "./helpers";

const DOCS = ["01J9ZDOC000000000000000001", "01J9ZDOC000000000000000002"];

interface EditRecord {
  docId: string;
  target: string;
  c: string;
  cv: VersionVector;
  visible: string;
}

/**
 * What the simulator needs from a cloud: FaultyCloud (a synced folder), or a fake provider API whose devices
 * mount it as their LocalFs (packages/cloud-folders' Dropbox and Google Drive tests).
 */
export interface SimCloud {
  mount(name: string): LocalFs;
  /** Faults off; everything pending delivered. */
  settle(): void;
  /** Runs one pending provider event; false when nothing is pending. */
  step(): boolean;
  readonly pending: number;
  faults: FaultRates;
  /** The cloud's copy of a file at its on-disk path. */
  cloudFile(path: string): Uint8Array | undefined;
  cloudPaths(): string[];
  readonly log: string[];
}

export interface Sim<C extends SimCloud = FaultyCloud> {
  cloud: C;
  replicas: NoteReplica[];
  edits: EditRecord[];
  clocks: { now: number }[];
  fss: LocalFs[];
  stubs: number;
  stubSeen: { docId: string; seen: VersionVector }[];
}

function visibleOf(b: NoteFile["blocks"][string]): string {
  return canonicalJson({ t: b.type, x: b.text, p: b.props, d: b.deleted !== null });
}

export async function makeSim(
  seed: number,
  devices: number,
  style: CopyStyle[],
  encrypted: boolean,
): Promise<Sim> {
  return makeSimOn(new FaultyCloud({ seed, copyStyle: style }), devices, encrypted);
}

/** A simulation whose devices mount `cloud`. */
export async function makeSimOn<C extends SimCloud>(
  cloud: C,
  devices: number,
  encrypted: boolean,
): Promise<Sim<C>> {
  const clocks: { now: number }[] = [];
  const replicas: NoteReplica[] = [];
  const fss: LocalFs[] = [];
  const master = new Uint8Array(32).fill(7);
  for (let i = 0; i < devices; i++) {
    const name = `D${i}`;
    const t = { now: 1_000_000 + i * 17 };
    clocks.push(t);
    const mount = cloud.mount(name);
    const fs: LocalFs = encrypted ? new EncryptedFs(mount, master) : mount;
    fss.push(fs);
    replicas.push(new NoteReplica(fs, new HybridClock(name, { now: () => t.now })));
  }
  return { cloud, replicas, edits: [], clocks, fss, stubs: 0, stubSeen: [] };
}

function recordBlock(sim: Sim<SimCloud>, docId: string, note: NoteFile, blockId: string) {
  const b = note.blocks[blockId]!;
  sim.edits.push({ docId, target: blockId, c: b.c.content, cv: b.cv, visible: visibleOf(b) });
}

/** One random local edit on a random note of device `i`. */
export function randomEdit(sim: Sim<SimCloud>, i: number, rnd: () => number) {
  const r = sim.replicas[i]!;
  const clock = r.clock;
  sim.clocks[i]!.now += 1 + Math.floor(rnd() * 5000);
  // One device sometimes has a clock hours ahead (skew is capped, never decides causality).
  if (i === 1 && rnd() < 0.05) sim.clocks[i]!.now += 6 * 3_600_000;
  const docId = DOCS[Math.floor(rnd() * DOCS.length)]!;
  const current = r.notes.get(docId);
  if (!current) {
    r.edit(docId, () =>
      createNote(docId, { createdAt: sim.clocks[i]!.now, title: `Note ${docId.slice(-1)}` }, clock),
    );
    return;
  }
  if (isStub(current)) return;
  const note = current;
  const ids = Object.keys(note.blocks).sort();
  const pick = () => ids[Math.floor(rnd() * ids.length)]!;
  const kind = rnd();
  let next: NoteFile;
  if (kind < 0.25 || ids.length === 0) {
    const id = `BLK${i}x${Math.floor(rnd() * 1e9).toString(36)}`;
    const parent = ids.length && rnd() < 0.3 ? pick() : null;
    next = upsertBlock(
      note,
      para(id, `new ${id}`, { parentId: parent, rank: "MNOPQRSTUV"[Math.floor(rnd() * 10)]! }),
      ["content", "position"],
      clock,
    );
    recordBlock(sim, docId, next, id);
  } else if (kind < 0.6) {
    const id = pick();
    const b = note.blocks[id]!;
    const w = para(id, `${i}:${Math.floor(rnd() * 1e6)}`, {
      parentId: b.parentId,
      rank: b.rank,
      type: b.type,
      props: b.props,
    });
    next = upsertBlock(note, w, ["content"], clock);
    recordBlock(sim, docId, next, id);
  } else if (kind < 0.7) {
    const id = pick();
    next = note.blocks[id]!.deleted ? restoreBlock(note, id, clock) : deleteBlock(note, id, clock);
    recordBlock(sim, docId, next, id);
  } else if (kind < 0.8) {
    const id = pick();
    const b = note.blocks[id]!;
    const parent = rnd() < 0.5 ? null : pick();
    next = upsertBlock(
      note,
      {
        ...para(id, "", {
          parentId: parent === id ? null : parent,
          rank: "MNOPQRSTUV"[Math.floor(rnd() * 10)]!,
        }),
        type: b.type,
        text: b.text as never,
        props: { ...b.props, collapsed: rnd() < 0.5 },
      },
      rnd() < 0.5 ? ["position"] : ["collapsed"],
      clock,
    );
  } else if (kind < 0.9) {
    next = setDocField(note, "title", `Title ${i}.${Math.floor(rnd() * 1000)}`, clock);
    sim.edits.push({
      docId,
      target: "doc.title",
      c: next.doc.title!.c,
      cv: next.doc.title!.cv!,
      visible: JSON.stringify(next.doc.title!.v),
    });
  } else if (kind < 0.92) {
    // Rarely, a permanent delete: the stub drops what it saw; edits it didn't see bring the note back.
    const stub = r.edit(docId, () => makeStub(note, clock.tick()));
    sim.stubs++;
    sim.stubSeen.push({ docId, seen: stub.seen });
    return;
  } else {
    const tag = `TAG${Math.floor(rnd() * 3)}`;
    const t = next0(note.doc.tags[tag]);
    next = t ? removeTag(note, tag, clock) : addTag(note, tag, clock);
  }
  r.edit(docId, () => next);
}

function next0(t: { add: string; rm: string | null } | undefined): boolean {
  return !!t && (t.rm === null || t.add > t.rm);
}

/** Syncs every device until nothing changes, delivering everything in between. Returns the rounds. */
export async function settle(sim: Sim<SimCloud>) {
  for (let round = 0; round < 60; round++) {
    let writes = 0;
    for (const r of sim.replicas) {
      const report = await r.sync();
      writes += report.written.length + report.copiesMerged.length + report.losses.length;
    }
    const pending = sim.cloud.pending;
    sim.cloud.settle();
    if (writes === 0 && pending === 0) return round;
  }
  throw new Error(`no convergence; log tail:\n${sim.cloud.log.slice(-30).join("\n")}`);
}

async function historyStates(sim: Sim<SimCloud>): Promise<Set<string>> {
  const out = new Set<string>();
  const entries = await sim.fss[0]!.list("history");
  for (const e of entries) {
    // Providers' copies of version files are duplicates of immutable files; history ignores them by name.
    if (!parseVersionFileName(e.path.slice(e.path.lastIndexOf("/") + 1))) continue;
    const r = await sim.fss[0]!.read(e.path);
    if ("notDownloaded" in r) continue;
    const v = decodeVersionFile(r.bytes);
    if (v.conflict) out.add(`${v.docId}|${v.conflict.target}|${v.c}`);
  }
  return out;
}

export async function checkProperties(sim: Sim<SimCloud>) {
  // Convergence: every replica holds the same notes, and the folder holds exactly them.
  const sums = sim.replicas.map((r) =>
    [...r.notes.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([id, n]) => `${id}:${noteSum(n)}`)
      .join(","),
  );
  for (const s of sums) expect(s).toBe(sums[0]);
  for (const [id, note] of sim.replicas[0]!.notes) {
    const r = await sim.fss[0]!.read(`notes/${id}.fnote`);
    if ("notDownloaded" in r) throw new Error("placeholder after settle");
    expect(noteSum(decodeNoteFile(r.bytes))).toBe(noteSum(note));
    const fs0 = sim.fss[0]!;
    const onDisk =
      fs0 instanceof EncryptedFs ? await fs0.physical(`notes/${id}.fnote`) : `notes/${id}.fnote`;
    expect(sim.cloud.cloudFile(onDisk), `the cloud holds ${onDisk}`).toBeDefined();
    if (!isStub(note)) normalizeBlocks(note); // the tree always normalizes
  }
  // No conflict copies are left behind.
  for (const fs of sim.fss) {
    const leftovers = (await fs.list("notes")).filter(
      (e) => !/^notes\/[0-9A-Z]{26}\.fnote$/.test(e.path) || e.hasConflicts,
    );
    expect(leftovers.map((e) => e.path)).toEqual([]);
  }
  // No loss.
  const history = await historyStates(sim);
  const final = sim.replicas[0]!.notes;
  const ok = new Set<number>();
  const key = (e: EditRecord) => `${e.docId}|${e.target}|${e.c}`;
  sim.edits.forEach((e, i) => {
    const note = final.get(e.docId);
    if (!note) return;
    if (isStub(note)) {
      // Dropped on purpose only if the stub had seen it.
      if ((note.seen[hlcDevice(e.c)] ?? "") >= e.c) ok.add(i);
      return;
    }
    const live =
      e.target === "doc.title"
        ? note.doc.title?.c === e.c
        : note.blocks[e.target]?.c.content === e.c;
    // A permanent delete drops what its stub had seen, even if an unseen edit brings the note back later.
    const droppedByStub = sim.stubSeen.some(
      (st) => st.docId === e.docId && (st.seen[hlcDevice(e.c)] ?? "") >= e.c,
    );
    if (live || history.has(key(e)) || droppedByStub) ok.add(i);
  });
  for (let changed = true; changed;) {
    changed = false;
    sim.edits.forEach((e, i) => {
      if (ok.has(i)) return;
      for (const j of ok) {
        const o = sim.edits[j]!;
        if (o.docId !== e.docId || o.target !== e.target) continue;
        // Superseded on purpose: a later edit made after seeing this one, or the same content kept elsewhere.
        if ((o.c !== e.c && dominates(o.cv, e.cv)) || o.visible === e.visible) {
          ok.add(i);
          changed = true;
          return;
        }
      }
    });
  }
  const lost = sim.edits.filter((_, i) => !ok.has(i));
  expect(lost, `lost edits (cloud log tail):\n${sim.cloud.log.slice(-20).join("\n")}`).toEqual([]);
}

export async function scenario(
  seed: number,
  devices: number,
  steps: number,
  style: CopyStyle[],
  encrypted = false,
) {
  return scenarioOn(await makeSim(seed, devices, style, encrypted), seed, steps);
}

/** The same scenario on any cloud: the devices are the ones `sim` mounted. */
export async function scenarioOn<C extends SimCloud>(
  sim: Sim<C>,
  seed: number,
  steps: number,
): Promise<Sim<C>> {
  const devices = sim.replicas.length;
  const rnd = seededRandom(seed ^ 0x9e3779b9);
  // Everyone starts from the same two notes.
  for (const id of DOCS) {
    sim.replicas[0]!.edit(id, () => {
      let n = createNote(id, { createdAt: 1, title: "Start" }, sim.replicas[0]!.clock);
      n = upsertBlock(
        n,
        para(`${id.slice(-1)}S1`, "first", { rank: "M" }),
        ["content", "position"],
        sim.replicas[0]!.clock,
      );
      return upsertBlock(
        n,
        para(`${id.slice(-1)}S2`, "second", { rank: "T" }),
        ["content", "position"],
        sim.replicas[0]!.clock,
      );
    });
  }
  await sim.replicas[0]!.sync();
  sim.cloud.settle();
  for (const r of sim.replicas) await r.sync();
  sim.cloud.faults = { delay: 0.2, duplicate: 0.15, stale: 0.15, truncate: 0.15, loseUpdate: 0.3 };
  for (let s = 0; s < steps; s++) {
    const i = Math.floor(rnd() * devices);
    const roll = rnd();
    if (roll < 0.5) randomEdit(sim, i, rnd);
    else if (roll < 0.75) await sim.replicas[i]!.sync();
    else for (let k = 0; k < 4; k++) sim.cloud.step();
  }
  await settle(sim);
  await checkProperties(sim);
  return sim;
}
