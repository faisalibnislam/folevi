"use client";

import { useAction, useConvex, useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { FolderUp, Upload } from "lucide-react";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { AppLink } from "@/lib/app/router";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { uploadFileNow } from "@/lib/sync/uploads";
import { TEXT_EXT, entriesFromFiles, entryMap, imageMime, imageSources, resolveImage, type BundleEntry } from "@/components/doc/importBundle";
import { Card } from "./Card";

type Result = { name: string; id?: string; warnings: { line?: number; message: string }[]; error?: string; images?: number };

const MAX_DOCS = 50;

export function DataSection() {
  const { workspace } = useAppState();
  const client = useConvex();
  const importText = useMutation(api.imports.importText);
  const exportWorkspace = useAction(api.exports.exportWorkspace);
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [exportNote, setExportNote] = useState<string | null>(null);

  // Folder picking isn't in React's typed attributes.
  useEffect(() => {
    folderInput.current?.setAttribute("webkitdirectory", "");
    folderInput.current?.setAttribute("directory", "");
  }, []);

  const runImport = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    setResults([]);
    const out: Result[] = [];
    try {
      setProgress("Reading files…");
      const { entries, errors } = await entriesFromFiles(files);
      for (const e of errors) out.push({ name: e.name, warnings: [], error: e.message });
      const map = entryMap(entries);
      const docs = entries.filter((e) => TEXT_EXT.test(e.path));
      if (!docs.length && !errors.length) out.push({ name: files.length === 1 ? files[0]!.name : `${files.length} files`, warnings: [], error: "No Markdown (.md) or text (.txt) files found." });
      if (docs.length > MAX_DOCS) toast.show(`Importing the first ${MAX_DOCS} of ${docs.length} documents. Import the rest in another batch.`);
      // An image used by several documents is uploaded once.
      const uploaded = new Map<BundleEntry, Promise<string>>();
      const upload = (entry: BundleEntry) => {
        let p = uploaded.get(entry);
        if (!p) {
          const name = entry.path.split("/").pop() ?? "image";
          p = uploadFileNow(client, { workspaceId: workspace.id, blob: entry.blob, filename: name, mimeType: imageMime(entry.path) ?? "application/octet-stream", kind: "image" });
          uploaded.set(entry, p);
        }
        return p;
      };
      const list = docs.slice(0, MAX_DOCS);
      for (const [i, doc] of list.entries()) {
        const name = doc.path.split("/").pop() ?? doc.path;
        setProgress(`Importing ${i + 1} of ${list.length}: ${name}`);
        try {
          const content = await doc.blob.text();
          const markdown = !/\.(txt|text)$/i.test(doc.path);
          const imageMap: Record<string, string> = {};
          const warnings: Result["warnings"] = [];
          let images = 0;
          if (markdown) {
            for (const src of imageSources(content)) {
              const entry = resolveImage(map, doc.path, src);
              if (!entry) continue; // the importer reports it as an unresolved image
              if (!imageMime(entry.path)) {
                warnings.push({ message: `Image “${src}” isn’t a PNG, JPEG, GIF or WebP and was kept as a link` });
                continue;
              }
              try {
                imageMap[src] = await upload(entry);
                images++;
              } catch (err) {
                warnings.push({ message: `Image “${src}” couldn’t be uploaded: ${errorMessage(err)}` });
              }
            }
          }
          const r = await importText({ workspaceId: workspace.id, filename: name, content, format: markdown ? "markdown" : "text", imageMap: images ? imageMap : undefined });
          out.push({ name: doc.path, id: r.document.id, warnings: [...warnings, ...r.warnings], images });
        } catch (err) {
          out.push({ name: doc.path, warnings: [], error: errorMessage(err) });
        }
        setResults([...out]);
      }
    } catch (err) {
      out.push({ name: "Import", warnings: [], error: errorMessage(err) });
    } finally {
      setResults(out);
      setBusy(false);
      setProgress("");
    }
    const ok = out.filter((r) => r.id).length;
    toast.show(`Imported ${ok} of ${out.length} ${out.length === 1 ? "file" : "files"}`, { tone: ok === out.length ? "success" : "error" });
  };

  return (
    <>
      <Card
        title="Import"
        description="Markdown (.md) and plain text (.txt) files, a folder, or a ZIP. Images referenced by relative paths inside a folder or ZIP are uploaded with the page. Headings, lists, checklists, links, code, quotes, tables and the front-matter title are kept. Anything we can’t convert is kept as text and listed below."
      >
        <input
          ref={input}
          type="file"
          accept=".md,.markdown,.txt,.zip,text/markdown,text/plain,application/zip,image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            void runImport(files);
          }}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            void runImport(files);
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => input.current?.click()} disabled={busy}>
            <Upload size={14} aria-hidden /> {busy ? "Importing…" : "Choose files…"}
          </Button>
          <Button onClick={() => folderInput.current?.click()} disabled={busy}>
            <FolderUp size={14} aria-hidden /> Import a folder…
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted" role="status" aria-live="polite">
          {progress}
        </p>
        {results.length ? (
          <ul className="mt-3 space-y-2 text-sm" aria-label="Import results">
            {results.map((r, i) => (
              <li key={`${r.name}-${i}`} className="ui-card rounded-[8px] p-3">
                <p className="font-medium">
                  {r.id ? (
                    <AppLink href={`/d/${r.id}`} className="hover:underline">
                      {r.name}
                    </AppLink>
                  ) : (
                    r.name
                  )}
                  {r.error ? <span className="ml-2 text-danger">— {r.error}</span> : null}
                </p>
                {r.images ? <p className="text-xs text-muted">{r.images === 1 ? "1 image uploaded" : `${r.images} images uploaded`}</p> : null}
                {r.warnings.length ? (
                  <ul className="mt-1 list-disc pl-5 text-xs text-muted">
                    {r.warnings.map((w, j) => (
                      <li key={j}>
                        {w.line ? `Line ${w.line}: ` : ""}
                        {w.message}
                      </li>
                    ))}
                  </ul>
                ) : r.id ? (
                  <p className="text-xs text-muted">Imported without changes.</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      <Card title="Export workspace" description="A ZIP with every document as Markdown (in folders matching your sidebar), all attachments in an assets folder, and a manifest.json describing folders, documents and files. Single pages can be exported from their ••• menu as Markdown, HTML or PDF.">
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setExportNote(null);
            try {
              const r = await exportWorkspace({ workspaceId: workspace.id });
              const a = document.createElement("a");
              a.href = r.url;
              a.download = r.filename;
              a.click();
              const skipped = r.skippedAssets ?? [];
              if (skipped.length) {
                setExportNote(
                  `${skipped.length === 1 ? "1 attachment was" : `${skipped.length} attachments were`} left out because ${r.skippedReason === "size" ? "the export reached its 400 MB size limit" : "they couldn’t be read"}: ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? "…" : ""}. They’re listed in manifest.json.`,
                );
                toast.show(`Exported ${r.documents} documents; ${skipped.length} attachments were left out`, { tone: "error" });
              } else {
                toast.show(`Exported ${r.documents} documents and ${r.assets} attachments`, { tone: "success" });
              }
            } catch (e) {
              toast.show(errorMessage(e), { tone: "error" });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Preparing…" : "Export workspace (.zip)"}
        </Button>
        {exportNote ? (
          <p className="mt-2 text-xs text-muted" role="status">
            {exportNote}
          </p>
        ) : null}
      </Card>
    </>
  );
}
