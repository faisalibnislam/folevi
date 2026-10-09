"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useConvex } from "convex/react";
import { FileAudio, FileCode, FileSpreadsheet, FileText, Image as ImageIcon, Loader2, Paperclip, Upload, X } from "lucide-react";
import type { WireScope } from "@folevi/editor-schema";
import { MenuButton, type MenuEntry } from "@/components/ui/Menu";
import { errorMessage } from "@/components/ui/Toast";
import { formatBytes } from "@/lib/format";
import { uploadFileNow } from "@/lib/sync/uploads";
import { checkAttachment, checkInlineBudget, MAX_ATTACHMENTS, type AttachmentKind, type ModelInputs } from "../../../../../../convex/lib/ai/attachments";

// Files in an AI chat (docs/AI_ASSISTANT.md, "Attachments"): the Attach control in the composer, the
// chips for what's attached, and the checks made before anything is uploaded. A file the assistant can't
// read (a Word file, a GIF, one too large) is refused here with the reason, never uploaded; the server
// checks every file again when the message is sent.

/** A file attached to the next message: uploading, or ready to send (its file id). */
export interface PendingFile {
  key: string;
  name: string;
  size: number;
  kind: AttachmentKind | "file";
  status: "uploading" | "ready";
  fileId?: string;
}

/** A file in a note the chat is about (aiAttachments.noteFiles). */
export interface NoteFileOption {
  id: string;
  name: string;
  size: number;
  kind: AttachmentKind | "file";
  noteTitle: string;
  supported: boolean;
  reason: string | null;
}

/** A file shown on a message (aiChat.get). */
export interface AttachmentInfo {
  id: string;
  name: string;
  size: number;
  kind: AttachmentKind | "file";
}

function KindIcon({ kind, size = 12 }: { kind: AttachmentKind | "file"; size?: number }) {
  const props = { size, "aria-hidden": true, className: "flex-none text-muted" } as const;
  if (kind === "image") return <ImageIcon {...props} />;
  if (kind === "audio") return <FileAudio {...props} />;
  if (kind === "csv") return <FileSpreadsheet {...props} />;
  if (kind === "html" || kind === "json") return <FileCode {...props} />;
  return <FileText {...props} />;
}

/**
 * Which picked files can be attached (the next ones up to MAX_ATTACHMENTS, each a kind the assistant reads,
 * within its size limit and what the model takes in, and all together within the inline limit) and which
 * are refused, each with the reason to show.
 */
export function planAttachments(
  attached: { kind: AttachmentKind | "file"; size: number }[],
  picked: { name: string; size: number; type: string }[],
  caps: ModelInputs | undefined,
): { accepted: { index: number; kind: AttachmentKind }[]; refused: { name: string; reason: string }[] } {
  const accepted: { index: number; kind: AttachmentKind }[] = [];
  const refused: { name: string; reason: string }[] = [];
  const kept = attached.filter((f): f is { kind: AttachmentKind; size: number } => f.kind !== "file");
  picked.forEach((f, index) => {
    if (attached.length + accepted.length >= MAX_ATTACHMENTS) return refused.push({ name: f.name, reason: `Attach up to ${MAX_ATTACHMENTS} files to one message.` });
    const check = checkAttachment({ filename: f.name, mimeType: f.type, size: f.size }, caps);
    if (!check.ok) return refused.push({ name: f.name, reason: check.reason });
    const tooBig = checkInlineBudget([...kept, ...accepted.map((a) => ({ kind: a.kind, size: picked[a.index]!.size })), { kind: check.kind, size: f.size }]);
    if (tooBig) return refused.push({ name: f.name, reason: tooBig });
    accepted.push({ index, kind: check.kind });
  });
  return { accepted, refused };
}

/**
 * The files attached to the next message, and what was refused: picked files upload right away (to the
 * conversation's place, private to the person), a note's files are attached by id.
 */
export function useChatAttachments({ scope, caps }: { scope: WireScope; caps: ModelInputs | undefined }) {
  const client = useConvex();
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [problems, setProblems] = useState<{ name: string; reason: string }[]>([]);
  const seq = useRef(0);
  const filesRef = useRef(files);
  useLayoutEffect(() => {
    filesRef.current = files;
  }, [files]);

  const add = useCallback(
    (picked: File[]) => {
      const { accepted, refused } = planAttachments(filesRef.current, picked.map((f) => ({ name: f.name, size: f.size, type: f.type })), caps);
      setProblems(refused);
      for (const { index, kind } of accepted) {
        const file = picked[index]!;
        const key = `upload-${++seq.current}`;
        setFiles((list) => [...list, { key, name: file.name, size: file.size, kind, status: "uploading" }]);
        void uploadFileNow(client, { scope, blob: file, filename: file.name, mimeType: file.type || "application/octet-stream", kind: "attachment" })
          .then((fileId) => setFiles((list) => list.map((f) => (f.key === key ? { ...f, status: "ready", fileId } : f))))
          .catch((e) => {
            setFiles((list) => list.filter((f) => f.key !== key));
            setProblems((p) => [...p, { name: file.name, reason: errorMessage(e) }]);
          });
      }
    },
    [client, scope, caps],
  );

  const pick = useCallback((option: NoteFileOption) => {
    const list = filesRef.current;
    if (list.some((f) => f.fileId === option.id)) return;
    // A note's file was checked by the server (its kind and size): here, the count and the total.
    const reason = !option.supported
      ? (option.reason ?? "That file isn't supported yet.")
      : list.length >= MAX_ATTACHMENTS
        ? `Attach up to ${MAX_ATTACHMENTS} files to one message.`
        : option.kind === "file"
          ? null
          : checkInlineBudget([...list.filter((f): f is PendingFile & { kind: AttachmentKind } => f.kind !== "file"), { kind: option.kind, size: option.size }]);
    if (reason) return setProblems([{ name: option.name, reason }]);
    setProblems([]);
    setFiles((list) => [...list, { key: `note-${option.id}`, name: option.name, size: option.size, kind: option.kind, status: "ready", fileId: option.id }]);
  }, []);

  const remove = useCallback((key: string) => setFiles((list) => list.filter((f) => f.key !== key)), []);
  const clear = useCallback(() => {
    setFiles([]);
    setProblems([]);
  }, []);
  const dismiss = useCallback(() => setProblems([]), []);

  return {
    files,
    problems,
    add,
    pick,
    remove,
    clear,
    dismiss,
    uploading: files.some((f) => f.status === "uploading"),
    fileIds: files.flatMap((f) => (f.status === "ready" && f.fileId ? [f.fileId] : [])),
  };
}

const CHIP = "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-[var(--glass-hover)] pl-2.5 text-[12.5px] text-ink shadow-[inset_0_0_0_1px_var(--glass-border)]";

/** The files attached to a message (or to the next one, with × to take one off). */
export function AttachmentChips({ files, onRemove, disabled, className }: { files: (PendingFile | AttachmentInfo)[]; onRemove?: (key: string) => void; disabled?: boolean; className?: string }) {
  if (!files.length) return null;
  return (
    <ul aria-label="Attached files" className={`flex flex-wrap gap-1.5 ${className ?? ""}`}>
      {files.map((f) => {
        const key = "key" in f ? f.key : f.id;
        const uploading = "status" in f && f.status === "uploading";
        return (
          <li key={key} className={`${CHIP} ${onRemove ? "" : "pr-2.5"}`} title={`${f.name} · ${formatBytes(f.size)}`}>
            {uploading ? <Loader2 size={12} aria-hidden className="flex-none animate-spin text-muted motion-reduce:animate-none" /> : <KindIcon kind={f.kind} />}
            <span className="min-w-0 max-w-[12rem] truncate">{f.name}</span>
            {uploading ? <span className="sr-only">Uploading</span> : null}
            {onRemove ? (
              <button type="button" disabled={disabled} aria-label={`Remove ${f.name}`} onClick={() => onRemove(key)} className="mr-0.5 grid h-6 w-6 flex-none place-items-center rounded-full text-muted hover:bg-[var(--glass-active)] hover:text-heading disabled:opacity-50">
                <X size={12} aria-hidden />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Files that couldn't be attached, with why (shown before anything is sent). */
export function AttachmentProblems({ problems, onDismiss }: { problems: { name: string; reason: string }[]; onDismiss: () => void }) {
  if (!problems.length) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-[10px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
      <ul className="min-w-0 flex-1 space-y-0.5">
        {problems.map((p, i) => (
          <li key={`${p.name}-${i}`}>{p.reason}</li>
        ))}
      </ul>
      <button type="button" aria-label="Dismiss" onClick={onDismiss} className="grid h-5 w-5 flex-none place-items-center rounded-full hover:bg-[var(--glass-active)]">
        <X size={12} aria-hidden />
      </button>
    </div>
  );
}

/**
 * The Attach control: upload files from the device (a hidden file input behind the app's own button),
 * or pick a file from the notes the chat is about. Files that can't be read are listed but can't be picked.
 */
export function AttachControl({ noteFiles, onFiles, onPick, disabled, className }: { noteFiles: NoteFileOption[]; onFiles: (files: File[]) => void; onPick: (option: NoteFileOption) => void; disabled?: boolean; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const button = "grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-[var(--glass-active)] hover:text-heading disabled:opacity-30";
  const browse = () => input.current?.click();
  const items: MenuEntry[] = [{ label: "Upload from this device", icon: <Upload size={14} />, onSelect: browse }];
  if (noteFiles.length) {
    items.push("separator", { heading: new Set(noteFiles.map((f) => f.noteTitle)).size > 1 ? "In these notes" : "In this note" });
    for (const f of noteFiles) items.push({ label: f.name, icon: <KindIcon kind={f.kind} size={14} />, description: f.supported ? formatBytes(f.size) : (f.reason ?? "Not supported yet"), disabled: !f.supported, onSelect: () => onPick(f) });
  }
  return (
    <div className={className}>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const picked = [...(e.target.files ?? [])];
          e.target.value = "";
          if (picked.length) onFiles(picked);
        }}
      />
      {noteFiles.length && !disabled ? (
        <MenuButton label="Attach files" align="end" side="top" triggerClassName={button} trigger={<Paperclip size={16} aria-hidden />} items={items} />
      ) : (
        <button type="button" aria-label="Attach files" title="Attach files" disabled={disabled} onClick={browse} className={button}>
          <Paperclip size={16} aria-hidden />
        </button>
      )}
    </div>
  );
}
