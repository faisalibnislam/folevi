// Revision 18's fixtures: the Vault (lib/engine/viewsVault.ts, commandsVault.ts). Made-up values only: nothing here is
// anyone's secret. The Swift tests decode them (VaultFixtureTests) and the Mac's screen captures draw them.
import type { CommandFixture, ViewFixture } from "./source";
import type { CommandName, VaultItemRow, VaultKindDef, ViewName } from "../protocol";
import { KIND_DEFS } from "../vault";

const view = <N extends ViewName>(f: Omit<ViewFixture<N>, "kind">): ViewFixture<N> => ({ kind: "view", ...f });
const command = <N extends CommandName>(f: Omit<CommandFixture<N>, "kind">): CommandFixture<N> => ({ kind: "command", ...f });

const NOW = Date.UTC(2026, 9, 27, 9, 30);
const VAULT = "01JVAULT000000000000000001";
const DAY = 86_400_000;
const KINDS: VaultKindDef[] = KIND_DEFS;

const row = (id: string, kind: string, kindLabel: string, title: string, detail: string, over: Partial<VaultItemRow> = {}): VaultItemRow => ({ id, kind, kindLabel, title, detail, folderId: null, revision: 1, updatedAt: NOW - DAY, deletedAt: null, mime: null, size: null, ...over });

export const VAULT_PASSWORDS: VaultItemRow[] = [
  row("01JITEM0000000000000000001", "login", "Login", "Bank of Kyoto", "Login · sam@example.com", { updatedAt: NOW - 3_600_000 }),
  row("01JITEM0000000000000000002", "apiKey", "API key", "Stripe live key", "API key · Stripe"),
  row("01JITEM0000000000000000003", "wifi", "Wi-Fi", "Studio Wi-Fi", "Wi-Fi", { updatedAt: NOW - 5 * DAY }),
];

export const VAULT_FILES: VaultItemRow[] = [
  row("01JITEM0000000000000000004", "note", "Note", "Safe deposit box", "Box 4711 at the High Street branch", { updatedAt: NOW - 2 * DAY }),
  row("01JITEM0000000000000000005", "file", "File", "lease-2026.pdf", "212 KB", { mime: "application/pdf", size: 217_088, updatedAt: NOW - 4 * DAY }),
];

export const VAULT_FIXTURES = {
  "view.vault.summary": view({
    name: "vault.summary",
    description: "A library's Vault, open on this device.",
    args: {},
    value: { state: "open", vaultId: VAULT, personal: true, local: true, role: "owner", autoLockMinutes: 5, locksAt: NOW + 5 * 60_000, recoveryToSave: null, recoveryOutdated: false, accessReviewDue: false, custodiansNameCustodians: false, moreSections: ["health", "trash", "settings"], passcodeLengths: [6, 8, 12] },
  }),
  "view.vault.summary.locked": view({
    name: "vault.summary",
    description: "A team Vault, locked.",
    args: { space: "ws1" },
    value: { state: "locked", vaultId: VAULT, personal: false, local: false, role: "custodian", autoLockMinutes: 10, locksAt: null, recoveryToSave: null, recoveryOutdated: false, accessReviewDue: true, custodiansNameCustodians: true, moreSections: ["health", "activity", "people", "trash", "settings"], passcodeLengths: [6, 8, 12] },
  }),
  "view.vault.summary.none": view({
    name: "vault.summary",
    description: "No Vault for this person here: the sidebar has no row.",
    args: {},
    value: { state: "none", vaultId: null, personal: false, local: false, role: "member", autoLockMinutes: 5, locksAt: null, recoveryToSave: null, recoveryOutdated: false, accessReviewDue: false, custodiansNameCustodians: false, moreSections: [], passcodeLengths: [6, 8, 12] },
  }),
  "view.vault.items": view({ name: "vault.items", description: "Passwords & Credentials.", args: { vaultId: VAULT, section: "passwords" }, value: { items: VAULT_PASSWORDS, kinds: KINDS } }),
  "view.vault.items.files": view({ name: "vault.items", description: "Files & Notes at the top.", args: { vaultId: VAULT, section: "files", folderId: null }, value: { items: VAULT_FILES, kinds: KINDS } }),
  "view.vault.folders": view({ name: "vault.folders", description: "Folder names, opened on the device.", args: { vaultId: VAULT }, value: { folders: [{ id: "01JFOLDER00000000000000001", parentId: null, name: "Contracts", updatedAt: NOW - DAY }] } }),
  "view.vault.health": view({
    name: "vault.health",
    description: "Health: a weak password.",
    args: { vaultId: VAULT },
    value: { needsLook: 1, groups: [{ issue: "weak", title: "Weak", body: "Short or easy to guess. Generate a new one.", tone: "warning", items: [VAULT_PASSWORDS[2]!] }] },
  }),
  "view.vault.activity": view({
    name: "vault.activity",
    description: "The log, as a custodian reads it.",
    args: { vaultId: VAULT, event: "vault." },
    value: { everything: true, entries: [{ seq: 12, actorName: "Maya", label: "Unlocked the Vault", failed: false, reason: null, at: NOW - 60_000, detail: "custodian · Folevi for Mac on macOS · reported by the device" }] },
  }),
  "view.vault.people": view({
    name: "vault.people",
    description: "A team Vault's people.",
    args: { vaultId: VAULT },
    value: {
      people: [
        { profileId: "prof_1", name: "Faisal", email: "f@example.com", avatarUrl: null, role: "owner", isYou: true, status: "Can open it" },
        { profileId: "prof_2", name: "Maya", email: "maya@example.com", avatarUrl: null, role: "member", isYou: false, status: "Waiting for the key" },
      ],
      canAdd: true,
      canNameCustodians: true,
      onlyOneCustodian: true,
      candidates: [{ profileId: "prof_3", name: "Lee" }],
    },
  }),
  "view.vault.shares": view({
    name: "vault.shares",
    description: "Who an item is shared with, and its live links.",
    args: { vaultId: VAULT, itemId: VAULT_PASSWORDS[0]!.id },
    value: { people: [{ id: "01JSHARE000000000000000001", name: "Ana", email: "ana@example.com", canEdit: false, expired: false, expiresAt: NOW + 30 * DAY }], links: [{ id: "link_1", views: 0, maxViews: 1, expiresAt: NOW + DAY, hasPassword: false }] },
  }),

  "command.vault.setUp": command({ name: "vault.setUp", description: "Set up the Vault with a 6 digit PIN; the recovery key comes back once.", args: { passcode: "246813" }, result: { recoveryKey: "6PQY-C1ZS-MRVM-GR5F-XKDQ-TP1S-K12E-P020-F4YE" } }),
  "command.vault.unlock": command({ name: "vault.unlock", description: "Unlock with the passcode.", args: { vaultId: VAULT, passcode: "246813" }, result: { status: "ok", until: null, message: null } }),
  "command.vault.unlock.wrong": command({ name: "vault.unlock", description: "A wrong passcode.", args: { vaultId: VAULT, passcode: "000000" }, result: { status: "wrong", until: null, message: "That isn't right. Try again." } }),
  "command.vault.reset": command({ name: "vault.reset", description: "A forgotten passcode: the recovery key sets a new one and opens the Vault.", args: { vaultId: VAULT, recoveryKey: "6PQY-C1ZS-MRVM-GR5F-XKDQ-TP1S-K12E-P020-F4YE", passcode: "13572468" }, result: { status: "ok", until: null, message: null } }),
  "command.vault.finishPasscode": command({ name: "vault.finishPasscode", description: "Choose a passcode after a custodian shared the key.", args: { vaultId: VAULT, passcode: "246813" }, result: { status: "ok", until: null, message: null } }),
  "command.vault.changePasscode": command({ name: "vault.changePasscode", description: "A new passcode, proven by the current one.", args: { vaultId: VAULT, current: "246813", next: "13572468" }, result: { status: "ok", until: null, message: null } }),
  "command.vault.lock": command({ name: "vault.lock", description: "Lock now.", args: { vaultId: VAULT }, result: { ok: true } }),
  "command.vault.recoverySaved": command({ name: "vault.recoverySaved", description: "The recovery key was saved.", args: { vaultId: VAULT }, result: { ok: true } }),
  "command.vault.newRecoveryKey": command({ name: "vault.newRecoveryKey", description: "Make a new recovery key.", args: { vaultId: VAULT }, result: { recoveryKey: "Q2W8-ZK1M-4RTA-9PLX-HB7E-C3NV-55TY-JQ0D-MW2R" } }),
  "command.vault.requestReset": command({ name: "vault.requestReset", description: "Ask a custodian for the key again (team Vault).", args: { vaultId: VAULT }, result: { ok: true } }),
  "command.vault.record": command({ name: "vault.record", description: "A password revealed, for the log.", args: { vaultId: VAULT, event: "item.reveal", itemId: VAULT_PASSWORDS[0]!.id, field: "password" }, result: { ok: true } }),
  "command.vault.item.open": command({
    name: "vault.item.open",
    description: "An item, opened (logged).",
    args: { vaultId: VAULT, itemId: VAULT_PASSWORDS[0]!.id },
    result: {
      id: VAULT_PASSWORDS[0]!.id,
      kind: "login",
      kindLabel: "Login",
      title: "Bank of Kyoto",
      fields: [
        { key: "username", label: "Username", type: "text", value: "sam@example.com" },
        { key: "password", label: "Password", type: "secret", value: "made-up-for-the-fixture" },
        { key: "website", label: "Website", type: "url", value: "bank.example" },
        { key: "totp", label: "2FA secret", type: "totp", value: "" },
      ],
      notes: "Branch on High Street",
      canChange: true,
      revision: 2,
      createdBy: "Sam",
      updatedBy: "Sam",
      updatedAt: NOW - 3_600_000,
    },
  }),
  "command.vault.item.save": command({ name: "vault.item.save", description: "Add a login.", args: { vaultId: VAULT, kind: "login", title: "Mail", values: { username: "sam@example.com", password: "made-up-for-the-fixture" }, notes: "" }, result: { id: "01JITEM0000000000000000009" } }),
  "command.vault.item.duplicate": command({ name: "vault.item.duplicate", description: "Duplicate an item.", args: { vaultId: VAULT, itemId: VAULT_PASSWORDS[0]!.id }, result: { id: "01JITEM0000000000000000010" } }),
  "command.vault.item.remove": command({ name: "vault.item.remove", description: "To the Vault's Trash.", args: { vaultId: VAULT, itemId: VAULT_PASSWORDS[1]!.id }, result: { ok: true } }),
  "command.vault.item.restore": command({ name: "vault.item.restore", description: "Back from the Trash.", args: { vaultId: VAULT, itemId: VAULT_PASSWORDS[1]!.id }, result: { ok: true } }),
  "command.vault.item.history": command({ name: "vault.item.history", description: "Earlier versions (logged).", args: { vaultId: VAULT, itemId: VAULT_PASSWORDS[0]!.id }, result: { versions: [{ revision: 1, title: "Bank of Kyoto", editedBy: "Sam", editedAt: NOW - 3 * DAY, fields: [{ key: "username", label: "Username", type: "text", value: "sam@example.com" }] }] } }),
  "command.vault.item.restoreVersion": command({ name: "vault.item.restoreVersion", description: "Bring back version 1.", args: { vaultId: VAULT, itemId: VAULT_PASSWORDS[0]!.id, revision: 1 }, result: { ok: true } }),
  "command.vault.totp": command({ name: "vault.totp", description: "A 2FA code and its seconds left.", args: { secret: "JBSWY3DPEHPK3PXP" }, result: { code: "123456", secondsLeft: 17 } }),
  "command.vault.generate": command({ name: "vault.generate", description: "A memorable password.", args: { kind: "passphrase" }, result: { value: "orbit-lantern-cedar-mosaic-harbor" } }),
  "command.vault.strength": command({ name: "vault.strength", description: "How strong a password is.", args: { password: "abc" }, result: { score: 0, label: "Very weak" } }),
  "command.vault.folder.create": command({ name: "vault.folder.create", description: "A folder at the top.", args: { vaultId: VAULT, parentId: null, name: "Contracts" }, result: { id: "01JFOLDER00000000000000001" } }),
  "command.vault.note.create": command({ name: "vault.note.create", description: "A note in a folder.", args: { vaultId: VAULT, folderId: "01JFOLDER00000000000000001", title: "Safe deposit box" }, result: { id: VAULT_FILES[0]!.id } }),
  "command.vault.note.open": command({ name: "vault.note.open", description: "A note's text (logged).", args: { vaultId: VAULT, itemId: VAULT_FILES[0]!.id }, result: { id: VAULT_FILES[0]!.id, title: "Safe deposit box", text: "Box 4711 at the High Street branch", canChange: true, revision: 2 } }),
  "command.vault.note.save": command({ name: "vault.note.save", description: "Save a note.", args: { vaultId: VAULT, itemId: VAULT_FILES[0]!.id, revision: 2, text: "Box 4711 at the High Street branch\nKey in the blue envelope" }, result: { revision: 3 } }),
  "command.vault.file.upload": command({ name: "vault.file.upload", description: "A file, sealed by the engine before it goes anywhere.", args: { vaultId: VAULT, folderId: null, name: "notes.txt", mime: "text/plain", data: "SGVsbG8=" }, result: { id: "01JITEM0000000000000000011" } }),
  "command.vault.file.open": command({ name: "vault.file.open", description: "A file decrypted in memory for a preview (logged).", args: { vaultId: VAULT, itemId: "01JITEM0000000000000000011", purpose: "preview" }, result: { name: "notes.txt", mime: "text/plain", kind: "text", data: "SGVsbG8=" } }),
  "command.vault.trash.empty": command({ name: "vault.trash.empty", description: "Empty the Vault's Trash.", args: { vaultId: VAULT }, result: { removed: 2 } }),
  "command.vault.settings.update": command({ name: "vault.settings.update", description: "Lock after 10 idle minutes.", args: { vaultId: VAULT, autoLockMinutes: 10 }, result: { ok: true } }),
  "command.vault.people.add": command({ name: "vault.people.add", description: "Add a workspace member.", args: { vaultId: VAULT, profileId: "prof_3" }, result: { ok: true } }),
  "command.vault.people.remove": command({ name: "vault.people.remove", description: "Remove someone.", args: { vaultId: VAULT, profileId: "prof_2" }, result: { ok: true } }),
  "command.vault.people.setRole": command({ name: "vault.people.setRole", description: "Make someone a custodian.", args: { vaultId: VAULT, profileId: "prof_2", role: "custodian" }, result: { ok: true } }),
  "command.vault.people.reviewed": command({ name: "vault.people.reviewed", description: "Everyone here should have access.", args: { vaultId: VAULT }, result: { ok: true } }),
  "command.vault.share.person": command({ name: "vault.share.person", description: "Share an item with someone outside the workspace for 30 days.", args: { vaultId: VAULT, itemId: VAULT_PASSWORDS[0]!.id, email: "ana@example.com", days: 30, canEdit: false }, result: { status: "shared", message: "Shared with Ana until 26/11/2026, 09:30:00" } }),
  "command.vault.share.stop": command({ name: "vault.share.stop", description: "Stop sharing.", args: { vaultId: VAULT, itemId: VAULT_PASSWORDS[0]!.id, shareId: "01JSHARE000000000000000001" }, result: { ok: true } }),
  "command.vault.link.create": command({ name: "vault.link.create", description: "A one-time link that works once for a day.", args: { vaultId: VAULT, itemId: VAULT_PASSWORDS[0]!.id, maxViews: 1, lastsMs: DAY }, result: { url: "https://app.folevi.com/v/link_1#made-up" } }),
  "command.vault.link.revoke": command({ name: "vault.link.revoke", description: "End a link.", args: { vaultId: VAULT, linkId: "link_1" }, result: { ok: true } }),
};
