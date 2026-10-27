"use client";
// Files & Notes (docs/VAULT_PLAN.md §5): folders (names opened on this device), files encrypted here before upload and
// decrypted here after download (the server logs each download), and notes (plain text for now, each save kept as a
// version; the rich editor comes later).
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, FilePlus2, FileText, FolderPlus, Upload } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { FolderGlyph } from "@/components/ui/FolderGlyph";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { formatRelative } from "@/lib/format";
import { vaultSessions } from "@/lib/vault/keys";
import { newItemId } from "@/lib/vault/items";
import { openFile, openFileSummary, openFolderName, openNote, openNoteSummary, sealFile, sealFolderName, sealNote } from "@/lib/vault/files";
import { useRecordEvent } from "./useVault";
import { NoteEditor } from "./NoteEditor";

const keysOf = (vaultId: string) => (version: number) => vaultSessions().keys(vaultId, version);
const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

type Entry = { id: string; kind: "note" | "file"; title: string; detail: string; updatedAt: number; row: { id: string; keyVersion: number; wrappedKey: ArrayBuffer; sealedSummary: ArrayBuffer; revision: number } };

export function Files({ vaultId }: { vaultId: string }) {
  const [folderId, setFolderId] = useState<string | null>(null);
  const folders = useQuery(api.vaultFiles.folders, { vaultId });
  const items = useQuery(api.vaultItems.list, { vaultId, section: "files", folderId });
  const createFolder = useMutation(api.vaultFiles.createFolder);
  const createNote = useMutation(api.vaultFiles.createNote);
  const uploadUrl = useMutation(api.vaultFiles.uploadUrl);
  const saveFile = useMutation(api.vaultFiles.saveFile);
  const fileUrl = useMutation(api.vaultFiles.fileUrl);
  const record = useRecordEvent(vaultId);
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [entries, setEntries] = useState<Entry[] | undefined>(undefined);
  const [naming, setNaming] = useState<"folder" | "note" | null>(null);
  const [note, setNote] = useState<Entry | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!folders) return;
    void Promise.all(folders.map(async (f) => [f.id, await openFolderName(vaultId, f.id, f.sealedName, keysOf(vaultId), f.keyVersion).catch(() => "Can't open")] as const)).then((r) => setNames(Object.fromEntries(r)));
  }, [folders, vaultId]);
  useEffect(() => {
    if (!items) return;
    void Promise.all(
      items.items.map(async (row): Promise<Entry> => {
        if (row.kind === "file") {
          const s = await openFileSummary(vaultId, row, keysOf(vaultId)).catch(() => ({ title: "Can't open", size: 0, mime: "" }));
          return { id: row.id, kind: "file", title: s.title, detail: size(row.size ?? s.size), updatedAt: row.updatedAt, row };
        }
        const s = await openNoteSummary(vaultId, row, keysOf(vaultId)).catch(() => ({ title: "Can't open", excerpt: "" }));
        return { id: row.id, kind: "note", title: s.title, detail: s.excerpt, updatedAt: row.updatedAt, row };
      }),
    ).then(setEntries);
  }, [items, vaultId]);

  const here = (folders ?? []).filter((f) => f.parentId === folderId);
  const parent = folderId ? ((folders ?? []).find((f) => f.id === folderId)?.parentId ?? null) : null;
  const s = vaultSessions();

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const id = newItemId();
      const { ciphertext, item } = await sealFile(vaultId, id, s.currentVersion(vaultId)!, s.keys(vaultId), { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
      const res = await fetch(await uploadUrl({ vaultId }), { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: new Blob([ciphertext.slice()]) });
      if (!res.ok) throw new Error("The upload didn't go through. Try again.");
      const { storageId } = (await res.json()) as { storageId: string };
      await saveFile({ vaultId, itemId: id, ...(folderId ? { folderId } : {}), storageId: storageId as never, size: ciphertext.length, item, client: s.info(vaultId) });
      toast.show(`${file.name} added to the Vault`, { tone: "success" });
    } catch (e) {
      toast.show(errorMessage(e), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const download = async (e: Entry) => {
    try {
      const r = await fileUrl({ vaultId, itemId: e.id, purpose: "download", client: s.info(vaultId) });
      const bytes = new Uint8Array(await (await fetch(r.url)).arrayBuffer());
      const f = await openFile(vaultId, { id: e.id, keyVersion: r.keyVersion, wrappedKey: r.wrappedKey, sealed: r.sealed }, bytes, keysOf(vaultId));
      const url = URL.createObjectURL(new Blob([f.bytes.slice()], { type: f.mime }));
      const a = document.createElement("a");
      a.href = url;
      a.download = f.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      toast.show(errorMessage(err), { tone: "error" });
    }
  };

  return (
    <section aria-label="Files and notes">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {folderId ? (
          <Button variant="quiet" onClick={() => setFolderId(parent)}>
            <ChevronLeft size={14} aria-hidden /> {parent ? names[parent] : "Files & Notes"}
          </Button>
        ) : null}
        <h3 className="mr-auto truncate text-headline font-semibold text-heading">{folderId ? names[folderId] : "Files & Notes"}</h3>
        <Button variant="secondary" onClick={() => setNaming("folder")}>
          <FolderPlus size={14} aria-hidden /> Folder
        </Button>
        <Button variant="secondary" onClick={() => setNaming("note")}>
          <FilePlus2 size={14} aria-hidden /> Note
        </Button>
        <Button variant="primary" disabled={busy} onClick={() => input.current?.click()}>
          <Upload size={14} aria-hidden /> {busy ? "Encrypting…" : "Upload"}
        </Button>
        <input ref={input} type="file" hidden onChange={(e) => (e.target.files?.[0] ? void upload(e.target.files[0]) : undefined, (e.target.value = ""))} />
      </div>
      {here.length ? (
        <ul className="mb-4 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
          {here.map((f) => (
            <li key={f.id}>
              <button type="button" onClick={() => (setFolderId(f.id), record("folder.open"))} className="flex w-full items-center gap-2 rounded-control ui-card px-3 py-2.5 text-left hover:bg-surface">
                <FolderGlyph color={null} size={17} />
                <span className="truncate text-subheadline font-medium text-ink">{names[f.id] ?? "…"}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {entries === undefined ? (
        <div className="h-24 animate-pulse rounded-chip bg-surface motion-reduce:animate-none" aria-busy />
      ) : !entries.length ? (
        here.length ? null : <EmptyState icon={FileText} title="Nothing here yet" body="Upload files of any kind, or write a note. They're encrypted on this device before they leave it." />
      ) : (
        <ul className="divide-y divide-line overflow-hidden ui-card rounded-control">
          {entries.map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => (e.kind === "file" ? void download(e) : setNote(e))} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface">
                {e.kind === "file" ? <Upload size={15} aria-hidden className="flex-none text-muted" /> : <FileText size={15} aria-hidden className="flex-none text-muted" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{e.title}</span>
                  <span className="block truncate text-footnote text-muted">{e.detail}</span>
                </span>
                <span className="text-footnote text-faint">{formatRelative(e.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <PromptDialog
        open={naming !== null}
        title={naming === "folder" ? "New folder" : "New note"}
        label={naming === "folder" ? "Folder name" : "Title"}
        confirmLabel="Create"
        onClose={() => setNaming(null)}
        onSubmit={async (name) => {
          try {
            const version = s.currentVersion(vaultId)!;
            const id = newItemId();
            if (naming === "folder") await createFolder({ vaultId, folderId: id, ...(folderId ? { parentId: folderId } : {}), sealedName: await sealFolderName(vaultId, id, version, s.keys(vaultId), name), keyVersion: version, client: s.info(vaultId) });
            else await createNote({ vaultId, itemId: id, ...(folderId ? { folderId } : {}), item: await sealNote(vaultId, id, version, s.keys(vaultId), name, { type: "doc", content: [{ type: "paragraph" }] }, ""), client: s.info(vaultId) });
          } catch (e) {
            toast.show(errorMessage(e), { tone: "error" });
          }
        }}
      />
      {note ? <NoteDialog vaultId={vaultId} entry={note} onClose={() => setNote(null)} /> : null}
    </section>
  );
}

function NoteDialog({ vaultId, entry, onClose }: { vaultId: string; entry: Entry; onClose: () => void }) {
  const open = useMutation(api.vaultItems.open);
  const save = useMutation(api.vaultFiles.saveNote);
  const toast = useToast();
  const [doc, setDoc] = useState<unknown>(undefined);
  const [edited, setEdited] = useState<{ doc: unknown; text: string } | null>(null);
  const [revision, setRevision] = useState(entry.row.revision);
  const [canChange, setCanChange] = useState(false);
  useEffect(() => {
    void open({ vaultId, itemId: entry.id, client: vaultSessions().info(vaultId) }).then(async (r) => {
      const c = await openNote(vaultId, { id: r.id, keyVersion: r.keyVersion, wrappedKey: r.wrappedKey, sealed: r.sealed }, keysOf(vaultId));
      setDoc(c.doc ?? null);
      setRevision(r.revision);
      setCanChange(r.canChange);
    });
  }, [open, vaultId, entry.id]);
  const s = vaultSessions();
  return (
    <Dialog
      open
      onClose={onClose}
      title={entry.title}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          {canChange ? (
            <Button
              variant="primary"
              disabled={!edited}
              onClick={() =>
                void (async () => {
                  if (!edited) return;
                  const version = s.currentVersion(vaultId)!;
                  const r = await save({ vaultId, itemId: entry.id, baseRevision: revision, item: await sealNote(vaultId, entry.id, version, s.keys(vaultId), entry.title, edited.doc, edited.text.replace(/\s+/g, " ").trim().slice(0, 160)), client: s.info(vaultId) });
                  setRevision(r.revision);
                  setEdited(null);
                  toast.show("Saved");
                })().catch((e) => toast.show(errorMessage(e), { tone: "error" }))
              }
            >
              Save
            </Button>
          ) : null}
        </>
      }
    >
      {doc === undefined ? <div className="h-40 animate-pulse rounded-chip bg-surface motion-reduce:animate-none" aria-busy /> : <NoteEditor initial={doc} editable={canChange} onChange={(d, text) => setEdited({ doc: d, text })} />}
    </Dialog>
  );
}
