// Golden merge scenarios (fixtures/merge-scenarios.json): one or more per rule of LOCAL_MODE_PLAN.md §3.4.
// Every merge in a scenario is also checked for commutativity, idempotence and absorption.
// UPDATE_GOLDEN=1 rewrites the expected checksums after an intended format change.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compactTombstones,
  isStub,
  liveTags,
  mergeNoteFiles,
  noteSum,
  normalizeBlocks,
  observeNote,
  type DeviceRecord,
  type Loss,
  type NoteLike,
} from "../src";
import { Device, applyOp, textOf, type Op } from "./helpers";

interface Scenario {
  name: string;
  rule: string;
  steps: Step[];
}
type Step = Record<string, unknown>;

const fixturePath = resolve(__dirname, "../fixtures/merge-scenarios.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  $description: string;
  rules: string[];
  scenarios: Scenario[];
};
const update = process.env.UPDATE_GOLDEN === "1";

function checkedMerge(a: NoteLike, b: NoteLike): { file: NoteLike; losses: Loss[] } {
  const ab = mergeNoteFiles(a, b);
  const ba = mergeNoteFiles(b, a);
  expect(noteSum(ba.file), "merge is commutative").toBe(noteSum(ab.file));
  expect(ba.losses.map((l) => l.noticeId).sort(), "losses are commutative").toEqual(
    ab.losses.map((l) => l.noticeId).sort(),
  );
  expect(noteSum(mergeNoteFiles(ab.file, ab.file).file), "merge is idempotent").toBe(
    noteSum(ab.file),
  );
  expect(noteSum(mergeNoteFiles(ab.file, a).file), "merging an input again changes nothing").toBe(
    noteSum(ab.file),
  );
  expect(noteSum(mergeNoteFiles(ab.file, b).file), "merging an input again changes nothing").toBe(
    noteSum(ab.file),
  );
  return ab;
}

function run(s: Scenario) {
  const devices = new Map<string, Device>();
  const dev = (name: string) => {
    let d = devices.get(name);
    if (!d) devices.set(name, (d = new Device(name)));
    return d;
  };
  const snapshots = new Map<string, NoteLike>();
  const losses = new Map<string, Loss>();
  const absorb = (to: Device, incoming: NoteLike) => {
    observeNote(to.clock, incoming);
    if (!to.state) {
      to.state = incoming;
      return;
    }
    const r = checkedMerge(to.state, incoming);
    for (const l of r.losses) losses.set(l.noticeId, l);
    to.state = r.file;
  };
  let goldenChanged = false;
  for (const [i, step] of s.steps.entries()) {
    const where = `${s.name} step ${i}`;
    if (typeof step.op === "string") {
      const d = dev(step.on as string);
      if (typeof step.at === "number") d.now = step.at;
      applyOp(d, step as Op);
    } else if (step.send) {
      absorb(dev(step.to as string), dev(step.send as string).state!);
    } else if (step.exchange) {
      const [x, y] = (step.exchange as string[]).map(dev);
      const before = x!.state!;
      absorb(x!, y!.state!);
      absorb(y!, before);
      expect(noteSum(x!.state!), `${where}: both sides converge`).toBe(noteSum(y!.state!));
    } else if (step.snapshot) {
      snapshots.set(step.snapshot as string, structuredClone(dev(step.of as string).state!));
    } else if (step.deliver) {
      absorb(dev(step.to as string), snapshots.get(step.deliver as string)!);
    } else if (step.compact) {
      const d = dev(step.compact as string);
      const records: DeviceRecord[] = [...devices.values()].map((x) => ({
        format: "folevi-device",
        v: 1,
        deviceId: x.name,
        name: x.name,
        platform: "mac",
        appVersion: "1",
        formatVersion: 1,
        lastSeen: step.at as number,
        heads: d.note.seen,
      }));
      d.state = compactTombstones(d.note, records, step.at as number).note;
    } else if (step.expect) {
      const exp = step.expect as Record<string, unknown>;
      const d = dev((step.on as string) ?? [...devices.keys()][0]!);
      const state = d.state!;
      if (exp.stub !== undefined) expect(isStub(state), `${where}: stub`).toBe(exp.stub);
      if (!isStub(state)) {
        const note = state;
        for (const [id, t] of Object.entries((exp.text ?? {}) as Record<string, string | null>))
          expect(textOf(note, id), `${where}: text of ${id}`).toBe(t);
        for (const id of (exp.absent ?? []) as string[])
          expect(note.blocks[id], `${where}: ${id} absent`).toBeUndefined();
        if (exp.title !== undefined) expect(note.doc.title?.v, `${where}: title`).toBe(exp.title);
        if (exp.tags) expect(liveTags(note), `${where}: tags`).toEqual(exp.tags);
        for (const [id, p] of Object.entries((exp.parent ?? {}) as Record<string, string | null>))
          expect(note.blocks[id]!.parentId, `${where}: parent of ${id}`).toBe(p);
        for (const [id, v] of Object.entries((exp.collapsed ?? {}) as Record<string, boolean>))
          expect(note.blocks[id]!.collapsed, `${where}: collapsed ${id}`).toBe(v);
        for (const [f, v] of Object.entries((exp.fields ?? {}) as Record<string, unknown>))
          expect(
            (note.doc as unknown as Record<string, { v: unknown }>)[f]?.v,
            `${where}: ${f}`,
          ).toEqual(v);
        if (exp.trashed !== undefined)
          expect(note.doc.trashedAt?.v != null, `${where}: trashed`).toBe(exp.trashed);
        for (const [id, v] of Object.entries((exp.palette ?? {}) as Record<string, unknown>))
          expect(note.files[id]?.palette, `${where}: palette ${id}`).toEqual(v);
        for (const [id, v] of Object.entries((exp.fileText ?? {}) as Record<string, string>))
          expect(note.fileText[id]?.text, `${where}: fileText ${id}`).toBe(v);
        for (const [id, v] of Object.entries(
          (exp.versionNames ?? {}) as Record<string, string | null>,
        ))
          expect(note.versionNames[id]?.v, `${where}: versionName ${id}`).toBe(v);
        for (const [id, v] of Object.entries((exp.row ?? {}) as Record<string, unknown>))
          expect(note.row?.values[id]?.v, `${where}: row ${id}`).toEqual(v);
        if (exp.tree) {
          const n = normalizeBlocks(note);
          expect(
            n.blocks.map((b) => [b.id, b.parentId]),
            `${where}: tree`,
          ).toEqual(exp.tree);
          if (exp.repairs) expect(n.repairs, `${where}: repairs`).toEqual(exp.repairs);
        }
        if (exp.notices) {
          const got = Object.values(note.notices)
            .map((n) => ({
              kind: n.kind,
              target: n.blockId ?? `doc.${n.field ?? ""}`,
              from: n.from,
              ...(n.other ? { other: n.other } : {}),
              dismissed: !!n.dismissed,
            }))
            .sort((a, b) => (a.target + a.kind < b.target + b.kind ? -1 : 1));
          expect(got, `${where}: notices`).toEqual(exp.notices);
        }
      }
      if (exp.losses) {
        const got = [...losses.values()]
          .map((l) => ({ target: l.kind === "block" ? l.blockId : `doc.${l.field}`, from: l.from }))
          .sort((a, b) => (a.target + a.from < b.target + b.from ? -1 : 1));
        expect(got, `${where}: losses`).toEqual(exp.losses);
      }
      if (exp.seen)
        expect(Object.keys(state.seen).sort(), `${where}: seen devices`).toEqual(exp.seen);
      for (const other of (exp.converged ?? []) as string[])
        expect(noteSum(dev(other).state!), `${where}: ${other} converged`).toBe(noteSum(state));
      if (update) {
        if (exp.sum !== noteSum(state)) goldenChanged = true;
        exp.sum = noteSum(state);
      } else if (exp.sum !== undefined)
        expect(noteSum(state), `${where}: golden checksum`).toBe(exp.sum);
    } else {
      throw new Error(`${where}: unknown step ${JSON.stringify(step)}`);
    }
  }
  return goldenChanged;
}

describe("merge scenarios (golden)", () => {
  it("covers every rule of §3.4", () => {
    const covered = new Set(fixture.scenarios.map((s) => s.rule));
    for (const rule of fixture.rules)
      expect(covered.has(rule), `a scenario for "${rule}"`).toBe(true);
  });

  let changed = false;
  for (const s of fixture.scenarios) {
    it(s.name, () => {
      if (run(s)) changed = true;
    });
  }

  if (update) {
    it("writes updated checksums", () => {
      if (changed || fixture.scenarios.length)
        writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
    });
  }
});
