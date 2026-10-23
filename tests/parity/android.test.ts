// Local mode on Folevi for Android's bridge (docs/ANDROID_PLAN.md "Local mode", the Android-like driver): every
// scenario that runs on both backends also runs on a library kept through the Android app's own bridge script
// (drivers/androidHost.ts), once on the phone and once on Dropbox through the bridge's cloud half, and must give
// exactly what local mode gives on the in-memory library (which scenarios.test.ts compares with Convex).
import { describe, expect, test } from "vitest";
import { ulid } from "@folevi/editor-schema";
import { FakeDropbox } from "../../packages/cloud-folders/test/fakeDropbox";
import { LocalDriver, localAvailability } from "./drivers/localDriver";
import { androidShell, FakeAndroid } from "./drivers/androidHost";
import { Kit } from "./kit";
import { normalize } from "./normalize";
import type { ParityBackend, Scenario } from "./types";

const files = import.meta.glob<{ scenarios?: Scenario[] }>("./scenarios/*.ts", { eager: true });
const all: { file: string; s: Scenario }[] = Object.entries(files).flatMap(([file, mod]) => (mod.scenarios ?? []).map((s) => ({ file: file.replace("./scenarios/", ""), s })));

async function observe(b: ParityBackend, s: Scenario) {
  try {
    return normalize(await s.run(b, new Kit(b)), { known: b.known, ignore: s.ignore });
  } finally {
    await b.close();
  }
}

async function androidDriver(where: "device" | "dropbox", deviceId: string): Promise<{ driver: LocalDriver; native: FakeAndroid }> {
  const native = new FakeAndroid();
  if (where === "dropbox") native.dropbox = new FakeDropbox({ seed: 3 });
  const shell = androidShell(native);
  await shell.library.setup({ kind: where });
  const { LibraryStore, MemoryReplicaDb } = await import("@/lib/local/store/index");
  const { createTestLocalClient } = await import("@/lib/local/testing");
  const run = ulid();
  const store = await LibraryStore.open({
    host: shell.library as never,
    deviceId,
    device: { platform: "android", appVersion: "1.0.0", name: "Pixel 9" },
    openDb: async (libraryId: string) => MemoryReplicaDb.open(`${run}:${libraryId}`),
    page: null,
    scanMs: 0,
    libraryIds: { recall: () => null, remember: () => {} },
  });
  const client = await createTestLocalClient({ seed: true, deviceId, store });
  return { driver: new LocalDriver(client as never, deviceId), native };
}

describe("parity on the Android bridge", async () => {
  const local = await localAvailability();
  const runnable = all.filter(({ s }) => !s.accountOnly && !s.localPending);
  test("the scenarios exist", () => expect(runnable.length).toBeGreaterThan(10));
  if (!local.ready) return;

  for (const where of ["device", "dropbox"] as const) {
    for (const { file, s } of runnable) {
      test(`${file}: ${s.name} (${where === "device" ? "on the phone" : "on Dropbox"} = in memory)`, async () => {
        const deviceId = "parity_android_device";
        const expected = await observe(new LocalDriver(await local.factory({ seed: true }) as never, deviceId), s);
        const { driver, native } = await androidDriver(where, deviceId);
        const actual = await observe(driver, s);
        expect(actual).toEqual(expected);
        // The library really went through the bridge (not around it).
        expect(native.calls).toBeGreaterThan(0);
        if (where === "dropbox") {
          expect(native.dropbox!.file("folevi-library.json"), "the library is on Dropbox").toBeDefined();
          expect(native.device.files.size, "and nothing on the phone's own folder").toBe(0);
        } else expect(native.device.files.has("folevi-library.json")).toBe(true);
      }, 60_000);
    }
  }
});
