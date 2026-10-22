"use client";

import { useAction, useConvex, useMutation } from "convex/react";
import { useCapabilities } from "@/lib/mode";
import { useEffect, useRef, useState } from "react";
import { FolderUp, Upload } from "lucide-react";
import { api } from "@/lib/convex/api";
import type { WireScope } from "@folevi/editor-schema";
import { AppLink, useAppRouter } from "@/lib/app/router";
import { useIphoneApp } from "@/lib/iphone";
import { ActionRow, IosRow, IosSection, IosText, Subscreen } from "@/components/iphone/SettingsKit";
import { RowIcon } from "@/components/iphone/Grouped";
import { Button } from "@/components/ui/Button";
import { useToast, errorMessage } from "@/components/ui/Toast";
import { uploadFileNow } from "@/lib/sync/uploads";
import { entriesFromFiles, entryMap } from "@/components/doc/importBundle";
import { csvDoc, docxDoc, evernoteDocs, htmlDoc, isNotionExport, loadMarkdown, markdownDocs, notionDocs, type ImportDoc, type ImportImage } from "@/lib/import/sources";
import { folderPathOf, planFolders } from "@/lib/import/folders";
import { Card } from "./Card";
import { EmailToNoteCard } from "./EmailToNote";
import { SaveFromAnywhereCard } from "./SaveFromAnywhere";
import { MoveBetweenModes } from "@/components/migrate/MoveBetweenModes";
import { TakeoutCard } from "@/components/places/TakeoutCard";

type Result = { name: string; id?: string; warnings: { line?: number; message: string }[]; error?: string; images?: number };

/** Pages per import (a Notion export is often hundreds); the rest can follow in another one. */
const MAX_DOCS = 400;

/** Where to import into and export from: your Personal, or a team workspace (under that workspace's settings). */
export type DataTarget = { kind: "personal" } | { kind: "workspace"; workspaceId: string; name: string };

export function DataSection({ target }: { target: DataTarget }) {
  const scope: WireScope = target.kind === "personal" ? { kind: "personal" } : { kind: "workspace", workspaceId: target.workspaceId };
  const where = target.kind === "personal" ? "Personal" : target.name;
  const client = useConvex();
  // Local mode: no email-to-note address or bookmarklet (they save through Folevi's servers).
  const caps = useCapabilities();
  const importText = useMutation(api.imports.importText);
  const createFolder = useMutation(api.organization.createFolder);
  const exportScope = useAction(api.exports.exportScope);
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [exportNote, setExportNote] = useState<string | null>(null);
  const iphone = useIphoneApp();
  const { navigate } = useAppRouter();

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
      // Each kind of file becomes pages: Evernote, Word, HTML and CSV by themselves; everything else
      // (Markdown, text, folders, ZIPs, and the Word and HTML files inside a ZIP) as a bundle, which may be a
      // Notion export.
      const docs: ImportDoc[] = [];
      const rest: File[] = [];
      for (const f of files) {
        try {
          // In a picked folder, a Word, HTML or CSV file goes in the folder its path names, like the rest.
          const inFolder = (doc: ImportDoc): ImportDoc => {
            const folderPath = folderPathOf((f as File & { webkitRelativePath?: string }).webkitRelativePath ?? "");
            return folderPath.length ? { ...doc, folderPath } : doc;
          };
          if (/\.enex$/i.test(f.name)) docs.push(...(await evernoteDocs(f)));
          else if (/\.docx$/i.test(f.name)) docs.push(inFolder(await docxDoc(f)));
          else if (/\.html?$/i.test(f.name)) docs.push(inFolder(await htmlDoc(f)));
          else if (/\.csv$/i.test(f.name) && files.length === 1) docs.push(await csvDoc(f));
          else rest.push(f);
        } catch (err) {
          out.push({ name: f.name, warnings: [], error: errorMessage(err) });
        }
      }
      if (rest.length) {
        const { entries, errors } = await entriesFromFiles(rest);
        for (const e of errors) out.push({ name: e.name, warnings: [], error: e.message });
        const map = entryMap(entries);
        docs.push(...(isNotionExport(entries) ? await notionDocs(entries, map) : markdownDocs(entries, map)));
      }
      if (!docs.length && !out.length) out.push({ name: files.length === 1 ? files[0]!.name : `${files.length} files`, warnings: [], error: "Nothing to import here. Folevi imports Markdown, text, Notion and Evernote exports, Word, HTML and CSV files." });
      if (docs.length > MAX_DOCS) toast.show(`Importing the first ${MAX_DOCS} of ${docs.length} pages. Import the rest in another batch.`);
      // An image used by several pages is uploaded once.
      const uploaded = new Map<Blob, Promise<string>>();
      const upload = (img: ImportImage) => {
        let p = uploaded.get(img.blob);
        if (!p) {
          p = uploadFileNow(client, { scope, blob: img.blob, filename: img.filename, mimeType: img.mime, kind: "image" });
          uploaded.set(img.blob, p);
        }
        return p;
      };
      const imported = new Map<string, string>(); // path → page id, for nesting
      const list = docs.slice(0, MAX_DOCS);
      // The folders the pages go in: the source's tree, reusing folders of the same name already there.
      const paths = list.flatMap((d) => (d.folderPath?.length ? [d.folderPath] : []));
      const plan = planFolders(paths, paths.length ? (await client.query(api.organization.sidebar, { scope })).folders : []);
      if (plan.steps.length) setProgress(plan.steps.length === 1 ? "Making 1 folder…" : `Making ${plan.steps.length} folders…`);
      for (const step of plan.steps) await createFolder({ scope, id: step.id, name: step.name, ...(step.parentFolderId ? { parentFolderId: step.parentFolderId } : {}) });
      for (const [i, doc] of list.entries()) {
        setProgress(`Importing ${i + 1} of ${list.length}: ${doc.name}`);
        try {
          await loadMarkdown(doc);
          const imageMap: Record<string, string> = {};
          let images = 0;
          for (const [src, img] of doc.images) {
            try {
              imageMap[src] = await upload(img);
              images++;
            } catch (err) {
              doc.warnings.push({ message: `Image “${img.filename}” couldn’t be uploaded: ${errorMessage(err)}` });
            }
          }
          const parentId = doc.parentPath ? imported.get(doc.parentPath) : undefined;
          const r = await importText({
            scope,
            filename: doc.filename,
            content: doc.content,
            format: doc.format,
            imageMap: images ? imageMap : undefined,
            publicId: doc.publicId,
            ...(parentId ? { parentId } : {}),
            ...(doc.links ? { links: doc.links } : {}),
            ...(doc.folderPath?.length ? { folderId: plan.folderId(doc.folderPath)! } : {}),
          });
          imported.set(doc.path, r.document.id);
          out.push({ name: doc.name, id: r.document.id, warnings: [...doc.warnings, ...r.warnings], images });
        } catch (err) {
          out.push({ name: doc.name, warnings: [], error: errorMessage(err) });
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
    toast.show(`Imported ${ok} of ${out.length} ${out.length === 1 ? "page" : "pages"}`, { tone: ok === out.length ? "success" : "error" });
  };

  const runExport = async () => {
    setBusy(true);
    setExportNote(null);
    try {
      const r = await exportScope({ scope });
      // In the Mac app's local mode the ZIP is already saved where the person chose (no url to download).
      if (r.url) {
        const a = document.createElement("a");
        a.href = r.url;
        a.download = r.filename;
        a.click();
      }
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
      // Cancelled in the save dialog: nothing to say.
      if ((e as { data?: { code?: string } }).data?.code !== "cancelled") toast.show(errorMessage(e), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  const IMPORT_HELP =
    "Markdown and text files, a folder or a ZIP (an Obsidian vault works), a Notion export (Export, Markdown & CSV, as a ZIP), an Evernote export (.enex), Word documents (.docx), HTML and CSV files. Pages keep their headings, lists, to-dos, links, code, quotes, tables and images; Notion pages stay nested and linked, a folder or ZIP keeps its subfolders, and Evernote notes go into a folder named after the notebook. Anything we can't convert is kept as text and listed in the results.";
  const inputs = (
    <>
      <input
        ref={input}
        type="file"
        accept=".md,.markdown,.txt,.zip,.enex,.docx,.html,.htm,.csv,text/markdown,text/plain,text/html,text/csv,application/zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/gif,image/webp"
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
    </>
  );
  if (iphone) {
    const failed = results.filter((r) => r.error).length;
    return (
      <>
        <IosSection header={`Import into ${where}`} footer={IMPORT_HELP}>
          {inputs}
          <ActionRow label="Choose files" icon={<RowIcon><Upload /></RowIcon>} busy={busy ? "Importing…" : null} onClick={() => input.current?.click()} />
          <ActionRow label="Import a folder" icon={<RowIcon><FolderUp /></RowIcon>} disabled={busy} onClick={() => folderInput.current?.click()} />
          {progress ? (
            <IosText muted>
              <span role="status" aria-live="polite">
                {progress}
              </span>
            </IosText>
          ) : null}
          {results.length ? <IosRow label="Results" value={failed ? `${results.length - failed} imported, ${failed} failed` : `${results.length} imported`} screen="import-results" /> : null}
        </IosSection>
        <Subscreen id="import-results" title="Import results">
          <IosSection label="Import results">
            {results.map((r, i) => (
              <IosRow
                key={`${r.name}-${i}`}
                label={r.name}
                description={
                  r.error ? (
                    <span className="text-danger">{r.error}</span>
                  ) : (
                    [r.images ? (r.images === 1 ? "1 image uploaded" : `${r.images} images uploaded`) : null, ...r.warnings.map((w) => `${w.line ? `Line ${w.line}: ` : ""}${w.message}`)].filter(Boolean).join(" · ") || "Imported without changes."
                  )
                }
                onClick={r.id ? () => navigate(`/d/${r.id}`) : undefined}
                chevron={Boolean(r.id)}
              />
            ))}
          </IosSection>
        </Subscreen>
        {target.kind === "personal" && caps.emailToNote ? <EmailToNoteCard /> : null}
        {target.kind === "personal" && caps.account ? <SaveFromAnywhereCard /> : null}
        <IosSection
          header={`Export ${where}`}
          footer={exportNote ?? `A ZIP with every note in ${where} as Markdown (in folders matching your sidebar), all attachments in an assets folder, and a manifest.json describing folders, notes and files. One note can be exported from its … menu as Markdown, HTML or PDF.`}
        >
          <ActionRow label={`Export ${where} (.zip)`} busy={busy ? "Preparing…" : null} onClick={() => void runExport()} />
        </IosSection>
      </>
    );
  }
  return (
    <>
      <Card
        title={`Import into ${where}`}
        description="Markdown and text files, a folder or a ZIP (an Obsidian vault works), a Notion export (Export → Markdown & CSV, as a ZIP), an Evernote export (.enex), Word documents (.docx), HTML and CSV files. Pages keep their headings, lists, to-dos, links, code, quotes, tables and images; Notion pages stay nested and linked, a folder or ZIP keeps its subfolders, and Evernote notes go into a folder named after the notebook. Anything we can’t convert is kept as text and listed below."
      >
        {inputs}
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
              <li key={`${r.name}-${i}`} className="ui-card rounded-control p-3">
                <p className="font-medium">
                  {r.id ? (
                    <AppLink href={`/d/${r.id}`} className="hover:underline">
                      {r.name}
                    </AppLink>
                  ) : (
                    r.name
                  )}
                  {r.error ? <span className="ml-2 text-danger">{r.error}</span> : null}
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
      {target.kind === "personal" && caps.emailToNote ? <EmailToNoteCard /> : null}
      {target.kind === "personal" && caps.account ? <SaveFromAnywhereCard /> : null}
      {target.kind === "personal" ? <MoveBetweenModes /> : null}
      {target.kind === "personal" ? <TakeoutCard /> : null}
      <Card title={`Export ${where}`} description={`A ZIP with every document in ${where} as Markdown (in folders matching your sidebar), all attachments in an assets folder, and a manifest.json describing folders, documents and files. Single pages can be exported from their ••• menu as Markdown, HTML or PDF.`}>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => void runExport()}
        >
          {busy ? "Preparing…" : `Export ${where} (.zip)`}
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
