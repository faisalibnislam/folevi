// @vitest-environment node
import { describe, expect, test } from "vitest";
import { normalize } from "./normalize";

describe("normalize", () => {
  test("ids keep their identity as placeholders; named ids keep their names", () => {
    const a = "01JABCDEFGHJKMNPQRSTVWXYZ0";
    const b = "01JABCDEFGHJKMNPQRSTVWXYZ1";
    const out = normalize({ id: a, parentId: b, children: [{ id: b }], documentIds: [a, b] }, { known: new Map([[a, "<note>"]]) });
    expect(out).toEqual({ children: [{ id: "<id:1>" }], documentIds: ["<note>", "<id:1>"], id: "<note>", parentId: "<id:1>" });
  });

  test("timestamps, revisions, cursors, profile and device become placeholders", () => {
    const out = normalize({ updatedAt: 1760000000000, _creationTime: 1760000000000.5, revision: 7, head: 99, seq: 3, continueCursor: "abc", isDone: true, lastEditedBy: "Ada", deviceId: "dev-123456", when: 1760000000123, count: 4 });
    expect(out).toEqual({ _creationTime: "<time>", continueCursor: "<cursor>", count: 4, deviceId: "<device>", head: "<rev>", isDone: true, lastEditedBy: "<profile>", revision: "<rev>", seq: "<rev>", updatedAt: "<time>", when: "<time>" });
  });

  test("known values are replaced wherever they are; Convex ids are ids", () => {
    const profile = "k17abcdefghijklmnopqrstuvwxyz0123";
    const out = normalize({ owner: profile, other: "jd7abcdefghijklmnopqrstuvwxyz4567", text: "hello" }, { known: new Map([[profile, "<profile>"]]) });
    expect(out).toEqual({ other: "<id:1>", owner: "<profile>", text: "hello" });
  });

  test("keys are sorted, undefined disappears, ignored keys are dropped, arrays keep their order", () => {
    const out = normalize({ z: 1, a: undefined, m: [3, 1, 2], skip: "x", nested: { b: 1, a: null } }, { ignore: ["skip"] });
    expect(JSON.stringify(out)).toBe(JSON.stringify({ m: [3, 1, 2], nested: { a: null, b: 1 }, z: 1 }));
  });

  test("two runs with different ids normalize to the same thing", () => {
    const run = (ids: [string, string]) => ({ page: [{ id: ids[0], parentDocumentId: null }, { id: ids[1], parentDocumentId: ids[0] }] });
    expect(normalize(run(["01JAAAAAAAAAAAAAAAAAAAAAA0", "01JAAAAAAAAAAAAAAAAAAAAAA1"]))).toEqual(normalize(run(["01JBBBBBBBBBBBBBBBBBBBBBB0", "01JBBBBBBBBBBBBBBBBBBBBBB1"])));
  });
});
