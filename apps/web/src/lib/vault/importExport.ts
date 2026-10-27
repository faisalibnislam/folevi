// Importing passwords from other apps' exports and exporting the Vault's (docs/VAULT_PLAN.md §4), all on the device.
// Imports read CSV from 1Password, Bitwarden, LastPass, Chrome, Safari and Firefox, recognised by their columns.
// Exports are an encrypted backup (a passphrase the exporter chooses, Argon2id) or, after a warning, plain CSV.
import { openRecord, passphraseKdfBytes, randomBytes, sealRecord, vaultCtx, hkdf, importAead, toBase64Url, fromBase64Url } from "@folevi/local-store/e2ee";
import { splitItem, type ItemContent, type ItemKind } from "./items";

/** RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

export type ImportSource = "1Password" | "Bitwarden" | "LastPass" | "Chrome" | "Safari" | "Firefox" | "CSV";

/** Which app made a CSV, from its header row. */
export function detectSource(header: string[]): ImportSource {
  const h = header.map((x) => x.trim().toLowerCase());
  const has = (...names: string[]) => names.every((n) => h.includes(n));
  if (has("login_uri", "login_username", "login_password")) return "Bitwarden";
  if (has("url", "username", "password", "extra", "grouping")) return "LastPass";
  if (has("url", "username", "password", "httprealm")) return "Firefox";
  if (has("title", "url", "username", "password", "otpauth") && h.includes("favorite")) return "1Password";
  if (has("title", "url", "username", "password")) return "Safari";
  if (has("name", "url", "username", "password")) return "Chrome";
  return "CSV";
}

/** Reads one export into items (logins and secure notes), skipping rows with nothing in them. */
export function itemsFromCsv(text: string): { source: ImportSource; items: ItemContent[]; skipped: number } {
  const rows = parseCsv(text);
  if (!rows.length) return { source: "CSV", items: [], skipped: 0 };
  const header = rows[0]!.map((x) => x.trim().toLowerCase());
  const source = detectSource(rows[0]!);
  const col = (r: string[], ...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0 && r[i]?.trim()) return r[i]!.trim();
    }
    return "";
  };
  const items: ItemContent[] = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const title = col(r, "title", "name");
    const url = col(r, "url", "login_uri", "website");
    const username = col(r, "username", "login_username", "user");
    const password = col(r, "password", "login_password");
    const totp = col(r, "otpauth", "login_totp", "totp");
    const notes = col(r, "notes", "note", "extra");
    const tags = col(r, "tags", "grouping", "folder");
    const isNote = (source === "Bitwarden" && col(r, "type") === "note") || (source === "LastPass" && url === "http://sn");
    if (!title && !url && !username && !password && !notes) {
      skipped++;
      continue;
    }
    const kind: ItemKind = isNote ? "secureNote" : "login";
    const name = title || hostOf(url) || username || "Imported item";
    items.push(
      isNote
        ? splitItem(kind, name, { text: notes }, "", [], tags ? [tags] : [])
        : splitItem(kind, name, { username, password, website: url, totp }, notes, [], tags ? [tags] : []),
    );
  }
  return { source, items, skipped };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const csvCell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Plain CSV of the items (title, kind, every field, notes): readable by anyone who gets the file. */
export function itemsToCsv(items: (ItemContent & { id?: string })[]): string {
  const keys = new Set<string>();
  for (const i of items) for (const k of [...Object.keys(i.summary.fields), ...Object.keys(i.secrets.fields)]) keys.add(k);
  const cols = [...keys].sort();
  const lines = [["title", "kind", ...cols, "notes", "tags"].join(",")];
  for (const i of items) {
    const all = { ...i.summary.fields, ...i.secrets.fields };
    lines.push([i.summary.title, i.kind, ...cols.map((k) => all[k] ?? ""), i.secrets.notes, i.summary.tags.join(" ")].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

const KDF = { m: 65536, t: 3, p: 1 } as const;
const MAGIC = "folevi-vault-export-1";

async function exportKey(passphrase: string, salt: Uint8Array) {
  const raw = await passphraseKdfBytes(passphrase, { name: "argon2id", ...KDF, salt });
  try {
    return await importAead(await hkdf(raw, "vault/export"));
  } finally {
    raw.fill(0);
  }
}

/** An encrypted backup: JSON of the items sealed with a key from `passphrase` (Argon2id). */
export async function encryptedExport(vaultId: string, items: ItemContent[], passphrase: string): Promise<string> {
  const salt = randomBytes(16);
  const exportId = toBase64Url(randomBytes(12));
  const key = await exportKey(passphrase, salt);
  const body = await sealRecord(key, 1, vaultCtx.exportFile(vaultId, exportId), new TextEncoder().encode(JSON.stringify({ items, exportedAt: Date.now() })));
  return JSON.stringify({ format: MAGIC, vaultId, exportId, kdf: { name: "argon2id", ...KDF, salt: toBase64Url(salt) }, body: toBase64Url(body) });
}

/** Opens an encrypted backup with its passphrase (throws on a wrong one). */
export async function openEncryptedExport(file: string, passphrase: string): Promise<ItemContent[]> {
  const f = JSON.parse(file) as { format: string; vaultId: string; exportId: string; kdf: { salt: string }; body: string };
  if (f.format !== MAGIC) throw new Error("This isn't a Folevi Vault backup.");
  const key = await exportKey(passphrase, fromBase64Url(f.kdf.salt));
  const plain = await openRecord(key, vaultCtx.exportFile(f.vaultId, f.exportId), fromBase64Url(f.body));
  return (JSON.parse(new TextDecoder().decode(plain)) as { items: ItemContent[] }).items;
}
