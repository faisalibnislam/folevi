// Moving and copying between any two places, and Takeout (docs/MULTI_ACCOUNT_PLAN.md §7, §8), on the real Convex
// functions under convex-test and libraries on the persistent store in memory: picked folders and notes from one
// account into another with new ids (the server's ids are unique across accounts), links inside the copy following,
// a move leaving the originals in Trash; and a takeout made from an account, imported into a library and into
// another account, twice, with nothing mixed.
import { describe, expect, test } from "vitest";
import { inboxDocumentId, SCHEMA_VERSION, ulid, type InlineNode, type WireBlock } from "@folevi/editor-schema";
import { api } from "../../convex/_generated/api";
import { copyLibrary } from "@/lib/migrate/copy";
import { memoryProgress } from "@/lib/migrate/progress";
import { freshId, freshSource, newMoveKey, pickedSource, replaceIds, trashOriginals } from "@/lib/migrate/reshape";
import { accountFiles, clientSource, libraryFiles } from "@/lib/migrate/source";
import { clientTarget, libraryPutFile } from "@/lib/migrate/target";
import { importTakeout, makeTakeout, readTakeout, TAKEOUT_FILE } from "@/lib/migrate/takeout";
import { openTestLibrary } from "@/lib/migrate/testing";
import type { MigrationClient } from "@/lib/migrate/types";
import { person } from "../convex/helpers";
import { ConvexDriver } from "./drivers/convexDriver";
import { PNG } from "./scenarios/files";

const block = (id: string, type: string, props: Record<string, unknown>, rank: string, text: InlineNode[] = [], parentId: string | null = null): WireBlock => ({ id, type, parentId, rank, schemaVersion: SCHEMA_VERSION, text, props });
const words = (text: string): InlineNode[] => [{ type: "text", text }];
const create = (id: string, title: string, o: { parent?: string | null; folder?: string | null; kind?: "document" | "synced" } = {}) => ({
  opId: ulid(),
  kind: "document.create",
  document: { id, parentDocumentId: o.parent ?? null, folderId: o.folder ?? null, kind: o.kind ?? "document", title, icon: null },
});
const upsert = (documentId: string, b: WireBlock) => ({ opId: ulid(), kind: "block.upsert", documentId, block: b, baseRevision: null, fields: ["content", "position"] });

async function push(c: MigrationClient, ops: unknown[]) {
  const results = (await c.mutation(api.sync.push, { scope: { kind: "personal" }, deviceId: "places-device", ops: ops as never })) as { status: string }[];
  for (const r of results) expect(r.status, JSON.stringify(r)).toBe("applied");
}

function callerClient(as: unknown): MigrationClient {
  const c = as as { query: (r: unknown, a: unknown) => Promise<never>; mutation: (r: unknown, a: unknown) => Promise<never>; action: (r: unknown, a: unknown) => Promise<never> };
  return { query: (r: unknown, x: unknown) => c.query(r, x), mutation: (r: unknown, x: unknown) => c.mutation(r, x), action: (r: unknown, x: unknown) => c.action(r, x) } as unknown as MigrationClient;
}

/** A's notes: a folder with a trip, a page under it that links back, synced words it shows, and a note outside. */
async function fillA(a: MigrationClient) {
  const { id: folder } = await a.mutation(api.organization.createFolder, { scope: { kind: "personal" }, name: "Travel" });
  const ids = { trip: ulid(), packing: ulid(), synced: ulid(), other: ulid() };
  await push(a, [create(ids.trip, "Trip", { folder }), create(ids.packing, "Packing list", { parent: ids.trip }), create(ids.synced, "", { kind: "synced" }), create(ids.other, "Somewhere else")]);
  const b = { card: ulid(), shows: ulid(), back: ulid(), line: ulid(), nested: ulid() };
  await push(a, [
    upsert(ids.trip, block(b.card, "page", { documentId: ids.packing, display: "card" }, "a")),
    upsert(ids.trip, block(b.shows, "synced", { sourceId: ids.synced }, "b")),
    upsert(ids.packing, block(b.back, "paragraph", {}, "a", [{ type: "text", text: "Back to " }, { type: "pageLink", documentId: ids.trip, label: "Trip" }, { type: "pageLink", documentId: ids.other, label: "elsewhere" }])),
    upsert(ids.packing, block(b.nested, "paragraph", {}, "a", words("Socks"), b.back)),
    upsert(ids.synced, block(b.line, "paragraph", {}, "a", words("Words kept in sync"))),
  ]);
  return { folder, ids, b };
}

const titles = async (c: MigrationClient) => (await clientSource(c, { readFile: async () => null }).notes()).filter((n) => !n.inTrash);

describe("account to account", () => {
  test("a picked folder moves with new ids, its links follow, and the originals are in Trash", async () => {
    const driver = await ConvexDriver.open();
    const a = driver as unknown as MigrationClient;
    const b = callerClient((await person(driver.t, "places-b@example.com")).as);
    const { folder, ids } = await fillA(a);

    const key = newMoveKey();
    const picked = pickedSource(clientSource(a, { readFile: accountFiles(a, async (url) => new Blob([(await driver.download(url)) as Uint8Array<ArrayBuffer>])) }), { folders: [folder], notes: [] });
    const source = freshSource(picked, key);
    const state = await copyLibrary({ source, target: clientTarget(b, { deviceId: "places-b-device", putFile: async () => "none" }), progress: memoryProgress(), direction: "upload", versions: false, mapInbox: false });
    expect(Object.keys(state.notes)).toHaveLength(3);

    const there = await titles(b);
    const trip = there.find((n) => n.title === "Trip")!;
    const packing = there.find((n) => n.title === "Packing list")!;
    const synced = there.find((n) => n.kind === "synced" && n.id === freshId(key, ids.synced))!;
    expect(trip.id).toBe(freshId(key, ids.trip));
    expect(trip.id).not.toBe(ids.trip);
    expect(packing.parentDocumentId).toBe(trip.id);
    expect(synced).toBeTruthy();
    expect(there.some((n) => n.title === "Somewhere else")).toBe(false);
    const index = await b.query(api.organization.index, { scope: { kind: "personal" } });
    const travel = index.folders.find((f) => f.name === "Travel")!;
    expect(travel.id).not.toBe(folder);
    expect(trip.folderId).toBe(travel.id);
    // Links inside the copy name the copies; a link to a note that stayed behind is as it was.
    const tripBlocks = (await b.query(api.blocks.list, { documentId: trip.id }))!.blocks as WireBlock[];
    expect(tripBlocks.find((x) => x.type === "page")!.props.documentId).toBe(packing.id);
    expect(tripBlocks.find((x) => x.type === "synced")!.props.sourceId).toBe(synced.id);
    const packingBlocks = (await b.query(api.blocks.list, { documentId: packing.id }))!.blocks as WireBlock[];
    const links = packingBlocks.flatMap((x) => x.text).filter((n) => n.type === "pageLink") as { documentId: string }[];
    expect(links.map((l) => l.documentId)).toEqual([trip.id, ids.other]);
    expect(packingBlocks.find((x) => x.parentId !== null)!.parentId).toBe(packingBlocks.find((x) => x.parentId === null)!.id);

    // The move ends with the originals in Trash and the folder gone; the rest of A is as it was.
    await trashOriginals({ client: a, notes: await picked.notes(), folders: [folder], inboxId: inboxDocumentId(driver.profileId, "personal") });
    const left = await clientSource(a, { readFile: async () => null }).notes();
    expect(left.find((n) => n.id === ids.trip)!.inTrash).toBe(true);
    expect(left.find((n) => n.id === ids.other)!.inTrash).toBe(false);
    expect((await a.query(api.organization.index, { scope: { kind: "personal" } })).folders.some((f) => f.id === folder)).toBe(false);
  });

  test("copying the same notes twice gives two copies (each move has its own ids); nothing is refused as already there", async () => {
    const driver = await ConvexDriver.open();
    const a = driver as unknown as MigrationClient;
    const b = callerClient((await person(driver.t, "places-twice@example.com")).as);
    const { ids } = await fillA(a);
    for (let i = 0; i < 2; i++) {
      const source = freshSource(pickedSource(clientSource(a, { readFile: async () => null }), { folders: [], notes: [ids.trip] }), newMoveKey());
      const state = await copyLibrary({ source, target: clientTarget(b, { deviceId: "places-b-device", putFile: async () => "none" }), progress: memoryProgress(), direction: "upload", versions: false, mapInbox: false });
      expect(state.problems).toEqual([]);
    }
    expect((await titles(b)).filter((n) => n.title === "Trip")).toHaveLength(2);
    // A picked note brings what's under it and the synced content it shows.
    expect((await titles(b)).filter((n) => n.title === "Packing list")).toHaveLength(2);
  });
});

describe("fresh ids", () => {
  test("are stable for a move, different between moves, keep a ULID's time, and follow ids inside text", () => {
    const id = ulid();
    const k = newMoveKey();
    expect(freshId(k, id)).toBe(freshId(k, id));
    expect(freshId(k, id)).not.toBe(freshId(newMoveKey(), id));
    expect(freshId(k, id).slice(0, 10)).toBe(id.slice(0, 10));
    expect(freshId(k, "short-id")).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    const map = new Map([[id, "NEW"]]);
    expect(replaceIds({ a: id, b: `{"node":"${id}"}`, [id]: 1, keep: "plain words" }, (x) => map.get(x))).toEqual({ a: "NEW", b: '{"node":"NEW"}', NEW: 1, keep: "plain words" });
  });
});

describe("takeout", () => {
  test("an account's takeout imports into a library and into another account, with its files, twice without mixing", async () => {
    const driver = await ConvexDriver.open();
    const a = driver as unknown as MigrationClient;
    const { ids } = await fillA(a);
    const pic = ulid();
    await push(a, [create(pic, "With a picture")]);
    const fileId = await driver.upload({ bytes: PNG, filename: "photo.png", mimeType: "image/png", kind: "image", documentId: pic });
    await push(a, [upsert(pic, block(ulid(), "image", { fileId, alt: "A pixel", caption: "" }, "a"))]);

    const fetchBytes = async (url: string) => new Blob([(await driver.download(url)) as Uint8Array<ArrayBuffer>], { type: "image/png" });
    const { bytes, manifest } = await makeTakeout({ account: a, who: { name: "Ana", email: "ana@example.com" }, fetchBytes, now: () => Date.UTC(2026, 9, 22) });
    expect(manifest.format).toBe("folevi-takeout");
    expect(manifest.notes).toBeGreaterThan(4);

    // It's a library folder in a zip.
    const { library } = await readTakeout(bytes);
    const paths = (await library.fs.list("")).map((e) => e.path);
    expect(paths).toContain("folevi-library.json");
    expect(paths.some((p) => p.startsWith("notes/"))).toBe(true);
    expect(paths.some((p) => p.startsWith("files/"))).toBe(true);
    expect(paths).toContain("exported/server-only.json");
    expect(paths).not.toContain(TAKEOUT_FILE);
    expect((await titles(library.client)).map((n) => n.title)).toEqual(expect.arrayContaining(["Trip", "Packing list", "With a picture", "Somewhere else"]));
    await library.close();

    // Into a library, twice: two folders, each with its own copy.
    const lib = await openTestLibrary({ seed: false, deviceId: "mac_one_device" });
    for (let i = 0; i < 2; i++) {
      const r = await importTakeout({ zip: bytes, target: clientTarget(lib.client, { deviceId: lib.client.deviceId, putFile: libraryPutFile(lib.client.local) }), now: () => Date.UTC(2026, 9, 22) });
      expect(r.folder.name).toBe("Takeout from ana@example.com, 22 Oct 2026");
      expect(r.state.problems.filter((p) => p.kind === "file")).toEqual([]);
    }
    const inLib = await titles(lib.client);
    expect(inLib.filter((n) => n.title === "Trip")).toHaveLength(2);
    const picture = inLib.find((n) => n.title === "With a picture")!;
    const img = ((await lib.client.query(api.blocks.list, { documentId: picture.id }))!.blocks as WireBlock[]).find((x) => x.type === "image")!;
    expect((await libraryFiles(lib.client.store)(img.props.fileId as string, picture.id, "image"))?.size).toBe(PNG.length);
    const folders = (await lib.client.query(api.organization.index, { scope: { kind: "personal" } })).folders.filter((f) => f.name.startsWith("Takeout from"));
    expect(folders).toHaveLength(2);
    // Nothing kept the original ids.
    expect(inLib.some((n) => n.id === ids.trip)).toBe(false);

    // Into another account on the same server (where A's ids exist): new ids again, nothing refused.
    const b = callerClient((await person(driver.t, "takeout-b@example.com")).as);
    const r = await importTakeout({ zip: bytes, target: clientTarget(b, { deviceId: "b-device", putFile: async () => "none" }), versions: false });
    expect(r.state.problems.filter((p) => p.kind !== "file")).toEqual([]);
    expect((await titles(b)).some((n) => n.title === "Packing list")).toBe(true);
  });
});
