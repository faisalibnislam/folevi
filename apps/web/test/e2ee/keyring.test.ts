// WP6: the account master key and its ways in, trusted browsers, public computers, and the key ring (space
// and note keys, grants, rotation), against an in-memory WP2 (keysFakeServer.ts). docs/E2EE_DESIGN.md §4.7 to
// §4.9, §6.2, §6.3, §6.10.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  ARGON2ID_TEST,
  ctx,
  deriveNoteKeys,
  linkWrapKey,
  newRecoveryKey,
  openRecord,
  randomBytes,
  sealRecord,
  toBase64Url,
} from "@folevi/local-store/e2ee";
import { endKeySession, getKeySession, keepOnSignOut, setup, startKeySession } from "@/lib/e2ee/keys";
import { getKeyRing, keyRingImpl, resetKeyRingForTests } from "@/lib/e2ee/keys/keyring";
import { idbKeyStore, memoryKeyStore, type KeyStore } from "@/lib/e2ee/keys/keystore";
import { passphraseProblem, setPassphraseCostsForTests } from "@/lib/e2ee/keys/passphrase";
import { wasPublicSession } from "@/lib/e2ee/keys/publicMode";
import { groupsMatch } from "@/lib/e2ee/keys/recoveryKey";
import { resetKeySessionForTests, sessionImpl } from "@/lib/e2ee/keys/session";
import { KeysError, SecretBox, browserLabel } from "@/lib/e2ee/keys/util";
import { FakeKeysServer } from "./keysFakeServer";

const tick = () => new Promise((r) => setTimeout(r, 0));
const stores = new Map<string, KeyStore>();
const storeOf = (who: string) => {
  let s = stores.get(who);
  if (!s) stores.set(who, (s = memoryKeyStore()));
  return s;
};

/** Signs `profileId` in on `device` (a browser with its own IndexedDB), like AccountGate would. */
async function signIn(fake: FakeKeysServer, profileId: string, device = `${profileId}-browser`) {
  resetKeySessionForTests();
  resetKeyRingForTests();
  let n = 0;
  await startKeySession({ server: fake.as(profileId), profileId, email: `${profileId}@example.com`, store: storeOf(device), mac: null, newDeviceId: async () => `web-${device}-${++n}` });
  await tick();
  return getKeySession();
}

beforeEach(() => {
  stores.clear();
  setPassphraseCostsForTests(ARGON2ID_TEST);
  try {
    localStorage.clear();
  } catch {
    /* jsdom */
  }
});
afterEach(() => {
  resetKeySessionForTests();
  resetKeyRingForTests();
  setPassphraseCostsForTests(null);
});

describe("standard accounts", () => {
  test("no E2EE: the session stays at none and asks for nothing else", async () => {
    const fake = new FakeKeysServer();
    const s = await signIn(fake, "p1");
    expect(s.state()).toBe("none");
    // One status query and its subscription; nothing else (no wraps, devices, approvals or spaces).
    expect(fake.calls).toEqual(["keys.status", "watch.status"]);
    expect(await s.unlockWithDevice()).toBe(false);
    expect(() => s.accountKeys()).toThrow(KeysError);
  });
});

describe("account and ways in", () => {
  test("createAccount: unlocked here, this browser trusted, and the next visit unlocks with no prompt", async () => {
    const fake = new FakeKeysServer();
    const s = await signIn(fake, "p1");
    await setup.createAccount();
    expect(s.state()).toBe("unlocked");
    const acct = fake.active("p1")!;
    expect(Buffer.from(new Uint8Array(acct.x25519Pub)).equals(Buffer.from(s.accountKeys().x25519.publicKey))).toBe(true);
    expect(fake.devices).toHaveLength(1);
    expect(fake.devices[0]).toMatchObject({ kind: "browser", status: "trusted", deviceId: s.deviceId() });
    expect(fake.wraps.map((w) => w.kind)).toEqual(["device"]);
    const rec = await storeOf("p1-browser").getDevice("p1");
    expect(rec?.trusted).toBe(true);
    // The private keys kept are WebCrypto keys this page can't read.
    expect(rec?.x25519.privateKey).toBeInstanceOf(CryptoKey);
    expect((rec?.x25519.privateKey as CryptoKey).extractable).toBe(false);
    const again = await signIn(fake, "p1");
    expect(again.state()).toBe("unlocked");
    expect(sessionImpl().methods.map((m) => m.label)).toEqual(["This browser"]);
  });

  test("the device keys survive in IndexedDB as non-extractable keys", async () => {
    const fake = new FakeKeysServer();
    resetKeySessionForTests();
    await startKeySession({ server: fake.as("pidb"), profileId: "pidb", store: idbKeyStore, mac: null });
    await setup.createAccount();
    resetKeySessionForTests();
    await startKeySession({ server: fake.as("pidb"), profileId: "pidb", store: idbKeyStore, mac: null });
    expect(getKeySession().state()).toBe("unlocked");
    const rec = await idbKeyStore.getDevice("pidb");
    expect((rec!.ed25519.privateKey as CryptoKey).extractable).toBe(false);
    await endKeySession({ forget: true });
    expect(await idbKeyStore.getDevice("pidb")).toBeNull();
  });

  test("recovery key: counts only after groups 3 and 7; unlocks a new browser; wrong and malformed keys are told apart", async () => {
    const fake = new FakeKeysServer();
    await signIn(fake, "p1");
    await setup.createAccount();
    const rk = await setup.addRecoveryKey();
    const groups = rk.text.split("-");
    expect(fake.wraps.some((w) => w.kind === "recoveryKey")).toBe(false);
    expect(await rk.confirm([groups[2]!, groups[5]!])).toBe(false);
    expect(await rk.confirm([groups[2]!.toLowerCase(), ` ${groups[6]!} `])).toBe(true);
    expect(fake.wraps.filter((w) => w.kind === "recoveryKey")).toHaveLength(1);

    const s = await signIn(fake, "p1", "laptop");
    expect(s.state()).toBe("locked");
    expect(await s.unlockWithRecoveryKey("not a key")).toBe("bad_format");
    expect(await s.unlockWithRecoveryKey(newRecoveryKey().text)).toBe("wrong");
    expect(s.state()).toBe("locked");
    expect(await s.unlockWithRecoveryKey(rk.text.toLowerCase().replace(/-/g, " "))).toBe("ok");
    expect(s.state()).toBe("unlocked");
    // Until "Trust this browser", nothing is kept here.
    expect(await storeOf("laptop").getWrap("p1")).toBeNull();
    await s.trust("browser");
    expect(fake.devices.filter((d) => d.status === "trusted")).toHaveLength(2);
    const back = await signIn(fake, "p1", "laptop");
    expect(back.state()).toBe("unlocked");
  });

  test("passphrase: refused when short or common; wrong ones don't unlock; ten tries an hour", async () => {
    const fake = new FakeKeysServer();
    await signIn(fake, "p1");
    await setup.createAccount();
    await expect(setup.addPassphrase("short")).rejects.toMatchObject({ code: "e2ee_passphrase_short" });
    await expect(setup.addPassphrase("password1234")).rejects.toMatchObject({ code: "e2ee_passphrase_common" });
    await setup.addPassphrase("tidal orchard lamp 42");
    const w = fake.wraps.find((x) => x.kind === "passphrase")!;
    expect(w.kdf).toMatchObject({ name: "argon2id", m: ARGON2ID_TEST.m, t: 3, p: 1 });
    const s = await signIn(fake, "p1", "laptop");
    expect(await s.unlockWithPassphrase("tidal orchard lamp 43")).toBe("wrong");
    expect(await s.unlockWithPassphrase("tidal orchard lamp 42")).toBe("ok");
    s.lock();
    for (let i = 0; i < 8; i++) await s.unlockWithPassphrase("nope nope nope nope");
    expect(await s.unlockWithPassphrase("tidal orchard lamp 42")).toBe("rate_limited");
    expect(s.state()).toBe("locked");
  });

  test("a re-check while unlocked opens the same key and records the wrap (for lowering a level)", async () => {
    const fake = new FakeKeysServer();
    const s = await signIn(fake, "p1");
    await setup.createAccount();
    await setup.addPassphrase("tidal orchard lamp 42");
    expect(await s.unlockWithPassphrase("tidal orchard lamp 42")).toBe("ok");
    expect(s.state()).toBe("unlocked");
    expect(sessionImpl().recheckedWrapId()).toBe(fake.wraps.find((w) => w.kind === "passphrase")!.publicId);
  });

  test("a device removed elsewhere stays locked on its next start and forgets its trust", async () => {
    const fake = new FakeKeysServer();
    const s = await signIn(fake, "p1");
    await setup.createAccount();
    fake.revoke("p1", s.deviceId());
    const again = await signIn(fake, "p1");
    expect(again.state()).toBe("locked");
    expect(await storeOf("p1-browser").getDevice("p1")).toBeNull();
  });

  test("offline: the cached wrap unlocks a trusted browser", async () => {
    const fake = new FakeKeysServer();
    await signIn(fake, "p1");
    await setup.createAccount();
    const offline = fake.as("p1");
    const broken = { ...offline, keys: { ...offline.keys, status: () => Promise.reject(new Error("offline")), getDeviceWrap: () => Promise.reject(new Error("offline")) } };
    resetKeySessionForTests();
    await startKeySession({ server: broken, profileId: "p1", store: storeOf("p1-browser"), mac: null });
    expect(getKeySession().state()).toBe("unlocked");
  });

  test("public computer: the key stays in this tab; nothing is wrapped for it; the next load clears up", async () => {
    const fake = new FakeKeysServer();
    await signIn(fake, "p1");
    await setup.createAccount();
    const rk = await setup.addRecoveryKey();
    const g = rk.text.split("-");
    await rk.confirm([g[2]!, g[6]!]);
    const s = await signIn(fake, "p1", "library");
    expect(await s.unlockWithRecoveryKey(rk.text)).toBe("ok");
    await s.trust("public");
    const session = fake.devices.find((d) => d.kind === "session")!;
    expect(session.status).toBe("trusted");
    expect(fake.wraps.some((w) => w.deviceId === session.deviceId)).toBe(false);
    expect(await storeOf("library").getWrap("p1")).toBeNull();
    expect(await storeOf("library").getDevice("p1")).toBeNull();
    expect(wasPublicSession()).toBe(true);
    expect(keepOnSignOut(false)("folevi-e2ee")).toBe(false);
    // Another load of this browser: locked again, and the flag is cleared.
    const next = await signIn(fake, "p1", "library");
    expect(next.state()).toBe("locked");
    expect(wasPublicSession()).toBe(false);
  });

  test("an AMK that doesn't match the account is refused", async () => {
    const fake = new FakeKeysServer();
    const s = await signIn(fake, "p1");
    await setup.createAccount();
    await setup.addPassphrase("tidal orchard lamp 42");
    // A server handing out another account's key (its check value differs) can't unlock this one.
    const other = new FakeKeysServer();
    await signIn(other, "p1", "x");
    await setup.createAccount();
    fake.accounts[0]!.amkCheck = other.accounts[0]!.amkCheck;
    const fresh = await signIn(fake, "p1", "laptop");
    expect(await fresh.unlockWithPassphrase("tidal orchard lamp 42")).toBe("wrong");
    void s;
  });
});

describe("key ring", () => {
  test("a Personal space key, a note key wrapped by it, opened again after a fresh unlock", async () => {
    const fake = new FakeKeysServer();
    await signIn(fake, "p1");
    await setup.createAccount();
    await setup.setUpSpace({ kind: "personal" });
    const sk = await getKeyRing().spaceKeys({ kind: "personal" });
    expect(sk.version).toBe(1);
    expect(fake.grants).toHaveLength(1);
    const made = await getKeyRing().newNoteKey("DOC1", { kind: "personal" });
    expect(made).toMatchObject({ version: 1, spaceVersion: 1 });
    fake.addNoteKeyRow({ documentId: "DOC1", scope: { kind: "personal" }, owner: "p1", version: 1, spaceVersion: 1, wrapped: made.wrapped });
    const ct = await sealRecord(made.keys.content, 1, ctx.block("DOC1", "B1"), new TextEncoder().encode("hello"));

    await signIn(fake, "p1");
    // Nothing cached: the ring finds the note's wrap (myNoteKeys) and the space grant, and opens both.
    const nk = await getKeyRing().noteKeys("DOC1");
    expect(nk.version).toBe(1);
    expect(new TextDecoder().decode(await openRecord(nk.content, ctx.block("DOC1", "B1"), ct))).toBe("hello");
    // Locking forgets every key.
    getKeySession().lock();
    expect(keyRingImpl().cachedNotes).toBe(0);
    await expect(getKeyRing().noteKeys("DOC1")).rejects.toMatchObject({ code: "e2ee_locked_session" });
  });

  test("addNoteKeys from a pull, with the space named", async () => {
    const fake = new FakeKeysServer();
    await signIn(fake, "p1");
    await setup.createAccount();
    await setup.setUpSpace({ kind: "personal" });
    const made = await getKeyRing().newNoteKey("DOC2", { kind: "personal" });
    await signIn(fake, "p1");
    await getKeyRing().addNoteKeys([{ documentId: "DOC2", version: 1, wrappedBy: "space", spaceVersion: 1, wrapped: made.wrapped.slice().buffer, scope: { kind: "personal" } }]);
    expect((await getKeyRing().noteKeys("DOC2")).version).toBe(1);
    expect(fake.calls).not.toContain("grants.myNoteKeys");
  });

  test("a grant whose statement names someone else, or was signed by another key, is refused", async () => {
    const fake = new FakeKeysServer();
    await signIn(fake, "p1");
    await setup.createAccount();
    await setup.setUpSpace({ kind: "personal" });
    const g = fake.grants[0]!;
    const body = JSON.parse(g.statement.body);
    g.statement = { ...g.statement, body: JSON.stringify({ ...body, version: 2 }) };
    await signIn(fake, "p1");
    await expect(getKeyRing().spaceKeys({ kind: "personal" })).rejects.toMatchObject({ code: "e2ee_bad_grant" });
    g.statement = { ...g.statement, body: JSON.stringify(body), sig: toBase64Url(randomBytes(64)) };
    await signIn(fake, "p1");
    await expect(getKeyRing().spaceKeys({ kind: "personal" })).rejects.toMatchObject({ code: "e2ee_bad_grant" });
  });

  test("an encrypted link's note key opens with the secret from the fragment", async () => {
    const fake = new FakeKeysServer();
    await signIn(fake, "p1");
    const nk = randomBytes(32);
    const secret = randomBytes(32);
    const wrapped = await sealRecord(await linkWrapKey(secret), 1, ctx.noteKeyLink("DOC3", 1, "LINK1"), nk);
    await expect(getKeyRing().linkNoteKey("DOC3", secret, wrapped, 1)).rejects.toMatchObject({ code: "invalid_argument" });
    await getKeyRing().linkNoteKey("DOC3", secret, wrapped, 1, "LINK1");
    const keys = await getKeyRing().noteKeys("DOC3");
    const want = await deriveNoteKeys(nk);
    const probe = await sealRecord(want.content, 1, ctx.docTitle("DOC3"), new Uint8Array([1, 2, 3]));
    expect(Array.from(await openRecord(keys.content, ctx.docTitle("DOC3"), probe))).toEqual([1, 2, 3]);
  });
});

describe("workspaces", () => {
  async function workspace() {
    const fake = new FakeKeysServer();
    fake.workspaces.set("WS1", [
      { profileId: "admin", role: "owner" },
      { profileId: "bea", role: "member" },
    ]);
    await signIn(fake, "admin");
    await setup.createAccount();
    await setup.setUpSpace({ kind: "workspace", workspaceId: "WS1" });
    return fake;
  }

  test("a member who sets up encryption later gets the key from an admin's device", async () => {
    const fake = await workspace();
    expect(fake.pending.map((p) => [p.profileId, p.reason])).toEqual([["bea", "joined"]]);
    await signIn(fake, "bea");
    await setup.createAccount();
    await expect(getKeyRing().spaceKeys({ kind: "workspace", workspaceId: "WS1" })).rejects.toMatchObject({ code: "e2ee_no_key" });
    // A member can't hand keys out.
    expect(await setup.completePendingGrants({ kind: "workspace", workspaceId: "WS1" })).toBe(0);
    await signIn(fake, "admin");
    expect(await setup.completePendingGrants({ kind: "workspace", workspaceId: "WS1" })).toBe(1);
    expect(fake.pending).toHaveLength(0);
    await signIn(fake, "bea");
    expect((await getKeyRing().spaceKeys({ kind: "workspace", workspaceId: "WS1" })).version).toBe(1);
    // Granted by someone else: their signature checks out against their account key.
    expect(keyRingImpl().unverified.size).toBe(0);
  });

  test("rotation: a removed member gets nothing new; remaining members and every note key move to the new version", async () => {
    const fake = await workspace();
    await signIn(fake, "bea");
    await setup.createAccount();
    await signIn(fake, "admin");
    await setup.completePendingGrants({ kind: "workspace", workspaceId: "WS1" });
    const ws = { kind: "workspace" as const, workspaceId: "WS1" };
    const docs = ["DOCA", "DOCB", "DOCC"];
    for (const d of docs) {
      const made = await getKeyRing().newNoteKey(d, ws);
      fake.addNoteKeyRow({ documentId: d, scope: ws, owner: "admin", version: 1, spaceVersion: 1, wrapped: made.wrapped });
    }
    // Carl was a member and is removed (his grants go, as workspaces.removeMember does).
    fake.workspaces.get("WS1")!.push({ profileId: "carl", role: "member" });
    fake.workspaces.set("WS1", fake.workspaces.get("WS1")!.filter((m) => m.profileId !== "carl"));
    const progress: [number, number][] = [];
    await signIn(fake, "admin");
    await setup.rotateSpace(ws, (n, of) => progress.push([n, of]));
    expect(fake.spaces.get("workspace:WS1")!.currentKeyVersion).toBe(2);
    expect(fake.grants.filter((g) => g.version === 2).map((g) => g.profileId).sort()).toEqual(["admin", "bea"]);
    expect(fake.noteKeys.filter((n) => n.spaceVersion === 2).map((n) => n.documentId).sort()).toEqual(docs);
    expect(progress.at(-1)![0]).toBe(progress.at(-1)![1]);
    // Bea opens a note with the new space version only.
    await signIn(fake, "bea");
    fake.noteKeys = fake.noteKeys.filter((n) => n.spaceVersion !== 1);
    expect((await getKeyRing().noteKeys("DOCB")).version).toBe(1);
  });

  test("a page shared with a guest: the guest opens its note key from their own grant", async () => {
    const fake = await workspace();
    const ws = { kind: "workspace" as const, workspaceId: "WS1" };
    const made = await getKeyRing().newNoteKey("PAGE", ws);
    fake.addNoteKeyRow({ documentId: "PAGE", scope: ws, owner: "admin", version: 1, spaceVersion: 1, wrapped: made.wrapped });
    await signIn(fake, "guest");
    await expect(setup.grantNote("PAGE", "guest")).rejects.toMatchObject({ code: "e2ee_locked_session" });
    await setup.createAccount();
    await signIn(fake, "admin");
    await setup.grantNote("PAGE", "guest");
    await signIn(fake, "guest");
    const nk = await getKeyRing().noteKeys("PAGE");
    const probe = await sealRecord(made.keys.content, 1, ctx.docTitle("PAGE"), new Uint8Array([7]));
    expect(Array.from(await openRecord(nk.content, ctx.docTitle("PAGE"), probe))).toEqual([7]);
  });
});

describe("rotation and reset of the account key", () => {
  test("rotateAccount: a new recovery key, the old one no longer opens anything, spaces granted again, Personal rotated", async () => {
    const fake = new FakeKeysServer();
    const s = await signIn(fake, "p1");
    await setup.createAccount();
    const rk = await setup.addRecoveryKey();
    const g = rk.text.split("-");
    await rk.confirm([g[2]!, g[6]!]);
    await setup.addPassphrase("tidal orchard lamp 42");
    await setup.setUpSpace({ kind: "personal" });
    const made = await getKeyRing().newNoteKey("DOC1", { kind: "personal" });
    fake.addNoteKeyRow({ documentId: "DOC1", scope: { kind: "personal" }, owner: "p1", version: 1, spaceVersion: 1, wrapped: made.wrapped });
    const before = s.accountKeys().x25519.publicKey;
    const r = await setup.rotateAccount({ passphrase: "tidal orchard lamp 42", passkeys: false });
    expect(r.recoveryKey).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){8}$/);
    expect(r.recoveryKey).not.toBe(rk.text);
    expect(fake.active("p1")!.epoch).toBe(2);
    expect(Buffer.from(s.accountKeys().x25519.publicKey).equals(Buffer.from(before))).toBe(false);
    expect(fake.spaces.get("personal:p1")!.currentKeyVersion).toBe(2);
    const fresh = await signIn(fake, "p1", "laptop");
    expect(await fresh.unlockWithRecoveryKey(rk.text)).toBe("wrong");
    expect(await fresh.unlockWithRecoveryKey(r.recoveryKey!)).toBe("ok");
    // The old note is still readable: its key is wrapped by the new space version too.
    expect((await getKeyRing().noteKeys("DOC1")).version).toBe(1);
    // This browser unlocks with its device key at the new epoch.
    expect((await signIn(fake, "p1")).state()).toBe("unlocked");
  });

  test("resetAccount: a new key with this device only; Personal gets a new key for new notes", async () => {
    const fake = new FakeKeysServer();
    await signIn(fake, "p1");
    await setup.createAccount();
    await setup.setUpSpace({ kind: "personal" });
    const s = await signIn(fake, "p1", "new-laptop");
    expect(s.state()).toBe("locked");
    await setup.resetAccount();
    expect(s.state()).toBe("unlocked");
    expect(fake.active("p1")!.epoch).toBe(2);
    expect(fake.spaces.get("personal:p1")!.currentKeyVersion).toBe(2);
    expect((await getKeyRing().spaceKeys({ kind: "personal" })).version).toBe(2);
    await expect(getKeyRing().spaceKeys({ kind: "personal" }, 1)).rejects.toMatchObject({ code: "e2ee_no_key" });
  });
});

describe("pieces", () => {
  test("passphrase rules", () => {
    expect(passphraseProblem("eleven char")).toBe("short");
    for (const p of ["123456789012", "qwertyuiop12", "Password2026!", "aaaaaaaaaaaaaa", "abcabcabcabc", "  password1234  ", "iloveyou!!!!"]) expect(passphraseProblem(p)).toBe("common");
    for (const p of ["tidal orchard lamp 42", "correct horse staple 9", "mi casa es tu casa?"]) expect(passphraseProblem(p)).toBeNull();
  });

  test("recovery groups are read like the parser reads keys", () => {
    const { text } = newRecoveryKey();
    const g = text.split("-");
    expect(groupsMatch(text, [g[2]!, g[6]!])).toBe(true);
    expect(groupsMatch(text, [g[2]!.toLowerCase().replace(/0/g, "o").replace(/1/g, "l"), g[6]!])).toBe(true);
    expect(groupsMatch(text, [g[6]!, g[2]!])).toBe(g[2] === g[6]);
  });

  test("SecretBox zeroes what it takes and what it lends", async () => {
    const raw = randomBytes(32);
    const copy = new Uint8Array(raw);
    const box = await SecretBox.hold(raw);
    expect(raw.every((b) => b === 0)).toBe(true);
    let lent: Uint8Array | null = null;
    await box.use((b) => {
      lent = b;
      expect(Array.from(b)).toEqual(Array.from(copy));
    });
    expect(lent!.every((b) => b === 0)).toBe(true);
    box.clear();
    await expect(box.use(() => 1)).rejects.toMatchObject({ code: "e2ee_locked_session" });
  });

  test("browser labels", () => {
    expect(browserLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15")).toBe("Safari on Mac");
    expect(browserLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36")).toBe("Chrome on Windows");
    expect(browserLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone");
  });
});
