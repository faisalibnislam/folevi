import { createPublicKey, verify as edVerify } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DeviceKeys, E2EE_CHANNELS, registerE2eeIpc, sealBoxForTest, statementMessage, ulid, type DeviceKeysDeps } from "./e2ee";
import type { Cipher } from "./secrets";

// WP1's shared vectors (packages/local-store/fixtures/e2ee-vectors.json): the Mac must open the same boxes and
// sign the same bytes as the web's @folevi/local-store/e2ee.
const vectors = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "packages", "local-store", "fixtures", "e2ee-vectors.json"), "utf8")) as {
  boxes: { name: string; recipientSeedHex: string; recipientPubHex: string; context: string; plaintextHex: string; boxHex: string }[];
  statements: { signerPubHex: string; kind: string; body: string; sig: string }[];
};
const hex = (h: string) => new Uint8Array(Buffer.from(h, "hex"));

const dirs: string[] = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "folevi-e2ee-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** safeStorage stand-in: a reversible transform that marks its output, so tests can see nothing is in the clear. */
function fakeCipher(o: { available?: boolean; key?: number } = {}): Cipher & { available: boolean } {
  const key = o.key ?? 0x5a;
  const c = {
    available: o.available ?? true,
    isEncryptionAvailable: () => c.available,
    encryptString: (plain: string) => Buffer.concat([Buffer.from([key]), Buffer.from(plain, "utf8").map((b) => b ^ key)]),
    decryptString: (enc: Buffer) => {
      if (enc[0] !== key) throw new Error("another Keychain");
      return Buffer.from(enc.subarray(1).map((b) => b ^ key)).toString("utf8");
    },
  };
  return c;
}

function keys(o: Partial<DeviceKeysDeps> = {}) {
  return new DeviceKeys({ dir: o.dir ?? scratch(), cipher: o.cipher ?? fakeCipher(), ...o });
}

describe("device keys", () => {
  test("made on the first call, kept sealed on disk, the same after a restart", () => {
    const dir = scratch();
    const cipher = fakeCipher();
    const a = keys({ dir, cipher });
    const first = a.deviceKeys();
    expect(first.deviceId).toMatch(/^mac-[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(first.x25519Pub).toHaveLength(32);
    expect(first.ed25519Pub).toHaveLength(32);
    // The private halves are only in device.bin, sealed; device.json holds the id and the public halves.
    const meta = JSON.parse(readFileSync(join(dir, "device.json"), "utf8"));
    expect(Object.keys(meta).sort()).toEqual(["createdAt", "deviceId", "ed25519Pub", "version", "x25519Pub"]);
    const bin = readFileSync(join(dir, "device.bin"));
    expect(bin.toString("utf8")).not.toContain('"x"');
    // A new process (a restart) reads the same keys.
    const b = keys({ dir, cipher });
    expect(b.deviceKeys()).toEqual(first);
  });

  test("keys another Mac's Keychain can't open are replaced, never trusted", () => {
    const dir = scratch();
    const first = keys({ dir, cipher: fakeCipher({ key: 1 }) }).deviceKeys();
    const other = keys({ dir, cipher: fakeCipher({ key: 2 }) }).deviceKeys();
    expect(other.deviceId).not.toBe(first.deviceId);
    expect(Buffer.from(other.x25519Pub).equals(Buffer.from(first.x25519Pub))).toBe(false);
  });

  test("a device.json swapped for someone else's public keys is refused", () => {
    const dir = scratch();
    const cipher = fakeCipher();
    const first = keys({ dir, cipher }).deviceKeys();
    const meta = JSON.parse(readFileSync(join(dir, "device.json"), "utf8"));
    meta.x25519Pub = Buffer.alloc(32, 7).toString("base64url");
    writeFileSync(join(dir, "device.json"), JSON.stringify(meta));
    const again = keys({ dir, cipher }).deviceKeys();
    expect(again.deviceId).not.toBe(first.deviceId);
  });

  test("without safeStorage nothing is written in the clear", () => {
    const dir = scratch();
    const k = keys({ dir, cipher: fakeCipher({ available: false }) });
    expect(() => k.deviceKeys()).toThrow(expect.objectContaining({ code: "unavailable" }));
    expect(existsSync(join(dir, "device.bin"))).toBe(false);
  });

  test("reset forgets them; the next call makes new ones", () => {
    const dir = scratch();
    const k = keys({ dir });
    const first = k.deviceKeys();
    k.reset();
    expect(existsSync(join(dir, "device.bin"))).toBe(false);
    expect(k.deviceKeys().deviceId).not.toBe(first.deviceId);
  });

  test("ulid: 26 Crockford characters, time first", () => {
    expect(ulid(0)).toMatch(/^0000000000[0-9A-HJKMNP-TV-Z]{16}$/);
    expect(ulid(1_700_000_000_000) < ulid(1_800_000_000_000)).toBe(true);
  });
});

describe("open (FLS1)", () => {
  test("opens WP1's vector boxes with the recipient key", async () => {
    for (const v of vectors.boxes) {
      const k = keys({ generate: () => ({ x: hex(v.recipientSeedHex), ed: new Uint8Array(32).fill(9) }) });
      expect(Buffer.from(k.deviceKeys().x25519Pub).toString("hex")).toBe(v.recipientPubHex);
      const out = await k.open(hex(v.boxHex), v.context);
      expect(Buffer.from(out).toString("hex")).toBe(v.plaintextHex);
    }
  });

  test("a box moved to another context, or changed, doesn't open", async () => {
    const v = vectors.boxes[0]!;
    const k = keys({ generate: () => ({ x: hex(v.recipientSeedHex), ed: new Uint8Array(32).fill(9) }) });
    k.deviceKeys();
    await expect(k.open(hex(v.boxHex), `${v.context}x`)).rejects.toMatchObject({ code: "failed" });
    const bad = hex(v.boxHex);
    bad[bad.length - 1] = (bad[bad.length - 1] ?? 0) ^ 1;
    await expect(k.open(bad, v.context)).rejects.toMatchObject({ code: "failed" });
  });

  test("round trip with a box sealed to this Mac; odd input is refused before any key is used", async () => {
    const k = keys();
    const { deviceId, x25519Pub } = k.deviceKeys();
    const context = `folevi/e2ee/v1/amk/device/p1/${deviceId}`;
    const amk = new Uint8Array(32).map((_, i) => i);
    expect(Array.from(await k.open(sealBoxForTest(x25519Pub, context, amk), context))).toEqual(Array.from(amk));
    await expect(k.open("not bytes", context)).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(k.open(new Uint8Array(70), context)).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(k.open(sealBoxForTest(x25519Pub, context, amk), "amk/device")).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(k.open(sealBoxForTest(x25519Pub, context, amk), `${context}\n`)).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(k.open(new Uint8Array(70 * 1024), context)).rejects.toMatchObject({ code: "invalid_argument" });
  });

  test("a low-order ephemeral key is refused", async () => {
    const k = keys();
    const { x25519Pub } = k.deviceKeys();
    const context = "folevi/e2ee/v1/amk/device/p1/d1";
    const box = sealBoxForTest(x25519Pub, context, new Uint8Array(32));
    box.fill(0, 5, 37);
    await expect(k.open(box, context)).rejects.toMatchObject({ code: "failed" });
  });
});

describe("sign (FST1)", () => {
  test("the signed bytes are WP1's: its vector signatures verify over statementMessage", () => {
    for (const s of vectors.statements) {
      const pub = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(s.signerPubHex, "hex").toString("base64url") }, format: "jwk" });
      expect(edVerify(null, statementMessage(s.kind, s.body), pub, Buffer.from(s.sig, "base64url"))).toBe(true);
    }
  });

  test("signs a statement with the device key; refuses unknown kinds and non-objects", async () => {
    const k = keys();
    const { ed25519Pub } = k.deviceKeys();
    const body = JSON.stringify({ deviceId: "d1", profileId: "p1" });
    const sig = await k.sign("device", body);
    const pub = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(ed25519Pub).toString("base64url") }, format: "jwk" });
    expect(edVerify(null, statementMessage("device", body), pub, Buffer.from(sig, "base64url"))).toBe(true);
    await expect(k.sign("anything", body)).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(k.sign("device", "[1]")).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(k.sign("device", "x".repeat(5000))).rejects.toMatchObject({ code: "invalid_argument" });
  });
});

describe("Touch ID before unlocking", () => {
  const touch = (o: { can?: boolean; ok?: boolean } = {}) => {
    const state = { ok: o.ok ?? true };
    const prompt = vi.fn(async () => {
      if (!state.ok) throw new Error("cancelled");
    });
    return { state, prompt, touchId: { canPrompt: () => o.can ?? true, prompt } };
  };

  test("off by default; turning it on asks Touch ID, then open asks (once for windows opening together)", async () => {
    let now = 1_000_000;
    const t = touch();
    const k = keys({ touchId: t.touchId, now: () => now });
    const { x25519Pub } = k.deviceKeys();
    const context = "folevi/e2ee/v1/amk/device/p1/d1";
    const box = sealBoxForTest(x25519Pub, context, new Uint8Array(32).fill(1));
    expect(k.settings()).toEqual({ touchId: false, available: true });
    await k.open(box, context);
    expect(t.prompt).not.toHaveBeenCalled();
    expect(await k.setTouchId(true)).toEqual({ touchId: true, available: true });
    expect(t.prompt).toHaveBeenCalledTimes(1);
    now += 60_000;
    await Promise.all([k.open(box, context), k.open(box, context)]);
    expect(t.prompt).toHaveBeenCalledTimes(2);
    now += 60_000;
    t.state.ok = false;
    await expect(k.open(box, context)).rejects.toMatchObject({ code: "cancelled" });
    // Kept across restarts.
    expect(keys({ dir: dirs.at(-1)!, touchId: t.touchId }).settings().touchId).toBe(true);
  });

  test("a cancelled Touch ID leaves the setting as it was; a Mac without Touch ID can't turn it on", async () => {
    const t = touch({ ok: false });
    const k = keys({ touchId: t.touchId });
    await expect(k.setTouchId(true)).rejects.toMatchObject({ code: "cancelled" });
    expect(k.settings().touchId).toBe(false);
    const none = keys({ touchId: touch({ can: false }).touchId });
    await expect(none.setTouchId(true)).rejects.toMatchObject({ code: "unavailable" });
    await expect(none.setTouchId("yes")).rejects.toMatchObject({ code: "invalid_argument" });
  });
});

describe("ipc", () => {
  test("every channel is registered and refuses pages that aren't Folevi's", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const k = keys();
    registerE2eeIpc(
      (channel, listener) => handlers.set(channel, listener),
      () => k,
      (e) => (e as { ok: boolean }).ok,
    );
    expect([...handlers.keys()].sort()).toEqual(Object.values(E2EE_CHANNELS).sort());
    const refused = await handlers.get(E2EE_CHANNELS.deviceKeys)!({ ok: false });
    expect(refused).toMatchObject({ ok: false, error: { code: "unavailable" } });
    expect(existsSync(join(dirs.at(-1)!, "device.bin"))).toBe(false);
    const answer = (await handlers.get(E2EE_CHANNELS.deviceKeys)!({ ok: true })) as { ok: true; value: { deviceId: string } };
    expect(answer.ok).toBe(true);
    const bad = await handlers.get(E2EE_CHANNELS.open)!({ ok: true }, new Uint8Array(3), "folevi/e2ee/v1/x");
    expect(bad).toEqual({ ok: false, error: { code: "invalid_argument", message: "Not a sealed Folevi box." } });
  });

  test("preload.ts calls exactly these channels, on both bridges", () => {
    const preload = readFileSync(join(__dirname, "preload.ts"), "utf8");
    for (const channel of Object.values(E2EE_CHANNELS)) expect(preload).toContain(`"${channel.replace("shell:e2ee-", "")}"`);
    expect(preload).toContain("shell:e2ee-");
    expect(preload).toMatch(/e2ee: e2eeBridge/);
    expect(preload.match(/e2ee: e2eeBridge/g)?.length).toBe(2);
  });
});
