#!/usr/bin/env node
// Makes the Electron support folder FoleviTests migrates (apps/mac/fixtures/migration/electron-user-data): what
// Folevi for Mac 1.22 keeps in Application Support/Folevi, sealed as Electron's safeStorage does with
// --use-mock-keychain (Chromium's password "mock_password"; SafeStorageTests checks the same cipher against a vector
// Electron itself made), with a test account's session, Foli AI and cloud keys, E2EE device keys for the library and
// an account, a library key, a folder library, two places, settings, the window, reminders, and a handover written by
// apps/desktop/src/handover.ts itself (fake-indexeddb standing in for Chromium's storage). Every value is made up.
//
//   node apps/mac/scripts/migration-fixture.mjs      (after `pnpm build` in apps/desktop)
//
// The library's folder is "$LIBRARY" in library.json: the tests put a real scratch folder there.
import { createCipheriv, generateKeyPairSync, pbkdf2Sync, randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { MAC } from "./project.mjs";

const desktop = resolve(MAC, "../desktop");
const require = createRequire(join(desktop, "package.json"));
const { IDBFactory, IDBKeyRange } = require("fake-indexeddb");
const { kitScript } = require(join(desktop, "dist/handoff.js"));
const { writeHandover } = require(join(desktop, "dist/handover.js"));
const { FileJournal } = require(join(desktop, "dist/library/journal.js"));

const out = join(MAC, "fixtures/migration/electron-user-data");
rmSync(out, { recursive: true, force: true });
const put = (rel, data) => {
  mkdirSync(join(out, rel, ".."), { recursive: true });
  writeFileSync(join(out, rel), data);
};
const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

// safeStorage with the mock Keychain: v10 + AES-128-CBC(PBKDF2-SHA1("mock_password", "saltysalt", 1003), IV 16 spaces).
const key = pbkdf2Sync("mock_password", "saltysalt", 1003, 16, "sha1");
const seal = (text) => {
  const c = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  return Buffer.concat([Buffer.from("v10"), c.update(text, "utf8"), c.final()]);
};

const USER = "k17abcuser1";
const expected = { user: USER, sessions: {}, ai: {}, devices: {}, libraryKey: null, cloud: {} };

// Sign-ins and Foli AI keys (secrets.ts).
expected.sessions["session." + USER] = "test-session-token-for-user-one-0001";
expected.sessions.session = "test-session-token-legacy-single-0002";
expected.ai["ai.openai"] = "test-openai-key-not-real-0003";
put(`secrets/auth.session.${USER}.bin`, seal(expected.sessions["session." + USER]));
put("secrets/auth.session.bin", seal(expected.sessions.session));
put("secrets/ai.openai.bin", seal(expected.ai["ai.openai"]));
put("secrets/notes.txt", "not a secret Folevi keeps\n");

// Dropbox (library/cloud/tokenStore.ts, electron.ts).
const dropbox = { accessToken: "test-dropbox-access", refreshToken: "test-dropbox-refresh", expiresAt: 1_900_000_000_000 };
expected.cloud.dropbox = dropbox;
put("cloud-tokens.bin", seal(JSON.stringify({ dropbox })));
put("cloud-connection.json", json({ provider: "dropbox", account: "test@example.com", connectedAt: 1_760_000_000_000 }));

// E2EE device keys (e2ee.ts): the library's pair in e2ee/, the account's in e2ee/accounts/<user id>/.
const raw = (k) => Buffer.from(k.export({ format: "jwk" }).d, "base64url");
const pub = (k) => k.export({ format: "jwk" }).x;
for (const [dir, deviceId, touchId] of [["e2ee", "mac-01JTESTLIBRARY0000000000", false], [`e2ee/accounts/${USER}`, "mac-01JTESTACCOUNT0000000000", true]]) {
  const x = generateKeyPairSync("x25519");
  const ed = generateKeyPairSync("ed25519");
  put(`${dir}/device.bin`, seal(JSON.stringify({ x: raw(x.privateKey).toString("base64url"), ed: raw(ed.privateKey).toString("base64url") })));
  put(`${dir}/device.json`, json({ version: 1, deviceId, x25519Pub: pub(x.publicKey), ed25519Pub: pub(ed.publicKey), createdAt: 1_760_000_000_000 }));
  if (touchId) put(`${dir}/prefs.json`, json({ touchId: true }));
  expected.devices[dir === "e2ee" ? "device" : `device.${USER}`] = { deviceId, x25519Pub: pub(x.publicKey), ed25519Pub: pub(ed.publicKey) };
}
// A device.json whose keys don't match is refused (as e2ee.ts does), in a fixture of its own (tests copy it in).

// The library (library/service.ts, keys.ts): a folder library, encrypted, with its key cached and a journal.
const LIB = "01JTESTLIBRARY00000000000A";
const libraryKey = randomBytes(32).toString("base64");
expected.libraryKey = { libraryId: LIB, key: libraryKey };
put(`library-keys/${LIB}.key`, seal(libraryKey));
put("library.json", json({ v: 1, kind: "folder", path: "$LIBRARY/Folevi Library", libraryId: LIB, chosenFolder: "$LIBRARY", encryptionJob: { direction: "encrypt" } }));
// Electron's own journal (library/journal.ts), two records; the native LibraryJournal reads the same file.
mkdirSync(join(out, "library"), { recursive: true });
const journal = new FileJournal(join(out, "library", `journal-${LIB}.bin`));
for (const r of ["first edit, not yet in its file", "second edit"]) await journal.append(new TextEncoder().encode(r));
expected.journal = ["first edit, not yet in its file", "second edit"];
put("Cloud libraries/Dropbox/.folevi-cloud/state.json", json({ cursor: "c1" }));
put("Cloud libraries/Dropbox/notes/one.md", "a note in the old copy\n");

// Places (places.ts): the library and one account, the account open.
put("places.json", json({
  v: 1,
  current: `acct:${USER}`,
  library: true,
  libraryCounts: { unread: 0, reminders: 1, waiting: 0 },
  accounts: [{ kind: "account", id: `acct:${USER}`, userId: USER, profileId: "p1", name: "Test Person", email: "test@example.com", avatarUrl: null, workspaces: [{ id: "w1", name: "Team", logoUrl: null }], unread: 2, reminders: 0, waiting: 0 }],
  quickAdd: "library",
}));

// Settings, the window, reminders, the lock (settings.ts, windowState.ts, reminders.ts, lock.ts).
put("settings.json", json({ quickAddShortcut: "Command+Shift+K", openAtLogin: false, menuBarIcon: false, notifications: true, mode: "account", bundledShell: true }));
put("window.json", JSON.stringify({ bounds: { x: 100, y: 80, width: 1200, height: 800 }, maximized: false }));
put("reminders.json", json({
  reminders: [
    { id: "r-future", at: 4_102_444_800_000, title: "Water the plants", body: "", path: "/tasks" },
    { id: "r-past", at: 1_600_000_000_000, title: "Long gone", body: "", path: "/tasks" },
  ],
  shown: [{ id: "r-shown", at: 1_700_000_000_000, shownAt: 1_700_000_000_000 }],
}));
put("lock.json", json({ lock: false, lockAfter: 0 }));

// Chromium's own files (only markers: their contents are never read).
put("Local State", "{}\n");
put("Partitions/folevi/IndexedDB/app_folevi_0.indexeddb.leveldb/CURRENT", "MANIFEST-000001\n");

// The handover, by handover.ts from an origin with one account's unsent edits.
class MemoryStorage {
  m = new Map();
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const indexedDB = new IDBFactory();
const localStorage = new MemoryStorage();
const call = (fn, ...args) => new Function("indexedDB", "IDBKeyRange", "localStorage", `return ${kitScript(fn, args)}`)(indexedDB, IDBKeyRange, localStorage);
const req = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));
const open = indexedDB.open(`folevi-${USER}`, 3);
open.onupgradeneeded = () => {
  const db = open.result;
  db.createObjectStore("meta");
  db.createObjectStore("syncState");
  db.createObjectStore("uploads", { keyPath: "uploadId" });
  db.createObjectStore("documents", { keyPath: "id" }).createIndex("by_scope", "scopeKey");
};
const db = await req(open);
const tx = db.transaction(["meta", "syncState", "uploads", "documents"], "readwrite");
tx.objectStore("meta").put({ id: "01OUTBOX", name: "organization.createFolder", args: { name: "Written offline" }, createdAt: 5, attempts: 0 }, "outbox:01OUTBOX");
tx.objectStore("meta").put({ at: new Date(1_700_000_000_000), bytes: new Uint8Array([1, 2, 3]) }, "odd");
tx.objectStore("syncState").put({ blocks: {}, pending: [{ kind: "block.update", opId: "op-1", block: { id: "b1", text: "written offline" } }], inflight: [], conflicts: [], errors: [], uploads: [] }, "account");
tx.objectStore("uploads").put({ uploadId: "u1", documentId: "d1", blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), attempts: 0 });
for (let i = 0; i < 12; i++) tx.objectStore("documents").put({ id: `d${i}`, scopeKey: "personal", title: `Note ${i}`, body: "x".repeat(400) });
await new Promise((r) => (tx.oncomplete = r));
db.close();
localStorage.setItem("folevi:last-account", USER);
localStorage.setItem(`folevi:sync-journal:${USER}:tab1`, JSON.stringify({ ops: [{ opId: "op-2" }], uploads: [], closed: true, at: 9 }));
const index = await writeHandover(call, out, { appVersion: "1.22.0", dbVersion: 3, origin: "app://folevi", budget: 2000, now: () => 1_761_000_000_000 });
expected.handover = { databases: index.databases.map((d) => ({ name: d.name, counts: d.counts })), storage: index.storage?.entries ?? 0 };

put("../electron-user-data.expected.json", json(expected));
console.log(out);
