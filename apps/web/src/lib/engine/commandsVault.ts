// Revision 18's commands: the Vault (lib/engine/vault.ts). Each does what the web's screen does (components/vault/*):
// the same server calls (or, in a library, the device's own), sealed and opened here with lib/vault/*, logged as the
// web logs them. What an item holds is kept in this page's memory while it's open (to save it again under the same
// item key), and dropped when the Vault locks.
import { api } from "@/lib/convex/api";
import { APP_URL } from "@/lib/env";
import { ensureEncryptionAccount } from "@/components/vault/useVault";
import { vaultSessions } from "@/lib/vault/keys";
import { changedFields, ITEM_KINDS, newItemId, openSecrets, openSummary, sealItem, splitItem, type ItemContent, type ItemKind, type ItemSecrets, type ItemSummary } from "@/lib/vault/items";
import { fetchCiphertext, openFile, openNote, openNoteSummary, sealFile, sealFolderName, sealNote, sendCiphertext } from "@/lib/vault/files";
import { passphrase, passwordStrength, randomPassword } from "@/lib/vault/generator";
import { breachStatus } from "@/lib/vault/breach";
import { parseTotp, totpCode } from "@/lib/vault/totp";
import { checkedRecipient, makeLink, sealItemTo } from "@/lib/vault/shares";
import { DEVICE_EVENTS_FOR_UI } from "@/components/vault/events";
import type { CommandDef } from "./commands";
import { BridgeError, bool, id, nullableId, num, oneOf, only, text } from "./validate";
import type { CommandName, VaultFieldValue, VaultFileValue, VaultItemValue, VaultUnlockResult } from "./protocol";
import { bindVault, fromBeforePins, isLocal, kindLabel, scopeArgs, unlockResult, type VaultInfo } from "./vault";

type Args = Record<string, unknown>;
type Opened = { id: string; kind: string; keyVersion: number; wrappedKey: ArrayBuffer; sealedSummary: ArrayBuffer; sealed: ArrayBuffer; revision: number; canChange: boolean; createdBy: { name: string }; updatedBy: { name: string }; updatedAt: number };

const s = () => vaultSessions();
const vaultIdOf = (args: Args) => text(args, "vaultId", { max: 64 }) as string;

function needOpen(vaultId: string) {
  if (!s().isOpen(vaultId)) throw new BridgeError("locked", "The Vault is locked. Unlock it first.");
  s().touch(vaultId);
  return (v: number) => s().keys(vaultId, v);
}

/** What was opened, by item (to save again under the same key, to share). Forgotten when the Vault locks. */
const held = new Map<string, { vaultId: string; row: Opened; content: ItemContent | null }>();
let watching = false;
function hold(vaultId: string, row: Opened, content: ItemContent | null) {
  if (!watching) {
    watching = true;
    s().subscribe(() => {
      for (const [k, v] of held) if (!s().isOpen(v.vaultId)) held.delete(k);
    });
  }
  held.set(row.id, { vaultId, row, content });
}

async function openItem(deps: Parameters<CommandDef["run"]>[0], vaultId: string, itemId: string) {
  const keys = needOpen(vaultId);
  const r = (await deps.client.mutation(api.vaultItems.open, { vaultId, itemId, client: s().info(vaultId) })) as Opened;
  return { r, keys };
}

async function openPassword(deps: Parameters<CommandDef["run"]>[0], vaultId: string, itemId: string) {
  const { r, keys } = await openItem(deps, vaultId, itemId);
  const summary = await openSummary(vaultId, r, keys);
  const secrets = await openSecrets(vaultId, r, keys);
  const content: ItemContent = { kind: summary.kind, summary, secrets };
  hold(vaultId, r, content);
  return { r, content };
}

function fieldsOf(kind: string, summary: ItemSummary, secrets: ItemSecrets): VaultFieldValue[] {
  const def = ITEM_KINDS[kind as ItemKind];
  const out: VaultFieldValue[] = (def?.fields ?? []).map((f) => ({ key: f.key, label: f.label, type: f.type, value: summary.fields[f.key] ?? secrets.fields[f.key] ?? "" }));
  secrets.custom.forEach((c, i) => out.push({ key: `custom:${i}`, label: c.label, type: c.type, value: c.value }));
  return out;
}

const record = (deps: Parameters<CommandDef["run"]>[0], vaultId: string, event: string, item?: { id: string; kind: string }, detail?: Record<string, string>) =>
  deps.client.mutation(api.vaultLog.record, { vaultId, event, ...(item ? { itemId: item.id, itemKind: item.kind } : {}), ...(detail ? { detail } : {}), client: s().info(vaultId) }).catch(() => undefined);

/** Once a Vault opens: the open for the log, and a custodian's chores (the web's VaultView does the same). */
async function afterOpen(deps: Parameters<CommandDef["run"]>[0], vaultId: string) {
  await record(deps, vaultId, "vault.open");
  if (isLocal(deps)) return;
  const info = (await deps.client.query(api.vault.get, { scope: deps.app.spaces.find((x) => x.id === deps.app.space)?.scope ?? { kind: "personal" } }).catch(() => null)) as VaultInfo;
  if (!info || info.role === "member") return;
  if (info.rotationNeeded) await s().rotate(vaultId).catch(() => false);
  await s().grantWaiting(vaultId).catch(() => 0);
}

// ---- notes as text (the editor's document, read and written as paragraphs on the Mac) ----

type PmNode = { type?: string; text?: string; content?: PmNode[] };
function docText(doc: unknown): string {
  const lines: string[] = [];
  const inline = (n: PmNode): string => (n.type === "text" ? (n.text ?? "") : n.type === "hardBreak" ? "\n" : (n.content ?? []).map(inline).join(""));
  const walk = (n: PmNode) => {
    if (!n || typeof n !== "object") return;
    const kids = n.content ?? [];
    if (kids.some((k) => k.type === "text" || k.type === "hardBreak") || (n.type === "paragraph" && !kids.length) || n.type === "heading") lines.push(inline(n));
    else kids.forEach(walk);
  };
  walk(doc as PmNode);
  return lines.join("\n");
}
const textDoc = (t: string) => ({ type: "doc", content: t.split("\n").map((line) => (line ? { type: "paragraph", content: [{ type: "text", text: line }] } : { type: "paragraph" })) });

// ---- files ----

const TEXT_EXT = /\.(txt|md|markdown|log|json|ya?ml|toml|ini|env|xml|html?|css|scss|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|zsh|bash|sql|graphql|conf|pem|pub|key|crt)$/i;
/** How a file is shown (components/vault/FilePreview.tsx kindOf). */
export function fileKind(name: string, mime: string): string {
  if (/^image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml|heic)$/.test(mime) || /\.(png|jpe?g|gif|webp|avif|bmp|svg|heic)$/i.test(name)) return "image";
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (mime === "text/csv" || /\.csv$/i.test(name)) return "csv";
  if (mime.startsWith("audio/") || /\.(mp3|m4a|wav|ogg|oga|flac|aac)$/i.test(name)) return "audio";
  if (mime.startsWith("video/") || /\.(mp4|m4v|webm|mov|ogv)$/i.test(name)) return "video";
  if (mime.startsWith("text/") || /^application\/(json|xml|x-yaml|yaml|toml|javascript|x-sh|sql)$/.test(mime) || TEXT_EXT.test(name)) return "text";
  return "other";
}

function toBase64(b: Uint8Array): string {
  let out = "";
  for (let i = 0; i < b.length; i += 0x8000) out += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(out);
}
function fromBase64(t: string): Uint8Array {
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A Vault file's limit, as for any attachment. */
const MAX_FILE = 50 * 1024 * 1024;

export const VAULT_COMMANDS = {
  "vault.setUp": {
    async run(deps, args) {
      only(args, ["passcode", "space"]);
      const passcode = text(args, "passcode", { max: 12 }) as string;
      bindVault(deps);
      const scope = scopeArgs(deps, text(args, "space", { max: 200, optional: true }));
      if (!isLocal(deps)) {
        await ensureEncryptionAccount(deps.client, deps.app.profile.id);
        bindVault(deps);
      }
      const info = (await deps.client.query(api.vault.get, scope)) as VaultInfo;
      if (info === null) throw new BridgeError("forbidden", "Only the owner can set up this Vault.");
      const vaultId = info.exists && info.id ? info.id : ((await deps.client.mutation(api.vault.create, { ...scope, client: s().info() })) as { id: string }).id;
      const { recoveryText } = await s().setUp(vaultId, passcode);
      await record(deps, vaultId, "vault.open");
      return { recoveryKey: recoveryText };
    },
  },

  "vault.unlock": {
    async run(deps, args): Promise<VaultUnlockResult> {
      only(args, ["vaultId", "passcode"]);
      const vaultId = vaultIdOf(args);
      const passcode = text(args, "passcode", { max: 200 }) as string;
      bindVault(deps);
      // A passcode from before PINs: native asks for a PIN, then vault.changePasscode switches with the old one.
      if (fromBeforePins(passcode)) return { status: "oldPasscode", until: null, message: null };
      const r = unlockResult(await s().unlock(vaultId, { passcode }));
      if (r.status === "ok") await afterOpen(deps, vaultId);
      return r;
    },
  },

  "vault.reset": {
    async run(deps, args): Promise<VaultUnlockResult> {
      only(args, ["vaultId", "recoveryKey", "passcode"]);
      const vaultId = vaultIdOf(args);
      bindVault(deps);
      const r = unlockResult(await s().changePasscode(vaultId, { recoveryText: text(args, "recoveryKey", { max: 400 }) as string }, text(args, "passcode", { max: 12 }) as string));
      if (r.status === "ok") await afterOpen(deps, vaultId);
      return r;
    },
  },

  "vault.finishPasscode": {
    async run(deps, args): Promise<VaultUnlockResult> {
      only(args, ["vaultId", "passcode"]);
      const vaultId = vaultIdOf(args);
      bindVault(deps);
      if (!isLocal(deps)) {
        await ensureEncryptionAccount(deps.client, deps.app.profile.id);
        bindVault(deps);
      }
      const r = unlockResult(await s().finishWithPasscode(vaultId, text(args, "passcode", { max: 12 }) as string));
      if (r.status === "ok") await afterOpen(deps, vaultId);
      return r;
    },
  },

  "vault.changePasscode": {
    async run(deps, args): Promise<VaultUnlockResult> {
      only(args, ["vaultId", "current", "next"]);
      const vaultId = vaultIdOf(args);
      bindVault(deps);
      const wasOpen = s().isOpen(vaultId);
      const r = unlockResult(await s().changePasscode(vaultId, { passcode: text(args, "current", { max: 200 }) as string }, text(args, "next", { max: 12 }) as string));
      if (r.status === "wrong") return { ...r, message: wasOpen ? "Your current passcode isn't right." : "That isn't right. Try again." };
      if (r.status === "ok" && !wasOpen) await afterOpen(deps, vaultId);
      return r;
    },
  },

  "vault.lock": {
    async run(_deps, args) {
      only(args, ["vaultId"]);
      await s().lock(vaultIdOf(args), "manual");
      return { ok: true };
    },
  },

  "vault.recoverySaved": {
    async run(_deps, args) {
      only(args, ["vaultId"]);
      s().recoverySaved(vaultIdOf(args));
      return { ok: true };
    },
  },

  "vault.newRecoveryKey": {
    async run(_deps, args) {
      only(args, ["vaultId"]);
      const vaultId = vaultIdOf(args);
      needOpen(vaultId);
      return { recoveryKey: (await s().newRecoveryKey(vaultId)).recoveryText };
    },
  },

  "vault.requestReset": {
    async run(deps, args) {
      only(args, ["vaultId"]);
      if (isLocal(deps)) throw new BridgeError("unavailable", "A Vault on this device opens only with your passcode or your recovery key.");
      await deps.client.mutation(api.vaultKeys.requestReset, { vaultId: vaultIdOf(args), client: s().info() });
      return { ok: true };
    },
  },

  "vault.record": {
    async run(deps, args) {
      only(args, ["vaultId", "event", "itemId", "field"]);
      const vaultId = vaultIdOf(args);
      const event = text(args, "event", { max: 40 }) as string;
      if (!(DEVICE_EVENTS_FOR_UI as readonly string[]).includes(event)) throw new BridgeError("invalid_args", "Not an event the device reports.");
      const itemId = args.itemId === undefined ? undefined : id(args, "itemId");
      const field = text(args, "field", { max: 60, optional: true });
      s().touch(vaultId);
      const kind = itemId ? (held.get(itemId)?.row.kind ?? "item") : undefined;
      await record(deps, vaultId, event, itemId ? { id: itemId, kind: kind! } : undefined, field ? (event === "section.open" ? { section: field } : { field }) : undefined);
      return { ok: true };
    },
  },

  "vault.item.open": {
    async run(deps, args): Promise<VaultItemValue> {
      only(args, ["vaultId", "itemId"]);
      const vaultId = vaultIdOf(args);
      const { r, content } = await openPassword(deps, vaultId, id(args, "itemId"));
      return { id: r.id, kind: content.kind, kindLabel: kindLabel(content.kind), title: content.summary.title, fields: fieldsOf(content.kind, content.summary, content.secrets), notes: content.secrets.notes, canChange: r.canChange, revision: r.revision, createdBy: r.createdBy.name, updatedBy: r.updatedBy.name, updatedAt: r.updatedAt };
    },
  },

  "vault.item.save": {
    async run(deps, args) {
      only(args, ["vaultId", "itemId", "kind", "title", "values", "notes"]);
      const vaultId = vaultIdOf(args);
      const keys = needOpen(vaultId);
      const kind = oneOf(args, "kind", Object.keys(ITEM_KINDS) as ItemKind[]);
      const title = (text(args, "title", { max: 300 }) as string).trim();
      if (!title) throw new BridgeError("invalid_args", "Give it a title.");
      const raw = args.values;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BridgeError("invalid_args", "values must be an object.");
      const values: Record<string, string> = {};
      for (const f of ITEM_KINDS[kind].fields) {
        const v = (raw as Record<string, unknown>)[f.key];
        if (v !== undefined && typeof v !== "string") throw new BridgeError("invalid_args", `${f.key} must be text.`);
        if (typeof v === "string") values[f.key] = v.slice(0, 20_000);
      }
      const notes = text(args, "notes", { max: 20_000, allowEmpty: true }) ?? "";
      const itemId = args.itemId === undefined ? undefined : id(args, "itemId");
      const existing = itemId ? (held.get(itemId) ?? (await openPassword(deps, vaultId, itemId), held.get(itemId))!) : null;
      const content = splitItem(kind, title, values, notes, existing?.content?.secrets.custom ?? [], existing?.content?.summary.tags ?? []);
      const pw = content.secrets.fields.password;
      if (pw) content.summary.health = { strength: passwordStrength(pw).score, breached: await breachStatus(pw, (prefix) => deps.client.action(api.vaultItems.breachRange, { prefix }) as Promise<string[]>), checkedAt: Date.now() };
      const version = s().currentVersion(vaultId)!;
      if (existing) {
        const sealed = await sealItem(vaultId, existing.row.id, version, s().keys(vaultId), content, { keyVersion: existing.row.keyVersion, wrappedKey: existing.row.wrappedKey, keys: keys(existing.row.keyVersion) });
        const r = (await deps.client.mutation(api.vaultItems.update, { vaultId, itemId: existing.row.id, baseRevision: existing.row.revision, item: sealed, changed: existing.content ? changedFields(existing.content, content) : [], client: s().info(vaultId) })) as { revision: number };
        hold(vaultId, { ...existing.row, ...sealed, revision: r.revision }, content);
        return { id: existing.row.id };
      }
      const newId = newItemId();
      await deps.client.mutation(api.vaultItems.create, { vaultId, itemId: newId, kind, item: await sealItem(vaultId, newId, version, s().keys(vaultId), content), client: s().info(vaultId) });
      return { id: newId };
    },
  },

  "vault.item.duplicate": {
    async run(deps, args) {
      only(args, ["vaultId", "itemId"]);
      const vaultId = vaultIdOf(args);
      const from = id(args, "itemId");
      const { content } = await openPassword(deps, vaultId, from);
      const newId = newItemId();
      const copy: ItemContent = { ...content, summary: { ...content.summary, title: `${content.summary.title} (copy)` } };
      await deps.client.mutation(api.vaultItems.create, { vaultId, itemId: newId, kind: content.kind, item: await sealItem(vaultId, newId, s().currentVersion(vaultId)!, s().keys(vaultId), copy), duplicateOf: from, client: s().info(vaultId) });
      return { id: newId };
    },
  },

  "vault.item.remove": {
    async run(deps, args) {
      only(args, ["vaultId", "itemId"]);
      const vaultId = vaultIdOf(args);
      needOpen(vaultId);
      await deps.client.mutation(api.vaultItems.remove, { vaultId, itemId: id(args, "itemId"), client: s().info(vaultId) });
      return { ok: true };
    },
  },

  "vault.item.restore": {
    async run(deps, args) {
      only(args, ["vaultId", "itemId"]);
      const vaultId = vaultIdOf(args);
      needOpen(vaultId);
      await deps.client.mutation(api.vaultItems.restore, { vaultId, itemId: id(args, "itemId"), client: s().info(vaultId) });
      return { ok: true };
    },
  },

  "vault.item.history": {
    async run(deps, args) {
      only(args, ["vaultId", "itemId"]);
      const vaultId = vaultIdOf(args);
      const keys = needOpen(vaultId);
      const itemId = id(args, "itemId");
      const rows = (await deps.client.mutation(api.vaultItems.history, { vaultId, itemId, client: s().info(vaultId) })) as { revision: number; sealedSummary: ArrayBuffer; sealed: ArrayBuffer; wrappedKey: ArrayBuffer; keyVersion: number; editedBy: string; editedAt: number }[];
      const versions = await Promise.all(
        rows.map(async (v) => {
          const row = { id: itemId, ...v };
          const summary = await openSummary(vaultId, row, keys).catch(() => null);
          const secrets = await openSecrets(vaultId, row, keys).catch(() => null);
          return { revision: v.revision, title: summary?.title ?? "Can't open this version", editedBy: v.editedBy, editedAt: v.editedAt, fields: summary && secrets ? fieldsOf(summary.kind, summary, secrets).filter((f) => f.value && !f.key.startsWith("custom:")) : [] };
        }),
      );
      return { versions };
    },
  },

  "vault.item.restoreVersion": {
    async run(deps, args) {
      only(args, ["vaultId", "itemId", "revision"]);
      const vaultId = vaultIdOf(args);
      needOpen(vaultId);
      await deps.client.mutation(api.vaultItems.restoreVersion, { vaultId, itemId: id(args, "itemId"), revision: num(args, "revision", { min: 1 }), client: s().info(vaultId) });
      return { ok: true };
    },
  },

  "vault.totp": {
    async run(_deps, args) {
      only(args, ["secret"]);
      const p = parseTotp(text(args, "secret", { max: 2000 }) as string);
      if (!p) return { code: null, secondsLeft: 0 };
      const c = await totpCode(p);
      return { code: c.code, secondsLeft: c.secondsLeft };
    },
  },

  "vault.generate": {
    async run(_deps, args) {
      only(args, ["kind"]);
      return { value: oneOf(args, "kind", ["password", "passphrase"] as const) === "password" ? randomPassword() : passphrase() };
    },
  },

  "vault.strength": {
    async run(_deps, args) {
      only(args, ["password"]);
      const st = passwordStrength(text(args, "password", { max: 20_000, allowEmpty: true }) ?? "");
      return { score: st.score, label: st.label };
    },
  },

  "vault.folder.create": {
    async run(deps, args) {
      only(args, ["vaultId", "parentId", "name"]);
      const vaultId = vaultIdOf(args);
      needOpen(vaultId);
      const parentId = nullableId(args, "parentId") ?? null;
      const folderId = newItemId();
      const version = s().currentVersion(vaultId)!;
      await deps.client.mutation(api.vaultFiles.createFolder, { vaultId, folderId, ...(parentId ? { parentId } : {}), sealedName: await sealFolderName(vaultId, folderId, version, s().keys(vaultId), text(args, "name", { max: 200 }) as string), keyVersion: version, client: s().info(vaultId) });
      return { id: folderId };
    },
  },

  "vault.note.create": {
    async run(deps, args) {
      only(args, ["vaultId", "folderId", "title"]);
      const vaultId = vaultIdOf(args);
      needOpen(vaultId);
      const folderId = nullableId(args, "folderId") ?? null;
      const itemId = newItemId();
      const item = await sealNote(vaultId, itemId, s().currentVersion(vaultId)!, s().keys(vaultId), text(args, "title", { max: 300, allowEmpty: true }) ?? "", { type: "doc", content: [{ type: "paragraph" }] }, "");
      await deps.client.mutation(api.vaultFiles.createNote, { vaultId, itemId, ...(folderId ? { folderId } : {}), item, client: s().info(vaultId) });
      return { id: itemId };
    },
  },

  "vault.note.open": {
    async run(deps, args) {
      only(args, ["vaultId", "itemId"]);
      const vaultId = vaultIdOf(args);
      const { r, keys } = await openItem(deps, vaultId, id(args, "itemId"));
      const summary = await openNoteSummary(vaultId, r, keys);
      const c = await openNote(vaultId, r, keys);
      hold(vaultId, r, null);
      return { id: r.id, title: summary.title, text: docText(c.doc), canChange: r.canChange, revision: r.revision };
    },
  },

  "vault.note.save": {
    async run(deps, args) {
      only(args, ["vaultId", "itemId", "revision", "text"]);
      const vaultId = vaultIdOf(args);
      const keys = needOpen(vaultId);
      const itemId = id(args, "itemId");
      const body = text(args, "text", { max: 200_000, allowEmpty: true }) ?? "";
      const h = held.get(itemId);
      const title = h ? (await openNoteSummary(vaultId, h.row, keys)).title : "Untitled";
      const keep = h ? { keyVersion: h.row.keyVersion, wrappedKey: h.row.wrappedKey, keys: keys(h.row.keyVersion) } : undefined;
      const item = await sealNote(vaultId, itemId, s().currentVersion(vaultId)!, s().keys(vaultId), title, textDoc(body), body.replace(/\s+/g, " ").trim().slice(0, 160), keep);
      const r = (await deps.client.mutation(api.vaultFiles.saveNote, { vaultId, itemId, baseRevision: num(args, "revision", { min: 1 }), item, client: s().info(vaultId) })) as { revision: number };
      if (h) hold(vaultId, { ...h.row, ...item, revision: r.revision }, null);
      return { revision: r.revision };
    },
  },

  "vault.file.upload": {
    async run(deps, args) {
      only(args, ["vaultId", "folderId", "name", "mime", "data"]);
      const vaultId = vaultIdOf(args);
      needOpen(vaultId);
      const folderId = nullableId(args, "folderId") ?? null;
      const bytes = fromBase64(text(args, "data", { max: Math.ceil((MAX_FILE * 4) / 3) + 8, allowEmpty: true }) ?? "");
      if (bytes.length > MAX_FILE) throw new BridgeError("invalid_args", "Files up to 50 MB go in the Vault.");
      const itemId = newItemId();
      const { ciphertext, item } = await sealFile(vaultId, itemId, s().currentVersion(vaultId)!, s().keys(vaultId), { name: text(args, "name", { max: 300 }) as string, type: text(args, "mime", { max: 200, allowEmpty: true }) ?? "", bytes });
      const storageId = await sendCiphertext((await deps.client.mutation(api.vaultFiles.uploadUrl, { vaultId })) as string, ciphertext);
      await deps.client.mutation(api.vaultFiles.saveFile, { vaultId, itemId, ...(folderId ? { folderId } : {}), storageId, size: ciphertext.length, item, client: s().info(vaultId) });
      return { id: itemId };
    },
  },

  "vault.file.open": {
    async run(deps, args): Promise<VaultFileValue> {
      only(args, ["vaultId", "itemId", "purpose"]);
      const vaultId = vaultIdOf(args);
      const keys = needOpen(vaultId);
      const itemId = id(args, "itemId");
      const purpose = oneOf(args, "purpose", ["preview", "download"] as const);
      const r = (await deps.client.mutation(api.vaultFiles.fileUrl, { vaultId, itemId, purpose, client: s().info(vaultId) })) as { url: string; sealed: ArrayBuffer; wrappedKey: ArrayBuffer; keyVersion: number };
      const f = await openFile(vaultId, { id: itemId, keyVersion: r.keyVersion, wrappedKey: r.wrappedKey, sealed: r.sealed }, await fetchCiphertext(r.url), keys);
      if (purpose === "preview") await record(deps, vaultId, "file.preview", { id: itemId, kind: "file" });
      return { name: f.name, mime: f.mime, kind: fileKind(f.name, f.mime), data: toBase64(f.bytes) };
    },
  },

  "vault.trash.empty": {
    async run(deps, args) {
      only(args, ["vaultId"]);
      const vaultId = vaultIdOf(args);
      needOpen(vaultId);
      return (await deps.client.mutation(api.vaultFiles.emptyTrash, { vaultId, client: s().info(vaultId) })) as { removed: number };
    },
  },

  "vault.settings.update": {
    async run(deps, args) {
      only(args, ["vaultId", "autoLockMinutes", "custodiansNameCustodians"]);
      const vaultId = vaultIdOf(args);
      needOpen(vaultId);
      await deps.client.mutation(api.vault.updateSettings, {
        vaultId,
        ...(args.autoLockMinutes !== undefined ? { autoLockMinutes: num(args, "autoLockMinutes", { min: 1, max: 30 }) } : {}),
        ...(args.custodiansNameCustodians !== undefined ? { custodiansNameCustodians: bool(args, "custodiansNameCustodians") } : {}),
        client: s().info(vaultId),
      });
      return { ok: true };
    },
  },

  "vault.people.add": {
    async run(deps, args) {
      only(args, ["vaultId", "profileId"]);
      const vaultId = vaultIdOf(args);
      await deps.client.mutation(api.vaultPeople.add, { vaultId, profileId: id(args, "profileId"), role: "member", client: s().info(vaultId) });
      return { ok: true };
    },
  },

  "vault.people.remove": {
    async run(deps, args) {
      only(args, ["vaultId", "profileId"]);
      const vaultId = vaultIdOf(args);
      await deps.client.mutation(api.vaultPeople.remove, { vaultId, profileId: id(args, "profileId"), client: s().info(vaultId) });
      return { ok: true };
    },
  },

  "vault.people.setRole": {
    async run(deps, args) {
      only(args, ["vaultId", "profileId", "role"]);
      const vaultId = vaultIdOf(args);
      await deps.client.mutation(api.vaultPeople.setRole, { vaultId, profileId: id(args, "profileId"), role: oneOf(args, "role", ["custodian", "member"] as const), client: s().info(vaultId) });
      return { ok: true };
    },
  },

  "vault.people.reviewed": {
    async run(deps, args) {
      only(args, ["vaultId"]);
      const vaultId = vaultIdOf(args);
      await deps.client.mutation(api.vaultPeople.reviewed, { vaultId, client: s().info(vaultId) });
      return { ok: true };
    },
  },

  "vault.share.person": {
    async run(deps, args) {
      only(args, ["vaultId", "itemId", "email", "days", "canEdit"]);
      if (isLocal(deps)) throw new BridgeError("unavailable", "Sign in to Folevi to share and collaborate");
      const vaultId = vaultIdOf(args);
      const keys = needOpen(vaultId);
      const itemId = id(args, "itemId");
      const email = (text(args, "email", { max: 320 }) as string).trim();
      const days = num(args, "days", { min: 1, max: 365 });
      const h = held.get(itemId) ?? (await openItem(deps, vaultId, itemId).then(({ r }) => (hold(vaultId, r, null), held.get(itemId))))!;
      const found = (await deps.client.mutation(api.vaultShares.findPerson, { vaultId, itemId, email })) as null | { name: string; inVault: boolean; outside: boolean; profileId: string; epoch: number; x25519Pub: ArrayBuffer; ed25519Pub: ArrayBuffer; statement: unknown };
      if (!found) return { status: "notFound", message: "Nobody with that email can receive it yet. They need a Folevi account with encryption set up." };
      if (found.inVault) return { status: "inVault", message: `${found.name} is in the Vault already.` };
      const to = await checkedRecipient(found);
      if (!to) return { status: "unchecked", message: `${found.name}'s encryption key couldn't be checked, so nothing was shared.` };
      const wrappedKey = await sealItemTo(vaultId, h.row, keys(h.row.keyVersion), to);
      const r = (await deps.client.mutation(api.vaultShares.share, { vaultId, itemId, shareId: newItemId(), profileId: to.profileId, canEdit: h.row.kind === "note" && bool(args, "canEdit"), wrappedKey, epoch: to.epoch, ...(found.outside ? { expiresAt: Date.now() + days * 86_400_000 } : {}), client: s().info(vaultId) })) as { expiresAt?: number | null };
      return { status: "shared", message: r.expiresAt ? `Shared with ${found.name} until ${new Date(r.expiresAt).toLocaleString()}` : `Shared with ${found.name}` };
    },
  },

  "vault.share.stop": {
    async run(deps, args) {
      only(args, ["vaultId", "itemId", "shareId"]);
      const vaultId = vaultIdOf(args);
      needOpen(vaultId);
      const itemId = id(args, "itemId");
      const shareId = id(args, "shareId");
      await deps.client.mutation(api.vaultShares.unshare, { vaultId, shareId, client: s().info(vaultId) });
      // A new item key when nobody else holds the old one (another share, a live link), as the web does.
      const shares = (await deps.client.query(api.vaultShares.ofItem, { vaultId, itemId })) as { people: { id: string; expired: boolean }[]; links: { endedHow?: string | null }[] };
      const others = shares.people.filter((p) => p.id !== shareId && !p.expired).length + shares.links.filter((l) => !l.endedHow).length;
      if (!others) {
        const { r, content } = await openPassword(deps, vaultId, itemId).catch(() => ({ r: null, content: null }));
        if (r && content && r.kind !== "note" && r.kind !== "file") await deps.client.mutation(api.vaultItems.update, { vaultId, itemId, baseRevision: r.revision, item: await sealItem(vaultId, itemId, s().currentVersion(vaultId)!, s().keys(vaultId), content), changed: [], client: s().info(vaultId) });
      }
      return { ok: true };
    },
  },

  "vault.link.create": {
    async run(deps, args) {
      only(args, ["vaultId", "itemId", "maxViews", "lastsMs", "password"]);
      if (isLocal(deps)) throw new BridgeError("unavailable", "Sign in to Folevi to share and collaborate");
      const vaultId = vaultIdOf(args);
      const keys = needOpen(vaultId);
      const itemId = id(args, "itemId");
      const password = text(args, "password", { max: 200, optional: true, allowEmpty: true }) || undefined;
      if (password && password.length < 5) throw new BridgeError("invalid_args", "A link's password has at least 5 characters.");
      const h = held.get(itemId) ?? (await openItem(deps, vaultId, itemId).then(({ r }) => (hold(vaultId, r, null), held.get(itemId))))!;
      const link = await makeLink(vaultId, h.row, keys(h.row.keyVersion), APP_URL);
      await deps.client.mutation(api.vaultShares.createLink, { vaultId, itemId, linkId: link.linkId, wrappedKey: link.wrappedKey, maxViews: num(args, "maxViews", { min: 1, max: 10 }), expiresInMs: num(args, "lastsMs", { min: 3_600_000, max: 30 * 86_400_000 }), ...(password ? { password } : {}), client: s().info(vaultId) });
      return { url: link.url };
    },
  },

  "vault.link.revoke": {
    async run(deps, args) {
      only(args, ["vaultId", "linkId"]);
      const vaultId = vaultIdOf(args);
      await deps.client.mutation(api.vaultShares.revokeLink, { vaultId, linkId: text(args, "linkId", { max: 64 }) as string, client: s().info(vaultId) });
      return { ok: true };
    },
  },
} satisfies Partial<Record<CommandName, CommandDef>>;
