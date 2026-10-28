// Importing files into a space (Settings > Import & export): Evernote, Word, HTML and CSV by themselves, everything
// else (Markdown, text, folders, ZIPs) as a bundle, which may be a Notion export; folders made as the source has
// them; images uploaded once. The web's section and the Mac's native one (through the engine) both run this.
import type { WireScope } from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { errorMessage } from "@/components/ui/Toast";
import { uploadFileNow } from "@/lib/sync/uploads";
import { entriesFromFiles, entryMap } from "@/components/doc/importBundle";
import { csvDoc, docxDoc, evernoteDocs, htmlDoc, isNotionExport, loadMarkdown, markdownDocs, notionDocs, type ImportDoc, type ImportImage } from "@/lib/import/sources";
import { folderPathOf, planFolders } from "@/lib/import/folders";

export type ImportResult = { name: string; id?: string; warnings: { line?: number; message: string }[]; error?: string; images?: number };

/** Pages per import (a Notion export is often hundreds); the rest can follow in another one. */
export const MAX_DOCS = 400;

type Client = { query(ref: never, args: never): Promise<unknown> } & Parameters<typeof uploadFileNow>[0];

export async function importFiles(
  client: Client,
  scope: WireScope,
  files: File[],
  o: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    importText: (args: any) => Promise<{ document: { id: string }; warnings: { line?: number; message: string }[] }>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createFolder: (args: any) => Promise<unknown>;
    onProgress?: (text: string) => void;
    onResults?: (results: ImportResult[]) => void;
    onNote?: (text: string) => void;
  },
): Promise<ImportResult[]> {
  const setProgress = o.onProgress ?? (() => undefined);
  const out: ImportResult[] = [];
  const { importText, createFolder } = o;
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
      if (docs.length > MAX_DOCS) o.onNote?.(`Importing the first ${MAX_DOCS} of ${docs.length} pages. Import the rest in another batch.`);
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
      const plan = planFolders(paths, paths.length ? ((await client.query(api.organization.sidebar as never, { scope } as never)) as { folders: never[] }).folders : []);
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
        o.onResults?.([...out]);
      }
  } catch (err) {
    out.push({ name: "Import", warnings: [], error: errorMessage(err) });
  }
  return out;
}
