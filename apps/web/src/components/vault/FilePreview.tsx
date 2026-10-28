"use client";
// A Vault file opened on this device to look at (docs/VAULT_PLAN.md: "a file previewed" is logged by the server).
// The decrypted bytes stay in memory: a blob URL made here and revoked when the preview moves on, closes, or the Vault
// locks (locking unmounts it). Images, PDFs (drawn by pdf.js, which never runs a PDF's scripts), text and code
// (CSV as a table), audio and video; anything else gets a card with Download. ← and → move through the folder's files.
import { useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, File as FileIcon } from "lucide-react";
import { api } from "@/lib/convex/api";
import { Button, IconButton } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { errorMessage } from "@/components/ui/Toast";
import { formatRelative } from "@/lib/format";
import { vaultSessions } from "@/lib/vault/keys";
import { fetchCiphertext, openFile } from "@/lib/vault/files";
import { pdfjs } from "@/lib/fileText/pdf";

export type PreviewFile = { id: string; title: string; detail: string; updatedAt: number };
type Kind = "image" | "pdf" | "text" | "csv" | "audio" | "video" | "other";
type Opened = { name: string; mime: string; bytes: Uint8Array; url: string; kind: Kind };

/** Text shown at most (a bigger text file shows its start, with Download for the rest). */
const MAX_TEXT_CHARS = 400_000;
/** CSV rows and PDF pages drawn at most. */
const MAX_ROWS = 500;
const MAX_PAGES = 60;

const TEXT_EXT = /\.(txt|md|markdown|log|json|ya?ml|toml|ini|env|xml|html?|css|scss|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|zsh|bash|sql|graphql|conf|pem|pub|key|crt)$/i;

function kindOf(name: string, mime: string): Kind {
  if (/^image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)$/.test(mime) || /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(name)) return "image";
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (mime === "text/csv" || /\.csv$/i.test(name)) return "csv";
  if (mime.startsWith("audio/") || /\.(mp3|m4a|wav|ogg|oga|flac|aac)$/i.test(name)) return "audio";
  if (mime.startsWith("video/") || /\.(mp4|m4v|webm|mov|ogv)$/i.test(name)) return "video";
  if (mime.startsWith("text/") || /^application\/(json|xml|x-yaml|yaml|toml|javascript|x-sh|sql)$/.test(mime) || TEXT_EXT.test(name)) return "text";
  return "other";
}

/** The type to give the blob: SVG only ever as an image (an <img> never runs its scripts); others as they are. */
const blobType = (kind: Kind, mime: string) => (kind === "image" || kind === "audio" || kind === "video" || kind === "pdf" ? mime || "application/octet-stream" : "text/plain");

/** A small CSV reader: quoted fields, doubled quotes, commas and line breaks inside quotes. */
function parseCsv(text: string, max: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length && rows.length < max; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if ((field || row.length) && rows.length < max) rows.push([...row, field]);
  return rows;
}

function PdfPages({ bytes }: { bytes: Uint8Array }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [state, setState] = useState<{ pages: number; shown: number } | "error" | null>(null);
  useEffect(() => {
    if (!host) return;
    let gone = false;
    let destroy: (() => void) | undefined;
    void (async () => {
      try {
        const lib = await pdfjs();
        // Scripts in a PDF never run: pdf.js doesn't evaluate them, and only the page is drawn (no form or link layer).
        const task = lib.getDocument({ data: bytes.slice(), stopAtErrors: false });
        destroy = () => void task.destroy();
        const doc = await task.promise;
        const shown = Math.min(doc.numPages, MAX_PAGES);
        if (!gone) setState({ pages: doc.numPages, shown });
        const width = host.clientWidth || 800;
        for (let n = 1; n <= shown && !gone; n++) {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(2.5, width / base.width) * (window.devicePixelRatio || 1);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.className = "mx-auto mb-3 block w-full max-w-full rounded-tiny bg-white shadow-sm";
          canvas.setAttribute("aria-label", `Page ${n}`);
          canvas.setAttribute("role", "img");
          host.appendChild(canvas);
          await page.render({ canvas, viewport }).promise;
        }
      } catch {
        if (!gone) setState("error");
      }
    })();
    return () => {
      gone = true;
      destroy?.();
      host.replaceChildren();
    };
  }, [host, bytes]);
  return (
    <div>
      {state === "error" ? <p className="py-10 text-center text-subheadline text-muted">This PDF couldn't be shown. Download it to open it.</p> : null}
      <div ref={setHost} />
      {state && state !== "error" && state.pages > state.shown ? <p className="py-3 text-center text-footnote text-muted">The first {state.shown} of {state.pages} pages. Download it for the rest.</p> : null}
    </div>
  );
}

function Body({ file }: { file: Opened }) {
  const text = file.kind === "text" || file.kind === "csv" ? new TextDecoder().decode(file.bytes.subarray(0, MAX_TEXT_CHARS * 2)).slice(0, MAX_TEXT_CHARS) : "";
  switch (file.kind) {
    case "image":
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={file.url} alt={file.name} className="mx-auto max-h-[70vh] max-w-full rounded-tiny object-contain" />;
    case "pdf":
      return <PdfPages bytes={file.bytes} />;
    case "audio":
      return <audio src={file.url} controls className="w-full" />;
    case "video":
      return <video src={file.url} controls className="mx-auto max-h-[70vh] max-w-full rounded-tiny" />;
    case "csv": {
      const rows = parseCsv(text, MAX_ROWS + 1);
      const [head, ...rest] = rows;
      return (
        <div className="max-h-[70vh] overflow-auto rounded-control border border-line">
          <table className="w-full border-collapse text-footnote">
            {head ? (
              <thead className="sticky top-0 bg-surface">
                <tr>
                  {head.map((h, i) => (
                    <th key={i} scope="col" className="border-b border-line px-3 py-2 text-left font-semibold text-heading">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody>
              {rest.slice(0, MAX_ROWS).map((r, i) => (
                <tr key={i} className="border-b border-line/60 last:border-0">
                  {r.map((c, j) => (
                    <td key={j} className="whitespace-pre-wrap px-3 py-1.5 align-top text-ink">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > MAX_ROWS ? <p className="px-3 py-2 text-footnote text-muted">The first {MAX_ROWS} rows. Download it for the rest.</p> : null}
        </div>
      );
    }
    case "text":
      return (
        <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-control border border-line bg-surface p-4 font-mono text-footnote text-ink">
          {text}
          {file.bytes.length > MAX_TEXT_CHARS ? "\n\n… Download it for the rest." : ""}
        </pre>
      );
    default:
      return null;
  }
}

export function FilePreview({ vaultId, files, startId, onClose, onDownload }: { vaultId: string; files: PreviewFile[]; startId: string; onClose: () => void; onDownload: (f: PreviewFile) => void }) {
  const fileUrl = useMutation(api.vaultFiles.fileUrl);
  const [index, setIndex] = useState(() => Math.max(0, files.findIndex((f) => f.id === startId)));
  const [opened, setOpened] = useState<Opened | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = files[index];

  useEffect(() => {
    if (!current) return;
    let gone = false;
    let url: string | null = null;
    setOpened(null);
    setError(null);
    void (async () => {
      try {
        const s = vaultSessions();
        const r = await fileUrl({ vaultId, itemId: current.id, purpose: "preview", client: s.info(vaultId) });
        const bytes = await fetchCiphertext(r.url);
        const f = await openFile(vaultId, { id: current.id, keyVersion: r.keyVersion, wrappedKey: r.wrappedKey, sealed: r.sealed }, bytes, (v) => s.keys(vaultId, v));
        if (gone) return;
        const kind = kindOf(f.name, f.mime);
        url = kind === "other" ? "" : URL.createObjectURL(new Blob([f.bytes.slice()], { type: blobType(kind, f.mime) }));
        setOpened({ ...f, url, kind });
      } catch (e) {
        if (!gone) setError(errorMessage(e));
      }
    })();
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [current, fileUrl, vaultId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, audio, video")) return;
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, files.length - 1));
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [files.length]);

  if (!current) return null;
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={current.title}
      description={`${current.detail} · ${formatRelative(current.updatedAt)}${files.length > 1 ? ` · ${index + 1} of ${files.length}` : ""}`}
      footer={
        <>
          {files.length > 1 ? (
            <span className="mr-auto flex gap-1">
              <IconButton label="Previous file" onClick={() => setIndex((i) => Math.max(i - 1, 0))} disabled={index === 0}>
                <ChevronLeft size={16} aria-hidden />
              </IconButton>
              <IconButton label="Next file" onClick={() => setIndex((i) => Math.min(i + 1, files.length - 1))} disabled={index === files.length - 1}>
                <ChevronRight size={16} aria-hidden />
              </IconButton>
            </span>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={() => onDownload(current)}>
            <Download size={14} aria-hidden /> Download
          </Button>
        </>
      }
    >
      <div className="min-h-48">
        {error ? (
          <p className="py-10 text-center text-subheadline text-danger">{error}</p>
        ) : !opened ? (
          <div className="h-48 animate-pulse rounded-control bg-surface motion-reduce:animate-none" aria-busy aria-label="Decrypting" />
        ) : opened.kind === "other" ? (
          <div className="flex flex-col items-center py-10 text-center">
            <span className="mb-3 grid h-14 w-14 place-items-center rounded-control bg-[var(--glass-hover)] text-heading">
              <FileIcon size={24} aria-hidden />
            </span>
            <p className="text-subheadline font-medium text-ink">{opened.name}</p>
            <p className="mt-1 text-footnote text-muted">This kind of file can't be shown here. Download it to open it on this device.</p>
          </div>
        ) : (
          <Body file={opened} />
        )}
      </div>
    </Dialog>
  );
}
