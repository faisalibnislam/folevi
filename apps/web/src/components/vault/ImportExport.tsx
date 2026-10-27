"use client";
// Importing and exporting passwords (docs/VAULT_PLAN.md §4). Import: a CSV from 1Password, Bitwarden, LastPass,
// Chrome, Safari or Firefox, or a Folevi Vault backup; every item is sealed on this device before it's sent. Export
// (custodians; the owner of a Personal Vault): an encrypted backup with a passphrase, or a readable CSV after a
// warning. Both are logged, and custodians are told about an export.
import { useMutation } from "convex/react";
import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { vaultSessions } from "@/lib/vault/keys";
import { newItemId, openSecrets, openSummary, sealItem, type ItemContent } from "@/lib/vault/items";
import { encryptedExport, itemsFromCsv, itemsToCsv, openEncryptedExport } from "@/lib/vault/importExport";
import { passwordStrength } from "@/lib/vault/generator";

const BATCH = 100;

function save(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

type Ask = { kind: "backupPassphrase"; file: string } | { kind: "exportEncrypted" } | { kind: "exportCsv" } | null;

export function ImportExport({ vaultId, canExport }: { vaultId: string; canExport: boolean }) {
  const importBatch = useMutation(api.vaultItems.importBatch);
  const exportPage = useMutation(api.vaultItems.exportPage);
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const s = vaultSessions();

  const send = async (source: string, items: ItemContent[]) => {
    const version = s.currentVersion(vaultId)!;
    const importId = newItemId();
    for (let i = 0; i < items.length; i += BATCH) {
      setBusy(`Encrypting ${Math.min(i + BATCH, items.length)} of ${items.length}…`);
      const batch = await Promise.all(
        items.slice(i, i + BATCH).map(async (c) => {
          const pw = c.secrets.fields.password;
          // Strength now; the breach check runs when each item is next saved (one request per password is too many here).
          if (pw) c.summary.health = { strength: passwordStrength(pw).score, breached: "unknown", checkedAt: Date.now() };
          const itemId = newItemId();
          return { itemId, kind: c.kind, item: await sealItem(vaultId, itemId, version, s.keys(vaultId), c) };
        }),
      );
      await importBatch({ vaultId, importId, source, items: batch, client: s.info(vaultId) });
    }
  };

  const importFile = async (file: File) => {
    const text = await file.text();
    if (text.trimStart().startsWith("{")) return setAsk({ kind: "backupPassphrase", file: text });
    try {
      const { source, items, skipped } = itemsFromCsv(text);
      if (!items.length) return void toast.show("Nothing in that file could be imported.", { tone: "error" });
      await send(source, items);
      toast.show(`Imported ${items.length} from ${source}${skipped ? ` (${skipped} skipped)` : ""}. Delete the file now: it isn't encrypted.`, { tone: "success" });
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const everything = async (format: "encrypted" | "csv"): Promise<ItemContent[]> => {
    const out: ItemContent[] = [];
    const keysOf = (v: number) => s.keys(vaultId, v);
    let after: string | null = null;
    for (;;) {
      const page: Awaited<ReturnType<typeof exportPage>> = await exportPage({ vaultId, after, format, client: s.info(vaultId) });
      for (const row of page.items) {
        const summary = await openSummary(vaultId, row, keysOf);
        const secrets = await openSecrets(vaultId, row, keysOf);
        const { kind, ...rest } = summary;
        out.push({ kind, summary: rest, secrets });
      }
      if (page.next === null) return out;
      after = page.next;
    }
  };

  const finish = async () => {
    const current = ask;
    const phrase = passphrase;
    setBusy("Working…");
    try {
      if (current?.kind === "backupPassphrase") {
        const items = await openEncryptedExport(current.file, phrase);
        await send("Folevi backup", items);
        toast.show(`Imported ${items.length} from the backup`, { tone: "success" });
      } else if (current?.kind === "exportEncrypted") {
        const items = await everything("encrypted");
        save(`Folevi Vault backup ${new Date().toISOString().slice(0, 10)}.json`, await encryptedExport(vaultId, items, phrase), "application/json");
        toast.show(`Exported ${items.length}, encrypted with your passphrase`);
      } else if (current?.kind === "exportCsv") {
        const items = await everything("csv");
        save(`Folevi Vault passwords ${new Date().toISOString().slice(0, 10)}.csv`, itemsToCsv(items), "text/csv");
        toast.show(`Exported ${items.length}. The file is readable: delete it when you're done.`);
      }
      setAsk(null);
      setPassphrase("");
    } catch (e) {
      toast.show(current?.kind === "backupPassphrase" ? "That passphrase doesn't open the backup." : errorMessage(e), { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const needsPassphrase = ask?.kind === "backupPassphrase" || ask?.kind === "exportEncrypted";
  return (
    <div className="space-y-2">
      <span className="block font-medium text-ink">Import and export</span>
      <span className="block text-footnote text-muted">Import a CSV from 1Password, Bitwarden, LastPass, Chrome, Safari or Firefox, or a Folevi Vault backup. Items are encrypted on this device before they're sent.</span>
      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          type="file"
          accept=".csv,.json,text/csv,application/json"
          className="hidden"
          aria-label="Choose a file to import"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void importFile(f);
          }}
        />
        <Button variant="secondary" disabled={busy !== null} onClick={() => input.current?.click()}>
          <Upload size={14} aria-hidden /> {busy ?? "Import…"}
        </Button>
        {canExport ? (
          <>
            <Button variant="secondary" disabled={busy !== null} onClick={() => setAsk({ kind: "exportEncrypted" })}>
              <Download size={14} aria-hidden /> Encrypted backup…
            </Button>
            <Button variant="secondary" disabled={busy !== null} onClick={() => setAsk({ kind: "exportCsv" })}>
              <Download size={14} aria-hidden /> Readable CSV…
            </Button>
          </>
        ) : null}
      </div>
      {ask ? (
        <Dialog
          open
          onClose={() => (setAsk(null), setPassphrase(""))}
          title={ask.kind === "backupPassphrase" ? "Open the backup" : ask.kind === "exportEncrypted" ? "Encrypted backup" : "Export a readable CSV?"}
          size="sm"
          footer={
            <>
              <Button onClick={() => (setAsk(null), setPassphrase(""))}>Cancel</Button>
              <Button variant="primary" disabled={busy !== null || (needsPassphrase && passphrase.length < (ask.kind === "exportEncrypted" ? 10 : 1))} onClick={() => void finish()}>
                {busy ?? (ask.kind === "backupPassphrase" ? "Import" : "Export")}
              </Button>
            </>
          }
        >
          <div className="space-y-3 pb-2 text-subheadline text-muted">
            {ask.kind === "exportCsv" ? <p>Every password, key and secret goes into a plain file that anyone who gets it can read. Custodians are told about the export, and it's in the log. Prefer the encrypted backup.</p> : null}
            {ask.kind === "exportEncrypted" ? <p>Choose a passphrase of at least 10 characters. Folevi can&apos;t open the file without it. Custodians are told about the export, and it&apos;s in the log.</p> : null}
            {needsPassphrase ? (
              <label htmlFor="vault-backup-passphrase" className="block">
                <span className="mb-1 block text-footnote font-medium text-ink">Passphrase</span>
                <input id="vault-backup-passphrase" type="password" autoFocus autoComplete="off" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} className="h-9 w-full ui-input rounded-chip px-3" />
              </label>
            ) : null}
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
